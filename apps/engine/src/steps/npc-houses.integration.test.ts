import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
  type NpcHouses,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CloseStep } from '../close';
import { closeWorld } from '../scheduler';
import { NPC_HOUSE_BLAZON, npcHouses } from './npc-houses';

// Maisons PNJ de secours à la clôture (#715), contre Supabase local. Chaque test a son monde.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
/** Kallistè : le blé et la farine, 8 000 oboles ; Elaia : le blé, sans dotation ; Halos, absente des mondes d'essai. */
const SECOURS: NpcHouses = {
  kalliste: {
    treasuryCapOboles: 20_000,
    chains: [
      {
        id: 'bread',
        name: 'Greniers de Kallistè',
        sites: { grow_wheat: 2, mill_flour: 1 },
        grantOboles: 8_000,
      },
    ],
  },
  elaia: {
    treasuryCapOboles: 0,
    chains: [{ id: 'bread', name: "Greniers d'Elaia", sites: { grow_wheat: 1 }, grantOboles: 0 }],
  },
  halos: {
    treasuryCapOboles: 1,
    chains: [{ id: 'fish', name: 'Pêcheries', sites: { catch_fish: 1 }, grantOboles: 1 }],
  },
};
const settings = (npc: NpcHouses) => ({
  at: async () => ({
    ...loaded,
    config: { ...initial, clock, npcHouses: npc },
  }),
});
const TODAY = gameDayAt(new Date(), clock);
/** Deux jours avant le jour en cours : une clôture ne se joue pas avant son instant. */
const DAY = TODAY - 2;
const close = (
  worldId: string,
  day = DAY,
  npc = SECOURS,
  steps: readonly CloseStep[] = [npcHouses],
) => closeWorld(db, { worldId, now: dailyCloseAt(day, clock), config: settings(npc), steps });

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/** Un monde, ses cités (par slug), et une maison de joueur métèque de Kallistè, nommée `player`. */
async function newWorld(slugs: string[], player = 'Alcméonides') {
  const worldId = randomUUID();
  const cityIds = Object.fromEntries(slugs.map((slug) => [slug, randomUUID()]));
  const [userId, houseId] = [randomUUID(), randomUUID()];
  await owner.transaction().execute(async (trx) => {
    await sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`n-${worldId.slice(0, 12)}`}, 'Test')`.execute(
      trx,
    );
    for (const slug of slugs)
      await sql`insert into game.cities (id, world_id, slug, name) values (${cityIds[slug]}, ${worldId}, ${slug}, ${slug})`.execute(
        trx,
      );
    await sql`with account as (insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`})),
      house as (insert into game.houses (id, world_id, user_id, name, blazon)
        values (${houseId}, ${worldId}, ${userId}, ${player}, '{}'))
      insert into game.citizenships (house_id, city_id) values (${houseId}, ${cityIds['kalliste']})`.execute(
      trx,
    );
  });
  return { worldId, cityIds, houseId };
}
/** Les maisons PNJ du monde, lues par le propriétaire : ce que la base en retient, par cité. */
async function npcOf(worldId: string) {
  const { rows } = await sql<{
    slug: string;
    chain_id: string;
    name: string;
    user_id: string | null;
    blazon: unknown;
    status: string;
    balance: string;
    sites: string[];
    founded_late: boolean;
  }>`select c.slug, n.chain_id, h.name, h.user_id, h.blazon, z.status, a.balance,
      array(select s.recipe_id from game.sites s where s.house_id = h.id and s.city_id = n.city_id
            order by s.recipe_id) as sites,
      n.founded_at >= (select close_at from game.daily_closes d where d.world_id = h.world_id
                       order by game_day limit 1) as founded_late
    from game.npc_houses n join game.houses h on h.id = n.house_id and h.kind = 'npc'
    join game.cities c on c.id = n.city_id
    join game.citizenships z on z.house_id = h.id and z.city_id = n.city_id
    join game.accounts a on a.house_id = h.id and a.kind = 'house'
    where n.world_id = ${worldId} order by c.slug`.execute(owner);
  return rows.map((row) => ({ ...row, balance: Number(row.balance) }));
}
/** Solde du robinet, somme de tous les comptes du monde, écritures et événements des maisons PNJ. */
async function ledgerOf(worldId: string) {
  const { rows } = await sql<Record<'faucet' | 'total' | 'entries' | 'events', string>>`select
      (select balance from game.accounts where world_id = ${worldId} and system_key = 'faucet_npc_house_grant') as faucet,
      (select sum(balance) from game.accounts where world_id = ${worldId}) as total,
      (select count(*) from game.ledger_entries where world_id = ${worldId} and kind = 'npc_house.grant') as entries,
      (select count(*) from game.domain_events where type = 'NpcHouseFounded' and payload->>'worldId' = ${worldId}) as events`.execute(
    owner,
  );
  return Object.fromEntries(
    Object.entries(rows[0] ?? {}).map(([key, value]) => [key, Number(value)]),
  );
}
const summaryOf = async (worldId: string, day = DAY) =>
  (
    await owner
      .selectFrom('game.daily_closes')
      .select('summary')
      .where('world_id', '=', worldId)
      .where('game_day', '=', day)
      .executeTakeFirstOrThrow()
  ).summary as Record<string, unknown>;

describe('maisons PNJ de secours à la clôture (#715)', () => {
  it('sans filière configurée, rien n’est fondé', async () => {
    const world = await newWorld(['kalliste']);
    expect(await close(world.worldId, DAY, {})).toEqual([DAY]);
    expect(await npcOf(world.worldId)).toEqual([]);
    expect(await summaryOf(world.worldId)).toEqual({
      npcHouses: { founded: 0, nameTaken: 0, oboles: 0 },
    });
  });

  it('une maison sans compte par filière, métèque, avec ses sites et sa dotation, une seule fois', async () => {
    const world = await newWorld(['kalliste', 'elaia', 'thera']);
    expect(await close(world.worldId)).toEqual([DAY]);
    const founded = [
      {
        slug: 'elaia',
        chain_id: 'bread',
        name: "Greniers d'Elaia",
        user_id: null,
        blazon: NPC_HOUSE_BLAZON,
        status: 'metic',
        balance: 0,
        sites: ['grow_wheat'],
        founded_late: true,
      },
      {
        slug: 'kalliste',
        chain_id: 'bread',
        name: 'Greniers de Kallistè',
        user_id: null,
        blazon: NPC_HOUSE_BLAZON,
        status: 'metic',
        balance: 8_000,
        sites: ['grow_wheat', 'grow_wheat', 'mill_flour'],
        founded_late: true,
      },
    ];
    expect(await npcOf(world.worldId)).toEqual(founded);
    // Partie double : le robinet paie la seule dotation non nulle, la masse du monde reste nulle.
    expect(await ledgerOf(world.worldId)).toEqual({
      faucet: -8_000,
      total: 0,
      entries: 1,
      events: 2,
    });
    expect(await summaryOf(world.worldId)).toEqual({
      npcHouses: { founded: 2, nameTaken: 0, oboles: 8_000 },
    });
    const { rows } = await sql<{
      payload: Record<string, unknown>;
    }>`select payload from game.domain_events
      where type = 'NpcHouseFounded' and payload->>'worldId' = ${world.worldId} order by seq`.execute(
      owner,
    );
    const slugOf = new Map<string, string>(
      Object.entries(world.cityIds).map(([slug, id]) => [id, slug]),
    );
    expect(
      rows.map(({ payload: p }) => [
        slugOf.get(String(p['cityId'])),
        p['sites'],
        p['grantOboles'],
        p['gameDay'],
      ]),
    ).toEqual([
      ['elaia', 1, 0, DAY],
      ['kalliste', 3, 8_000, DAY],
    ]);
    // Rejouée : la clôture du jour ne se rejoue pas ; celles des jours suivants ne fondent rien de plus.
    expect(await close(world.worldId)).toEqual([]);
    expect(await close(world.worldId, DAY + 1)).toEqual([DAY + 1]);
    expect(await summaryOf(world.worldId, DAY + 1)).toEqual({
      npcHouses: { founded: 0, nameTaken: 0, oboles: 0 },
    });
    // Même l'étape seule, rejouée dans une transaction, ne fonde rien.
    const again = await db.transaction().execute((trx) =>
      npcHouses.run({
        trx,
        worldId: world.worldId,
        gameDay: DAY + 1,
        closeAt: dailyCloseAt(DAY + 1, clock),
        config: { ...initial, npcHouses: SECOURS },
      }),
    );
    expect(again).toEqual({ founded: 0, nameTaken: 0, oboles: 0 });
    expect(await npcOf(world.worldId)).toEqual(founded);
    expect(await ledgerOf(world.worldId)).toEqual({
      faucet: -8_000,
      total: 0,
      entries: 1,
      events: 2,
    });
  });
});
