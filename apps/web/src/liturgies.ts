import { LITURGY_GENRES, type LiturgyGenre } from '@oikos/contracts';
import { liturgyGain, maxSplendor } from '@oikos/sim';
import { z } from 'zod';

/**
 * Liturgies lues par le client (6.4, 12). Le dû ne se lit que pour sa propre maison (`my_liturgies`) : les liturgies
 * des cités (`city_liturgies`) n'en portent ni le dû ni aucun montant, et rien ici ne classe les maisons par fortune.
 * Les calculs du faste et des gains sont ceux de `packages/sim` ; l'API fait foi, l'écran ne fait qu'annoncer.
 */

/** État d'une liturgie à un instant : désignée, échue sans être réglée (prélevée à la prochaine clôture), accomplie ou prélevée d'office. */
export type LiturgyState = 'assigned' | 'overdue' | 'performed' | 'levied';
type Status = 'assigned' | 'performed' | 'levied';

const id = z.string().min(1);
const genre = z.enum(LITURGY_GENRES);
const status = z.enum(['assigned', 'performed', 'levied']);
const instant = z.string().transform((value, ctx) => {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) ctx.addIssue({ code: 'custom', message: 'not an instant' });
  return ms;
});

/** Liturgie de la maison du joueur, avec son dû en oboles. Instants en millisecondes. */
export interface MyLiturgy {
  id: string;
  cityId: string;
  season: number;
  genre: LiturgyGenre;
  due: number;
  dueAt: number;
  status: Status;
}

const mineRow = z.object({
  id,
  city_id: id,
  season: z.number().int(),
  genre,
  // Le dû est un `bigint` : PostgREST le rend en nombre, borné aux entiers sûrs par la base.
  due: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  due_at: instant,
  status,
});

/** Liturgies de la maison, de la plus récente saison à la plus ancienne ; `null` si une ligne est illisible. */
export function parseMyLiturgies(rows: unknown): MyLiturgy[] | null {
  const parsed = z.array(mineRow).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data
    .map((row) => ({
      id: row.id,
      cityId: row.city_id,
      season: row.season,
      genre: row.genre,
      due: row.due,
      dueAt: row.due_at,
      status: row.status,
    }))
    .sort((a, b) => b.season - a.season);
}

/** Liturgie d'une cité, telle que la lit tout joueur : sans montant. */
export interface CityLiturgy {
  houseId: string;
  season: number;
  genre: LiturgyGenre;
  status: Status;
  dueAt: number;
}

const cityRow = z.object({
  house_id: id,
  season: z.number().int(),
  genre,
  status,
  due_at: instant,
});

/**
 * Liturgies de la saison la plus récente d'une cité, dans l'ordre de lecture (l'écran les range par nom de maison,
 * jamais par ce qui dirait la fortune) ; `null` si une ligne est illisible. Vide : aucune saison n'a encore désigné
 * personne.
 */
export function parseCityLiturgies(rows: unknown): CityLiturgy[] | null {
  const parsed = z.array(cityRow).safeParse(rows);
  if (!parsed.success) return null;
  const latest = Math.max(...parsed.data.map((row) => row.season));
  return parsed.data
    .filter((row) => row.season === latest)
    .map((row) => ({
      houseId: row.house_id,
      season: row.season,
      genre: row.genre,
      status: row.status,
      dueAt: row.due_at,
    }));
}

/** État à un instant : une liturgie désignée est échue dès l'instant de son échéance, que la clôture l'ait réglée ou non. */
export function liturgyState(
  liturgy: { status: Status; dueAt: number },
  now: number,
): LiturgyState {
  if (liturgy.status !== 'assigned') return liturgy.status;
  return now >= liturgy.dueAt ? 'overdue' : 'assigned';
}

/**
 * Liturgie à accomplir de la maison : la désignée, pas encore échue, de la saison la plus récente ; `null` sinon.
 * Une liturgie échue ne s'accomplit plus (`LITURGY_OVERDUE`).
 */
export function openLiturgy(liturgies: readonly MyLiturgy[], now: number): MyLiturgy | null {
  return liturgies.find((liturgy) => liturgyState(liturgy, now) === 'assigned') ?? null;
}

/** Règles publiques des liturgies (vue `liturgy_rules`, 12) : gains, perte de Timè et borne du faste. */
export interface LiturgyRules {
  honorGain: number;
  charisGain: number;
  evasionHonorLoss: number;
  maxSplendorBps: number;
}

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const rulesSchema = z.object({
  honorGain: count,
  charisGain: count,
  evasionHonorLoss: count,
  maxSplendorBps: count.max(10_000),
});

/** Règles lues dans la colonne `rules` ; `null` si la ligne est illisible ou absente (aucune configuration en vigueur). */
export function parseLiturgyRules(row: unknown): LiturgyRules | null {
  const parsed = z.object({ rules: rulesSchema }).safeParse(row);
  return parsed.success ? parsed.data.rules : null;
}

/** Ce qu'une liturgie accomplie avec ce faste coûte et rapporte, d'après les règles lues. */
export interface LiturgyQuote {
  /** Oboles payées : le dû et le faste. */
  total: number;
  honor: number;
  charis: number;
}

/** Faste le plus haut permis pour un dû : zéro sans borne publiée. */
export const splendorLimit = (due: number, rules: LiturgyRules): number =>
  Number(maxSplendor(BigInt(due), rules.maxSplendorBps));

/** Dû et faste payés, Timè et Charis gagnées, par les formules de `packages/sim` ; `null` si le faste sort de [0, borne]. */
export function quoteLiturgy(
  due: number,
  splendor: number,
  rules: LiturgyRules,
): LiturgyQuote | null {
  if (!Number.isSafeInteger(splendor) || splendor < 0 || splendor > splendorLimit(due, rules))
    return null;
  return {
    total: due + splendor,
    honor: liturgyGain(rules.honorGain, BigInt(due), BigInt(splendor)),
    charis: liturgyGain(rules.charisGain, BigInt(due), BigInt(splendor)),
  };
}

const honorRow = z.object({
  amount: z.number().int(),
  reason: z.string(),
  reference: z.string().nullable(),
});

/**
 * Timè qu'une liturgie réglée a changée, lue dans le journal de la Timè de la maison (`my_honor_entries`) : le gain
 * d'une liturgie accomplie, la perte (négative) d'une dérobade. Sans ligne : `0` ; `null` si une ligne est illisible.
 */
export function liturgyHonor(rows: unknown, liturgyId: string): number | null {
  const parsed = z.array(honorRow).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data
    .filter(
      (row) =>
        row.reference === liturgyId &&
        (row.reason === 'liturgy_performed' || row.reason === 'liturgy_evaded'),
    )
    .reduce((sum, row) => sum + row.amount, 0);
}
