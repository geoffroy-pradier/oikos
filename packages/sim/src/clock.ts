/**
 * Horloges du monde (docs/specs/03-boucles-progression.md) : ticks, clôture quotidienne, bascule de saison.
 * Fonctions pures : tout se déduit de l'indice du tick et des paramètres d'horloge de la configuration.
 */
export interface ClockSettings {
  tickMinutes: number;
  dailyCloseHour: number;
  /** Fuseau IANA de la clôture, par exemple `Europe/Paris`. */
  timezone: string;
  seasonDays: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Rang (en jours depuis 1970-01-01) d'un lundi de référence : le 5 janvier 1970. */
const REFERENCE_MONDAY = 4;

/** Indice du tick contenant l'instant donné. Les ticks sont alignés sur l'époque Unix. */
export function tickIndexAt(instant: Date, tickMinutes: number): number {
  return Math.floor(instant.getTime() / (tickMinutes * MINUTE_MS));
}

/** Instant de début du tick d'indice donné. */
export function tickStart(index: number, tickMinutes: number): Date {
  return new Date(index * tickMinutes * MINUTE_MS);
}

/** Un formateur par fuseau : sa construction est coûteuse et le moteur l'appelle à chaque tick. */
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

/** Date et heure locales d'un instant dans un fuseau, heure d'été comprise. */
export function localTime(instant: Date, timezone: string) {
  const parts = formatterFor(timezone).formatToParts(instant);
  const part = (type: string) => Number(parts.find((candidate) => candidate.type === type)?.value);
  const [year, month, day] = [part('year'), part('month'), part('day')];
  return {
    year,
    month,
    day,
    hour: part('hour'),
    minute: part('minute'),
    /** Rang du jour civil local, en jours depuis 1970-01-01. */
    dayNumber: Math.floor(Date.UTC(year, month - 1, day) / DAY_MS),
  };
}

/** Vrai pour le tick qui ouvre l'heure de clôture locale : c'est lui qui porte la clôture quotidienne. */
export function isDailyClose(index: number, clock: ClockSettings): boolean {
  const { hour, minute } = localTime(tickStart(index, clock.tickMinutes), clock.timezone);
  return hour === clock.dailyCloseHour && minute < clock.tickMinutes;
}

/** Ce dont dépend le jour de jeu : ni la durée du tick ni celle de la saison. */
export type DayClock = Pick<ClockSettings, 'dailyCloseHour' | 'timezone'>;

/**
 * Jour de jeu d'un instant : rang (en jours depuis 1970-01-01) du jour civil local dont la clôture l'a
 * ouvert. La journée de jeu commence à la clôture : avant elle, on est encore dans la précédente.
 */
export function gameDayAt(instant: Date, clock: DayClock): number {
  const { dayNumber, hour } = localTime(instant, clock.timezone);
  return hour < clock.dailyCloseHour ? dayNumber - 1 : dayNumber;
}

/**
 * Instant de la clôture qui ouvre un jour de jeu : le premier instant de ce jour. Il ne dépend pas de
 * la durée du tick. Si l'heure de clôture est sautée par le passage à l'heure d'été, la clôture a lieu
 * au premier instant qui la suit ; si elle se répète au retour à l'heure d'hiver, à sa première occurrence.
 */
export function dailyCloseAt(gameDay: number, clock: DayClock): Date {
  if (!Number.isSafeInteger(gameDay)) throw new RangeError(`Invalid game day ${gameDay}`);
  // L'heure locale lue comme une heure universelle, moins le plus grand décalage qui existe (UTC+14) :
  // un instant sûrement antérieur à la clôture. De là, on avance par quarts d'heure, le pas de tous
  // les fuseaux, jusqu'au premier instant du jour de jeu.
  let time = gameDay * DAY_MS + (clock.dailyCloseHour - 14) * HOUR_MS;
  while (gameDayAt(new Date(time), clock) < gameDay) time += 15 * MINUTE_MS;
  return new Date(time);
}

/** Indice de la saison du jour local du tick. Une saison commence un lundi (pour `seasonDays` = 7). */
export function seasonIndexAt(index: number, clock: ClockSettings): number {
  const gameDay = gameDayAt(tickStart(index, clock.tickMinutes), clock);
  return Math.floor((gameDay - REFERENCE_MONDAY) / clock.seasonDays);
}

/** Vrai pour la clôture quotidienne qui ouvre une nouvelle saison. */
export function isSeasonSwitch(index: number, clock: ClockSettings): boolean {
  return (
    isDailyClose(index, clock) && seasonIndexAt(index, clock) !== seasonIndexAt(index - 1, clock)
  );
}

/**
 * Début du premier tick de clôture quotidienne strictement après l'instant donné. C'est l'échéance d'un
 * changement programmé « à la prochaine clôture ».
 */
export function nextDailyClose(after: Date, clock: ClockSettings): Date {
  const first = tickIndexAt(after, clock.tickMinutes) + 1;
  // Trois jours de ticks : couvre une heure de clôture sautée par un passage à l'heure d'été.
  const horizon = first + Math.ceil((3 * DAY_MS) / (clock.tickMinutes * MINUTE_MS));
  for (let index = first; index <= horizon; index++) {
    if (isDailyClose(index, clock)) return tickStart(index, clock.tickMinutes);
  }
  throw new Error('No daily close within three days');
}
