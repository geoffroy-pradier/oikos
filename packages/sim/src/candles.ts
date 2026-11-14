/**
 * Chandeliers de prix (docs/specs/05-economie.md, 5.3) : calcul pur, en entiers. Les échanges d'un
 * marché (un bien dans une cité) sont résumés par période [début, début + durée), le début étant un
 * multiple de la durée depuis l'époque Unix. Une période sans échange n'a pas de chandelier.
 */
export interface TradePrint {
  /** Instant de l'échange, en millisecondes depuis l'époque Unix. */
  at: number;
  /** Prix par unité, en oboles. */
  price: number;
  quantity: number;
}

export interface PriceCandle {
  /** Début de la période, en millisecondes depuis l'époque Unix. */
  periodStart: number;
  /** Prix du premier et du dernier échange de la période, dans l'ordre reçu. */
  open: number;
  close: number;
  high: number;
  low: number;
  /** Unités échangées. */
  volume: number;
  /** Somme des prix × quantités : montant brut, avant taxe de marché. */
  turnover: number;
}

const positiveInteger = (value: number) => Number.isSafeInteger(value) && value > 0;

/**
 * Résume des échanges en chandeliers, rendus par période croissante. Les échanges sont lus dans l'ordre
 * reçu, qui est leur ordre d'exécution : il départage l'ouverture et la clôture quand plusieurs échanges
 * portent le même instant (ceux d'une même transaction). Une somme hors des entiers sûrs est refusée
 * plutôt qu'arrondie.
 */
export function priceCandles(trades: readonly TradePrint[], periodSeconds: number): PriceCandle[] {
  // Borne haute : la colonne `period_seconds` de la table est un entier de 32 bits.
  if (!positiveInteger(periodSeconds) || periodSeconds > 2_147_483_647)
    throw new RangeError('periodSeconds must be a positive 32-bit integer');
  const periodMs = periodSeconds * 1000;
  const candles = new Map<number, PriceCandle>();
  for (const { at, price, quantity } of trades) {
    if (!Number.isSafeInteger(at)) throw new RangeError('trade instant must be an integer');
    if (!positiveInteger(price) || !positiveInteger(quantity))
      throw new RangeError('trade price and quantity must be positive integers');
    const periodStart = Math.floor(at / periodMs) * periodMs;
    const candle = candles.get(periodStart);
    const turnover = (candle?.turnover ?? 0) + price * quantity;
    if (!Number.isSafeInteger(price * quantity) || !Number.isSafeInteger(turnover))
      throw new RangeError('candle turnover exceeds safe integers');
    candles.set(periodStart, {
      periodStart,
      open: candle?.open ?? price,
      close: price,
      high: Math.max(candle?.high ?? price, price),
      low: Math.min(candle?.low ?? price, price),
      volume: (candle?.volume ?? 0) + quantity,
      turnover,
    });
  }
  return [...candles.values()].sort((a, b) => a.periodStart - b.periodStart);
}

/**
 * Prix de référence observé (5.3) : prix moyen des échanges résumés par ces chandeliers, pondéré par les
 * volumes, arrondi à l'obole la plus proche (la demi-obole vers le haut). `null` sans échange.
 */
export function observedPrice(
  candles: readonly Pick<PriceCandle, 'volume' | 'turnover'>[],
): { price: number; volume: number } | null {
  let [volume, turnover] = [0, 0];
  for (const candle of candles) {
    // Une unité s'échange au moins une obole : le prix observé n'est jamais nul.
    if (
      !positiveInteger(candle.volume) ||
      !positiveInteger(candle.turnover) ||
      candle.turnover < candle.volume
    )
      throw new RangeError(
        'candle volume and turnover must be positive integers, turnover ≥ volume',
      );
    volume += candle.volume;
    turnover += candle.turnover;
  }
  if (volume === 0) return null;
  if (!Number.isSafeInteger(turnover) || !Number.isSafeInteger(2 * volume))
    throw new RangeError('observed turnover or volume exceeds safe integers');
  const rest = turnover % volume;
  return { price: (turnover - rest) / volume + (2 * rest >= volume ? 1 : 0), volume };
}
