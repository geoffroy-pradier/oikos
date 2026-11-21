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
import type { CloseStep } from '../close';
import { closeWorld } from '../scheduler';
import { npcHouses } from './npc-houses';

// Monde d'essai des maisons PNJ de secours (#716), contre Supabase local : un monde par test, ses cités, sa clôture.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
export const db = createDb(serviceRoleUrl(DATABASE_URL));
export const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
export const clock = {
  tickMinutes: 10,
  dailyCloseHour: 4,
  timezone: 'Europe/Paris',
  seasonDays: 7,
};
const archon = { termDays: 28, candidacyDays: 4, votingDays: 3, maxConsecutiveTerms: 2 };
/** Configuration d'essai : l'initiale, son horloge, et les maisons PNJ données. */
export const configWith = (npc: NpcHouses): GameConfig => ({
  ...initial,
  clock,
  politics: { meticDays: 3, archon },
  npcHouses: npc,
});
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>> | undefined;
export async function setUp() {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
  return loaded;
}
export const tearDown = () => Promise.all([db.destroy(), owner.destroy()]);
/** Deux jours avant le jour en cours : une clôture ne se joue pas avant son instant. */
export const DAY = gameDayAt(new Date(), clock) - 2;
/** Joue la clôture du jour avec ces étapes (la fondation seule, par défaut) : les jours joués. */
export const close = (
  worldId: string,
  day: number,
  npc: NpcHouses,
  steps: readonly CloseStep[] = [npcHouses],
) =>
  closeWorld(db, {
    worldId,
    now: dailyCloseAt(day, clock),
    config: {
      at: async () => {
        if (!loaded) throw new Error('setUp() first');
        return { ...loaded, config: configWith(npc) };
      },
    },
    steps,
  });

/** Un monde et ses cités, par slug. */
export async function newWorld(slugs: string[]) {
  const worldId = randomUUID();
  const cityIds = Object.fromEntries(slugs.map((slug) => [slug, randomUUID()]));
  await owner.transaction().execute(async (trx) => {
    await sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`n-${worldId.slice(0, 12)}`}, 'Test')`.execute(
      trx,
    );
    for (const slug of slugs)
      await sql`insert into game.cities (id, world_id, slug, name) values (${cityIds[slug]}, ${worldId}, ${slug}, ${slug})`.execute(
        trx,
      );
  });
  return { worldId, cityIds };
}

/** La maison PNJ d'une cité, son compte et sa trésorerie. */
export async function npcHouseOf(worldId: string, cityId: string) {
  const { rows } = await sql<{ house_id: string; account_id: string; balance: string }>`
    select n.house_id, a.id as account_id, a.balance from game.npc_houses n
    join game.accounts a on a.house_id = n.house_id and a.kind = 'house'
    where n.world_id = ${worldId} and n.city_id = ${cityId}`.execute(owner);
  const row = rows[0];
  if (!row) throw new Error(`No NPC house in ${cityId}`);
  return { houseId: row.house_id, accountId: row.account_id, balance: Number(row.balance) };
}

/** Crédite la trésorerie d'une maison depuis le robinet des récompenses : ce qu'elle aurait gagné à l'agora. */
export async function credit(worldId: string, accountId: string, amount: number) {
  await owner.transaction().execute(async (trx) => {
    const { rows } = await sql<{
      id: string;
    }>`insert into game.ledger_entries (world_id, kind, meta)
      values (${worldId}, 'test.credit', '{}') returning id`.execute(trx);
    await sql`insert into game.ledger_lines (entry_id, account_id, amount) values
      (${rows[0]?.id}, (select id from game.accounts where world_id = ${worldId} and system_key = 'faucet_rewards'), ${-amount}),
      (${rows[0]?.id}, ${accountId}, ${amount})`.execute(trx);
  });
}

/** Sites de la maison, datés d'une minute après la clôture du jour (garde levée), comme en jeu. */
export async function startAfterClose(worldId: string, day: number) {
  const after = new Date(dailyCloseAt(day, clock).getTime() + 60_000);
  await owner.transaction().execute(async (trx) => {
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`update game.sites set created_at = ${after}, cycle_started_at = ${after}
      where world_id = ${worldId}`.execute(trx);
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });
}
