import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeOf, config, openBench, treasuryOf } from './balance/city';
import { winnerOf } from './balance/politics';
import { playWorld } from './balance/run';
import {
  basketDriftBps,
  isWorkshop,
  median,
  PUBLIC_SINKS,
  publish,
  recipeMargins,
  sinkShares,
} from './balance/measures';
import { SLUGS, WARMUP, MEASURED, WINDOW, worldConfig } from './balance/world';
import { sql } from 'kysely';

/*
 * Banc d'équilibrage des quatre cités (#281, docs/specs/05-economie.md 5.2 et 5.5), dans un monde à part, sur
 * la graine `WORLD_SEED` : les quatre cités de la configuration initiale, leurs maisons scriptées selon leur
 * terroir et des armateurs qui ravitaillent les cités importatrices (`balance/world.ts`), jouées comme celles du banc
 * d'une cité de #78 (`balance.integration.test.ts`, qui garde ses bornes). Il tourne dans son propre job `ci`
 * (`pnpm test:balance`), pas avec les tests d'intégration. Il vérifie que le grand livre se rapproche des flux
 * comptés et que chaque cité a tourné, et borne les marges des ateliers (#285), puis l'économie de chaque cité et la
 * masse monétaire du monde (#283).
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
      lodging,
      minutes,
      supplyBefore,
      events,
      wages,
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
    // Les maisons ont payé les salaires de la configuration, leurs intendants compris, que le rapprochement de la
    // bourse des PNJ compte, et leurs intendants ont exécuté leurs règles.
    expect(wages, 'salaires payés').toBeGreaterThan(0);
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
    // Les armateurs ont transporté : leurs navires ont fait des voyages, arrivés avec leur cargaison.
    const sailed = (
      await sql<{ voyages: string; units: string }>`select count(*) as voyages,
        coalesce(sum(c.units), 0) as units
        from game.voyages v left join lateral (select sum(quantity) as units from game.voyage_cargo
          where voyage_id = v.id) c on true
        where v.world_id = ${world.worldId} and v.arrived_at is not null`.execute(world.db)
    ).rows[0];
    expect(Number(sailed?.voyages), 'voyages arrivés').toBeGreaterThan(0);
    expect(Number(sailed?.units), 'unités transportées').toBeGreaterThan(0);
    // Chaque voyage est daté à l'heure de jeu (#663), comme les sites : parti entre le jour 0 et la fin du banc, arrivé
    // au plus un jour après (un caboteur parti le dernier soir est encore en mer), jamais à l'instant réel de la base,
    // qui est des mois après.
    const undated = (
      await sql<{ n: string }>`select count(*) as n from game.voyages
        where world_id = ${world.worldId}
          and not (departed_at between ${closeOf(world, 0)} and ${closeOf(world, lastDay + 1)}
            and arrives_at between departed_at and ${closeOf(world, lastDay + 2)})`.execute(
        world.db,
      )
    ).rows[0];
    expect(Number(undated?.n), 'voyages datés hors de l’heure de jeu').toBe(0);
    // Les événements du monde de la configuration ont été planifiés sur la graine du banc, et joués (7.4).
    expect(
      Object.values(events).reduce((a, b) => a + b, 0),
      'événements planifiés',
    ).toBeGreaterThan(0);

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
    for (const key of [
      'sink_property_upkeep',
      'sink_ship_upkeep',
      'sink_voyage_provisions',
      'sink_port_dues',
      ...PUBLIC_SINKS,
    ])
      expect(shares[key] ?? 0, `part de ${key}`).toBeGreaterThan(0);
    expect(shares['estate'], 'part des puits immobiliers').toBeGreaterThan(0);
    expect(shares['public'], 'part des puits publics').toBeGreaterThan(0);

    // Mesures publiées.
    const margins = recipeMargins(days.slice(-WINDOW));
    const drift = Object.fromEntries(
      SLUGS.map((slug) => [slug, basketDriftBps(days, slug, WINDOW)]),
    );
    // Création nette du monde (robinets moins puits), par jour, sur une fenêtre de jours mesurés.
    const created = (part: typeof days) =>
      part.reduce(
        (sum, day) => sum + Object.values(day.flows['world'] ?? {}).reduce((a, b) => a + b, 0),
        0,
      ) / part.length;
    const [before, after] = [supplyBefore['world'] ?? 0, days.at(-1)?.supply['world'] ?? 0];
    const massBps = Math.round(((after - before) * 10_000) / before);
    await publish(days, margins, {
      basketDriftBps: drift,
      massBps,
      createdPerDay: [
        Math.round(created(days.slice(0, WINDOW))),
        Math.round(created(days.slice(-WINDOW))),
      ],
      minutes: Math.round(minutes * 10) / 10,
      stewards: stewards.length,
      stewardOperations: operations,
      events,
      voyages: Number(sailed?.voyages),
      units: Number(sailed?.units),
    });

    // Marges des ateliers (#285, 4.3), borne écrite à la main : aux prix du monde des dix derniers jours, la marge nette
    // quotidienne d'un site de chaque recette d'atelier est entre la moitié et le double de la médiane de celle des
    // sites de matières premières. Aucune voie n'écrase l'autre (01, pilier 2).
    const worldMargins = margins['world'] ?? {};
    const primary = median(
      config.recipes
        .filter((recipe) => !isWorkshop(recipe))
        .map((recipe) => worldMargins[recipe.id] ?? 0),
    );
    for (const recipe of config.recipes.filter(isWorkshop)) {
      expect(worldMargins[recipe.id], `marge de ${recipe.id}`).toBeGreaterThanOrEqual(primary / 2);
      expect(worldMargins[recipe.id], `marge de ${recipe.id}`).toBeLessThanOrEqual(primary * 2);
    }

    // Bornes de #283 (5.5), écrites à la main, dans chaque cité, celles de la cité prototype (#78) : le coût du panier
    // des dix derniers jours mesurés est de 0 à 2 % au-dessus de celui des dix premiers, chaque bien du panier s'y
    // échangeant ; les besoins vitaux de chaque classe sont couverts à 98 % au moins chaque jour mesuré ; la
    // population ne baisse pas.
    for (const slug of SLUGS) {
      expect(drift[slug], `${slug} : coût du panier`).not.toBeNull();
      expect(drift[slug], `${slug} : coût du panier`).toBeGreaterThanOrEqual(0);
      expect(drift[slug], `${slug} : coût du panier`).toBeLessThanOrEqual(200);
      for (const day of days) {
        expect(
          Object.keys(day.coverage[slug] ?? {}),
          `${slug} : couverture mesurée, jour ${day.day}`,
        ).not.toHaveLength(0);
        for (const [classId, coverage] of Object.entries(day.coverage[slug] ?? {}))
          expect(
            coverage,
            `${slug} : couverture de ${classId}, jour ${day.day}`,
          ).toBeGreaterThanOrEqual(9_800);
      }
      expect(days.at(-1)?.population[slug], `${slug} : population`).toBeGreaterThanOrEqual(
        days[0]?.population[slug] ?? Infinity,
      );
    }
    // Masse du monde, borne contre l'emballement (5.5) : sur les 30 jours mesurés, elle croît de moins de 200 %, ce que
    // ferait le seul revenu public de 30 jours sans aucun puits ; et sa création nette quotidienne des dix derniers jours
    // ne dépasse pas 110 % de celle des dix premiers. La borne de −5 % à +25 % attend les liturgies (phase 3).
    expect(massBps, 'masse du monde').toBeLessThan(20_000);
    expect(created(days.slice(-WINDOW)), 'création nette').toBeLessThanOrEqual(
      created(days.slice(0, WINDOW)) * 1.1,
    );
  },
);
