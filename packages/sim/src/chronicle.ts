/**
 * Faits du jour d'une cité pour sa chronique (6.6, 8.1, 15.2 ; #271) : calcul pur, en entiers, à partir des
 * événements de domaine (dans leur ordre d'émission) et du journal de la clôture. Les entrées ne portent que des
 * identifiants courts et des noms : une chronique ne peut citer d'autre nombre que ceux des faits.
 */

/** Issue d'un décret dans la journée : dépouillé (adopté, rejeté), appliqué ou tombé. */
export type ChronicleDecreeOutcome = 'adopted' | 'rejected' | 'applied' | 'lapsed';
export type ChronicleWorldEventModel = 'drought' | 'good_year' | 'storm' | 'caravan';
/**
 * Fait de ligue d'une cité (#737) : elle fonde une ligue, y entre, la quitte, la quitte et la ligue se dissout, ou la
 * ligue se dissout autour d'elle, restée seule.
 */
export type ChronicleLeagueChange = 'founded' | 'joined' | 'left' | 'leftDissolved' | 'dissolved';

/** Un événement du journal, réduit à ce que la chronique en dit. */
export type ChronicleInputEvent =
  | { type: 'trade'; cityId: string; goodId: string; price: number; quantity: number }
  | { type: 'arrival'; cityId: string; fromCityId: string }
  /** Cargaison perdue en mer (#730) sur la route de `fromCityId` à `cityId`, la cité d'arrivée : aucune maison. */
  | { type: 'loss'; cityId: string; fromCityId: string }
  | { type: 'election'; cityId: string; houseName: string; votes: number }
  | {
      type: 'decree';
      cityId: string;
      model: string;
      outcome: ChronicleDecreeOutcome;
      /** Dépouillement seulement (adopté ou rejeté). */
      votesFor?: number;
      votesAgainst?: number;
    }
  | { type: 'league'; cityId: string; leagueName: string; change: ChronicleLeagueChange }
  /** Programmation ou annulation d'une version de configuration, pour la clôture de l'instant `activateAt`. */
  | { type: 'configScheduled'; activateAt: number }
  | { type: 'configCancelled'; activateAt: number };

export interface ChronicleWorldEvent {
  model: ChronicleWorldEventModel;
  cityId: string;
  /** Autre extrémité de la route d'une tempête ; bien demandé par une caravane. */
  otherCityId: string | null;
  goodId: string | null;
}

export interface ChronicleInput {
  /** Identifiant court de la cité dont on écrit la chronique. */
  cityId: string;
  /** Événements de la période, dans leur ordre d'émission, toutes cités confondues. */
  events: readonly ChronicleInputEvent[];
  /** Événements du monde commencés pendant la période, toutes cités confondues. */
  worldEvents: readonly ChronicleWorldEvent[];
  /** Habitants de la cité avant et après la clôture qui finit la période ; `null` si elle n'en a rien dit. */
  population: { before: number; after: number } | null;
  /** Biens détaillés au plus, les plus échangés d'abord (`chronicle.maxGoods`). */
  maxGoods: number;
}

export interface ChronicleGoodFacts {
  goodId: string;
  /** Unités échangées. */
  volume: number;
  /** Somme des prix × quantités, en oboles. */
  turnover: number;
  /** Prix moyen pondéré, en oboles, arrondi à l'entier le plus proche (moitié vers le haut). */
  averagePrice: number;
  lowPrice: number;
  highPrice: number;
}

export interface ChronicleFacts {
  goods: ChronicleGoodFacts[];
  /** Biens échangés au-delà de ceux détaillés. */
  otherGoods: number;
  /** `change` est `after - before`, porté tel quel pour que le texte n'ait aucun nombre à calculer. */
  population: { before: number; after: number; change: number } | null;
  /** Navires arrivés dans la cité, par cité de départ. */
  arrivals: { fromCityId: string; ships: number }[];
  /** Cargaisons perdues en mer en venant vers la cité, par cité de départ, donc par route (#730). */
  losses: { fromCityId: string; cargoes: number }[];
  elections: { houseName: string; votes: number }[];
  decrees: {
    model: string;
    outcome: ChronicleDecreeOutcome;
    votesFor?: number;
    votesAgainst?: number;
  }[];
  worldEvents: ChronicleWorldEvent[];
  /** Ligues que la cité fonde, rejoint ou quitte (#737). */
  leagues: { leagueName: string; change: ChronicleLeagueChange }[];
  /** Une version de configuration programmée pendant la période, et pas annulée, entre en vigueur. */
  configChange: boolean;
}

const OUTCOMES: readonly ChronicleDecreeOutcome[] = ['adopted', 'rejected', 'applied', 'lapsed'];
const MODELS: readonly ChronicleWorldEventModel[] = ['drought', 'good_year', 'storm', 'caravan'];
const CHANGES: readonly ChronicleLeagueChange[] = [
  'founded',
  'joined',
  'left',
  'leftDissolved',
  'dissolved',
];
const nonNegative = (value: number) => Number.isSafeInteger(value) && value >= 0;
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Arrondi d'un quotient d'entiers à l'entier le plus proche, moitié vers le haut, sans flottant. */
export function roundedQuotient(numerator: number, denominator: number): number {
  if (!nonNegative(numerator) || !positive(denominator))
    throw new RangeError('roundedQuotient expects integers, a positive denominator');
  const quotient = Math.floor(numerator / denominator);
  return 2 * (numerator - quotient * denominator) >= denominator ? quotient + 1 : quotient;
}

/**
 * Faits du jour d'une cité. Déterministe : biens par volume puis montant décroissants, puis par identifiant ;
 * arrivées et pertes en mer par nombre décroissant, puis par cité ; élections par nom ; décrets par issue puis par modèle ;
 * événements du monde par modèle ; faits de ligue par nature puis par nom de ligue. Les échanges ne dépendent pas de leur ordre. Une somme hors des entiers sûrs
 * est refusée plutôt qu'arrondie.
 */
export function chronicleFacts(input: ChronicleInput): ChronicleFacts {
  const { cityId, maxGoods } = input;
  if (!nonNegative(maxGoods)) throw new RangeError('maxGoods must be a non-negative integer');
  const goods = new Map<string, ChronicleGoodFacts>();
  const arrivals = new Map<string, number>();
  const losses = new Map<string, number>();
  const elections: ChronicleFacts['elections'] = [];
  const decrees: ChronicleFacts['decrees'] = [];
  const leagues: ChronicleFacts['leagues'] = [];
  // État final de chaque clôture visée : la dernière programmation l'emporte, une annulation les annule toutes.
  const scheduled = new Map<number, boolean>();

  for (const event of input.events) {
    if (event.type === 'configScheduled' || event.type === 'configCancelled') {
      if (!Number.isSafeInteger(event.activateAt))
        throw new RangeError('activateAt must be an integer');
      scheduled.set(event.activateAt, event.type === 'configScheduled');
    } else if (event.cityId !== cityId) {
      continue;
    } else if (event.type === 'trade') {
      const { goodId, price, quantity } = event;
      if (!positive(price) || !positive(quantity))
        throw new RangeError('trade price and quantity must be positive integers');
      const before = goods.get(goodId);
      const volume = (before?.volume ?? 0) + quantity;
      const turnover = (before?.turnover ?? 0) + price * quantity;
      if (!Number.isSafeInteger(price * quantity) || !Number.isSafeInteger(turnover))
        throw new RangeError('chronicle trade totals exceed safe integers');
      const lowPrice = Math.min(before?.lowPrice ?? price, price);
      const highPrice = Math.max(before?.highPrice ?? price, price);
      goods.set(goodId, { goodId, volume, turnover, averagePrice: 0, lowPrice, highPrice });
    } else if (event.type === 'arrival') {
      arrivals.set(event.fromCityId, (arrivals.get(event.fromCityId) ?? 0) + 1);
    } else if (event.type === 'loss') {
      losses.set(event.fromCityId, (losses.get(event.fromCityId) ?? 0) + 1);
    } else if (event.type === 'election') {
      if (!nonNegative(event.votes)) throw new RangeError('votes must be a non-negative integer');
      elections.push({ houseName: event.houseName, votes: event.votes });
    } else if (event.type === 'league') {
      leagues.push({ leagueName: event.leagueName, change: event.change });
    } else {
      const { model, outcome, votesFor, votesAgainst } = event;
      const tallied = outcome === 'adopted' || outcome === 'rejected';
      if (votesFor === undefined && votesAgainst === undefined && !tallied)
        decrees.push({ model, outcome });
      else if (tallied && nonNegative(votesFor ?? -1) && nonNegative(votesAgainst ?? -1))
        decrees.push({ model, outcome, votesFor: votesFor ?? 0, votesAgainst: votesAgainst ?? 0 });
      else throw new RangeError('a tallied decree, and only it, has its votes');
    }
  }

  const ranked = [...goods.values()]
    .map((good) => ({ ...good, averagePrice: roundedQuotient(good.turnover, good.volume) }))
    .sort((a, b) => b.volume - a.volume || b.turnover - a.turnover || byText(a.goodId, b.goodId));
  const counted = input.population && [input.population.before, input.population.after];
  if (counted && !counted.every(nonNegative))
    throw new RangeError('population must be non-negative integers');
  const scope = (event: ChronicleWorldEvent) =>
    [event.cityId, event.otherCityId ?? '', event.goodId ?? ''].join('|');

  return {
    goods: ranked.slice(0, maxGoods),
    otherGoods: Math.max(0, ranked.length - maxGoods),
    population: input.population && {
      ...input.population,
      change: input.population.after - input.population.before,
    },
    arrivals: [...arrivals]
      .map(([fromCityId, ships]) => ({ fromCityId, ships }))
      .sort((a, b) => b.ships - a.ships || byText(a.fromCityId, b.fromCityId)),
    losses: [...losses]
      .map(([fromCityId, cargoes]) => ({ fromCityId, cargoes }))
      .sort((a, b) => b.cargoes - a.cargoes || byText(a.fromCityId, b.fromCityId)),
    elections: elections.sort((a, b) => byText(a.houseName, b.houseName) || b.votes - a.votes),
    decrees: decrees.sort(
      (a, b) =>
        OUTCOMES.indexOf(a.outcome) - OUTCOMES.indexOf(b.outcome) || byText(a.model, b.model),
    ),
    worldEvents: input.worldEvents
      .filter((event) => event.cityId === cityId || event.otherCityId === cityId)
      .map((event) => ({ ...event }))
      .sort(
        (a, b) => MODELS.indexOf(a.model) - MODELS.indexOf(b.model) || byText(scope(a), scope(b)),
      ),
    leagues: leagues.sort(
      (a, b) =>
        CHANGES.indexOf(a.change) - CHANGES.indexOf(b.change) || byText(a.leagueName, b.leagueName),
    ),
    configChange: [...scheduled.values()].some(Boolean),
  };
}

/** Nombres que portent les faits, en valeur absolue : les seuls qu'une chronique peut citer. */
export function chronicleNumbers(facts: ChronicleFacts): Set<number> {
  const numbers = new Set<number>();
  const walk = (value: unknown): void => {
    if (typeof value === 'number') numbers.add(Math.abs(value));
    else if (value !== null && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(facts);
  return numbers;
}
