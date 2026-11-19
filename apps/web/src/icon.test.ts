import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe("icône de l'application", () => {
  const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');

  it('est un SVG dessiné à la main : ni image, ni lien, ni ressource externe', () => {
    // Seul l'espace de noms SVG est une adresse, et il ne se charge pas.
    const body = svg.replace('xmlns="http://www.w3.org/2000/svg"', '');
    for (const pattern of [/<image/i, /href/i, /url\(/i, /data:/i, /https?:/i]) {
      expect(body).not.toMatch(pattern);
    }
  });

  it('est dans la palette de la refonte : orange sur graphite, plus de terre cuite', () => {
    expect(svg).toContain('fill="#17191c"');
    expect(svg).toContain('fill="#ff7a1a"');
    expect(svg).not.toMatch(/#9a3412|#faf6ef|#b45309/i);
  });
});
