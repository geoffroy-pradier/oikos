import { randomUUID } from 'node:crypto';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { siteUpkeep } from '@oikos/engine';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { unlimited } from './rate-limit';
import { createTelemetry } from './telemetry';
import { TEST_CONFIG, testConfig, testVerifier } from './test-config';

// Tests d'intégration de `site.restart` contre Supabase local. Le champ de départ vient de `house.create`.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const app = createApp({
  db,
  telemetry: createTelemetry(db),
  verifyToken: testVerifier,
  rateLimiter: unlimited,
  loadConfig: testConfig,
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const { starting, sites, recipes } = TEST_CONFIG.config;
const recipe = recipes.find((candidate) => candidate.id === starting.siteRecipeId);
if (!recipe) throw new Error('starting recipe missing from the test configuration');
const HOUR = 3_600_000;
/** Entretien d'un jour du champ de départ, au coefficient ×1 de la configuration de test : 30 oboles. */
const UPKEEP = sites.upkeep.dailyOboles[recipe.siteType];
const GRANT = starting.grantOboles;

/** Salaire du jour de 5 oboles dans chaque cité : le champ de départ (4 travailleurs) doit 30 + 20. */
const WAGES = 4 * 5;
const staffed = {
  ...TEST_CONFIG,
  config: {
    ...TEST_CONFIG.config,
    staff: { dailyWageOboles: { kalliste: 5, elaia: 5, ampelos: 5, halos: 5 } },
  },
};
const staffedApp = createApp({
  db,
  telemetry: createTelemetry(db),
  verifyToken: testVerifier,
  rateLimiter: unlimited,
  loadConfig: async () => staffed,
});

const send = async (
  user: string,
  command: string,
  body: unknown,
  key: string = randomUUID(),
  via = app,
) => {
  const res = await via.request(`/api/commands/${command}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${user}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const restart = (user: string, siteId: string, key?: string) =>
  send(user, 'site.restart', { siteId }, key);

/** Une maison fondée par la commande réelle ; son champ, âgé de `ageHours`, est à l'arrêt depuis `haltedHours`. */
async function newPlayer(
  ageHours = 0,
  haltedHours?: number,
  cityId = '01900000-0000-7000-8000-000000000101',
) {
  const user = randomUUID();
  await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
    owner,
  );
  const name = `Relance ${[...user.replace(/[^a-f]/g, '')].slice(0, 10).join('')}`;
  const blazon = { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' };
  const founded = await send(user, 'house.create', {
    cityId,
    name,
    blazon,
  });
  const houseId = (founded.body['data'] as { houseId: string }).houseId;
  const site = await db
    .selectFrom('game.sites')
    .select('id')
    .where('house_id', '=', houseId)
    .executeTakeFirstOrThrow();
  // Garde des sites levée le temps d'antidater la création, le cycle et l'arrêt.
  await owner.transaction().execute(async (trx) => {
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`update game.sites set created_at = now() - ${`${ageHours * HOUR} milliseconds`}::interval,
      cycle_started_at = now() - ${`${ageHours * HOUR} milliseconds`}::interval,
      halted_at = now() - ${haltedHours === undefined ? null : `${haltedHours * HOUR} milliseconds`}::interval
      where id = ${site.id}`.execute(trx);
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });
  return { user, houseId, siteId: site.id };
}
type Player = Awaited<ReturnType<typeof newPlayer>>;
/** Trésorerie, site à l'arrêt ou non, heures de cycle écoulées, et écritures de relance de la maison. */
const stateOf = async ({ houseId, siteId }: Player) => {
  const { rows } = await sql<{
    balance: string;
    halted: boolean;
    hours: string;
    paid: string[] | null;
  }>`select
    (select balance from game.accounts where house_id = ${houseId} and kind = 'house') as balance,
    s.halted_at is not null as halted,
    round(extract(epoch from coalesce(s.halted_at, now()) - s.cycle_started_at) / 3600, 2) as hours,
    (select array_agg(l.amount order by e.created_at) from game.ledger_entries e
      join game.ledger_lines l on l.entry_id = e.id join game.accounts a on a.id = l.account_id
      where e.kind = 'upkeep.restart' and e.meta = jsonb_build_object('houseId', ${houseId}::text, 'siteId', ${siteId}::text)
        and a.system_key = 'sink_upkeep') as paid
    from game.sites s where s.id = ${siteId}`.execute(db);
  const row = rows[0];
  return {
    balance: Number(row?.balance),
    halted: row?.halted,
    hours: Number(row?.hours),
    paid: row?.paid ?? [],
  };
};
/** Retire des oboles à la maison, vers un puits, par une écriture de test. */
const drain = ({ houseId }: Player, oboles: number) =>
  sql`with entry as (insert into game.ledger_entries (world_id, kind) select world_id, 'test.drain' from game.houses where id = ${houseId} returning id, world_id)
    insert into game.ledger_lines (entry_id, account_id, amount)
    select entry.id, a.id, case when a.kind = 'house' then -${oboles}::bigint else ${oboles}::bigint end from entry, game.accounts a
    where a.world_id = entry.world_id and ((a.kind = 'house' and a.house_id = ${houseId}) or a.system_key = 'sink_offerings')`.execute(
    owner,
  );

/** Lignes des écritures de relance de la maison : compte (puits ou trésorerie), montant, nature. */
const restartLinesOf = async ({ houseId }: Player) =>
  (
    await sql<{
      account: string;
      amount: string;
      nature: string | null;
    }>`select coalesce(a.system_key, 'treasury') as account, l.amount, l.nature
      from game.ledger_entries e join game.ledger_lines l on l.entry_id = e.id join game.accounts a on a.id = l.account_id
      where e.kind = 'upkeep.restart' and e.meta->>'houseId' = ${houseId} order by e.created_at, l.nature, a.system_key`.execute(
      db,
    )
  ).rows;

describe('site.restart', () => {
  it('paie un jour d’entretien au puits et relance le site, son cycle gelé repris ; rejouée, la commande ne prélève rien de plus', async () => {
    // Champ de 10 heures, à l'arrêt depuis 7 : 3 heures de cycle avant l'arrêt.
    const player = await newPlayer(10, 7);
    expect(await stateOf(player)).toEqual({ balance: GRANT, halted: true, hours: 3, paid: [] });
    const key = randomUUID();
    const done = await restart(player.user, player.siteId, key);
    expect(done).toMatchObject({
      status: 200,
      body: { data: { siteId: player.siteId, upkeepOboles: UPKEEP } },
    });
    expect(UPKEEP).toBe(30);
    // 3 000 − 30 = 2 970 ; le site tourne, et son cycle en est toujours à 3 heures, pas à 10.
    expect(await stateOf(player)).toEqual({
      balance: GRANT - 30,
      halted: false,
      hours: 3,
      paid: ['30'],
    });
    expect(await restart(player.user, player.siteId, key)).toEqual(done);
    expect(await stateOf(player)).toMatchObject({ balance: GRANT - 30, paid: ['30'] });
    const events = await sql<{ payload: unknown }>`select payload from game.domain_events
      where type = 'SiteRestarted' and payload->>'siteId' = ${player.siteId}`.execute(db);
    expect(events.rows).toEqual([
      {
        payload: {
          siteId: player.siteId,
          houseId: player.houseId,
          upkeepOboles: 30,
          wagesOboles: 0,
        },
      },
    ]);
    // Avec une clé neuve : le site tourne déjà, rien n'est prélevé.
    expect(await restart(player.user, player.siteId)).toMatchObject({
      status: 409,
      body: { error: { code: 'SITE_NOT_HALTED' } },
    });
    expect(await stateOf(player)).toMatchObject({ balance: GRANT - 30, paid: ['30'] });
  });

  it('trésorerie insuffisante : refus, site toujours à l’arrêt, jamais de solde négatif ; à l’obole près, elle suffit', async () => {
    const player = await newPlayer(10, 7);
    await drain(player, GRANT - 29);
    expect(await restart(player.user, player.siteId)).toMatchObject({
      status: 409,
      body: { error: { code: 'INSUFFICIENT_FUNDS' } },
    });
    expect(await stateOf(player)).toEqual({ balance: 29, halted: true, hours: 3, paid: [] });
    await drain(player, -1);
    expect((await restart(player.user, player.siteId)).status).toBe(200);
    expect(await stateOf(player)).toEqual({ balance: 0, halted: false, hours: 3, paid: ['30'] });
  });

  it('refuse le site d’un autre joueur, un site inconnu et une demande mal formée, sans rien écrire', async () => {
    const [player, other] = [await newPlayer(10, 7), await newPlayer()];
    expect(await restart(other.user, player.siteId)).toMatchObject({
      status: 404,
      body: { error: { code: 'SITE_NOT_FOUND' } },
    });
    expect(await restart(player.user, randomUUID())).toMatchObject({
      status: 404,
      body: { error: { code: 'SITE_NOT_FOUND' } },
    });
    expect((await send(player.user, 'site.restart', { siteId: 'x' })).status).toBe(400);
    expect(await stateOf(player)).toEqual({ balance: GRANT, halted: true, hours: 3, paid: [] });
  });

  it('entretien attendu : payé s’il est le tarif en vigueur, refusé sans effet sinon', async () => {
    const player = await newPlayer(10, 7);
    for (const expectedUpkeepOboles of [UPKEEP - 1, UPKEEP + 1, 0])
      expect(
        await send(player.user, 'site.restart', { siteId: player.siteId, expectedUpkeepOboles }),
      ).toMatchObject({ status: 409, body: { error: { code: 'PRICE_CHANGED' } } });
    expect(await stateOf(player)).toEqual({ balance: GRANT, halted: true, hours: 3, paid: [] });
    expect(
      await send(player.user, 'site.restart', {
        siteId: player.siteId,
        expectedUpkeepOboles: UPKEEP,
      }),
    ).toMatchObject({ status: 200, body: { data: { upkeepOboles: UPKEEP } } });
    expect(await stateOf(player)).toMatchObject({ balance: GRANT - UPKEEP, halted: false });
    expect(
      await send(player.user, 'site.restart', { siteId: player.siteId, expectedUpkeepOboles: -1 }),
    ).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_FAILED' } } });
  });

  it('deux relances simultanées du même site : une seule paie, l’autre constate qu’il tourne', async () => {
    const player = await newPlayer(10, 7);
    const results = await Promise.all([
      restart(player.user, player.siteId),
      restart(player.user, player.siteId),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await stateOf(player)).toEqual({
      balance: GRANT - 30,
      halted: false,
      hours: 3,
      paid: ['30'],
    });
  });

  it('un site dont la recette a quitté la configuration n’a plus de tarif : relancé sans rien payer', async () => {
    const player = await newPlayer(10, 7);
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
      await sql`update game.sites set recipe_id = 'retired_recipe' where id = ${player.siteId}`.execute(
        trx,
      );
      await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
    });
    expect(await restart(player.user, player.siteId)).toMatchObject({
      status: 200,
      body: { data: { upkeepOboles: 0 } },
    });
    expect(await stateOf(player)).toEqual({ balance: GRANT, halted: false, hours: 3, paid: [] });
  });

  it('site arrêté par une clôture commencée après la commande : conflit à rejouer, pas une erreur interne', async () => {
    // L'arrêt est postérieur à l'instant de la commande (ici, dans une heure).
    const player = await newPlayer(10, -1);
    expect(await restart(player.user, player.siteId)).toMatchObject({
      status: 409,
      body: { error: { code: 'SITE_CHANGED' } },
    });
    expect(await stateOf(player)).toMatchObject({ balance: GRANT, halted: true, paid: [] });
  });

  it('la monnaie sous séquestre ne paie pas la relance : 29 oboles en trésorerie et 200 retenues, refus', async () => {
    const player = await newPlayer(10, 7);
    await drain(player, GRANT - 229);
    // Un achat en attente de 20 unités à 10 oboles retient 200 oboles : il en reste 29 en trésorerie.
    // `hold` pose l'achat et son séquestre, puis les retire : le carnet de la cité est partagé.
    const hold = (held: number) =>
      owner.transaction().execute(async (trx) => {
        if (held > 0) {
          await sql`insert into game.accounts (world_id, kind, house_id) select world_id, 'escrow', id from game.houses where id = ${player.houseId}`.execute(
            trx,
          );
          await sql`insert into game.orders (world_id, city_id, house_id, good_id, side, price, quantity, remaining)
            select world_id, city_id, house_id, 'wheat', 'buy', 10, 20, 20 from game.sites where id = ${player.siteId}`.execute(
            trx,
          );
        } else
          await sql`update game.orders set status = 'cancelled' where house_id = ${player.houseId}`.execute(
            trx,
          );
        await sql`with entry as (insert into game.ledger_entries (world_id, kind) select world_id, 'test.escrow' from game.houses where id = ${player.houseId} returning id)
          insert into game.ledger_lines (entry_id, account_id, amount)
          select entry.id, a.id, case when a.kind = 'escrow' then ${held}::bigint else -${held}::bigint end from entry, game.accounts a where a.house_id = ${player.houseId}`.execute(
          trx,
        );
      });
    await hold(200);
    const refused = await restart(player.user, player.siteId);
    const state = await stateOf(player);
    const escrow = await sql<{
      balance: string;
    }>`select balance from game.accounts where house_id = ${player.houseId} and kind = 'escrow'`.execute(
      db,
    );
    await hold(-200);
    expect(refused).toMatchObject({ status: 409, body: { error: { code: 'INSUFFICIENT_FUNDS' } } });
    expect(state).toEqual({ balance: 29, halted: true, hours: 3, paid: [] });
    expect(escrow.rows).toEqual([{ balance: '200' }]);
  });

  it('avec des salaires : le prix vu est l’entretien plus les salaires, payés en entier ou pas du tout, une ligne par nature', async () => {
    const player = await newPlayer(10, 7);
    const relaunch = (expectedUpkeepOboles?: number) =>
      send(
        player.user,
        'site.restart',
        { siteId: player.siteId, expectedUpkeepOboles },
        undefined,
        staffedApp,
      );
    // Un client qui n'annonce que l'entretien n'a pas vu les salaires : refus, rien n'est payé.
    for (const seen of [UPKEEP, UPKEEP + WAGES - 1, UPKEEP + WAGES + 1])
      expect(await relaunch(seen)).toMatchObject({
        status: 409,
        body: { error: { code: 'PRICE_CHANGED', message: 'Restarting now costs 50 oboles.' } },
      });
    // 49 oboles couvriraient l'entretien seul, pas le tout : refus, sans paiement partiel.
    await drain(player, GRANT - (UPKEEP + WAGES - 1));
    expect(await relaunch(UPKEEP + WAGES)).toMatchObject({
      status: 409,
      body: { error: { code: 'INSUFFICIENT_FUNDS' } },
    });
    expect([await stateOf(player), await restartLinesOf(player)]).toEqual([
      { balance: UPKEEP + WAGES - 1, halted: true, hours: 3, paid: [] },
      [],
    ]);
    await drain(player, -1);
    expect(await relaunch(UPKEEP + WAGES)).toMatchObject({
      status: 200,
      body: { data: { siteId: player.siteId, upkeepOboles: UPKEEP, wagesOboles: WAGES } },
    });
    expect(await stateOf(player)).toEqual({ balance: 0, halted: false, hours: 3, paid: ['30'] });
    expect(await restartLinesOf(player)).toEqual([
      { account: 'treasury', amount: '-30', nature: 'upkeep' },
      { account: 'treasury', amount: '-20', nature: 'wages' },
      { account: 'sink_npc_wages', amount: '20', nature: null },
      { account: 'sink_upkeep', amount: '30', nature: null },
    ]);
    const events = await sql<{ payload: unknown }>`select payload from game.domain_events
      where type = 'SiteRestarted' and payload->>'siteId' = ${player.siteId}`.execute(db);
    expect(events.rows).toEqual([
      {
        payload: {
          siteId: player.siteId,
          houseId: player.houseId,
          upkeepOboles: UPKEEP,
          wagesOboles: WAGES,
        },
      },
    ]);
  });

  it('salaire nul : aucune ligne de salaires, l’entretien seul marqué', async () => {
    const player = await newPlayer(10, 7);
    expect(await restart(player.user, player.siteId)).toMatchObject({
      status: 200,
      body: { data: { upkeepOboles: UPKEEP, wagesOboles: 0 } },
    });
    expect(await restartLinesOf(player)).toEqual([
      { account: 'treasury', amount: '-30', nature: 'upkeep' },
      { account: 'sink_upkeep', amount: '30', nature: null },
    ]);
  });

  describe('relance et clôture quotidienne', () => {
    /** Un monde à part : l'étape d'entretien prélève toutes les maisons du monde où elle tourne. */
    async function newWorld(config = TEST_CONFIG.config) {
      const [worldId, cityId] = [randomUUID(), randomUUID()];
      await sql`with world as (insert into game.worlds (id, slug, name) values (${worldId}, ${`r-${worldId.slice(0, 12)}`}, 'Test'))
        insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, 'kalliste', 'Agora')`.execute(
        owner,
      );
      const context = { worldId, gameDay: 20_771, closeAt: new Date(), config };
      return {
        cityId,
        upkeep: (trx: typeof db) => siteUpkeep.run({ ...context, trx, closeAt: new Date() }),
      };
    }
    /** Vrai dès qu'une connexion attend un verrou tenu par `pid` ; faux si rien n'attend en cinq secondes. */
    async function blockedBy(pid: number) {
      for (const deadline = Date.now() + 5_000; Date.now() < deadline;) {
        const { rows } = await sql<{
          waiting: string;
        }>`select count(*) as waiting from pg_stat_activity
          where wait_event_type = 'Lock' and ${pid}::int = any(pg_blocking_pids(pid))`.execute(
          owner,
        );
        if (Number(rows[0]?.waiting) > 0) return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return false;
    }
    const dailyOf = async ({ houseId }: Player) =>
      (
        await sql<{
          amount: string;
        }>`select l.amount from game.ledger_entries e join game.ledger_lines l on l.entry_id = e.id
          join game.accounts a on a.id = l.account_id and a.system_key = 'sink_upkeep'
          where e.kind = 'upkeep.daily' and e.meta->>'houseId' = ${houseId}`.execute(db)
      ).rows.map((row) => row.amount);

    it('site relancé juste avant la clôture : il paie de nouveau à la clôture, par deux écritures de natures distinctes', async () => {
      const world = await newWorld();
      const player = await newPlayer(10, 7, world.cityId);
      expect((await restart(player.user, player.siteId)).status).toBe(200);
      const summary = await db.transaction().execute(world.upkeep);
      // 3 000 − 30 (relance) − 30 (clôture) = 2 940 : la règle écrite, pas un double prélèvement fautif.
      expect(summary).toMatchObject({ houses: 1, paidOboles: 30, sitesPaid: 1, resumed: 0 });
      expect(await stateOf(player)).toMatchObject({
        balance: GRANT - 60,
        halted: false,
        paid: ['30'],
      });
      expect(await dailyOf(player)).toEqual(['30']);
    });

    it('relance validée après le début de la clôture, puis impayé à cette clôture : le site est arrêté de nouveau, son cycle intact à la durée de la clôture près', async () => {
      const world = await newWorld();
      const player = await newPlayer(10, 7, world.cityId);
      await drain(player, GRANT - 30);
      // La clôture commence (son « maintenant » est fixé) ; la relance passe avant qu'elle ne prenne le puits.
      const closing = await db.startTransaction().execute();
      await sql`select now()`.execute(closing);
      expect((await restart(player.user, player.siteId)).status).toBe(200);
      const summary = await world.upkeep(closing).finally(() => closing.commit().execute());
      // La relance a pris les 30 oboles : la clôture ne peut rien prélever et arrête le site.
      expect(summary).toMatchObject({ paidOboles: 0, sitesUnpaid: 1, halted: 1 });
      // Trois heures de cycle avant l'arrêt, toujours trois heures après (à la durée de la clôture près).
      expect(await stateOf(player)).toEqual({ balance: 0, halted: true, hours: 3, paid: ['30'] });
      expect(await dailyOf(player)).toEqual([]);
    });

    it('relance demandée pendant la clôture : elle attend, sans interblocage, puis constate que la clôture a relancé le site', async () => {
      const world = await newWorld();
      const player = await newPlayer(10, 7, world.cityId);
      const closing = await db.startTransaction().execute();
      let settled = false;
      let pending: ReturnType<typeof restart> | undefined;
      try {
        // La clôture a prélevé et relancé le site, mais n'a pas encore validé : elle tient le puits.
        await world.upkeep(closing);
        const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(
          closing,
        );
        // La relance n'est demandée qu'une fois l'étape terminée : elle ne peut qu'attendre la validation.
        pending = restart(player.user, player.siteId).finally(() => (settled = true));
        // L'attente est constatée par la base : une connexion attend un verrou que tient la clôture.
        expect(await blockedBy(rows[0]?.pid ?? 0)).toBe(true);
        expect(settled).toBe(false);
      } finally {
        await closing.commit().execute();
      }
      expect(await pending).toMatchObject({
        status: 409,
        body: { error: { code: 'SITE_NOT_HALTED' } },
      });
      // Un seul paiement, celui de la clôture : 3 000 − 30.
      expect(await stateOf(player)).toMatchObject({ balance: GRANT - 30, halted: false, paid: [] });
      expect(await dailyOf(player)).toEqual(['30']);
    });

    it('avec des salaires, relances et clôture simultanées : sans interblocage, un seul paiement du dû entier', async () => {
      const world = await newWorld(staffed.config);
      const player = await newPlayer(10, 7, world.cityId);
      const relaunch = () =>
        send(
          player.user,
          'site.restart',
          { siteId: player.siteId, expectedUpkeepOboles: UPKEEP + WAGES },
          undefined,
          staffedApp,
        );
      // Deux relances et la clôture partent ensemble : la première à prendre le puits de l'entretien
      // paie ; les autres voient ensuite un site qui tourne (la clôture le fait payer de nouveau, comme
      // pour une relance juste avant elle, si elle passe après).
      const [first, second, summary] = await Promise.all([
        relaunch(),
        relaunch(),
        db.transaction().execute(world.upkeep),
      ]);
      const restarted = [first, second].filter((result) => result.status === 200).length;
      expect([first.status, second.status].sort()).toEqual(
        restarted === 1 ? [200, 409] : [409, 409],
      );
      const lines = await restartLinesOf(player);
      expect(lines).toHaveLength(restarted * 4);
      const paidAtClose = summary.paidOboles;
      expect(paidAtClose).toBe(UPKEEP + WAGES);
      expect(summary.wagesOboles).toBe(WAGES);
      // Conservation : la trésorerie a perdu exactement ce que les deux puits ont reçu de cette maison.
      expect(await stateOf(player)).toMatchObject({
        balance: GRANT - (restarted + 1) * (UPKEEP + WAGES),
        halted: false,
      });
    });
  });
});
