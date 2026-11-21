import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { INITIAL_CONFIG } from '@oikos/config';
import {
  CandidateError,
  parseCandidate,
  readCandidate,
  unsimulatedFields,
} from './balance/candidate';
import { playPair } from './balance/pair';
import { compare, toMarkdown, type Indicators } from './balance/report';
import { MEASURED, SETTLEMENTS, SLUGS, WORLD_SEED } from './balance/world';

/*
 * Simulateur d'équilibrage (#284, docs/specs/15-back-office-olympe.md 15.1 et 15.2), commande locale :
 * `pnpm --filter @oikos/api simulate --candidate config.json [--days 30] [--seed graine] [--json rapport.json] [--markdown rapport.md]`.
 * Joue la configuration de référence (la configuration initiale) et la candidate, en parallèle, sur deux mondes neufs de la
 * base `DATABASE_URL` (comme le banc de `ci`) ou, pour la candidate, de `SIMULATE_CANDIDATE_DATABASE_URL`, puis écrit le rapport : tableaux Markdown sur la sortie, JSON
 * dans le fichier de `--json` et le Markdown dans celui de `--markdown` (`pnpm` ajoute ses propres lignes à la sortie). Une candidate que le schéma refuse l'est avant toute simulation.
 */
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
/**
 * Base de la candidate : les deux parties se jouent en parallèle (ADR 0012), chacune dans son monde ; sur deux bases
 * (`SIMULATE_CANDIDATE_DATABASE_URL`) elles ne se partagent ni connexions ni écritures, ce qui les accélère. Sans elle,
 * la candidate joue sur la base de la référence, dans son propre monde.
 */
const CANDIDATE_DATABASE_URL = process.env['SIMULATE_CANDIDATE_DATABASE_URL'] ?? DATABASE_URL;

const USAGE = `Usage: simulate (--candidate <file.json> | --version <number>) [--days ${MEASURED}] [--seed <seed>] [--json <report.json>] [--markdown <report.md>]`;

/** Joue une partie dans un processus à part, avec la configuration du fichier (la configuration initiale sans). */
function play(
  label: string,
  databaseUrl: string,
  configFile: string | null,
  output: string,
  days: number,
  seed: string,
) {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl };
  if (configFile) env['BALANCE_CONFIG_FILE'] = configFile;
  else delete env['BALANCE_CONFIG_FILE'];
  const script = new URL('./balance/play.ts', import.meta.url).pathname;
  return new Promise<Indicators>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', script, output, String(days), seed], {
      env,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('exit', async (code) => {
      if (code !== 0)
        return reject(
          new Error(`Simulation of the ${label} failed (exit ${code}), see the log above`),
        );
      try {
        resolve(JSON.parse(await readFile(output, 'utf8')) as Indicators);
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      candidate: { type: 'string' },
      version: { type: 'string' },
      days: { type: 'string', default: String(MEASURED) },
      seed: { type: 'string', default: WORLD_SEED },
      json: { type: 'string' },
      markdown: { type: 'string' },
    },
  });
  const days = Number(values.days);
  if (!Number.isInteger(days) || days < 2) throw new CandidateError(['--days: integer, 2 or more']);
  // La base tient la graine d'un monde entre 16 et 128 caractères (`worlds_seed_length`).
  if (!values.seed || values.seed.length < 16 || values.seed.length > 128)
    throw new CandidateError(['--seed: 16 to 128 characters']);
  if (Boolean(values.candidate) === Boolean(values.version)) {
    console.error(USAGE);
    process.exit(2);
  }
  const source = values.candidate
    ? { file: values.candidate }
    : { version: Number(values.version), databaseUrl: DATABASE_URL };
  if ('version' in source && !Number.isInteger(source.version))
    throw new CandidateError(['--version: integer']);
  // Refus avant toute simulation : schéma, puis scénario du banc.
  const text = await readCandidate(source);
  const parsed = parseCandidate(text, {
    slugs: SLUGS,
    recipes: [
      ...new Set(Object.values(SETTLEMENTS).flatMap((roles) => roles.flatMap((r) => r.sites))),
    ],
  });
  // Champs que le scénario du banc remplace : dits avant de jouer, et portés par le rapport.
  const unsimulated = unsimulatedFields(parsed, INITIAL_CONFIG);
  if (unsimulated.length > 0)
    console.error(
      `Not simulated (the bench scenario overrides these candidate fields):\n${unsimulated.map((path) => `  ${path}`).join('\n')}`,
    );
  const dir = await mkdtemp(join(tmpdir(), 'oikos-simulate-'));
  try {
    const candidateFile = join(dir, 'candidate.json');
    await writeFile(candidateFile, text);
    const seed = values.seed ?? WORLD_SEED;
    const { reference, candidate } = await playPair({
      reference: () =>
        play('reference', DATABASE_URL, null, join(dir, 'reference-out.json'), days, seed),
      candidate: () =>
        play(
          'candidate',
          CANDIDATE_DATABASE_URL,
          candidateFile,
          join(dir, 'candidate-out.json'),
          days,
          seed,
        ),
    });
    const report = compare(reference, candidate, { seed, days, unsimulated });
    if (values.json) await writeFile(values.json, JSON.stringify(report, null, 1));
    const markdown = toMarkdown(report);
    if (values.markdown) await writeFile(values.markdown, markdown);
    console.log(markdown);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  if (error instanceof CandidateError) {
    console.error(
      `Refused before any simulation:\n${error.errors.map((line) => `  ${line}`).join('\n')}`,
    );
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});
