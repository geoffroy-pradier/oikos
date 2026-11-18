import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  code,
  db,
  eventsOf,
  hire,
  narrow,
  newPlayer,
  owner,
  send,
  stewardsOf,
} from './steward.integration-fixtures';

// Règles des intendants (#278), contre Supabase local. Chaque test fonde sa maison : un champ de blé, sans
// intrant, et un moulin, dont l'intrant est le blé.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const rulesOf = (stewardId: string, revision: number) =>
  db
    .selectFrom('game.steward_rules')
    .select(['position', 'kind', 'good_id', 'price_oboles', 'units'])
    .where('steward_id', '=', stewardId)
    .where('revision', '=', revision)
    .orderBy('position')
    .execute();
const sell = { kind: 'sell', goodId: 'flour', minPriceOboles: 14, keepUnits: 20 } as const;
const buy = { kind: 'buy', goodId: 'wheat', maxPriceOboles: 7, targetUnits: 50 } as const;
const collect = { kind: 'collect' } as const;

describe('steward.setRules', () => {
  it('remplace les règles par une révision nouvelle, dans l’ordre reçu ; rejouée, rien de plus', async () => {
    const player = await newPlayer();
    const stewardId = await hire(player.user, player.mill);
    const rules = [collect, sell, buy];
    const key = randomUUID();
    const set = await send(player.user, 'steward.setRules', { stewardId, rules }, key);
    expect(set).toEqual({ status: 200, body: { ok: true, data: { stewardId, rules } } });
    expect(await send(player.user, 'steward.setRules', { stewardId, rules }, key)).toEqual(set);
    expect(await rulesOf(stewardId, 1)).toEqual([
      { position: 0, kind: 'collect', good_id: null, price_oboles: null, units: null },
      { position: 1, kind: 'sell', good_id: 'flour', price_oboles: '14', units: '20' },
      { position: 2, kind: 'buy', good_id: 'wheat', price_oboles: '7', units: '50' },
    ]);
    // Une liste vide est une révision comme une autre : l'intendant ne fait plus rien.
    expect(code(await send(player.user, 'steward.setRules', { stewardId, rules: [] }))).toBe('ok');
    expect((await stewardsOf(player.houseId))[0]?.rules_revision).toBe(2);
    expect(await rulesOf(stewardId, 2)).toEqual([]);
    expect(await rulesOf(stewardId, 1)).toHaveLength(3);
    const events = (await eventsOf(player.houseId)).filter((e) => e.type === 'StewardRulesSet');
    expect(events.map((event) => event.payload)).toEqual([
      { stewardId, houseId: player.houseId, siteId: player.mill, rules },
      { stewardId, houseId: player.houseId, siteId: player.mill, rules: [] },
    ]);
  });

  it('refuse sans rien écrire : trop de règles, bien inconnu, rachat hors des intrants, grammaire', async () => {
    const player = await newPlayer();
    const field = await hire(player.user, player.field);
    const mill = await hire(player.user, player.mill);
    const attempt = (stewardId: string, rules: unknown[], via = narrow) =>
      send(player.user, 'steward.setRules', { stewardId, rules }, randomUUID(), via).then(code);
    expect(await attempt(mill, [collect, sell, buy])).toBe('TOO_MANY_RULES');
    expect(await attempt(mill, [{ ...sell, goodId: 'nectar' }])).toBe('GOOD_NOT_FOUND');
    // Le champ de blé n'a pas d'intrant : il ne rachète rien.
    expect(await attempt(field, [buy])).toBe('NOT_AN_INPUT');
    expect(await attempt(mill, [{ ...buy, goodId: 'olives' }])).toBe('NOT_AN_INPUT');
    expect(await attempt(mill, [sell, { ...sell, minPriceOboles: 20 }])).toBe('VALIDATION_FAILED');
    expect(await attempt(mill, [{ ...sell, minPriceOboles: 0 }])).toBe('VALIDATION_FAILED');
    expect(await attempt(mill, [{ kind: 'transport', goodId: 'flour' }])).toBe('VALIDATION_FAILED');
    expect((await stewardsOf(player.houseId)).map((s) => s.rules_revision)).toEqual([0, 0]);
    expect((await eventsOf(player.houseId)).map((event) => event.type)).toEqual([
      'StewardHired',
      'StewardHired',
    ]);
    expect(await attempt(mill, [collect, buy])).toBe('ok');
  });

  it('l’intendant d’une autre maison est inconnu ; sous concurrence, chaque révision reste entière', async () => {
    const [alice, bob] = [await newPlayer(), await newPlayer()];
    const stewardId = await hire(bob.user, bob.mill);
    expect(code(await send(alice.user, 'steward.setRules', { stewardId, rules: [sell] }))).toBe(
      'STEWARD_NOT_FOUND',
    );
    const lists = [[sell], [collect, buy], [buy, sell, collect]];
    const raced = await Promise.all(
      lists.map((rules) => send(bob.user, 'steward.setRules', { stewardId, rules })),
    );
    expect(raced.map(code)).toEqual(['ok', 'ok', 'ok']);
    const revisions = await Promise.all([1, 2, 3].map((revision) => rulesOf(stewardId, revision)));
    expect(revisions.map((rows) => rows.length).sort()).toEqual([1, 2, 3]);
    expect((await stewardsOf(bob.houseId))[0]?.rules_revision).toBe(3);
  });

  it('un intendant renvoyé ne reçoit plus de règles ; renvoi et règles simultanés se suivent', async () => {
    const player = await newPlayer();
    const first = await hire(player.user, player.mill);
    await send(player.user, 'steward.dismiss', { stewardId: first });
    expect(code(await send(player.user, 'steward.setRules', { stewardId: first, rules: [] }))).toBe(
      'STEWARD_NOT_FOUND',
    );
    const stewardId = await hire(player.user, player.mill);
    const [rules, dismissed] = await Promise.all([
      send(player.user, 'steward.setRules', { stewardId, rules: [sell] }),
      send(player.user, 'steward.dismiss', { stewardId }),
    ]);
    expect(code(dismissed)).toBe('ok');
    // Les règles sont passées avant le renvoi, ou refusées après lui : jamais écrites pour un renvoyé.
    expect(['ok', 'STEWARD_NOT_FOUND']).toContain(code(rules));
    const second = (await stewardsOf(player.houseId)).find((steward) => steward.id === stewardId);
    expect(second?.rules_revision).toBe(code(rules) === 'ok' ? 1 : 0);
  });
});
