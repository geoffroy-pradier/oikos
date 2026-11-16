import { sql, type Kysely } from 'kysely';

/**
 * Taux en vigueur d'une cité (docs/specs/05-economie.md, 5.3 et 5.6 ; #262) : le taux de la taxe de marché
 * de son agora et le coefficient de son droit de port, en points de base.
 */
export interface CityRates {
  marketTaxRateBps: number;
  portDuesCoefficientBps: number;
}

/**
 * Ce que le calcul lit de la configuration : le taux du monde, le coefficient de chaque cité et les bornes
 * des décrets de taux. `GameConfig` s'y conforme.
 */
export interface CityRateRules {
  marketTax: { rateBps: number };
  ships: { portDues: { cityCoefficientBps: Readonly<Record<string, number>> } };
  decrees?:
    | {
        models: {
          market_tax_rate?: { minRateBps: number; maxRateBps: number } | undefined;
          port_dues?: { minCoefficientBps: number; maxCoefficientBps: number } | undefined;
        };
      }
    | undefined;
}

/**
 * Taux en vigueur de chaque cité du monde sous la configuration lue par l'appelant : dernier décret appliqué,
 * borné par le monde, sinon la configuration. Seule source des taux pour les commandes et les étapes qui
 * taxent ; le calcul est celui de la base (`game.city_rates`), le même que lisent les joueurs. À lire après
 * le verrou de l'agora du monde : la clôture qui applique un décret le prend aussi, si bien qu'un échange ne
 * se règle jamais au taux d'avant un décret validé avant lui.
 */
export async function cityRates<T>(
  db: Kysely<T>,
  worldId: string,
  rules: CityRateRules,
): Promise<ReadonlyMap<string, CityRates>> {
  const models = rules.decrees?.models;
  const section = {
    marketTax: { rateBps: rules.marketTax.rateBps },
    ships: { portDues: { cityCoefficientBps: rules.ships.portDues.cityCoefficientBps } },
    decrees: models
      ? { models: { market_tax_rate: models.market_tax_rate, port_dues: models.port_dues } }
      : null,
  };
  const { rows } = await sql<{
    city_id: string;
    market_tax_rate_bps: number;
    port_dues_coefficient_bps: number;
  }>`select city_id, market_tax_rate_bps, port_dues_coefficient_bps
     from game.city_rates(${worldId}, ${JSON.stringify(section)}::jsonb)`.execute(db);
  return new Map(
    rows.map((row) => [
      row.city_id,
      {
        marketTaxRateBps: row.market_tax_rate_bps,
        portDuesCoefficientBps: row.port_dues_coefficient_bps,
      },
    ]),
  );
}

/** Taux en vigueur d'une cité du monde ; une cité absente du monde est une erreur, pas un taux nul. */
export async function cityRatesOf<T>(
  db: Kysely<T>,
  worldId: string,
  cityId: string,
  rules: CityRateRules,
): Promise<CityRates> {
  const rates = (await cityRates(db, worldId, rules)).get(cityId);
  if (!rates) throw new Error(`City ${cityId} is not in world ${worldId}`);
  return rates;
}
