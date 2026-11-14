import { DEFAULT_PRICE_HISTORY } from '@oikos/config/schema';
import { z } from 'zod';

/** Un chandelier lu par le client (vue `public.price_candles`), instants en millisecondes. */
export interface Candle {
  periodStart: number;
  periodSeconds: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const DAY_MS = 86_400_000;
const price = z.number().int().positive();
/** Souple sur la forme (colonnes en plus), tenu sur les valeurs : un chandelier incohérent n'est pas affiché. */
const candleSchema = z
  .object({
    period_start: z.iso.datetime({ offset: true }),
    period_seconds: z.number().int().positive(),
    open: price,
    high: price,
    low: price,
    close: price,
    volume: z.number().int().positive(),
  })
  .refine((c) => c.low <= Math.min(c.open, c.close) && Math.max(c.open, c.close) <= c.high);

const rulesSchema = z.object({
  price_history: z
    .object({ candleMinutes: z.number().int().min(1).max(1440) })
    .nullable()
    .transform((history) => history ?? DEFAULT_PRICE_HISTORY),
});

/**
 * Durée, en secondes, des chandeliers de la série en cours : celle de la configuration en vigueur, lue
 * dans la vue `public.market_rules` (une ligne). Version publiée avant l'historique : valeur du schéma
 * partagé. `null` si la ligne manque ou est illisible : la série en cours est alors inconnue.
 */
export function parseCandleSeconds(raw: unknown): number | null {
  const parsed = rulesSchema.safeParse(raw);
  return parsed.success ? parsed.data.price_history.candleMinutes * 60 : null;
}

/**
 * Lit des chandeliers et en garde la série en cours, du plus ancien au plus récent : ceux de la durée
 * donnée. Après un changement de durée, l'ancienne série reste en base et recouvre la nouvelle dans le
 * temps : rien dans les lignes ne dit laquelle est en cours, c'est la configuration qui le dit. `null`
 * si une ligne est illisible : jamais pris pour « aucun échange ».
 */
export function parsePriceSeries(raw: unknown, periodSeconds: number): Candle[] | null {
  const parsed = z.array(candleSchema).safeParse(raw);
  if (!parsed.success) return null;
  const candles = parsed.data
    .map(({ period_start, period_seconds, ...values }) => ({
      periodStart: Date.parse(period_start),
      periodSeconds: period_seconds,
      ...values,
    }))
    .sort((a, b) => a.periodStart - b.periodStart);
  return candles.filter((candle) => candle.periodSeconds === periodSeconds);
}

/**
 * Début le plus tardif d'un chandelier entièrement clos 24 heures avant `now` : sa clôture est le prix
 * d'il y a 24 heures, à la finesse des chandeliers près.
 */
export function dayAgoCutoff(periodSeconds: number, now: number): number {
  return now - DAY_MS - periodSeconds * 1000;
}

/**
 * Dernier prix et variation sur 24 heures. Le prix de comparaison est la clôture du dernier chandelier
 * clos 24 heures plus tôt (`dayAgoCutoff`) : c'est le dernier chandelier lui-même si rien ne s'est
 * échangé depuis, la variation est alors nulle. Sans chandelier aussi ancien, la variation est inconnue.
 */
export function priceSummary(series: readonly Candle[], now: number) {
  const last = series.at(-1);
  if (!last) return null;
  const cutoff = dayAgoCutoff(last.periodSeconds, now);
  const before = series.filter((candle) => candle.periodStart <= cutoff).at(-1);
  return {
    last: last.close,
    lastAt: last.periodStart,
    /** Rapport signé, arrondi au millième : 0,25 pour +25 %. Jamais « −0 » : une baisse infime vaut 0. */
    change: before
      ? Math.round(((last.close - before.close) / before.close) * 1000) / 1000 || 0
      : null,
  };
}

export interface CandleMark {
  /** Centre horizontal du chandelier. */
  x: number;
  /** Mèche : du plus haut au plus bas. */
  wickTop: number;
  wickBottom: number;
  /** Corps : entre l'ouverture et la clôture, d'une épaisseur toujours visible. */
  bodyTop: number;
  bodyHeight: number;
  /** Clôture au-dessus de l'ouverture, en dessous, ou égale. */
  trend: 'up' | 'down' | 'flat';
}

/**
 * Place les chandeliers dans un cadre `width` × `height` (unités du dessin, origine en haut à gauche) :
 * un créneau de même largeur par chandelier, dans l'ordre reçu, et une échelle verticale linéaire du
 * plus bas au plus haut de la série. Si tous les prix sont égaux, ils sont tracés à mi-hauteur. Série
 * vide : aucune marque, et une échelle de 0 à 0.
 */
export function candleMarks(series: readonly Candle[], width: number, height: number) {
  const low = series.length ? Math.min(...series.map((candle) => candle.low)) : 0;
  const high = series.length ? Math.max(...series.map((candle) => candle.high)) : 0;
  const y = (value: number) =>
    high === low ? height / 2 : ((high - value) / (high - low)) * height;
  const slot = width / Math.max(series.length, 1);
  const marks = series.map((candle, index): CandleMark => {
    const [top, bottom] = [
      y(Math.max(candle.open, candle.close)),
      y(Math.min(candle.open, candle.close)),
    ];
    const bodyHeight = Math.max(bottom - top, 1);
    return {
      x: slot * (index + 0.5),
      wickTop: y(candle.high),
      wickBottom: y(candle.low),
      // Un corps d'épaisseur minimale reste centré sur son prix, sans sortir du cadre.
      bodyTop: Math.min(Math.max(top - (bodyHeight - (bottom - top)) / 2, 0), height - bodyHeight),
      bodyHeight,
      trend: candle.close > candle.open ? 'up' : candle.close < candle.open ? 'down' : 'flat',
    };
  });
  return { marks, slot, low, high };
}
