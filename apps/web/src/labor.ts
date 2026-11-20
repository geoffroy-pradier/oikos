import { dailyWages } from '@oikos/sim';
import { z } from 'zod';

const id = z.string().min(1);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** Marché du travail du dernier jour fixé d'une cité (vue publique `labor_market`, 4.4). */
export interface CityLabor {
  gameDay: number;
  /** Offre de travail ; `null` : sans limite (colonne `supply` nulle). 0 reste une vraie offre de 0. */
  supply: number | null;
  employed: number;
  unhoused: number;
  wageOboles: number;
  lodgingOboles: number;
}

const laborRow = z.object({
  city_id: id,
  game_day: z.number().int(),
  supply: count.nullable(),
  employed: count,
  unhoused: count,
  wage_oboles: count,
  lodging_oboles: count,
});

/**
 * Marché du travail de chaque cité, par identifiant de cité. `null` si une ligne est illisible : l'écran
 * annonce un échec de lecture plutôt qu'un chiffre faux.
 */
export function parseCityLabor(rows: unknown): Map<string, CityLabor> | null {
  const parsed = z.array(laborRow).safeParse(rows);
  if (!parsed.success) return null;
  return new Map(
    parsed.data.map((row) => [
      row.city_id,
      {
        gameDay: row.game_day,
        supply: row.supply,
        employed: row.employed,
        unhoused: row.unhoused,
        wageOboles: row.wage_oboles,
        lodgingOboles: row.lodging_oboles,
      },
    ]),
  );
}

/**
 * Taux d'emploi en fraction (0 à 1, au-delà si la population est tombée sous l'emploi), pour
 * `Intl.NumberFormat` en pourcentage. `null` : offre sans limite ou offre nulle (pas de division par zéro), aucun taux à montrer.
 */
export const employmentShare = (labor: CityLabor) =>
  labor.supply === null || labor.supply === 0 ? null : labor.employed / labor.supply;

/** Personnel de la maison dans une cité : travailleurs de ses sites, logés ou non, et ce que coûte l'hébergement. */
export interface CityStaff {
  cityId: string;
  workers: number;
  housed: number;
  unhoused: number;
  /** Hébergement d'un jour chez les PNJ, au prix du jour de la cité ; `null` : prix inconnu. */
  lodgingOboles: number | null;
}

const staffRow = z.object({
  city_id: id,
  workers: count,
  housed: count,
  unhoused: count,
});

/**
 * Personnel de la maison par cité (vue `my_workforce`, une ligne par site), avec le coût de l'hébergement
 * au prix du jour de chaque cité (`labor`). `null` si une ligne est illisible ou si un total sort des
 * entiers sûrs. Les cités vont dans l'ordre de leur nom (`nameOf`).
 */
export function staffByCity(
  rows: unknown,
  labor: ReadonlyMap<string, CityLabor> | null,
  nameOf: (cityId: string) => string,
): CityStaff[] | null {
  const parsed = z.array(staffRow).safeParse(rows);
  if (!parsed.success) return null;
  const cities = new Map<string, CityStaff>();
  try {
    for (const row of parsed.data) {
      const city = cities.get(row.city_id) ?? {
        cityId: row.city_id,
        workers: 0,
        housed: 0,
        unhoused: 0,
        lodgingOboles: null,
      };
      city.workers += row.workers;
      city.housed += row.housed;
      city.unhoused += row.unhoused;
      cities.set(row.city_id, city);
    }
    for (const city of cities.values()) {
      if (![city.workers, city.housed, city.unhoused].every(Number.isSafeInteger)) return null;
      const price = labor?.get(city.cityId)?.lodgingOboles;
      city.lodgingOboles = price === undefined ? null : dailyWages(city.unhoused, price);
    }
  } catch {
    return null;
  }
  return [...cities.values()].sort((a, b) => nameOf(a.cityId).localeCompare(nameOf(b.cityId)));
}
