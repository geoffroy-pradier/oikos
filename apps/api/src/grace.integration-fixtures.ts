import type { Grace, GraceEffect } from '@oikos/config';
import { appWithConfig } from './voyage.integration-fixtures';

// Grâces des tests d'intégration (#266), la configuration initiale n'en offrant aucune avant le calibrage (#283) :
// chacune demande 300 de Charis, en dépense 150 et se recharge en trois jours.
const grace = (id: string, godId: string, effect: GraceEffect, magnitudeBps: number): Grace => ({
  ...{ id, godId, effect, magnitudeBps },
  ...{ charisRequired: 300, charisSpent: 150, cooldownDays: 3 },
});
export const TEST_GRACES = [
  grace('demeter_harvest', 'demeter', 'blessed_harvest', 2_000),
  grace('athena_inspiration', 'athena', 'inspired_workshop', 2_000),
  grace('poseidon_wind', 'poseidon', 'fair_wind', 2_500),
];
/** L'API servie par la configuration de test et ces grâces, modifiées par `change`. */
export const graceApp = (change = (row: Grace) => row) =>
  appWithConfig((config) => ({ ...config, graces: TEST_GRACES.map(change) }));
export const blessed = graceApp();
