// @vitest-environment jsdom
import { GoodIcon } from '@oikos/ui';
import { cleanup, render } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fr from './locales/fr.json';
import { GoodPicture, parseGoodTiers } from './good-tiers';
import { GoodTiersProvider } from './GoodTiersProvider';
import { ProductionList } from './screens/HomeProduction';

const reads = vi.hoisted(() => ({ rows: null as unknown[] | null, calls: [] as unknown[][] }));
vi.mock('./data', () => ({
  useRows: (...args: unknown[]) => {
    reads.calls.push(args);
    return { rows: reads.rows, failed: false, reload: () => Promise.resolve(null) };
  },
}));
vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children: React.ReactNode }) => <a href="/sites">{props.children}</a>,
}));
afterEach(cleanup);

/** Dessin rendu, sans l'élément racine : ce qui distingue un pictogramme d'un autre. */
const drawingOf = (element: React.ReactElement) =>
  render(element).container.querySelector('svg')?.innerHTML ?? '';

describe('niveau des biens publié au client (#873)', () => {
  it('lit une ligne par bien ; écarte une ligne illisible, garde la première ligne d’un bien', () => {
    const tiers = parseGoodTiers([
      { good_id: 'ambrosia', tier: 'finished' },
      { good_id: 'ambrosia', tier: 'raw' },
      { good_id: 'nectar', tier: 'intermediate' },
      { good_id: '', tier: 'raw' },
      { good_id: 'no_tier', tier: null },
      { good_id: 7, tier: 'raw' },
      null,
    ]);
    expect([...tiers]).toEqual([
      ['ambrosia', 'finished'],
      ['nectar', 'intermediate'],
    ]);
    expect(parseGoodTiers(null).size).toBe(0);
    expect(parseGoodTiers({ good_id: 'wheat', tier: 'raw' }).size).toBe(0);
  });

  it('un bien sans dessin prend le dessin de son niveau publié ; un bien dessiné garde le sien', () => {
    reads.rows = [
      { good_id: 'ambrosia', tier: 'finished' },
      { good_id: 'wheat', tier: 'finished' },
      { good_id: 'freight', tier: 'service' },
    ];
    reads.calls = [];
    const shown = (goodId: string) =>
      drawingOf(
        <GoodTiersProvider>
          <GoodPicture goodId={goodId} />
        </GoodTiersProvider>,
      );
    const crate = drawingOf(<GoodIcon goodId="ambrosia" />);
    expect(shown('ambrosia')).toBe(drawingOf(<GoodIcon goodId="ambrosia" tier="finished" />));
    expect(shown('ambrosia')).not.toBe(crate);
    expect(shown('wheat')).toBe(drawingOf(<GoodIcon goodId="wheat" />));
    // Bien absent de la vue, ou niveau sans dessin : la caisse, jamais un niveau supposé.
    expect(shown('nectar')).toBe(crate);
    expect(shown('freight')).toBe(crate);
    expect(reads.calls[0]).toEqual(['good_tiers', 'good_id, tier', 'good_id']);
  });

  it('lecture en cours ou en échec, ou écran sans fournisseur : la caisse', () => {
    reads.rows = null;
    const crate = drawingOf(<GoodIcon goodId="ambrosia" />);
    expect(
      drawingOf(
        <GoodTiersProvider>
          <GoodPicture goodId="ambrosia" />
        </GoodTiersProvider>,
      ),
    ).toBe(crate);
    expect(drawingOf(<GoodPicture goodId="ambrosia" />)).toBe(crate);
  });

  it('un écran passe le niveau : la production du tableau de bord d’un bien ajouté par Olympe', async () => {
    reads.rows = [{ good_id: 'ambrosia', tier: 'intermediate' }];
    const instance = i18next.createInstance();
    await instance
      .use(initReactI18next)
      .init({ resources: { fr: { translation: fr } }, lng: 'fr' });
    const item = {
      id: 's1',
      name: 'Atelier',
      city: 'Kallistè',
      goodId: 'ambrosia',
      progress: null,
    };
    const { container } = render(
      <I18nextProvider i18n={instance}>
        <GoodTiersProvider>
          <ProductionList
            items={[{ ...item, ready: null, retired: false }]}
            harvestable={0}
            busy={false}
            onCollect={vi.fn()}
            onCollectAll={vi.fn()}
            announce={() => null}
            status={null}
            titleRef={null}
          />
        </GoodTiersProvider>
      </I18nextProvider>,
    );
    const pictures = [...container.querySelectorAll('svg')].map((svg) => svg.innerHTML);
    expect(pictures).toContain(drawingOf(<GoodIcon goodId="ambrosia" tier="intermediate" />));
  });
});
