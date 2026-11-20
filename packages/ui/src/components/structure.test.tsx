// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Coins, Ship } from '../icons';
import { EmptyState } from './EmptyState';
import { PageHeader } from './PageHeader';
import { Progress } from './Progress';
import { StatCard, StatGrid } from './StatCard';
import { StatusRegion } from './StatusRegion';

afterEach(cleanup);

describe('StatCard', () => {
  it('dit le sens par un triangle et la valeur signée, pas par la couleur seule', () => {
    render(
      <StatCard
        label="Charges"
        icon={<Coins />}
        value="96 dr."
        delta={{ value: '+3 %', trend: 'up', tone: 'negative' }}
        hint="depuis hier"
      />,
    );
    const delta = screen.getByText('+3 %', { exact: false });
    expect(delta.dataset['trend']).toBe('up');
    expect(delta.className).toContain('text-danger');
    expect(delta.querySelector('[aria-hidden="true"]')?.textContent).toBe('▲ ');
    expect(screen.getByText('96 dr.').className).toContain('tabular-nums');
  });

  it('dense : petite carte sous 1 024 px, sans icône ni variation ; entière au-delà', () => {
    render(<StatCard dense label="Stocks" icon={<Coins />} value="12 dr." hint="2 cités" />);
    expect(screen.getByText('12 dr.').className).toContain('cqi');
    expect(screen.getByText('12 dr.').className).toContain('max-lg:[--stat-max:1.25rem]');
    expect(screen.getByText('2 cités').className).toContain('max-lg:hidden');
    expect(screen.getByText('Stocks').nextElementSibling?.className).toContain('max-lg:hidden');
  });

  it('dans une liste de définitions : libellé en `dt`, valeur et variation en `dd`', () => {
    render(
      <dl>
        <StatCard
          definition
          label="Masse"
          icon={<Coins />}
          value="5 615"
          delta={{ value: '+4 %', trend: 'up', tone: 'negative' }}
        />
      </dl>,
    );
    const term = screen.getByText('Masse');
    expect(term.tagName).toBe('DT');
    expect(term.parentElement?.tagName).toBe('DIV');
    expect(Array.from(term.parentElement?.children ?? [], (child) => child.tagName)).toEqual([
      'DT',
      'DD',
      'DD',
    ]);
    expect(term.parentElement?.querySelector('dd')?.textContent).toBe('5 615');
    expect(screen.getByText('+4 %').className).toContain('text-danger');
  });

  it('montant long : en entier sur une ligne, à la taille que permet la largeur de la carte', () => {
    render(<StatCard label="Trésorerie" icon={<Coins />} value="486 drachmes 4 oboles" />);
    const value = screen.getByText('486 drachmes 4 oboles');
    expect(value.className).toContain('whitespace-nowrap');
    expect(value.className).not.toContain('overflow-wrap');
    // Taille : la largeur de la carte (`cqi`, la valeur est dans un conteneur) divisée par celle du montant, en em.
    expect(value.style.getPropertyValue('--stat-em')).toBe('12.08');
    expect(value.className).toMatch(/min\(var\(--stat-max\),100cqi\/var\(--stat-em\)\)/);
    expect(value.parentElement?.className).toContain('@container');
  });

  it('une seule ligne secondaire : variation, précision et courbe ensemble', () => {
    render(
      <StatCard
        inverse
        label="Trésorerie"
        value="600 oboles"
        delta={{ value: '+2 drachmes', trend: 'up' }}
        hint="sur 7 jours"
        chart={<svg aria-hidden="true" data-testid="courbe" />}
      />,
    );
    const line = screen.getByText('+2 drachmes').closest('p');
    expect(line?.textContent).toBe('▲ +2 drachmes sur 7 jours');
    expect(line?.contains(screen.getByTestId('courbe'))).toBe(true);
    expect(screen.getByText('Trésorerie').closest('section')?.querySelectorAll('p')).toHaveLength(
      2,
    );
    // Plan inversé sous 1 024 px : la variation y garde le texte du plan, son sens reste dit par le triangle.
    expect(screen.getByText('+2 drachmes').className).toContain('max-lg:text-inverse-foreground');
  });
});

describe('StatGrid', () => {
  /** Colonnes de chaque enfant : sous 1 280 px (`max-xl`), puis au-delà (`xl`), deux s'il est marqué. */
  const spans = (items: Iterable<Element>) =>
    Array.from(items, (item) =>
      ['max-xl:col-span-2', 'xl:col-span-2'].map((span) => +item.classList.contains(span) + 1),
    );

  it('rangées partagées par les cartes ; une rangée à 1 280 px si les cartes tiennent en cinq colonnes', () => {
    render(
      <StatGrid as="ul" aria-label="Chiffres">
        <li>
          <StatCard label="Hébergés chez les habitants de la cité" value="4" />
        </li>
        <li>
          <StatCard label="Hébergement par jour" value="13 drachmes 2 oboles" />
        </li>
      </StatGrid>,
    );
    const grid = screen.getByRole('list', { name: 'Chiffres' });
    expect(grid.className).toContain('grid-cols-2');
    // 1 + 2 colonnes : une seule rangée de trois.
    expect(grid.className).toContain('xl:grid-cols-3');
    expect(grid.className).toContain('[&>li]:grid-rows-subgrid');
    expect(grid.className).toContain('[&_[data-stat-card]]:grid-rows-subgrid');
    // Montant trop long pour une colonne : deux, partout ; la carte d'avant reste seule sous 1 280 px.
    expect(spans(grid.children)).toEqual([
      [2, 1],
      [2, 2],
    ]);
    // Libellé, valeur, ligne secondaire : trois rangées partagées, la valeur ne suit pas la hauteur du libellé.
    for (const card of grid.querySelectorAll('section')) {
      expect(card.dataset['statCard']).toBe('');
      // Une carte conteneur (`container-type`) perdrait ses rangées partagées : seule sa valeur l'est.
      expect(card.className).not.toContain('@container');
    }
  });

  it('Maison : trésorerie large et trois cartes, une rangée de cinq ; la carte seule sur téléphone s’étend', () => {
    const { container } = render(
      <StatGrid>
        <StatCard wide label="Trésorerie" value="—" />
        <StatCard label="Résultat" value="0 obole" />
        <StatCard label="Stocks" value="0 obole" />
        <StatCard label="Sites" value="1 sur 1" />
        <p className="col-span-full">Détail</p>
      </StatGrid>,
    );
    const grid = container.firstElementChild as Element;
    expect(grid.className).toContain('xl:grid-cols-5');
    expect(spans(grid.children)).toEqual([
      [2, 2],
      [1, 1],
      [1, 1],
      [2, 1],
      [1, 1],
    ]);
  });

  it('Sites : une carte large et trois normales font cinq colonnes, une rangée aux valeurs de même taille', () => {
    const { container } = render(
      <StatGrid>
        <StatCard wide label="Trésorerie" value="486 drachmes 4 oboles" />
        <StatCard label="Sites" value="1 sur 4" />
        <StatCard label="Prêts" value="0" />
        <StatCard label="Coût d'un jour" value="9 drachmes" />
      </StatGrid>,
    );
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.className).toContain('xl:grid-cols-5');
    expect(spans(grid.children)).toEqual([
      [2, 2],
      [1, 1],
      [1, 1],
      [2, 1],
    ]);
    // Taille commune : la plus serrée d'une colonne (« 9 drachmes ») et de deux (le montant), sur la largeur de la grille.
    expect(grid.className).toContain('xl:[&_[data-stat-value]]:text-[length:var(--stat-row)]');
    expect(grid.style.getPropertyValue('--stat-fit')).toBe(
      'min(1.75rem, calc((2 * (100cqi - 4rem) / 5 + 1rem - 2rem - 2px) / 12.08), ' +
        'calc((1 * (100cqi - 4rem) / 5 + 0rem - 2rem - 2px) / 6.11))',
    );
  });

  it('Comptes : au-delà de cinq colonnes, quatre par rangée', () => {
    const { container } = render(
      <StatGrid as="ul">
        {['486 drachmes 4 oboles', '13 drachmes 2 oboles', '0 obole', '500 drachmes'].map(
          (value) => (
            <li key={value}>
              <StatCard wide={value.startsWith('486')} label="Bilan" value={value} />
            </li>
          ),
        )}
      </StatGrid>,
    );
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.className).toContain('xl:grid-cols-4');
    expect(grid.className).not.toContain('--stat-row');
    expect(spans(grid.children).map(([, xl]) => xl)).toEqual([2, 2, 1, 2]);
  });
});

describe('Progress', () => {
  it('est une barre nommée, bornée, dont la valeur est dite en clair', () => {
    render(<Progress label="Moisson" value={7} max={5} valueText="5 jours sur 5" />);
    const bar = screen.getByRole('progressbar', { name: 'Moisson' });
    expect(bar.getAttribute('aria-valuenow')).toBe('5');
    expect(bar.getAttribute('aria-valuemax')).toBe('5');
    expect(bar.getAttribute('aria-valuetext')).toBe('5 jours sur 5');
  });
});

describe('StatusRegion', () => {
  it('est présente vide avant le résultat, puis l’annonce sans être recréée', () => {
    const ref = createRef<HTMLDivElement>();
    const { rerender } = render(<StatusRegion ref={ref} />);
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    rerender(
      <StatusRegion ref={ref} tone="success">
        Ordre passé
      </StatusRegion>,
    );
    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toBe('Ordre passé');
    ref.current?.focus();
    expect(document.activeElement).toBe(region);
  });

  it('prend le rôle alert pour une erreur', () => {
    render(<StatusRegion role="alert" tone="danger" />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

describe('EmptyState', () => {
  it('montre une illustration décorative à la place de l’icône', () => {
    const { container } = render(
      <EmptyState icon={<Ship data-testid="icon" />} illustration="noShip" title="Rien" />,
    );
    // Le dessin de la famille, par son identifiant (`EMPTY_ILLUSTRATION_IDS`).
    const art = container.querySelector('svg[viewBox="0 0 160 120"]');
    expect(art?.parentElement?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('[data-testid="icon"]')).toBeNull();
  });
});

describe('PageHeader', () => {
  it('nomme la page par son seul titre, et range recherche et action après lui', () => {
    const ref = createRef<HTMLHeadingElement>();
    render(
      <PageHeader
        title="Agora"
        subtitle="Il est 14:05"
        titleRef={ref}
        search={<input aria-label="Chercher" />}
        action={<button type="button">Passer un ordre</button>}
      />,
    );
    const title = screen.getByRole('heading', { level: 1, name: 'Agora' });
    expect(title).toBe(ref.current);
    expect(title.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByText('Il est 14:05').className).toContain('text-muted-foreground');
    const order = [title, screen.getByLabelText('Chercher'), screen.getByRole('button')];
    order.slice(1).forEach((node, index) => {
      const before = order[index];
      if (!before) throw new Error('ordre');
      expect(before.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  it('sans référence, le titre n’est pas focalisable ; sans action, aucune colonne vide', () => {
    const { container } = render(<PageHeader title="Carte" />);
    expect(screen.getByRole('heading', { level: 1 }).hasAttribute('tabindex')).toBe(false);
    expect(container.firstElementChild?.children).toHaveLength(1);
  });
});
