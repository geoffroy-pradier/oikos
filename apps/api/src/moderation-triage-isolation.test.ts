import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Le pré-tri de l'IA (#763) n'est qu'une indication qui ordonne la file : aucune commande de sanction ne lit la
// catégorie (règle 6, 8.1, 15.1). La base le tient aussi (test pgTAP 763 : seule `admin.moderation_queue` lit
// `game.report_triage`) ; ici, le code de l'API : ni table, ni catégorie, ni usage du pré-tri hors de la lecture de la file.
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
        ? [join(dir, entry.name)]
        : [],
  );

describe('le pré-tri ne décide d’aucune sanction (#763)', () => {
  const files = sources(join(__dirname));
  it('aucune source de l’API, commandes comprises, ne lit le pré-tri : ni sa table, ni ses catégories', () => {
    expect(files.length).toBeGreaterThan(20);
    const readers = files.filter((file) =>
      /report_triage|moderation_triage|TRIAGE_CATEGORIES|TriageCategory|likely_violation|likely_unfounded/.test(
        readFileSync(file, 'utf8'),
      ),
    );
    expect(readers).toEqual([]);
  });

  it('les commandes de sanction ne lisent que la file des signalements et les comptes, jamais une catégorie', () => {
    const commands = readFileSync(join(__dirname, 'commands', 'admin-moderation.ts'), 'utf8');
    expect(commands).not.toMatch(/triage|category/i);
  });
});
