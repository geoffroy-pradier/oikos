import { randomUUID } from 'node:crypto';
import { INITIAL_CONFIG, validateConfig, type LoadedConfig } from '@oikos/config';
import type { Db } from '@oikos/db';
import { nextDailyClose, type ClockSettings } from '@oikos/sim';
import { sql } from 'kysely';
import type { TokenVerifier } from './auth';
import type { ConfigSource } from './registry';

const validation = validateConfig(INITIAL_CONFIG);
if (!validation.ok) throw new Error(validation.errors.join('\n'));

/**
 * Configuration fixe pour les tests : indépendante des versions publiées dans la base partagée. C'est la
 * configuration initiale, à l'offre de travail près (#668) : les tests fondent leurs maisons dans des cités qu'ils
 * créent, inconnues de la configuration, donc sans population ni travailleur ; sans classe travailleuse, l'offre y
 * est sans limite (4.4). Les tests du marché du travail donnent la leur.
 */
export const TEST_CONFIG: LoadedConfig = {
  id: '00000000-0000-7000-8000-00000000c0f1',
  number: 1,
  config: { ...validation.config, labor: { ...validation.config.labor, workingShareBps: {} } },
};
export const testConfig: ConfigSource = async () => TEST_CONFIG;

/** Marge demandée entre l'instant du test et la clôture de l'horloge de test. */
export const FAR_CLOSE_MARGIN_MS = 3_600_000;

/**
 * Horloge de test dont la prochaine clôture est à plus d'une heure de `now`, quelle que soit l'heure :
 * dans la dernière minute avant l'échéance, la base refuse les annulations, et un test de programmation
 * ou d'annulation dépendrait de l'heure où il tourne. Minuit et midi locaux ne sont jamais tous deux à
 * moins d'une heure.
 *
 * Cette clôture n'est pas celle de `TEST_CONFIG` (04 h 00) et tombe tantôt avant elle, tantôt après :
 * de 23 h 00 à 04 h 00 (heure de Paris), une programmation faite avec l'horloge de `TEST_CONFIG` échoit
 * avant la clôture de test. Un fichier qui prend cette horloge la donne donc à toutes ses applications ;
 * et comme d'autres fichiers programment à 04 h 00 dans la même base, aucun test ne suppose qu'entre
 * maintenant et sa clôture rien d'autre n'entre en vigueur.
 */
export function farCloseClock(
  now: Date,
  base: ClockSettings = TEST_CONFIG.config.clock,
): ClockSettings {
  const far = [0, 12]
    .map((dailyCloseHour) => ({ ...base, dailyCloseHour }))
    .find((clock) => nextDailyClose(now, clock).getTime() - now.getTime() > FAR_CLOSE_MARGIN_MS);
  if (!far) throw new Error(`No test close further than an hour from ${now.toISOString()}`);
  return far;
}

/** Source de configuration de test réglée sur l'horloge donnée. */
export const testConfigWithClock =
  (clock: ClockSettings): ConfigSource =>
  async () => ({ ...TEST_CONFIG, config: { ...TEST_CONFIG.config, clock } });

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

/**
 * Compte de Supabase Auth sans maison, posé par le propriétaire (`owner`) : le jeton d'un compte absent de
 * `auth.users` est refusé avant toute commande (#565), si bien qu'un « compte sans maison » doit exister.
 */
export async function newAccount(owner: Db): Promise<string> {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id}@example.test`})`.execute(
    owner,
  );
  return id;
}
