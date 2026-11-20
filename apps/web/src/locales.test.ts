import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Chaque texte de `fr.json`, lu sur le fichier même : en test, l'import en garde des espaces ordinaires. */
function texts(node: unknown, path = ''): [string, string][] {
  if (typeof node === 'string') return [[path, node]];
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) =>
    texts(value, path ? `${path}.${key}` : key),
  );
}

const fr = texts(
  JSON.parse(readFileSync(new URL('./locales/fr.json', import.meta.url), 'utf8')) as unknown,
);

describe('typographie française (#869)', () => {
  it('une espace insécable précède « : », « ; », « ! » et « ? », jamais une espace ordinaire', () => {
    const ordinary = fr
      .filter(([, text]) => /[ \t\n\u2009][:;!?]/.test(text))
      .map(([path]) => path);
    expect(ordinary).toEqual([]);
  });

  it('aucun de ces signes n’est collé au mot qui le précède', () => {
    // Un « : » suivi d'un chiffre est une heure ou un ratio, pas une ponctuation.
    const glued = fr
      .filter(([, text]) => /[^\s\u00a0\u202f][;!?](?=\s|$)|[^\s\u00a0\u202f]:(?=\s|$)/.test(text))
      .map(([path]) => path);
    expect(glued).toEqual([]);
  });

  it('le fichier lu porte bien des espaces insécables (le test ne lit pas l’import de test)', () => {
    expect(fr.some(([, text]) => /\u00a0:/.test(text))).toBe(true);
  });
});
