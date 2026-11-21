/**
 * Hybris (docs/specs/07-dieux-faveur-evenements.md, 7.2 ; #734) : variation quotidienne de la jauge cachée d'une maison
 * de joueur, calcul pur en entiers. La jauge n'est ni monnaie ni bien : elle reste entre zéro et le plus grand entier sûr.
 */

/** Causes du journal de l'Hybris (`hubris_ledger`), dans l'ordre où elles s'appliquent : gains, baisses, déclin. */
export const HUBRIS_CAUSES = [
  'market_share',
  'wealth',
  'liturgy_levied',
  'offering',
  'liturgy_performed',
  'decay',
] as const;
export type HubrisCause = (typeof HUBRIS_CAUSES)[number];

/** Paramètres lus dans la section `hubris` de la configuration. */
export interface HubrisWeights {
  marketShareThresholdBps: number;
  wealthMultipleBps: number;
  marketShareWeight: number;
  wealthWeight: number;
  leviedLiturgyWeight: number;
  offeringReliefBps: number;
  performedLiturgyRelief: number;
  dailyDecay: number;
}

/** Ventes d'une maison dans un marché (un bien, une cité) sur la fenêtre, et tout ce qui s'y est échangé. */
export interface MarketSales {
  sold: bigint;
  total: bigint;
}

/** Ce que la clôture a vu d'une maison. */
export interface HubrisDay {
  /** Un élément par marché où la maison a vendu sur la fenêtre. */
  markets: readonly MarketSales[];
  /** Fortune de la maison (4.1) et fortune médiane des maisons de joueur du monde, en oboles. */
  wealth: bigint;
  medianWealth: bigint;
  /** Liturgies de la maison prélevées d'office à cette clôture. */
  leviedLiturgies: number;
  /** Oboles offertes aux dieux sur la période comptée. */
  offeredOboles: bigint;
  /** Liturgies accomplies sur la période comptée, et leur faste total en oboles. */
  performedLiturgies: number;
  splendorOboles: bigint;
}

export interface HubrisChange {
  cause: HubrisCause;
  /** Positif pour un gain, négatif pour une baisse ; jamais nul. */
  amount: number;
}

const WEIGHT_NAMES = [
  'marketShareThresholdBps',
  'wealthMultipleBps',
  'marketShareWeight',
  'wealthWeight',
  'leviedLiturgyWeight',
  'offeringReliefBps',
  'performedLiturgyRelief',
  'dailyDecay',
] as const satisfies readonly (keyof HubrisWeights)[];
const BPS = 10_000n;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);

const count = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a non-negative safe integer`);
  return BigInt(value);
};
const nonNegative = (value: bigint, name: string) => {
  if (value < 0n) throw new RangeError(`${name} must be non-negative`);
  return value;
};

/**
 * Hybris gagnée sur un marché : la part des ventes au-delà du seuil, en points de base, fois le poids, sur 10 000,
 * arrondie vers le bas d'un seul coup (sans arrondir la part elle-même). Nulle à la part du seuil ou en dessous.
 */
function marketShareGain(market: MarketSales, rules: HubrisWeights): bigint {
  const sold = nonNegative(market.sold, 'sold');
  if (market.total < sold) throw new RangeError('a house cannot sell more than its market trades');
  if (sold === 0n) return 0n;
  const excess = sold * BPS - BigInt(rules.marketShareThresholdBps) * market.total;
  if (excess <= 0n) return 0n;
  return (excess * BigInt(rules.marketShareWeight)) / (market.total * BPS);
}

/**
 * Hybris gagnée par la fortune : son rapport à la médiane au-delà du multiple, en points de base, fois le poids, sur
 * 10 000, arrondi vers le bas. Nulle si la médiane est nulle ou négative : le rapport n'a alors pas de sens.
 */
function wealthGain(day: HubrisDay, rules: HubrisWeights): bigint {
  if (day.medianWealth <= 0n) return 0n;
  const excess = day.wealth * BPS - BigInt(rules.wealthMultipleBps) * day.medianWealth;
  if (excess <= 0n) return 0n;
  return (excess * BigInt(rules.wealthWeight)) / (day.medianWealth * BPS);
}

/**
 * Variations de la jauge `gauge` d'une maison pour une clôture, une par cause non nulle, dans l'ordre de
 * `HUBRIS_CAUSES` : les gains d'abord, puis les baisses, puis le déclin, chacun rogné pour que la jauge reste entre zéro
 * et le plus grand entier sûr. Une baisse ne sert donc jamais à éponger d'avance un gain du même jour qui viendrait
 * après elle. La jauge finale (`gauge` plus la somme des variations) croît avec chaque part de marché et la fortune, et
 * décroît avec les oboles offertes et les liturgies accomplies.
 */
export function hubrisDelta(gauge: number, day: HubrisDay, rules: HubrisWeights): HubrisChange[] {
  let level = count(gauge, 'gauge');
  for (const name of WEIGHT_NAMES) count(rules[name], name);
  nonNegative(day.offeredOboles, 'offeredOboles');
  nonNegative(day.splendorOboles, 'splendorOboles');
  const relief = (oboles: bigint) => (oboles * BigInt(rules.offeringReliefBps)) / BPS;
  const raw: Record<HubrisCause, bigint> = {
    market_share: day.markets.reduce((sum, market) => sum + marketShareGain(market, rules), 0n),
    wealth: wealthGain(day, rules),
    liturgy_levied:
      count(day.leviedLiturgies, 'leviedLiturgies') * BigInt(rules.leviedLiturgyWeight),
    offering: -relief(day.offeredOboles),
    liturgy_performed: -(
      count(day.performedLiturgies, 'performedLiturgies') * BigInt(rules.performedLiturgyRelief) +
      relief(day.splendorOboles)
    ),
    decay: -BigInt(rules.dailyDecay),
  };
  const changes: HubrisChange[] = [];
  for (const cause of HUBRIS_CAUSES) {
    const wanted = raw[cause];
    const amount = wanted > 0n ? min(wanted, MAX - level) : -min(-wanted, level);
    if (amount === 0n) continue;
    level += amount;
    changes.push({ cause, amount: Number(amount) });
  }
  return changes;
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);

/**
 * Fortune médiane : celle du milieu, ou la moyenne des deux du milieu arrondie vers le bas (vers moins l'infini) ;
 * nulle sans fortune.
 */
export function medianWealth(wealths: readonly bigint[]): bigint {
  if (wealths.length === 0) return 0n;
  const sorted = [...wealths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const high = sorted[sorted.length >> 1] ?? 0n;
  if (sorted.length % 2 === 1) return high;
  const sum = (sorted[(sorted.length >> 1) - 1] ?? 0n) + high;
  const half = sum / 2n;
  return sum < 0n && sum % 2n !== 0n ? half - 1n : half;
}
