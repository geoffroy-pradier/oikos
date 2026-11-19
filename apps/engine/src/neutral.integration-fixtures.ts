import { DEFAULT_LABOR, type GameConfig } from '@oikos/config';

/**
 * La configuration donnée, à paramètres économiques neutres, ceux de la configuration initiale d'avant le calibrage
 * de #668 : aucun salaire, offre de travail sans limite, hébergement nul, ni entretien ni vétusté des biens, ni
 * entretien des navires, provisions ou droit de port. Les essais de l'entretien, des salaires et de l'hébergement
 * règlent eux-mêmes le tarif qu'ils éprouvent : ils partent de cette base, qui ne bouge pas quand le calibrage change
 * la configuration initiale. Aucune valeur n'est posée ici, sinon zéro.
 */
export function neutralEconomy(config: GameConfig): GameConfig {
  const zero = (byId: Readonly<Record<string, number>>) =>
    Object.fromEntries(Object.keys(byId).map((id) => [id, 0]));
  return {
    ...config,
    staff: { dailyWageOboles: zero(config.staff.dailyWageOboles) },
    ...(config.stewards && { stewards: { ...config.stewards, dailyWageOboles: 0 } }),
    labor: DEFAULT_LABOR,
    properties: {
      ...config.properties,
      sizes: config.properties.sizes.map((size) => ({
        ...size,
        dailyUpkeepOboles: 0,
        dailyWear: 0,
      })),
    },
    ships: {
      ...config.ships,
      classes: config.ships.classes.map((shipClass) => ({ ...shipClass, dailyUpkeepOboles: 0 })),
      routes: config.ships.routes.map((route) => ({
        ...route,
        provisionsOboles: zero(route.provisionsOboles),
      })),
      portDues: {
        ...config.ships.portDues,
        byClassOboles: zero(config.ships.portDues.byClassOboles),
      },
    },
  };
}
