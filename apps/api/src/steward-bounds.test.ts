import { INITIAL_CONFIG, validateConfig } from '@oikos/config';
import { MAX_STEWARD_RULES } from '@oikos/contracts';
import { describe, expect, it } from 'vitest';

// Le nombre de règles par intendant se règle dans `packages/config`, dans la borne du contrat de la grammaire
// (`packages/contracts`), qui ne dépendent pas l'un de l'autre : une version admise doit rester saisissable (#278).
describe('règles par intendant : configuration et contrat concordent', () => {
  const admits = (rulesPerSteward: number) => {
    const config = structuredClone(INITIAL_CONFIG) as { stewards: Record<string, unknown> };
    config.stewards = { ...config.stewards, rulesPerSteward };
    return validateConfig(config).ok;
  };

  it('la configuration admet le plafond du contrat, et pas au-delà', () => {
    expect(admits(MAX_STEWARD_RULES)).toBe(true);
    expect(admits(MAX_STEWARD_RULES + 1)).toBe(false);
  });
});
