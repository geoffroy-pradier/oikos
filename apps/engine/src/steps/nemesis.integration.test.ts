import type { HubrisRules, NemesisRules } from '@oikos/config';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { hubrisGauge } from './hubris-gauge';
import {
  close,
  DAY,
  db,
  gaugesOf,
  newWorld,
  WEIGHTED,
  type World,
} from './hubris.integration-fixtures';
import { nemesis } from './nemesis';

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
});
