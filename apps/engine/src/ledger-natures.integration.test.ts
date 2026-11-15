import { createDb } from '@oikos/db';
import { LEDGER_LINE_NATURES } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';

// La liste des natures d'une ligne du grand livre existe deux fois : dans le code qui écrit les lignes
// (`LEDGER_LINE_NATURES`, packages/sim) et dans la contrainte qui les admet (`ledger_lines_nature_known`).
// Ce test les lit toutes deux, contre Supabase local, pour qu'elles ne divergent pas.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const owner = createDb(DATABASE_URL);
afterAll(() => owner.destroy());

describe('natures d’une ligne du grand livre', () => {
  it('le code et la contrainte de la base admettent la même liste', async () => {
    const { rows } = await sql<{ natures: string[] | null }>`select array(
        select m[1] from regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
        order by 1) as natures
      from pg_constraint c
      where c.conrelid = 'game.ledger_lines'::regclass and c.conname = 'ledger_lines_nature_known'`.execute(
      owner,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.natures).toEqual([...LEDGER_LINE_NATURES].sort());
  });
});
