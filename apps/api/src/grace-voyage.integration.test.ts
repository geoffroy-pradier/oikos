import { randomUUID } from 'node:crypto';
import { fairWindSeconds, stormDurationSeconds } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import {
  db,
  depart,
  departuresOf,
  newShipowner,
  owner,
  send,
  type Shipowner,
} from './voyage.integration-fixtures';
import { blessed } from './grace.integration-fixtures';
import { planEvent, waitUntil } from './world-events.integration-fixtures';

// Vent favorable consommé par `voyage.depart` (#266), contre Supabase local, avec les grâces d'essai : le vent
// de Poséidon retire 25 % au trajet, demande 300 de Charis, en dépense 150. De Kallistè à Elaia, un caboteur met
// 4 h par temps calme.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const CALM = 4 * 3_600;
const codeOf = (reply: { body: { error?: { code: string } } }) => reply.body.error?.code;
const duration = (reply: { body: { data?: { arrivesAt: string; departedAt: string } } }) =>
  (Date.parse(reply.body.data?.arrivesAt ?? '') - Date.parse(reply.body.data?.departedAt ?? '')) /
  1000;
const invoke = (player: Shipowner) =>
  send(
    player.user,
    'temple.invokeGrace',
    { graceId: 'poseidon_wind', expectedCharisSpent: 150 },
    undefined,
    blessed,
  );
/** L'armateur offre 300 oboles à Poséidon et invoque son vent favorable. */
async function windy(player: Shipowner) {
  const offered = await send(player.user, 'temple.makeOffering', {
    godId: 'poseidon',
    oboles: 300,
    goods: [],
    expectedCharis: 300,
  });
  expect(offered.status).toBe(200);
  const invoked = await invoke(player);
  expect(invoked.status).toBe(200);
  return invoked.body.data.graceUseId as string;
}
const useOf = (id: string) =>
  db
    .selectFrom('game.graces_used')
    .select(['consumed_at', 'voyage_id', 'saved_seconds'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();

describe('vent favorable et départ (#266)', () => {
  it('raccourcit le prochain départ, une fois ; un départ refusé ne le consomme pas', async () => {
    const player = await newShipowner();
    const graceUseId = await windy(player);
    // Plus de blé que le stock : refusé, le vent attend toujours.
    expect(codeOf(await depart(player, { cargo: [{ goodId: 'wheat', quantity: 101 }] }))).toBe(
      'INSUFFICIENT_STOCK',
    );
    expect((await useOf(graceUseId)).consumed_at).toBeNull();
    const left = await depart(player);
    const saved = CALM - fairWindSeconds(CALM, 2_500);
    expect([duration(left), saved]).toEqual([3 * 3_600, 3_600]);
    expect(left.body.data.fairWind).toEqual({
      graceUseId,
      graceId: 'poseidon_wind',
      savedSeconds: saved,
    });
    expect(await useOf(graceUseId)).toMatchObject({
      voyage_id: left.body.data.voyageId,
      saved_seconds: saved,
    });
    expect((await departuresOf(player.houseId))[0]).toMatchObject({
      fairWind: left.body.data.fairWind,
    });
    // Consommé, il se recharge ; un autre armateur sans vent part par temps calme.
    const again = await invoke(player);
    expect(codeOf(again)).toBe('GRACE_RECHARGING');
    const other = await depart(await newShipowner());
    expect([duration(other), other.body.data.fairWind]).toEqual([CALM, undefined]);
  });

  it('pendant une tempête : la tempête allonge d’abord, le vent raccourcit ensuite la durée allongée', async () => {
    const worldId = randomUUID();
    await owner
      .insertInto('game.worlds')
      .values({ id: worldId, slug: `gr-${worldId.slice(0, 12)}`, name: 'Grâces' })
      .execute();
    const cities = await owner
      .insertInto('game.cities')
      .values(['kalliste', 'elaia'].map((slug) => ({ world_id: worldId, slug, name: slug })))
      .returning(['id', 'slug'])
      .execute();
    const [kalliste, elaia] = ['kalliste', 'elaia'].map(
      (slug) => cities.find((city) => city.slug === slug)?.id ?? '',
    );
    const player = await newShipowner(kalliste);
    const graceUseId = await windy(player);
    const storm = await planEvent(owner, {
      worldId,
      model: 'storm',
      cityId: kalliste ?? '',
      otherCityId: elaia ?? '',
      magnitudeBps: 3_000,
      inMs: 1_500,
      lastsMs: 86_400_000,
    });
    await waitUntil(db, storm.startsAt);
    const left = await depart(player, { fromCityId: kalliste, toCityId: elaia });
    // 4 h × 1,3 = 18 720 s, puis × 0,75 = 14 040 s ; la tempête garde son retard, le vent ses secondes.
    const stormy = stormDurationSeconds(CALM, 3_000);
    expect([stormy, duration(left)]).toEqual([18_720, fairWindSeconds(stormy, 2_500)]);
    expect(duration(left)).toBe(14_040);
    const delay = await sql<{ delay_seconds: number }>`select delay_seconds from game.event_effects
      where voyage_id = ${left.body.data.voyageId as string}`.execute(db);
    expect(delay.rows).toEqual([{ delay_seconds: stormy - CALM }]);
    expect((await useOf(graceUseId)).saved_seconds).toBe(stormy - 14_040);
  });
});
