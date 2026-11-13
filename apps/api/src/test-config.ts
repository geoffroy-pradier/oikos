import { INITIAL_CONFIG, validateConfig, type LoadedConfig } from '@oikos/config';
import type { TokenVerifier } from './auth';
import type { ConfigSource } from './registry';

const validation = validateConfig(INITIAL_CONFIG);
if (!validation.ok) throw new Error(validation.errors.join('\n'));

/** Configuration fixe pour les tests : indépendante des versions publiées dans la base partagée. */
export const TEST_CONFIG: LoadedConfig = {
  id: '00000000-0000-7000-8000-00000000c0f1',
  number: 1,
  config: validation.config,
};
export const testConfig: ConfigSource = async () => TEST_CONFIG;

/**
 * Jetons de test : un identifiant de compte (36 caractères) ouvre une session simple ; préfixé de
 * `aal2:`, une session à double authentification.
 */
export const testVerifier: TokenVerifier = async (token) => {
  const [aal, userId] = token.startsWith('aal2:')
    ? (['aal2', token.slice(5)] as const)
    : (['aal1', token] as const);
  return userId.length === 36 ? { userId, aal } : null;
};
