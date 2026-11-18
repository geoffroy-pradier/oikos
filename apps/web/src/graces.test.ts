import { describe, expect, it } from 'vitest';
import { graceStates, parseGraceUses } from './graces';

const grace = (id: string, charisRequired = 200) => ({
  id,
  godId: 'demeter',
  effect: 'blessed_harvest',
  magnitudeBps: 2_000,
  charisRequired,
  charisSpent: 150,
  cooldownDays: 3,
});
const now = Date.parse('2026-11-18T12:00:00Z');
const use = (graceId: string, readyAt: string, consumedAt: string | null) => ({
  id: `u-${graceId}`,
  house_id: 'h1',
  grace_id: graceId,
  god_id: 'demeter',
  effect: 'blessed_harvest',
  magnitude_bps: 2_000,
  charis_spent: 150,
  invoked_at: '2026-11-17T08:00:00.123456+00:00',
  ready_at: readyAt,
  consumed_at: consumedAt,
});

describe('état des grâces de la maison (#272)', () => {
  it('en attente, en recharge, à invoquer ou Charis insuffisante, comme l’API', () => {
    const uses = parseGraceUses(
      [
        use('pending', '2026-11-20T03:00:00+00:00', null),
        use('recharging', '2026-11-19T03:00:00+00:00', '2026-11-17T09:00:00+00:00'),
        // Recharge finie à l'heure du serveur, même si la vue la rendait encore : à invoquer.
        use('ready', '2026-11-18T11:59:00+00:00', '2026-11-17T09:00:00+00:00'),
        { ...use('other', '2026-11-20T03:00:00+00:00', null), house_id: 'h2' },
      ],
      'h1',
    );
    if (!uses) throw new Error('lecture attendue');
    const states = graceStates(
      [grace('pending'), grace('recharging'), grace('ready'), grace('short', 500), grace('other')],
      uses,
      new Map([['demeter', 300]]),
      now,
    );
    expect(states.map(({ grace: shown, state }) => [shown.id, state])).toEqual([
      ['pending', { kind: 'pending', readyAt: Date.parse('2026-11-20T03:00:00Z') }],
      ['recharging', { kind: 'recharging', readyAt: Date.parse('2026-11-19T03:00:00Z') }],
      ['ready', { kind: 'ready' }],
      ['short', { kind: 'short', missing: 200 }],
      ['other', { kind: 'ready' }],
    ]);
  });

  it('une grâce retirée de la configuration reste dite tant qu’une invocation l’attend ou la recharge', () => {
    const uses = parseGraceUses([use('retired', '2026-11-17T03:00:00+00:00', null)], 'h1') ?? [];
    expect(graceStates([], uses, new Map(), now)).toEqual([
      {
        grace: { id: 'retired', godId: 'demeter', effect: 'blessed_harvest', magnitudeBps: 2_000 },
        state: { kind: 'pending', readyAt: Date.parse('2026-11-17T03:00:00Z') },
      },
    ]);
    expect(parseGraceUses([{ ...use('x', 'demain', null) }], 'h1')).toBeNull();
  });
});
