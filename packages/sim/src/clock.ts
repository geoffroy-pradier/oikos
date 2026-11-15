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

/**
 * Vrai pour le tick dont l'intervalle contient l'instant d'une clôture quotidienne (`dailyCloseAt`) : le
 * même calcul que la clôture elle-même, que l'heure de clôture soit sautée par l'heure d'été ou que le
 * fuseau soit décalé d'une demi-heure.
 */
export function isDailyClose(index: number, clock: ClockSettings): boolean {
  // Le jour de jeu change exactement à l'instant de sa clôture : le tick en contient une si le jour de
  // son dernier instant n'est pas celui de l'instant qui le précède (un tick dure moins d'un jour).
  const start = tickStart(index, clock.tickMinutes).getTime();
  const end = tickStart(index + 1, clock.tickMinutes).getTime();
  return gameDayAt(new Date(end - 1), clock) !== gameDayAt(new Date(start - 1), clock);
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

/**
 * Date civile d'un jour de jeu, rendue à minuit UTC et à afficher en UTC : celle du jour local dont la
 * clôture l'ouvre (il court jusqu'à la clôture du lendemain). Inverse de `gameDayAt` qui se passe
 * d'horloge : le rang d'un jour de jeu est celui de ce jour civil.
 */
export function gameDayDate(gameDay: number): Date {
  return new Date(gameDay * DAY_MS);
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
 * Instant de la première clôture quotidienne strictement après l'instant donné : c'est l'échéance d'un
 * changement programmé « à la prochaine clôture ». Même calcul que la clôture (`dailyCloseAt`), sans
 * dépendre de la durée du tick.
 */
export function nextDailyClose(after: Date, clock: DayClock): Date {
  return dailyCloseAt(gameDayAt(after, clock) + 1, clock);
}
