// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { Config } from './Config';

const api = vi.hoisted(() => ({ adminGet: vi.fn(), adminCommand: vi.fn() }));
vi.mock('../api', () => api);
/** Champs rendus, par identifiant. */
const rendered = vi.hoisted(() => [] as string[]);
// Le vrai champ, mémorisé (`memo`) : React n'appelle sa fonction (`type`) que pour le rendre, on la compte.
vi.mock('./FieldControl', async (original) => {
  const { FieldControl } = await original<{ FieldControl: object }>();
  const memoized = FieldControl as unknown as { type: (props: { id: string }) => ReactNode };
  const draw = memoized.type;
  const type = (props: { id: string }) => {
    rendered.push(props.id);
    return draw(props);
  };
  return { FieldControl: { ...memoized, type } };
});

// Catalogue de soixante biens (#884) : une recette par bien, quatre classes au panier de quinze biens.
const id = (index: number) => `good_${String(index).padStart(2, '0')}`;
const SIXTY = Array.from({ length: 60 }, (_, index) => index);
const CONFIG = {
  starting: { grantOboles: 600 },
  goods: SIXTY.map((index) => ({
    id: id(index),
    tier: 'raw',
    referencePriceOboles: 10 + index,
    elasticity: 0.5,
  })),
  recipes: SIXTY.map((index) => ({
    id: `make_${id(index)}`,
    siteType: 'farm',
    durationMinutes: 60,
    workers: 2,
    maxAccruedCycles: 3,
    inputs: [{ goodId: id(index), quantity: 2 }],
    outputs: [{ goodId: id((index + 1) % 60), quantity: 1 }],
  })),
  npcClasses: [0, 1, 2, 3].map((group) => ({
    id: `class_${group}`,
    basket: SIXTY.slice(group * 15, group * 15 + 15).map((index) => ({
      goodId: id(index),
      quantityPerThousand: 5,
    })),
  })),
};

beforeAll(async () => {
  await initI18n('fr');
});
afterEach(cleanup);

it('soixante biens : une saisie ne rend à nouveau que son champ, et le texte garde chaque saisie', async () => {
  api.adminGet.mockImplementation((path: string) =>
    Promise.resolve({
      ok: true,
      data:
        path === 'config/versions'
          ? {
              activeVersionId: 'v1',
              versions: [
                { id: 'v1', number: 1, note: '', createdBy: null, createdAt: '2026-11-20' },
              ],
              activations: [],
            }
          : { id: 'v1', number: 1, config: CONFIG },
    }),
  );
  render(<Config accessToken="token" role="super_admin" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir la version 1' }));
  const editor = (await screen.findByLabelText('Configuration (JSON)')) as HTMLTextAreaElement;
  await waitFor(() => expect(screen.getByText(/^Aucune différence/)).toBeTruthy());
  const field = (key: string) => document.getElementById(key) as HTMLInputElement;
  /** Saisit `value` et rend les champs rendus à nouveau par cette saisie. */
  const type = (key: string, value: string) => {
    rendered.length = 0;
    fireEvent.change(field(key), { target: { value } });
    return [...new Set(rendered)];
  };
  // À l'ouverture, tous les champs sont rendus : plusieurs centaines, qu'une saisie rendait tous à nouveau.
  expect(new Set(rendered).size).toBeGreaterThan(500);

  // Un bien, un autre, une ligne d'extrant de recette : chaque saisie ne rend que son champ.
  for (const [key, value] of [
    ['goods-0-elasticity', '0.7'],
    ['goods-59-referencePriceOboles', '99'],
    ['recipes-3-outputs-0-quantity', '4'],
    // Champs que les saisies suivantes n'ont pas rendus à nouveau : ils écrivent dans le texte du moment.
    ['goods-0-elasticity', '0.75'],
    ['recipes-3-outputs-0-quantity', '5'],
  ] as const)
    expect(type(key, value)).toEqual([key]);

  const text = JSON.parse(editor.value) as typeof CONFIG;
  expect(text.goods[0]?.elasticity).toBe(0.75);
  expect(text.goods[59]?.referencePriceOboles).toBe(99);
  expect(text.recipes[3]?.outputs[0]?.quantity).toBe(5);
  for (const change of [
    'goods[good_00].elasticity : 0.5 → 0.75',
    'goods[good_59].referencePriceOboles : 69 → 99',
    'recipes[make_good_03].outputs[good_04].quantity : 1 → 5',
  ])
    expect(screen.getByText((_, node) => node?.tagName === 'LI' && node.textContent === change));
  expect(field('goods-0-elasticity').value).toBe('0.75');
});
