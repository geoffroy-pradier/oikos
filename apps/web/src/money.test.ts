import { beforeAll, describe, expect, it } from 'vitest';
import { initI18n } from './i18n';
import { formatMoney, splitObols } from './money';

let money: (language: 'fr' | 'en') => (amount: number) => string;
beforeAll(async () => {
  const i18n = await initI18n('fr');
  money = (language) => (amount) =>
    // Espaces insécables de `Intl` ramenées à des espaces simples, pour des attentes lisibles.
    formatMoney(amount, i18n.getFixedT(language), language).replace(/\s/g, ' ');
});

describe('montants en drachmes et oboles', () => {
  it.each([
    [0, 0, 0],
    [1, 0, 1],
    [5, 0, 5],
    [6, 1, 0],
    [7, 1, 1],
    [3000, 500, 0],
    [Number.MAX_SAFE_INTEGER, 1_501_199_875_790_165, 1],
  ])('%d oboles : %d drachmes et %d oboles, sans rien perdre', (amount, drachmas, obols) => {
    expect(splitObols(amount)).toEqual({ negative: false, drachmas, obols });
    // Le signe porte sur tout le montant : une dette de 7 oboles est 1 drachme 1 obole, pas −2 + 5.
    expect(splitObols(-amount)).toEqual({ negative: amount > 0, drachmas, obols });
    expect(drachmas * 6 + obols).toBe(amount);
  });

  it.each([
    [0, '0 obole', '0 obols'],
    [1, '1 obole', '1 obol'],
    [5, '5 oboles', '5 obols'],
    [6, '1 drachme', '1 drachma'],
    [7, '1 drachme 1 obole', '1 drachma 1 obol'],
    [12, '2 drachmes', '2 drachmas'],
    [17, '2 drachmes 5 oboles', '2 drachmas 5 obols'],
    [-1, '−1 obole', '−1 obol'],
    [-6, '−1 drachme', '−1 drachma'],
    [-7, '−1 drachme 1 obole', '−1 drachma 1 obol'],
    // Un million de drachmes : la catégorie « many » du français s'accorde comme le pluriel.
    [6_000_000, '1 000 000 drachmes', '1,000,000 drachmas'],
    [
      Number.MAX_SAFE_INTEGER,
      '1 501 199 875 790 165 drachmes 1 obole',
      '1,501,199,875,790,165 drachmas 1 obol',
    ],
  ])('%d oboles s’écrit « %s » en français et « %s » en anglais', (amount, fr, en) => {
    expect(money('fr')(amount)).toBe(fr);
    expect(money('en')(amount)).toBe(en);
  });
});
