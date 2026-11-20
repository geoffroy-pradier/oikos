// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fr from '../locales/fr.json';
import { ArchipelagoMap } from './ArchipelagoMap';

afterEach(cleanup);
const POINTS: Record<string, { x: number; y: number }> = {
  k: { x: 50, y: 36 },
  e: { x: 79, y: 16 },
};

const select = vi.fn();

async function mount() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  render(
    <I18nextProvider i18n={instance}>
      <ArchipelagoMap
        label="Carte"
        routes={[{ from: 'k', to: 'e', hours: 4, ours: false }]}
        cities={[
          {
            id: 'k',
            name: 'Kallistè',
            at: POINTS.k ?? { x: 0, y: 0 },
            home: true,
            docked: 0,
            selected: true,
            goods: [],
          },
        ]}
        ships={[]}
        pointOf={(id) => POINTS[id]}
        home={POINTS.k}
        layer="routes"
        onSelect={select}
      />
    </I18nextProvider>,
  );
  const map = screen.getByRole('group', { name: /flèches pour la déplacer/ });
  // La carte occupe 500 × 350 pixels à l'écran : 5 pixels par unité du dessin, sans zoom.
  map.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 350 }) as DOMRect;
  const viewBox = () => screen.getByRole('img', { name: 'Carte' }).getAttribute('viewBox');
  return { map, viewBox };
}

describe('carte déplaçable et zoomable (#696)', () => {
  it('au clavier : + zoome, les flèches déplacent, 0 recentre sur la cité de la maison', async () => {
    const { map, viewBox } = await mount();
    expect(viewBox()).toBe('0 0 100 70');
    map.focus();
    fireEvent.keyDown(map, { key: '+' });
    expect(viewBox()).toBe('16.667 11.667 66.667 46.667');
    fireEvent.keyDown(map, { key: 'ArrowRight' });
    fireEvent.keyDown(map, { key: '0' });
    expect(viewBox()).toBe('25 18.5 50 35');
    // Les touches modifiées restent au navigateur.
    fireEvent.keyDown(map, { key: '-', ctrlKey: true });
    expect(viewBox()).toBe('25 18.5 50 35');
  });

  it('boutons : zoomer, dézoomer, recentrer ; jamais au-delà du dessin', async () => {
    const { viewBox } = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Dézoomer' }));
    expect(viewBox()).toBe('0 0 100 70');
    fireEvent.click(screen.getByRole('button', { name: 'Recentrer sur votre cité' }));
    expect(viewBox()).toBe('25 18.5 50 35');
    for (let i = 0; i < 6; i += 1) fireEvent.click(screen.getByRole('button', { name: 'Zoomer' }));
    expect(viewBox()).toBe('37.5 27.25 25 17.5');
  });

  it('à la souris : la molette zoome sous le pointeur, glisser déplace le dessin', async () => {
    const { map, viewBox } = await mount();
    // Sans zoom, le doigt fait défiler la page verticalement.
    expect(map.className).toContain('touch-pan-y');
    // Molette vers le haut, pointeur sur le coin haut gauche : il reste en place.
    fireEvent.wheel(map, { deltaY: -Math.log(2) / 0.002, clientX: 0, clientY: 0 });
    expect(viewBox()).toBe('0 0 50 35');
    // Un appui qui bouge de moins de 4 pixels ne déplace rien ; zoomée, la carte prend tous les gestes.
    expect(map.className).toContain('touch-none');
    fireEvent.pointerDown(map, { pointerId: 1, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 197, clientY: 102 });
    expect(viewBox()).toBe('0 0 50 35');
    // Glisser de 50 pixels vers la gauche : 5 unités (10 pixels par unité au zoom 2).
    fireEvent.pointerDown(map, { pointerId: 1, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 150, clientY: 100 });
    fireEvent.pointerUp(map, { pointerId: 1 });
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 0, clientY: 0 });
    expect(viewBox()).toBe('5 0 50 35');
  });

  it('un clic sur une cité la choisit pour le panneau ; un glisser, jamais', async () => {
    await mount();
    const city = screen.getByText('Kallistè');
    // Un glisser de plus de 4 pixels qui revient sur la cité ne la choisit pas.
    select.mockClear();
    fireEvent.pointerDown(city, { pointerId: 1, clientX: 250, clientY: 180 });
    fireEvent.pointerMove(city, { pointerId: 1, clientX: 270, clientY: 180 });
    fireEvent.pointerMove(city, { pointerId: 1, clientX: 250, clientY: 180 });
    fireEvent.pointerUp(city, { pointerId: 1 });
    fireEvent.click(city);
    expect(select).not.toHaveBeenCalled();
    // Un appui qui bouge à peine reste un clic.
    fireEvent.pointerDown(city, { pointerId: 1, clientX: 250, clientY: 180 });
    fireEvent.pointerMove(city, { pointerId: 1, clientX: 252, clientY: 181 });
    fireEvent.pointerUp(city, { pointerId: 1 });
    fireEvent.click(city);
    expect(select).toHaveBeenCalledWith('k');
  });
});

describe('terroirs et noms sur un dessin petit (#707)', () => {
  async function drawAt(width: number | null) {
    if (width !== null) {
      // Un téléphone : le dessin mesure `width` pixels de large.
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(private readonly callback: () => void) {}
          observe() {
            this.callback();
          }
          disconnect() {}
        },
      );
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
    }
    const instance = i18next.createInstance();
    await instance.use(initReactI18next).init({
      resources: { fr: { translation: fr } },
      lng: 'fr',
      interpolation: { escapeValue: false },
    });
    const city = (id: string, name: string, at: { x: number; y: number }, selected: boolean) => ({
      id,
      name,
      at,
      home: false,
      docked: 0,
      selected,
      goods: ['wheat', 'fish'],
    });
    render(
      <I18nextProvider i18n={instance}>
        <ArchipelagoMap
          label="Carte"
          routes={[]}
          cities={[
            city('k', 'Kallistè', { x: 50, y: 36 }, true),
            // Au bas du dessin : ses biens passent au-dessus d'elle.
            city('c', 'Chalkeia', { x: 60, y: 69 }, false),
          ]}
          ships={[]}
          pointOf={() => undefined}
          home={undefined}
          layer="terroirs"
          onSelect={select}
        />
      </I18nextProvider>,
    );
    const drawing = screen.getByRole('img', { name: 'Carte' });
    return {
      tiles: () => drawing.querySelectorAll('rect.fill-surface').length,
      tileTops: () =>
        [...drawing.querySelectorAll('rect.fill-surface')].map((rect) =>
          Number(
            /translate\([\d.]+ ([\d.]+)\)/.exec(
              rect.parentElement?.getAttribute('transform') ?? '',
            )?.[1],
          ),
        ),
    };
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sur téléphone, seul le terroir de la cité choisie, et l’écran le dit', async () => {
    const { tiles } = await drawAt(328);
    expect(tiles()).toBe(2);
    expect(screen.getByText(fr.map.terroirHint)).toBeTruthy();
  });

  it('sur ordinateur, le terroir de chaque cité ; au bas du dessin, au-dessus d’elle', async () => {
    const { tiles, tileTops } = await drawAt(null);
    expect(tiles()).toBe(4);
    expect(screen.queryByText(fr.map.terroirHint)).toBeNull();
    const [, , chalkeia] = tileTops();
    expect(chalkeia).toBeLessThan(69);
  });
});
