import {
  INITIAL_CONFIG,
  type GameConfig,
  type HubrisRules,
  type NemesisRules,
} from '@oikos/config';
import { createRng, tickIndexAt } from '@oikos/sim';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { hubrisGauge } from './hubris-gauge';
import {
  at,
  close,
  DAY,
  db,
  gaugesOf,
  newWorld,
  owner,
  WEIGHTED,
  type World,
} from './hubris.integration-fixtures';
import { nemesis } from './nemesis';
import { siteUpkeep } from './site-upkeep';
import { voyageArrivals } from './voyage-arrivals';

// Présages et Némésis (#735), contre Supabase local. Dans chaque monde, la maison a (90 000 oboles, médiane 1 000) gagne
// 870 000 d'Hybris par clôture au poids de WEIGHTED, moins 10 de déclin : 869 990 au jour DAY.
const steps = [hubrisGauge, nemesis];
const RULES: NemesisRules = {
  threshold: 800_000,
  omenLeadDays: 3,
  fullExcess: 100_000,
  models: { lawsuit: { minBps: 500, maxBps: 2_000 } },
};
/** Hybris en vigueur avec les règles de Némésis données ; sans gain de fortune, la jauge ne fait que décliner. */
const hubris = (rules: NemesisRules | null, wealthWeight = WEIGHTED.wealthWeight): HubrisRules => {
  const value: HubrisRules = { ...WEIGHTED, wealthWeight };
  if (rules) value.nemesis = rules;
  return value;
};
const FIRE: NemesisRules = { ...RULES, models: { warehouse_fire: { minBps: 500, maxBps: 3_000 } } };
const DESERTION: NemesisRules = { ...RULES, models: { artisan_desertion: {} } };
const SHIP: NemesisRules = { ...RULES, models: { ship_lost: {} } };
const quiet = (rules: NemesisRules | null = RULES) => hubris(rules, 0);

const NONE = { averted: 0, struck: 0, omens: 0 };
/**
 * Présages du monde, `maison:modèle:jour→échéance`, puis, réglés, `:issue@jour` et ce que porte l'issue : ampleur, baisse
 * de la jauge, oboles, quantité (`-` pour nul).
 */
const omensOf = async ({ worldId, ids }: World) =>
  (
    await sql<{
      line: string;
    }>`select concat_ws(':', array_position(${ids}::uuid[], house_id) - 1, model,
        (omen_day - ${DAY}) || '→' || (due_day - ${DAY}), outcome || '@' || (settled_day - ${DAY}),
        case when outcome = 'struck' then concat_ws(':', coalesce(magnitude_bps::text, '-'), relief,
          coalesce(oboles::text, '-'), coalesce(quantity::text, '-')) end) as line
      from game.nemesis_omens where world_id = ${worldId}
      order by omen_day, array_position(${ids}::uuid[], house_id)`.execute(db)
  ).rows.map((row) => row.line);
const eventsOf = async ({ ids }: World) =>
  (
    await sql<{
      type: string;
      model: string;
    }>`select type, payload ->> 'model' as model from game.domain_events
      where type in ('OmenReceived', 'NemesisStruck', 'NemesisAverted') and payload ->> 'houseId' = any(${ids}::text[])
      order by seq`.execute(db)
  ).rows.map((row) => `${row.type}:${row.model}`);
const balanceOf = async (worldId: string, houseId: string | null) =>
  Number(
    (
      await sql<{ balance: string }>`select balance from game.accounts where world_id = ${worldId}
        and (case when ${houseId}::uuid is null then system_key = 'sink_nemesis' else kind = 'house' and house_id = ${houseId} end)`.execute(
        db,
      )
    ).rows[0]?.balance,
  );

describe('présages et Némésis à la clôture (#735)', () => {
  it('seuil de la configuration initiale : jamais de présage, quelle que soit la jauge', async () => {
    const world = await newWorld([90_000, 1_000, 1_000]);
    const initial = { ...RULES, threshold: Number.MAX_SAFE_INTEGER };
    expect((await close(world.worldId, DAY, hubris(initial), steps)).summary['nemesis']).toEqual(
      NONE,
    );
    expect(await gaugesOf(world)).toEqual({ '0': 869_990 });
    expect(await omensOf(world)).toEqual([]);
  });

  it('présage au-delà du seuil, une fois même rejoué ; à l’échéance, jauge redescendue : sanction évitée', async () => {
    const world = await newWorld([90_000, 1_000, 1_000]);
    const twice = await close(world.worldId, DAY, hubris(RULES), [
      ...steps,
      { ...nemesis, name: 'again' },
    ]);
    expect([twice.summary['nemesis'], twice.summary['again']]).toEqual([
      { ...NONE, omens: 1 },
      NONE,
    ]);
    // Les jours suivants, sans gain : la jauge décline de 300 000 par clôture, rien n'arrive avant l'échéance.
    const decline = { ...quiet(), dailyDecay: 300_000 };
    for (const day of [DAY + 1, DAY + 2])
      expect((await close(world.worldId, day, decline, steps)).summary['nemesis']).toEqual(NONE);
    const outcomes = await Promise.all([
      close(world.worldId, DAY + 3, decline, steps),
      close(world.worldId, DAY + 3, decline, steps),
    ]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['done', 'skipped']);
    expect(await gaugesOf(world)).toEqual({ '0': 0 });
    expect(await omensOf(world)).toEqual(['0:lawsuit:0→3:averted@3']);
    expect(await balanceOf(world.worldId, world.ids[0] ?? '')).toBe(90_000);
    expect(await eventsOf(world)).toEqual(['OmenReceived:lawsuit', 'NemesisAverted:lawsuit']);
  });

  it('procès : amende au prorata de l’excès, la jauge redescend au seuil ; clôture manquée, réglé le lendemain', async () => {
    const world = await newWorld([90_000, 1_000, 1_000]);
    const [a = ''] = world.ids;
    await close(world.worldId, DAY, hubris(RULES), steps);
    // Jours 1 et 2 sans gain : 869 970 ; l'échéance (jour 3) manquée ; au jour 4, 869 960, excès de 69 960.
    for (const day of [DAY + 1, DAY + 2, DAY + 4]) await close(world.worldId, day, quiet(), steps);
    // Ampleur 500 + 1 500 × 69 960 / 100 000 = 1 549,4 : 1 549 ; amende 90 000 × 1 549 / 10 000 = 13 941.
    expect(await omensOf(world)).toEqual(['0:lawsuit:0→3:struck@4:1549:69960:13941:-']);
    expect([await balanceOf(world.worldId, a), await balanceOf(world.worldId, null)]).toEqual([
      76_059, 13_941,
    ]);
    // La jauge redescend au seuil exactement : pas au-delà, aucun présage nouveau.
    expect(await gaugesOf(world)).toEqual({ '0': 800_000 });
    expect(await eventsOf(world)).toEqual(['OmenReceived:lawsuit', 'NemesisStruck:lawsuit']);
  });

  it('procès à l’excès plein, trésorerie vide : rien de pris, la jauge redescend quand même, présage nouveau', async () => {
    const world = await newWorld([90_000, 1_000, 1_000]);
    const [a = ''] = world.ids;
    for (const day of [DAY, DAY + 1, DAY + 2])
      await close(world.worldId, day, hubris(RULES), steps);
    // La trésorerie de a part entière avant l'échéance.
    await sql`with e as (insert into game.ledger_entries (world_id, kind) values (${world.worldId}, 'test.spend') returning id)
      insert into game.ledger_lines (entry_id, account_id, amount)
      select e.id, x.id, case when x.kind = 'house' then -90000 else 90000 end from e, game.accounts x
      where x.world_id = ${world.worldId} and ((x.kind = 'house' and x.house_id = ${a}) or x.system_key = 'sink_upkeep')`.execute(
      owner,
    );
    await close(world.worldId, DAY + 3, hubris(RULES), steps);
    // Au jour 3 : 3 × 869 990, sans gain (fortune nulle), moins le déclin : 2 609 960 ; excès plein, baisse de 100 000.
    expect(await omensOf(world)).toEqual([
      '0:lawsuit:0→3:struck@3:2000:100000:0:-',
      '0:lawsuit:3→6',
    ]);
    expect(await gaugesOf(world)).toEqual({ '0': 2_509_960 });
    expect([await balanceOf(world.worldId, a), await balanceOf(world.worldId, null)]).toEqual([
      0, 0,
    ]);
  });

  it('incendie : une part du stock libre le plus fourni, réservations épargnées ; sans stock, rien', async () => {
    const world = await newWorld([90_000, 1_000, 1_000]);
    const bare = await newWorld([90_000, 1_000, 1_000]);
    const [a = ''] = world.ids;
    // 200 blés dont 50 réservés par une vente ouverte (150 libres), 120 huiles.
    await sql`insert into game.inventories (world_id, house_id, city_id, good_id)
      values (${world.worldId}, ${a}, ${world.city}, 'oil')`.execute(owner);
    await sql`insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
      select ${world.worldId}, good_id, case good_id when 'wheat' then 200 else 120 end, 'production', id, 'test.seed'
      from game.inventories where house_id = ${a}`.execute(owner);
    await sql`insert into game.orders (world_id, house_id, city_id, good_id, side, price, quantity, remaining)
      values (${world.worldId}, ${a}, ${world.city}, 'wheat', 'sell', 1000000, 50, 50)`.execute(
      owner,
    );
    for (const { worldId } of [world, bare]) {
      await close(worldId, DAY, hubris(FIRE), steps);
      for (const day of [DAY + 1, DAY + 2, DAY + 3]) await close(worldId, day, quiet(FIRE), steps);
    }
    // Excès de 69 960 : ampleur 500 + 2 500 × 0,6996 = 2 249 ; 150 × 2 249 / 10 000 = 33,7 : 33 blés.
    expect(await omensOf(world)).toEqual(['0:warehouse_fire:0→3:struck@3:2249:69960:-:33']);
    const { rows } = await sql<{
      stock: string;
    }>`select good_id || ':' || quantity || ':' || reserved as stock
      from game.inventories where house_id = ${a} order by good_id`.execute(db);
    expect(rows.map((row) => row.stock)).toEqual(['oil:120:0', 'wheat:167:50']);
    expect(await eventsOf(world)).toEqual([
      'OmenReceived:warehouse_fire',
      'NemesisStruck:warehouse_fire',
    ]);
    // Sans stock : la sanction frappe sans rien brûler.
    expect(await omensOf(bare)).toEqual(['0:warehouse_fire:0→3:struck@3:2249:69960:-:0']);
  });

  it('à l’échéance, une version sans Némésis, ou sans le modèle du présage : sanction évitée', async () => {
    const world = await newWorld([90_000, 90_000, 1_000, 1_000, 1_000]);
    await close(world.worldId, DAY, hubris(RULES), steps);
    // Jours 1 et 2 sans section Némésis : rien ne se règle ni ne s'adresse.
    for (const day of [DAY + 1, DAY + 2]) await close(world.worldId, day, quiet(null), steps);
    expect(await omensOf(world)).toEqual(['0:lawsuit:0→3', '1:lawsuit:0→3']);
    // À l'échéance, seul l'incendie est en jeu : les procès sont évités, et les jauges, toujours au-delà du seuil,
    // appellent chacune un présage d'incendie.
    await close(world.worldId, DAY + 3, quiet(FIRE), steps);
    expect(await omensOf(world)).toEqual([
      '0:lawsuit:0→3:averted@3',
      '1:lawsuit:0→3:averted@3',
      '0:warehouse_fire:3→6',
      '1:warehouse_fire:3→6',
    ]);
    expect(await eventsOf(world)).toEqual([
      ...['OmenReceived', 'OmenReceived', 'NemesisAverted', 'NemesisAverted'].map(
        (e) => `${e}:lawsuit`,
      ),
      'OmenReceived:warehouse_fire',
      'OmenReceived:warehouse_fire',
    ]);
  });

  it('désertion : le plus ancien atelier en marche s’arrête, sans rien devoir, jusqu’à la clôture suivante', async () => {
    const world = await newWorld([90_000, 1_000, 1_000]);
    const bare = await newWorld([90_000, 1_000, 1_000]);
    const [a = ''] = world.ids;
    // Deux champs de a, ouverts avant la première clôture, gardes levées pour les dater.
    await owner.transaction().execute(async (trx) => {
      await sql`set local session_replication_role = replica`.execute(trx);
      await sql`insert into game.sites (world_id, house_id, city_id, recipe_id, created_at, cycle_started_at)
        select ${world.worldId}, ${a}, ${world.city}, 'grow_wheat', t, t
        from unnest(array[${at(DAY - 2)}::timestamptz, ${at(DAY - 1)}::timestamptz]) t`.execute(
        trx,
      );
    });
    const sitesOf = async () =>
      (
        await sql<{ site: string }>`select (halted_at is not null)::text as site from game.sites
          where house_id = ${a} order by created_at`.execute(db)
      ).rows.map((row) => row.site);
    const upkeep = [...steps, siteUpkeep];
    for (const { worldId } of [world, bare]) await close(worldId, DAY, hubris(DESERTION), upkeep);
    for (const day of [DAY + 1, DAY + 2]) await close(world.worldId, day, quiet(DESERTION), upkeep);
    const struck = await close(world.worldId, DAY + 3, quiet(DESERTION), upkeep);
    expect(await omensOf(world)).toEqual(['0:artisan_desertion:0→3:struck@3:-:69960:-:-']);
    // Le plus ancien s'arrête ; l'entretien du jour ne paie que l'autre, et ne relance pas le déserté.
    expect(await sitesOf()).toEqual(['true', 'false']);
    expect(struck.summary['siteUpkeep']).toMatchObject({ sitesPaid: 1, halted: 0, resumed: 0 });
    // La clôture suivante, instant de reprise atteint, le paie et le relance.
    const next = await close(world.worldId, DAY + 4, quiet(DESERTION), upkeep);
    expect(next.summary['siteUpkeep']).toMatchObject({ sitesPaid: 2, resumed: 1 });
    expect(await sitesOf()).toEqual(['false', 'false']);
    // Sans atelier : la sanction frappe sans rien arrêter.
    for (const day of [DAY + 1, DAY + 2, DAY + 3])
      await close(bare.worldId, day, quiet(DESERTION), upkeep);
    const { rows } = await sql<{
      site: string | null;
    }>`select site_id as site from game.nemesis_omens
      where world_id = ${bare.worldId} and outcome = 'struck'`.execute(db);
    expect(rows).toEqual([{ site: null }]);
  });

  it('navire perdu : le voyage le plus chargé, puis l’autre ; à l’arrivée, leur cargaison part à nemesis', async () => {
    const world = await newWorld([90_000, 1_000, 1_000]);
    const bare = await newWorld([90_000, 1_000, 1_000]);
    const [a = ''] = world.ids;
    const port = randomUUID();
    // Deux navires de a prennent la mer vers un port, avec 30 et 10 blés, pour une arrivée imminente.
    await owner.transaction().execute(async (trx) => {
      await sql`insert into game.cities (id, world_id, slug, name) values (${port}, ${world.worldId}, 'c1', 'Port')`.execute(
        trx,
      );
      await sql`insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
        select ${world.worldId}, 'wheat', 40, 'production', id, 'test.seed' from game.inventories where house_id = ${a}`.execute(
        trx,
      );
      for (const quantity of [30, 10]) {
        const { rows } = await sql<{ id: string; ship: string }>`with s as (
            insert into game.ships (world_id, house_id, class_id, docked_city_id)
            values (${world.worldId}, ${a}, 'coaster', ${world.city}) returning id)
          insert into game.voyages (world_id, house_id, ship_id, from_city_id, to_city_id, arrives_at)
          select ${world.worldId}, ${a}, s.id, ${world.city}, ${port}, now() + interval '50 milliseconds' from s
          returning id, ship_id as ship`.execute(trx);
        const voyage = rows[0];
        await sql`insert into game.voyage_cargo (voyage_id, world_id, good_id, quantity)
          values (${voyage?.id}, ${world.worldId}, 'wheat', ${quantity})`.execute(trx);
        await sql`insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind, voyage_id)
          select ${world.worldId}, 'wheat', ${quantity}, id, 'in_transit', 'voyage.departure', ${voyage?.id}
          from game.inventories where house_id = ${a}`.execute(trx);
        await sql`update game.ships set docked_city_id = null where id = ${voyage?.ship}`.execute(
          trx,
        );
      }
    });
    // a gagne de l'Hybris chaque jour : frappée à l'excès plein, sa jauge reste au-delà et appelle un présage nouveau.
    for (let day = DAY; day <= DAY + 6; day++) await close(world.worldId, day, hubris(SHIP), steps);
    await close(bare.worldId, DAY, hubris(SHIP), steps);
    for (const day of [DAY + 1, DAY + 2, DAY + 3])
      await close(bare.worldId, day, quiet(SHIP), steps);
    // Le voyage de 30 blés est condamné au jour 3 ; au jour 6, l'autre, et non le même une seconde fois.
    expect(await omensOf(world)).toEqual([
      '0:ship_lost:0→3:struck@3:-:100000:-:-',
      '0:ship_lost:3→6:struck@6:-:100000:-:-',
      '0:ship_lost:6→9',
    ]);
    const voyages = await sql<{
      id: string;
      doomed: boolean;
    }>`select v.id, exists (select 1 from game.nemesis_omens o
        where o.voyage_id = v.id) as doomed from game.voyages v where v.house_id = ${a}
      order by (select quantity from game.voyage_cargo c where c.voyage_id = v.id) desc`.execute(
      db,
    );
    expect(voyages.rows.map((voyage) => voyage.doomed)).toEqual([true, true]);
    // Aucun des deux ne décharge.
    const scheduledAt = new Date(Date.now() + 100);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const tickMinutes = (INITIAL_CONFIG as GameConfig).clock.tickMinutes;
    const summary = await db.transaction().execute((trx) =>
      voyageArrivals.run({
        trx,
        worldId: world.worldId,
        index: tickIndexAt(scheduledAt, tickMinutes),
        scheduledAt,
        config: INITIAL_CONFIG as GameConfig,
        rng: createRng('0'),
        dailyClose: false,
        seasonSwitch: false,
        catchUp: false,
      }),
    );
    expect(summary).toEqual({ voyages: 2, units: 0, nemesisVoyages: 2, nemesisUnits: 40 });
    const { rows } = await sql<{
      line: string;
    }>`select coalesce(to_system, 'stock') || ':' || quantity as line
      from game.stock_ledger where world_id = ${world.worldId} and from_system = 'in_transit' order by quantity desc`.execute(
      db,
    );
    expect(rows.map((row) => row.line)).toEqual(['nemesis:30', 'nemesis:10']);
    expect(
      (
        await sql<{ n: number }>`select count(*)::integer as n from game.domain_events
          where type = 'CargoLostAtSea' and payload ->> 'houseId' = ${a}`.execute(db)
      ).rows[0]?.n,
    ).toBe(0);
    // Sans voyage en mer : la sanction frappe sans rien condamner.
    expect(await omensOf(bare)).toEqual(['0:ship_lost:0→3:struck@3:-:69960:-:-']);
  });
});
