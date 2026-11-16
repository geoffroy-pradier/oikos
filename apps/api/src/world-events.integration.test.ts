import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { TEST_CONFIG } from './test-config';
import { db, newShipowner, owner, send } from './voyage.integration-fixtures';
import { planEvent, waitUntil } from './world-events.integration-fixtures';

// Effets des événements du monde sur les commandes (#267), contre Supabase local. Chaque test a son monde, pour
// qu'un événement n'y touche que ses propres maisons.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const recipe = TEST_CONFIG.config.recipes.find((row) => row.id === 'grow_wheat');
if (!recipe?.outputs[0] || recipe.siteType !== 'field') throw new Error('grow_wheat expected');
const CYCLE_MS = recipe.durationMinutes * 60_000;
const PER_CYCLE = recipe.outputs[0].quantity;

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

/** Le site de la maison, dont le `cycles`-ième cycle se termine à `lastEnds` (garde de la base levée). */
async function siteEndingAt(houseId: string, cycles: number, lastEnds: Date) {
  const site = await db
    .selectFrom('game.sites')
    .select('id')
    .where('house_id', '=', houseId)
    .executeTakeFirstOrThrow();
  await owner.transaction().execute(async (trx) => {
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`update game.sites set cycle_started_at = ${new Date(lastEnds.getTime() - cycles * CYCLE_MS)},
      created_at = ${new Date(lastEnds.getTime() - (cycles + 1) * CYCLE_MS)} where id = ${site.id}`.execute(
      trx,
    );
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });
  return site.id;
}

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
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
      await trx
        .updateTable('game.sites')
        .set({ halted_at: halted })
        .where('id', 'in', sites)
        .execute();
      await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
    });
    // Récolté pendant l'arrêt, le cycle finit pendant la sécheresse : il ne rend rien.
    const during = await send(early.user, 'site.collect', { siteId: sites[0] });
    expect(during.body).toMatchObject({ data: { cycles: 1, outputs: [{ quantity: 0 }] } });
    // Relancé après la sécheresse, temps du site décalé de l'arrêt (plus de 1,4 s) : le cycle produit en entier.
    await waitUntil(db, new Date(drought.startsAt.getTime() + 1_800));
    await sql`update game.sites set halted_at = null,
      cycle_started_at = cycle_started_at + extract(epoch from now() - halted_at) * interval '1 second'
      where id = ${sites[1]}`.execute(owner);
    const after = await send(late.user, 'site.collect', { siteId: sites[1] });
    expect(after.body).toMatchObject({ data: { cycles: 1, outputs: [{ quantity: PER_CYCLE }] } });
    expect((await effectsOf(drought.eventId)).map((effect) => effect.site_id)).toEqual([sites[0]]);
  });
});
