// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fr from '../locales/fr.json';
import { ProductionList, type ProductionItem } from './HomeProduction';

vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children: React.ReactNode; 'aria-label'?: string; hash?: string }) => (
    <a aria-label={props['aria-label']} href={`/sites#${props.hash ?? ''}`}>
      {props.children}
    </a>
  ),
}));

const field: ProductionItem = {
  id: 's1',
  name: 'Champ de blé',
  city: 'Kallistè',
  goodId: 'wheat',
  progress: { done: 1, text: 'Plafond atteint', tone: 'success' },
  ready: '720 × Blé',
  retired: false,
};
const retired: ProductionItem = {
  ...field,
  id: 's2',
  name: 'retired_recipe',
  goodId: null,
  progress: null,
  ready: null,
  retired: true,
};

async function show(items: ProductionItem[] | null, onCollect = vi.fn()) {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({ resources: { fr: { translation: fr } }, lng: 'fr' });
  render(
    <I18nextProvider i18n={instance}>
      <ProductionList
        items={items}
        harvestable={items?.filter((item) => item.ready).length ?? 0}
        busy={false}
        onCollect={onCollect}
        onCollectAll={vi.fn()}
        announce={(target) => <p role="status">{`annonce ${target}`}</p>}
        status={null}
        titleRef={null}
      />
    </I18nextProvider>,
  );
  return onCollect;
}
afterEach(cleanup);

describe('production en cours du tableau de bord', () => {
  it('chaque site : sa cité, son cycle décrit, ce qui est prêt, « Récolter » et sa fiche', async () => {
    const onCollect = await show([field, retired]);
    const bar = screen.getByRole('progressbar', { name: 'Prochaine récolte : Champ de blé' });
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect(bar.getAttribute('aria-valuetext')).toBe('Plafond atteint');
    expect(screen.getByText('Prêt : 720 × Blé')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Détails : Champ de blé' }).getAttribute('href')).toBe(
      '/sites#site-s1',
    );
    // L'issue d'une récolte s'annonce dans la ligne de son site.
    const row = screen.getByRole('heading', { name: 'Champ de blé' }).closest('li');
    expect(within(row as HTMLElement).getByRole('status').textContent).toBe('annonce s1');
    fireEvent.click(screen.getByRole('button', { name: 'Récolter : Champ de blé' }));
    expect(onCollect).toHaveBeenCalledWith('s1');
    // Production retirée : ni récolte ni cycle, mais sa fiche, où en choisir une autre.
    expect(screen.queryByRole('button', { name: 'Récolter : retired_recipe' })).toBeNull();
    expect(screen.getByText(fr.production.retired)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Détails : retired_recipe' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tout récolter : 1 site à récolter' })).toBeTruthy();
  });

  it('rien de prêt : « Récolter » reste proposé, sans « Tout récolter » ; non estimé : « — » ; aucun site : l’acquisition', async () => {
    const onCollect = await show([{ ...field, ready: null }]);
    expect(screen.getByText(fr.production.nothing)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Récolter : Champ de blé' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Tout récolter/ })).toBeNull();
    // Rien de prêt d'après le calcul : inactif, la raison à côté et reliée, le clic sans effet (#864).
    const idle = screen.getByRole('button', { name: 'Récolter : Champ de blé' });
    expect(idle.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(idle.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      fr.production.nothing,
    );
    fireEvent.click(idle);
    expect(onCollect).not.toHaveBeenCalled();
    // Pas encore estimé : un tiret, jamais « rien de prêt » ; l'API juge, le bouton reste actif.
    cleanup();
    await show([{ ...field, ready: undefined }]);
    expect(screen.queryByText(fr.production.nothing)).toBeNull();
    expect(screen.getByText(fr.production.unknown)).toBeTruthy();
    const unknown = screen.getByRole('button', { name: 'Récolter : Champ de blé' });
    expect(unknown.getAttribute('aria-disabled')).toBe('false');
    expect(unknown.hasAttribute('aria-describedby')).toBe(false);
    cleanup();
    await show([]);
    expect(screen.getByRole('heading', { name: fr.home.sitesEmpty })).toBeTruthy();
    expect(screen.getByText(fr.home.acquire)).toBeTruthy();
  });
});
