import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('niveau des biens publié au client (#873)', () => {
  it('aucun écran du jeu ne rend `GoodIcon` sans passer par `GoodPicture`, qui lui donne le niveau du bien', () => {
    const sources = readdirSync(new URL('.', import.meta.url), {
      recursive: true,
      encoding: 'utf8',
    })
      .filter(
        (path) =>
          path.endsWith('.tsx') &&
          !/\.test\.tsx$|catalogue|good-tiers|GoodTiersProvider/.test(path),
      )
      .filter((path) => readFileSync(new URL(path, import.meta.url), 'utf8').includes('GoodIcon'));
    expect(sources).toEqual([]);
  });
});
