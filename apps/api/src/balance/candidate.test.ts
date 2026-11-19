import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { INITIAL_CONFIG } from '@oikos/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CandidateError, parseCandidate } from './candidate';
import { SETTLEMENTS, SLUGS } from './world';

const scenario = {
  slugs: SLUGS,
  recipes: [
    ...new Set(Object.values(SETTLEMENTS).flatMap((roles) => roles.flatMap((r) => r.sites))),
  ],
};
const initial = INITIAL_CONFIG as Record<string, unknown> & {
  goods: Record<string, unknown>[];
  clock: Record<string, unknown>;
  cities: { id: string }[];
  recipes: { id: string }[];
};
const mutate = (change: (copy: typeof initial) => void) => {
  const copy = structuredClone(initial);
  change(copy);
  return JSON.stringify(copy);
};
const refusal = (text: string) => {
  try {
    parseCandidate(text, scenario);
  } catch (error) {
    if (error instanceof CandidateError) return error.errors;
    throw error;
  }
  return null;
};

describe('parseCandidate', () => {
  it('accepte la configuration initiale', () => {
    expect(refusal(JSON.stringify(initial))).toBeNull();
  });
  it('refuse un texte qui n’est pas du JSON', () => {
    expect(refusal('{')).toEqual(['(root): not valid JSON']);
  });
  it('refuse une valeur hors schéma en désignant le champ', () => {
    const errors = refusal(
      mutate((copy) => (copy.goods[2] = { ...copy.goods[2], elasticity: -3 })),
    );
    expect(errors?.some((line) => line.startsWith('goods[2].elasticity:'))).toBe(true);
  });
  it('refuse une horloge dont le tick ne divise pas l’heure, champ nommé', () => {
    const errors = refusal(mutate((copy) => (copy.clock['tickMinutes'] = 45)));
    expect(errors?.join('\n')).toMatch(/clock\.tickMinutes/);
  });
  it('refuse une candidate sans une cité ou une recette que le banc joue', () => {
    const errors = refusal(
      mutate((copy) => {
        copy.cities = copy.cities.filter((city) => city.id !== 'halos');
        copy.recipes = copy.recipes.filter((recipe) => recipe.id !== 'grow_wheat');
      }),
    );
    expect(errors?.join('\n')).toContain('"halos"');
    expect(errors?.join('\n')).toContain('"grow_wheat"');
  });
});

describe('commande simulate', () => {
  let dir = '';
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'oikos-simulate-test-'));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('refuse une candidate invalide avant toute simulation (aucune base jointe), champ désigné', async () => {
    const file = join(dir, 'bad.json');
    await writeFile(
      file,
      mutate((copy) => (copy.goods[2] = { ...copy.goods[2], elasticity: -3 })),
    );
    const script = new URL('../simulate.ts', import.meta.url).pathname;
    const run = promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', script, '--candidate', file],
      // Une base injoignable : toute tentative de simulation échouerait autrement que par le refus.
      { env: { ...process.env, DATABASE_URL: 'postgresql://x:x@127.0.0.1:1/none' } },
    );
    const failure = await run.then(
      () => null,
      (error: { code: number; stderr: string }) => error,
    );
    expect(failure?.code).toBe(1);
    expect(failure?.stderr).toContain('goods[2].elasticity');
  }, 60_000);
});
