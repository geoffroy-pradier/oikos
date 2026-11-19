import { describe, expect, it } from 'vitest';
import { CandidateError, parseCandidate, readCandidate } from './candidate';
import { SETTLEMENTS, SLUGS } from './world';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

describe('readCandidate : version enregistrée', () => {
  it('lit la première version de la base, que le schéma et le scénario acceptent', async () => {
    const text = await readCandidate({ version: 1, databaseUrl });
    const recipes = Object.values(SETTLEMENTS).flatMap((roles) => roles.flatMap((r) => r.sites));
    expect(() => parseCandidate(text, { slugs: SLUGS, recipes })).not.toThrow();
  });
  it('refuse un numéro inconnu, désigné', async () => {
    await expect(readCandidate({ version: 999_999, databaseUrl })).rejects.toThrow(CandidateError);
    await expect(readCandidate({ version: 999_999, databaseUrl })).rejects.toThrow(/#999999/);
  });
});
