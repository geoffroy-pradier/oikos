import { readFile } from 'node:fs/promises';
import { validateConfig, type GameConfig } from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';

/*
 * Configuration candidate du simulateur (#284) : lue dans un fichier JSON ou dans une version enregistrée de
 * la base, puis refusée avant toute simulation si le schéma ou le scénario du banc ne la tient pas.
 */

/** Refus d'une configuration candidate : une ligne par champ fautif (`chemin: raison`). */
export class CandidateError extends Error {
  constructor(readonly errors: readonly string[]) {
    super(errors.join('\n'));
  }
}

/**
 * Le banc joue des ticks d'une heure (`hourlyConfig`) : une horloge dont le tick ne divise pas l'heure en est
 * refusée, et le banc joue les cités et les recettes de son scénario (`world.ts`), qu'une candidate doit connaître.
 */
export function scenarioErrors(
  config: Readonly<GameConfig>,
  scenario: { slugs: readonly string[]; recipes: readonly string[] },
) {
  const errors: string[] = [];
  const { tickMinutes } = config.clock;
  if (60 % tickMinutes !== 0)
    errors.push(
      `clock.tickMinutes: ${tickMinutes} does not divide an hour (the bench plays hourly ticks)`,
    );
  for (const slug of scenario.slugs)
    if (!config.cities.some((city) => city.id === slug))
      errors.push(`cities: the bench plays the city "${slug}", missing from the candidate`);
  for (const recipe of scenario.recipes)
    if (!config.recipes.some((candidate) => candidate.id === recipe))
      errors.push(`recipes: the bench plays the recipe "${recipe}", missing from the candidate`);
  return errors;
}

/** Valide un texte JSON : toute erreur nomme le champ fautif. Rend le contenu tel qu'il a été lu. */
export function parseCandidate(
  text: string,
  scenario: Parameters<typeof scenarioErrors>[1],
): GameConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new CandidateError(['(root): not valid JSON']);
  }
  const validation = validateConfig(raw);
  if (!validation.ok) throw new CandidateError(validation.errors);
  const errors = scenarioErrors(validation.config, scenario);
  if (errors.length > 0) throw new CandidateError(errors);
  return raw as GameConfig;
}

/** Contenu JSON d'une candidate : un fichier, ou une version enregistrée (`config.versions`, par numéro). */
export async function readCandidate(
  source: { file: string } | { version: number; databaseUrl: string },
): Promise<string> {
  if ('file' in source) return readFile(source.file, 'utf8');
  const db = createDb(serviceRoleUrl(source.databaseUrl));
  try {
    const row = (
      await sql<{
        payload: unknown;
      }>`select payload from config.versions where number = ${source.version}`.execute(db)
    ).rows[0];
    if (!row) throw new CandidateError([`version: no registered configuration #${source.version}`]);
    return JSON.stringify(row.payload);
  } finally {
    await db.destroy();
  }
}
