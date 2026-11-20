import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Les écrans du jeu, sans les tests ni le catalogue (page de développement). */
const sources = readdirSync(new URL('.', import.meta.url), { recursive: true, encoding: 'utf8' })
  .filter((path) => path.endsWith('.tsx') && !/\.test\.tsx$|catalogue/.test(path))
  .map((path) => [path, readFileSync(new URL(path, import.meta.url), 'utf8')] as const);

/** Chaque balise ouvrante `<Button …>`, accolades comprises (un `>` dans une expression ne la ferme pas). */
function buttonTags(source: string): string[] {
  const tags: string[] = [];
  for (const match of source.matchAll(/<Button\b/g)) {
    let depth = 0;
    let end = match.index + match[0].length;
    for (; end < source.length; end++) {
      const char = source[end];
      if (char === '{') depth++;
      else if (char === '}') depth--;
      else if (char === '>' && depth === 0) break;
    }
    tags.push(source.slice(match.index, end));
  }
  return tags;
}

/** Expression de l'attribut `icon={…}` d'une balise, accolades équilibrées ; `null` sans attribut. */
function iconOf(tag: string): string | null {
  const start = /\sicon=\{/.exec(tag);
  if (!start) return null;
  let depth = 0;
  for (let end = start.index + start[0].length - 1; end < tag.length; end++) {
    if (tag[end] === '{') depth++;
    else if (tag[end] === '}' && --depth === 0)
      return tag.slice(start.index + start[0].length, end);
  }
  return tag.slice(start.index + start[0].length);
}

describe('icônes des actions (spécification 10, Direction artistique, #869)', () => {
  it('lit bien les écrans, et refuse une icône qui peut manquer', () => {
    expect(sources.some(([path]) => path.endsWith('Sites.tsx'))).toBe(true);
    expect(iconOf('<Button icon={undefined} onClick={go}')).toBe('undefined');
    expect(iconOf('<Button icon={busy ? <Spin /> : <Send />} aria-label={a ? b : undefined}')).toBe(
      'busy ? <Spin /> : <Send />',
    );
    expect(iconOf('<Button onClick={go}')).toBeNull();
  });

  it('chaque bouton d’action du jeu porte une icône au trait, en tout état', () => {
    const bare = sources.flatMap(([path, source]) =>
      buttonTags(source)
        .filter((tag) => {
          const icon = iconOf(tag);
          // Sans icône, ou une icône qui peut manquer (`undefined`, `null`, `cond && …`) : refusé.
          return icon === null || /\bundefined\b|\bnull\b|&&/.test(icon);
        })
        .map((tag) => `${path} : ${tag.replace(/\s+/g, ' ').slice(0, 80)}`),
    );
    expect(bare).toEqual([]);
  });
});
