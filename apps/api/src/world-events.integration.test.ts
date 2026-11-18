import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { TEST_CONFIG } from './test-config';
import { db, newShipowner, owner, send } from './voyage.integration-fixtures';
import { pastEvent, planEvent, waitUntil } from './world-events.integration-fixtures';

// Effets des événements du monde sur les commandes (#267), contre Supabase local. Chaque test a son monde, pour
// qu'un événement n'y touche que ses propres maisons.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const recipe = TEST_CONFIG.config.recipes.find((row) => row.id === 'grow_wheat');
if (!recipe?.outputs[0] || recipe.siteType !== 'field') throw new Error('grow_wheat expected');
const CYCLE_MS = recipe.durationMinutes * 60_000;
const PER_CYCLE = recipe.outputs[0].quantity;
const olives = TEST_CONFIG.config.recipes.find((row) => row.id === 'grow_olives');
if (!olives?.outputs[0] || olives.siteType !== 'orchard') throw new Error('grow_olives expected');
const OLIVES_PER_CYCLE = olives.outputs[0].quantity;

/** Un monde neuf et ses cités, par identifiant court de la configuration. */
async function newWorld(slugs: string[]) {
  const worldId = randomUUID();
  await owner
    .insertInto('game.worlds')
    .values({ id: worldId, slug: `ev-${worldId.slice(0, 12)}`, name: 'Événements' })
    .execute();
  const rows = await owner
    .insertInto('game.cities')
    .values(slugs.map((slug) => ({ world_id: worldId, slug, name: slug })))
    .returning(['id', 'slug'])
    .execute();
  return { worldId, city: Object.fromEntries(rows.map((row) => [row.slug, row.id])) };
}
const effectsOf = (eventId: string) =>
  db
    .selectFrom('game.event_effects')
    .select(['kind', 'site_id', 'voyage_id', 'good_id', 'quantity', 'delay_seconds'])
    .where('event_id', '=', eventId)
    .execute();

/**
 * Le site de la maison qui exploite la recette, dont le `cycles`-ième cycle se termine à `lastEnds` (garde de la
 * base levée).
 */
async function siteEndingAt(
  houseId: string,
  cycles: number,
  lastEnds: Date,
  recipeId = 'grow_wheat',
) {
  const cycleMs =
    (TEST_CONFIG.config.recipes.find((row) => row.id === recipeId)?.durationMinutes ?? 0) * 60_000;
  const site = await db
    .selectFrom('game.sites')
    .select('id')
    .where('house_id', '=', houseId)
    .where('recipe_id', '=', recipeId)
    .executeTakeFirstOrThrow();
  await owner.transaction().execute(async (trx) => {
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`update game.sites set cycle_started_at = ${new Date(lastEnds.getTime() - cycles * cycleMs)},
      created_at = ${new Date(lastEnds.getTime() - (cycles + 1) * cycleMs)} where id = ${site.id}`.execute(
      trx,
    );
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });
  return site.id;
}

/** Met les sites à l'arrêt à l'instant donné, comme une clôture qui ne les paie pas (garde de la base levée). */
const halt = (siteIds: string[], at: Date) =>
  owner.transaction().execute(async (trx) => {
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await trx.updateTable('game.sites').set({ halted_at: at }).where('id', 'in', siteIds).execute();
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });
/** Relance d'un site par la commande, entretien d'un jour payé. */
const restart = (player: { user: string }, siteId: string) =>
  send(player.user, 'site.restart', { siteId });

describe('sécheresse et récolte (#267)', () => {
  it('à cheval sur son début : seuls les cycles terminés pendant la sécheresse sont réduits', async () => {
    const { worldId, city } = await newWorld(['kalliste', 'elaia']);
    const kalliste = city['kalliste'] ?? '';
    const player = await newShipowner(kalliste);
    // Sécheresse de 30 % à Kallistè dans 1,5 s ; une autre, plus forte, à Elaia, qui n'y change rien.
    const drought = await planEvent(owner, {
      worldId,
      model: 'drought',
      cityId: kalliste,
      magnitudeBps: 3_000,
      inMs: 1_500,
      lastsMs: 86_400_000,
    });
    await planEvent(owner, {
      worldId,
      model: 'drought',
      cityId: city['elaia'] ?? '',
      magnitudeBps: 9_000,
      inMs: 1_000,
      lastsMs: 86_400_000,
    });
    // Trois cycles : les deux premiers finissent avant la sécheresse, le troisième 0,5 s après son début.
    const thirdEnds = new Date(drought.startsAt.getTime() + 500);
    const site = { id: await siteEndingAt(player.houseId, 3, thirdEnds) };
    await waitUntil(db, thirdEnds);
    const reduced = Math.floor((PER_CYCLE * 7_000) / 10_000);
    // Deux récoltes en même temps : l'une prend les trois cycles, l'autre ne trouve plus rien.
    const keys = [randomUUID(), randomUUID()];
    const both = await Promise.all(
      keys.map((key) => send(player.user, 'site.collect', { siteId: site.id }, key)),
    );
    const winner = both.findIndex((reply) => reply.body.ok);
    const collected = both[winner];
    expect(both[1 - winner]?.body.error?.code).toBe('NOTHING_TO_COLLECT');
    expect(collected?.body).toMatchObject({
      ok: true,
      data: { cycles: 3, outputs: [{ goodId: 'wheat', quantity: 2 * PER_CYCLE + reduced }] },
    });
    // Rejouée sous sa clé, la récolte gagnante rend la même réponse et n'écrit rien de plus.
    const again = await send(player.user, 'site.collect', { siteId: site.id }, keys[winner]);
    expect(again.body).toEqual(collected?.body);
    // Le journal des stocks fait foi ; l'effet n'en est que l'explication.
    const movements = await db
      .selectFrom('game.stock_ledger as m')
      .innerJoin('game.inventories as i', 'i.id', 'm.to_inventory_id')
      .select(['m.quantity'])
      .where('i.house_id', '=', player.houseId)
      .where('m.kind', '=', 'site.collect')
      .execute();
    expect(movements).toEqual([{ quantity: String(2 * PER_CYCLE + reduced) }]);
    expect(await effectsOf(drought.eventId)).toEqual([
      {
        kind: 'site_yield',
        site_id: site.id,
        voyage_id: null,
        good_id: 'wheat',
        quantity: String(reduced - PER_CYCLE),
        delay_seconds: null,
      },
    ]);
    const event = await db
      .selectFrom('game.domain_events')
      .select('payload')
      .where('type', '=', 'SiteCollected')
      .where(sql<boolean>`payload ->> 'siteId' = ${site.id}`)
      .executeTakeFirstOrThrow();
    expect(event.payload).toMatchObject({
      eventEffects: [{ eventId: drought.eventId, goodId: 'wheat', quantity: reduced - PER_CYCLE }],
    });
  });

  it('au plus fort : la récolte rend zéro, rien n’entre au stock, le cycle avance quand même', async () => {
    const { worldId, city } = await newWorld(['kalliste']);
    const kalliste = city['kalliste'] ?? '';
    const player = await newShipowner(kalliste);
    const drought = await planEvent(owner, {
      worldId,
      model: 'drought',
      cityId: kalliste,
      magnitudeBps: 10_000,
      inMs: 1_000,
      lastsMs: 86_400_000,
    });
    const ends = new Date(drought.startsAt.getTime() + 300);
    const siteId = await siteEndingAt(player.houseId, 1, ends);
    await waitUntil(db, ends);
    const collected = await send(player.user, 'site.collect', { siteId });
    expect(collected.body).toMatchObject({
      ok: true,
      data: {
        cycles: 1,
        outputs: [{ goodId: 'wheat', quantity: 0 }],
        cycleStartedAt: ends.toISOString(),
      },
    });
    const movements = await db
      .selectFrom('game.stock_ledger')
      .select('id')
      .where('world_id', '=', worldId)
      .where('kind', '=', 'site.collect')
      .execute();
    expect(movements).toEqual([]);
    expect((await effectsOf(drought.eventId)).map((effect) => effect.quantity)).toEqual([
      String(-PER_CYCLE),
    ]);
  });

  it('arrêt puis relance après sa fin : le cycle se date dans le temps du site, et y échappe', async () => {
    const { worldId, city } = await newWorld(['kalliste']);
    const kalliste = city['kalliste'] ?? '';
    const [early, late] = [await newShipowner(kalliste), await newShipowner(kalliste)];
    const drought = await planEvent(owner, {
      worldId,
      model: 'drought',
      cityId: kalliste,
      magnitudeBps: 10_000,
      inMs: 1_000,
      lastsMs: 1_500,
    });
    // Un cycle de chaque champ se termine pendant la sécheresse ; tous deux s'arrêtent 0,1 s après.
    const ends = new Date(drought.startsAt.getTime() + 300);
    const sites = await Promise.all([early, late].map((p) => siteEndingAt(p.houseId, 1, ends)));
    const halted = new Date(ends.getTime() + 100);
    await waitUntil(db, halted);
    await halt(sites, halted);
    // Récolté pendant l'arrêt, le cycle finit pendant la sécheresse : il ne rend rien.
    const during = await send(early.user, 'site.collect', { siteId: sites[0] });
    expect(during.body).toMatchObject({ data: { cycles: 1, outputs: [{ quantity: 0 }] } });
    // Relancé par la commande après la sécheresse, temps du site décalé de l'arrêt (plus de 1,4 s) : le cycle
    // produit en entier.
    await waitUntil(db, new Date(drought.startsAt.getTime() + 1_800));
    expect((await restart(late, sites[1] ?? '')).body).toMatchObject({ ok: true });
    const after = await send(late.user, 'site.collect', { siteId: sites[1] });
    expect(after.body).toMatchObject({ data: { cycles: 1, outputs: [{ quantity: PER_CYCLE }] } });
    expect((await effectsOf(drought.eventId)).map((effect) => effect.site_id)).toEqual([sites[0]]);
  });
  it('arrêt puis relance pendant elle : commencée pendant l’arrêt, elle touche un cycle fini avant (4.2, 7.4)', async () => {
    const { worldId, city } = await newWorld(['kalliste']);
    const kalliste = city['kalliste'] ?? '';
    const [early, late] = [await newShipowner(kalliste), await newShipowner(kalliste)];
    const drought = await planEvent(owner, {
      worldId,
      model: 'drought',
      cityId: kalliste,
      magnitudeBps: 10_000,
      inMs: 1_500,
      lastsMs: 86_400_000,
    });
    // Un cycle de chaque champ finit, puis les champs s'arrêtent, avant la sécheresse ; aucun n'est récolté.
    const ends = new Date(drought.startsAt.getTime() - 1_000);
    const sites = await Promise.all([early, late].map((p) => siteEndingAt(p.houseId, 1, ends)));
    const halted = new Date(ends.getTime() + 100);
    await waitUntil(db, halted);
    await halt(sites, halted);
    // Récolté à l'arrêt, le cycle finit avant la sécheresse : il produit en entier.
    const during = await send(early.user, 'site.collect', { siteId: sites[0] });
    expect(during.body).toMatchObject({ data: { cycles: 1, outputs: [{ quantity: PER_CYCLE }] } });
    // Relancé pendant la sécheresse, temps du site décalé de plus d'une seconde : sa fin tombe dedans.
    await waitUntil(db, new Date(drought.startsAt.getTime() + 100));
    expect((await restart(late, sites[1] ?? '')).body).toMatchObject({ ok: true });
    const after = await send(late.user, 'site.collect', { siteId: sites[1] });
    expect(after.body).toMatchObject({ data: { cycles: 1, outputs: [{ quantity: 0 }] } });
    expect(await effectsOf(drought.eventId)).toMatchObject([
      { site_id: sites[1], quantity: String(-PER_CYCLE) },
    ]);
  });
});

describe('bonne année et récolte (#267)', () => {
  it('accroît un verger de la cité, de bout en bout ; ni un champ, ni une sécheresse finie avant son cycle', async () => {
    const { worldId, city } = await newWorld(['kalliste']);
    const kalliste = city['kalliste'] ?? '';
    // Une maison sans navire, son champ de départ, et un verger d'oliviers acquis dans la même cité.
    const user = randomUUID();
    await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
      owner,
    );
    const name = `Oliviers ${[...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('')}`;
    const blazon = { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' };
    const founded = await send(user, 'house.create', { cityId: kalliste, name, blazon });
    const houseId = founded.body.data.houseId as string;
    const acquired = await send(user, 'site.acquire', { recipeId: 'grow_olives' });
    const orchard = acquired.body.data.siteId as string;
    // Bonne année de 25 % dans 1 s ; deux cycles de chaque site, le second fini 0,3 s après son début.
    const goodYear = await planEvent(owner, {
      worldId,
      model: 'good_year',
      cityId: kalliste,
      magnitudeBps: 2_500,
      inMs: 1_000,
      lastsMs: 86_400_000,
    });
    const ends = new Date(goodYear.startsAt.getTime() + 300);
    const field = await siteEndingAt(houseId, 2, ends);
    await siteEndingAt(houseId, 2, ends, 'grow_olives');
    // Une sécheresse au plus fort, finie à l'instant où commencent les cycles du champ (fin exclue).
    const fieldStarts = new Date(ends.getTime() - 2 * CYCLE_MS);
    const drought = await pastEvent(owner, {
      worldId,
      model: 'drought',
      cityId: kalliste,
      magnitudeBps: 10_000,
      startsAt: new Date(fieldStarts.getTime() - CYCLE_MS),
      endsAt: fieldStarts,
    });
    await waitUntil(db, ends);
    const raised = Math.floor((OLIVES_PER_CYCLE * 12_500) / 10_000);
    const collected = await send(user, 'site.collect', { siteId: orchard });
    expect(collected.body).toMatchObject({
      ok: true,
      data: { cycles: 2, outputs: [{ goodId: 'olives', quantity: OLIVES_PER_CYCLE + raised }] },
    });
    const wheat = await send(user, 'site.collect', { siteId: field });
    expect(wheat.body).toMatchObject({
      ok: true,
      data: { cycles: 2, outputs: [{ goodId: 'wheat', quantity: 2 * PER_CYCLE }] },
    });
    expect(await effectsOf(drought.eventId)).toEqual([]);
    expect(await effectsOf(goodYear.eventId)).toEqual([
      {
        kind: 'site_yield',
        site_id: orchard,
        voyage_id: null,
        good_id: 'olives',
        quantity: String(raised - OLIVES_PER_CYCLE),
        delay_seconds: null,
      },
    ]);
    const payloads = await db
      .selectFrom('game.domain_events')
      .select(sql<string>`payload ->> 'siteId'`.as('siteId'))
      .select(sql<unknown>`payload -> 'eventEffects'`.as('eventEffects'))
      .where('type', '=', 'SiteCollected')
      .where(sql<boolean>`payload ->> 'siteId' in (${orchard}, ${field})`)
      .orderBy('seq')
      .execute();
    expect(payloads).toEqual([
      {
        siteId: orchard,
        eventEffects: [
          { eventId: goodYear.eventId, goodId: 'olives', quantity: raised - OLIVES_PER_CYCLE },
        ],
      },
      { siteId: field, eventEffects: null },
    ]);
  });
});

describe('tempête et départ (#267)', () => {
  it('allonge le trajet d’un navire qui part pendant la tempête de sa route, et seulement lui', async () => {
    const { worldId, city } = await newWorld(['kalliste', 'elaia', 'halos']);
    const [kalliste, elaia, halos] = [
      city['kalliste'] ?? '',
      city['elaia'] ?? '',
      city['halos'] ?? '',
    ];
    const [before, during, elsewhere] = [
      await newShipowner(kalliste),
      await newShipowner(kalliste),
      await newShipowner(kalliste),
    ];
    const leave = (player: typeof before, toCityId = elaia) =>
      send(player.user, 'voyage.depart', {
        shipId: player.shipId,
        fromCityId: kalliste,
        toCityId,
        cargo: [{ goodId: 'wheat', quantity: 10 }],
        expectedCostOboles: 0,
      });
    const hours = (from: string, to: string) =>
      TEST_CONFIG.config.ships.routes.find(
        (route) => route.cities.includes(from) && route.cities.includes(to),
      )?.hours ?? 0;
    // Tempête de 25 % sur la route de Kallistè à Elaia, planifiée dans l'autre sens, dans 3 s : le départ
    // calme part avant elle, même sur une machine lente.
    const storm = await planEvent(owner, {
      worldId,
      model: 'storm',
      cityId: elaia,
      otherCityId: kalliste,
      magnitudeBps: 2_500,
      inMs: 3_000,
      lastsMs: 86_400_000,
    });
    const duration = (reply: Awaited<ReturnType<typeof leave>>) =>
      (Date.parse(reply.body.data.arrivesAt) - Date.parse(reply.body.data.departedAt)) / 1000;
    const calm = await leave(before);
    expect(duration(calm)).toBe(hours('kalliste', 'elaia') * 3_600);
    await waitUntil(db, storm.startsAt);
    const stormy = await leave(during);
    const longer = await leave(elsewhere, halos);
    // Le caboteur (vitesse 10 000) met 25 % de plus ; rien n'est perdu : la cargaison est chargée en entier.
    expect(duration(stormy)).toBe(hours('kalliste', 'elaia') * 3_600 * 1.25);
    expect(duration(longer)).toBe(hours('kalliste', 'halos') * 3_600);
    expect(await effectsOf(storm.eventId)).toEqual([
      {
        kind: 'voyage_delay',
        site_id: null,
        voyage_id: stormy.body.data.voyageId,
        good_id: null,
        quantity: null,
        delay_seconds: hours('kalliste', 'elaia') * 900,
      },
    ]);
    const departed = await db
      .selectFrom('game.domain_events')
      .select('payload')
      .where('type', '=', 'VoyageDeparted')
      .where(
        sql<boolean>`payload ->> 'voyageId' in (${calm.body.data.voyageId}, ${stormy.body.data.voyageId})`,
      )
      .execute();
    const stormOf = (voyageId: string) =>
      departed
        .map((row) => row.payload as { voyageId: string; storm?: unknown })
        .find((payload) => payload.voyageId === voyageId)?.storm;
    expect(stormOf(stormy.body.data.voyageId)).toEqual({
      eventId: storm.eventId,
      delaySeconds: hours('kalliste', 'elaia') * 900,
    });
    expect(stormOf(calm.body.data.voyageId)).toBeUndefined();
    const cargo = await db
      .selectFrom('game.voyage_cargo')
      .select(['good_id', 'quantity'])
      .where('voyage_id', '=', stormy.body.data.voyageId)
      .execute();
    expect(cargo).toEqual([{ good_id: 'wheat', quantity: '10' }]);
  });
});
