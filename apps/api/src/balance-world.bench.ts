import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeOf, openBench, treasuryOf } from './balance/city';
import { winnerOf } from './balance/politics';
import { playWorld } from './balance/run';
import { PUBLIC_SINKS, publish, recipeMargins, sinkShares } from './balance/measures';
import { SLUGS, WAGES, WARMUP, MEASURED, WINDOW, worldConfig } from './balance/world';
import { sql } from 'kysely';

/*
 * Banc d'équilibrage des quatre cités (#281, docs/specs/05-economie.md 5.2 et 5.5), dans un monde à part, sur
 * la graine `WORLD_SEED` : les quatre cités de la configuration initiale, leurs maisons scriptées selon leur
 * terroir (`balance/world.ts`), jouées comme celles du banc d'une cité de #78 (`balance.integration.test.ts`, qui
 * garde ses bornes). Il tourne dans son propre job `ci` (`pnpm test:balance`), pas avec les tests d'intégration.
 * Il ne borne pas l'économie, calibrée par #283 : il vérifie que le grand livre se rapproche des flux comptés
 * et que chaque cité a tourné.
 */
const bench = openBench({ config: worldConfig });
beforeAll(() => bench.start());
afterAll(() => bench.stop());

/** Durée maximale du banc, en minutes : au-delà, le test échoue (le job `ci` en laisse davantage). */
const MAX_MINUTES = 15;

it(
  'quatre cités, 40 jours : grand livre rapproché',
  { timeout: MAX_MINUTES * 60_000 },
  async () => {
    const run = await playWorld(bench);
    const {
      world,
      settlements,
      stewards,
      operations,
      housing,
      politics,
      days,
      measured,
      ledger,
      paidFor,
      lastDay,
      measuredFrom,
      acquisitions,
      wages,
      lodging,
      minutes,
    } = run;
    expect(ledger.actual).toEqual(ledger.expected);
    expect(ledger.supply).toBe(ledger.mass);
    // Le trésor de chaque cité reçoit la taxe des échanges de son marché, et rien d'autre.
    const treasuries = await treasuryOf(world);
    for (const { city } of settlements)
      expect(treasuries.get(city.cityId), `${city.slug} : trésor`).toBe(
        ledger.treasuries.get(city.cityId) ?? 0,
      );
    expect(minutes).toBeLessThan(MAX_MINUTES);

    // Chaque cité a tourné : des achats de PNJ sur son marché pendant les jours mesurés, payés par sa bourse (#632),
    // une population qui ne s'est pas vidée.
    const bought = await sql<{
      city_id: string;
      gross: string;
    }>`select o.city_id, sum(t.price * t.quantity) as gross
      from game.trades t join game.orders o on o.id = t.sell_order_id
      where t.world_id = ${world.worldId} and t.buy_order_id is null and t.created_at > ${measuredFrom}
      group by o.city_id`.execute(world.db);
    for (const { city } of settlements) {
      const gross = Number(bought.rows.find((row) => row.city_id === city.cityId)?.gross ?? 0);
      expect(gross, `${city.slug} : achats des PNJ`).toBeGreaterThan(0);
      expect(days.at(-1)?.population[city.slug] ?? 0, `${city.slug} : population`).toBeGreaterThan(
        0,
      );
    }
    expect(acquisitions).toBeGreaterThan(0);
    // Les maisons ont payé leurs salaires, leurs intendants compris, et leurs intendants ont exécuté leurs règles.
    expect(wages).toBeGreaterThan(0);
    expect(stewards.length).toBeGreaterThan(0);
    expect(operations.acted, 'opérations des intendants').toBeGreaterThan(0);
    expect(operations.failed).toBe(0);
    const unpaid = await sql<{ n: string }>`select count(*) as n from game.stewards
      where world_id = ${world.worldId} and dismissed_at is null and unpaid_since is not null`.execute(
      world.db,
    );
    expect(Number(unpaid.rows[0]?.n), 'intendants impayés').toBe(
      stewards.filter((steward) => steward.hiredDay === WARMUP + MEASURED - 1).length,
    );
    // Vie civique : chaque élection dépouillée a donné la charge au candidat que les bulletins du banc désignent, et
    // chaque décret dont le vote est clos a l'issue que ses votes imposent (adopté et payé, ou rejeté).
    const offices = await sql<{
      election_id: string;
      house_id: string;
    }>`select election_id, house_id
      from game.offices where world_id = ${world.worldId}`.execute(world.db);
    const elected = new Map(offices.rows.map((row) => [row.election_id, row.house_id]));
    let elections = 0;
    for (const [electionId, followed] of politics.elections) {
      if (!elected.has(electionId)) continue;
      elections += 1;
      expect(elected.get(electionId), `archonte de ${followed.cityId}`).toBe(
        winnerOf(followed.candidates).houseId,
      );
    }
    expect(elections, 'élections dépouillées').toBeGreaterThanOrEqual(SLUGS.length);
    const statuses = await sql<{ id: string; status: string }>`select id, status from game.decrees
      where world_id = ${world.worldId}`.execute(world.db);
    const statusOf = new Map(statuses.rows.map((row) => [row.id, row.status]));
    const closed = politics.decrees.filter((decree) => decree.closesAt <= closeOf(world, lastDay));
    for (const decree of closed)
      expect(statusOf.get(decree.decreeId), `${decree.model} de ${decree.cityId}`).toBe(
        decree.adopted ? 'applied' : 'rejected',
      );
    expect(paidFor('public_works'), 'grands travaux payés').toBeGreaterThan(0);
    expect(paidFor('festival'), 'fêtes payées').toBeGreaterThan(0);
    // Le logement a servi par ses trois voies : achats, baux, rénovations ; aucun bail n'a pris fin faute de loyer,
    // aucun bien n'est resté sans entretien payé (le rapprochement du logement des travailleurs le suppose), et
    // des travailleurs sont logés dans chaque cité.
    expect(housing.bought, 'biens achetés').toBeGreaterThan(0);
    expect(housing.leased, 'baux signés').toBeGreaterThan(0);
    expect(housing.renovated, 'biens rénovés').toBeGreaterThan(0);
    expect(lodging, 'hébergement chez les PNJ').toBeGreaterThan(0);
    const strained = await sql<{ n: string }>`select
      (select count(*) from game.leases where world_id = ${world.worldId} and end_reason = 'unpaid')
      + (select count(*) from game.properties where world_id = ${world.worldId} and upkeep_unpaid_since is not null) as n`.execute(
      world.db,
    );
    expect(Number(strained.rows[0]?.n), 'loyers ou entretiens impayés').toBe(0);
    const unhoused = await sql<{ employed: string; unhoused: string }>`
      select sum(employed) as employed, sum(unhoused) as unhoused from game.labor_market
      where world_id = ${world.worldId} and game_day = (select max(game_day) from game.labor_market where world_id = ${world.worldId})`.execute(
      world.db,
    );
    expect(Number(unhoused.rows[0]?.unhoused), 'travailleurs non logés').toBeLessThan(
      Number(unhoused.rows[0]?.employed),
    );
    // Les négociants ont transporté : leurs navires ont fait des voyages, arrivés avec leur cargaison.
    const sailed = (
      await sql<{ voyages: string; units: string }>`select count(*) as voyages,
        coalesce(sum(c.units), 0) as units
        from game.voyages v left join lateral (select sum(quantity) as units from game.voyage_cargo
          where voyage_id = v.id) c on true
        where v.world_id = ${world.worldId} and v.arrived_at is not null`.execute(world.db)
    ).rows[0];
    expect(Number(sailed?.voyages), 'voyages arrivés').toBeGreaterThan(0);
    expect(Number(sailed?.units), 'unités transportées').toBeGreaterThan(0);

    // Les flux mesurés (mise en route comprise), sommés sur tous les jours, rendent ceux du grand livre : le net de
    // chaque robinet et de chaque puits, relevé sur les lignes du grand livre, est l'opposé du solde de son compte,
    // que le rapprochement tire des flux comptés.
    const expectedNet = Object.fromEntries(
      Object.entries(ledger.expected)
        .filter(([key]) => key !== 'treasury' && key !== 'npc_purse')
        .map(([key, balance]) => [key, 0 - balance]),
    );
    expect(measured).toEqual(expectedNet);

    // Chaque puits qui revient chaque jour a sa part dans la monnaie détruite des jours mesurés (les achats de biens,
    // faits surtout pendant la mise en route, sont comptés par le rapprochement ci-dessus).
    const shares = sinkShares(days)['world'] ?? {};
    for (const key of ['sink_property_upkeep', ...PUBLIC_SINKS])
      expect(shares[key] ?? 0, `part de ${key}`).toBeGreaterThan(0);
    expect(shares['estate'], 'part des puits immobiliers').toBeGreaterThan(0);
    expect(shares['public'], 'part des puits publics').toBeGreaterThan(0);

    // Mesures publiées.
    const margins = recipeMargins(days.slice(-WINDOW), () => WAGES.workerOboles);
    await publish(days, margins, {
      minutes: Math.round(minutes * 10) / 10,
      stewards: stewards.length,
      stewardOperations: operations,
      voyages: Number(sailed?.voyages),
      units: Number(sailed?.units),
    });
  },
);
