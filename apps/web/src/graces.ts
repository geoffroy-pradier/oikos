import { z } from 'zod';
import type { TempleGrace } from './temple';

const id = z.string().min(1);
const instant = z.iso.datetime({ offset: true }).transform((value) => Date.parse(value));
const useSchema = z.object({
  house_id: id,
  grace_id: id,
  god_id: id,
  effect: id,
  magnitude_bps: z.number().int().positive(),
  charis_spent: z.number().int().nonnegative(),
  invoked_at: instant,
  ready_at: instant,
  consumed_at: instant.nullable(),
});
export type GraceUse = z.infer<typeof useSchema>;

/** Invocations de la maison (vue `my_graces`) ; `null` si une ligne est illisible. */
export function parseGraceUses(rows: unknown, houseId: string): GraceUse[] | null {
  const parsed = z.array(useSchema).safeParse(rows);
  return parsed.success ? parsed.data.filter((use) => use.house_id === houseId) : null;
}

/**
 * État d'une grâce pour la maison (7.1) : en attente de l'action qui la consommera (et sa fin de recharge), en
 * recharge jusqu'à `readyAt`, à invoquer, ou hors de portée faute de Charis (`missing`).
 */
export type GraceState =
  | { kind: 'pending'; readyAt: number }
  | { kind: 'recharging'; readyAt: number }
  | { kind: 'ready' }
  | { kind: 'short'; missing: number };

/** Ce qu'une grâce donne et coûte : celle de la configuration, ou celle d'une invocation qui l'a quittée depuis. */
export type GraceShown = Pick<TempleGrace, 'id' | 'godId' | 'effect' | 'magnitudeBps'> &
  Partial<Pick<TempleGrace, 'charisRequired' | 'charisSpent' | 'cooldownDays'>>;

/**
 * Grâces à afficher, à l'instant `now` du serveur : celles de la configuration en vigueur, puis celles qu'elle ne
 * porte plus mais qu'une invocation de la maison attend encore ou recharge (ce qui est payé est servi, 7.1). Une
 * invocation en attente bloque la grâce ; sinon la plus tardive des recharges en cours ; sinon la Charis de la
 * maison envers le dieu décide, comme l'API (`INSUFFICIENT_CHARIS`).
 */
export function graceStates(
  graces: readonly TempleGrace[],
  uses: readonly GraceUse[],
  favor: ReadonlyMap<string, number>,
  now: number,
): { grace: GraceShown; state: GraceState }[] {
  const busy = (graceId: string): GraceState | null => {
    const mine = uses.filter((use) => use.grace_id === graceId);
    const readyAt = Math.max(-Infinity, ...mine.map((use) => use.ready_at));
    if (mine.some((use) => use.consumed_at === null)) return { kind: 'pending', readyAt };
    return readyAt > now ? { kind: 'recharging', readyAt } : null;
  };
  const known = graces.map((grace) => {
    const charis = favor.get(grace.godId) ?? 0;
    const state: GraceState =
      busy(grace.id) ??
      (charis >= grace.charisRequired
        ? { kind: 'ready' }
        : { kind: 'short', missing: grace.charisRequired - charis });
    return { grace: grace as GraceShown, state };
  });
  const gone = [...new Set(uses.map((use) => use.grace_id))]
    .filter((graceId) => !graces.some((grace) => grace.id === graceId))
    .flatMap((graceId) => {
      const state = busy(graceId);
      const use = uses.find((candidate) => candidate.grace_id === graceId);
      if (!state || !use) return [];
      const grace = {
        id: graceId,
        godId: use.god_id,
        effect: use.effect,
        magnitudeBps: use.magnitude_bps,
      };
      return [{ grace, state }];
    });
  return [...known, ...gone];
}
