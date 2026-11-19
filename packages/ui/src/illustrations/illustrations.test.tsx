// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CITY_VIGNETTE_IDS,
  CityVignette,
  GOD_EMBLEM_IDS,
  GodEmblem,
  GOOD_ICON_IDS,
  GoodIcon,
} from '.';
import { paths } from './svg';

afterEach(cleanup);

// Chemins par `node:path` : sous jsdom, `URL` n'est pas celle de Node.
const HERE = dirname(fileURLToPath(import.meta.url));

const config = JSON.parse(
  readFileSync(join(HERE, '../../../config/src/values/initial.json'), 'utf8'),
) as Record<'goods' | 'gods' | 'cities', { id: string }[]>;
const ids = (key: keyof typeof config) => config[key].map((entry) => entry.id).sort();

/** Chaque dessin, repli compris, tel que le navigateur le reçoit. */
const ALL = [
  ...[...GOOD_ICON_IDS, 'unknown'].map((id) => <GoodIcon key={id} goodId={id} size={48} />),
  ...[...GOD_EMBLEM_IDS, 'unknown'].map((id) => <GodEmblem key={id} godId={id} />),
  ...[...CITY_VIGNETTE_IDS, 'unknown'].map((id) => <CityVignette key={id} cityId={id} />),
].map((element): [string, ReactElement] => [`${element.type.name} ${element.key}`, element]);

/** Ce qu'une illustration dessinée dans le dépôt ne contient jamais : image, lien, ressource externe. */
const FORBIDDEN = [/<image/i, /href/i, /url\(/i, /data:/i, /https?:/i];
const SOURCES = readdirSync(HERE).filter((name) => !name.includes('.test.'));

describe('illustrations dessinées à la main', () => {
  it('le répertoire ne contient que du code : aucune image importée', () => {
    const files = readdirSync(HERE);
    expect(files.filter((name) => !/\.tsx?$/.test(name))).toEqual([]);
  });

  it.each(SOURCES)('%s : aucune source externe', (name) => {
    const source = readFileSync(join(HERE, name), 'utf8');
    for (const pattern of FORBIDDEN) expect(source).not.toMatch(pattern);
  });

  it('un dessin ne se compose que de tracés aux tons connus', () => {
    expect(() => paths('x M0 0h1')).toThrow('Ton inconnu : x');
    expect(renderToStaticMarkup(<svg>{paths('s M0 0h1\n  I M1 1h1')}</svg>)).toBe(
      '<svg><path style="fill:var(--primary-subtle)" d="M0 0h1"></path>' +
        '<path fill="currentColor" stroke="none" d="M1 1h1"></path></svg>',
    );
  });

  it.each(ALL)('%s : ni image, ni lien, ni ressource externe', (_name, element) => {
    const markup = renderToStaticMarkup(element);
    expect(markup).toMatch(/^<svg[^>]* aria-hidden="true"/);
    for (const pattern of FORBIDDEN) expect(markup).not.toMatch(pattern);
  });
});

describe('GoodIcon', () => {
  it('dessine chaque bien de la configuration', () => {
    expect([...GOOD_ICON_IDS].sort()).toEqual(ids('goods'));
  });

  it('est décoratif par défaut, nommé quand l’appelant fournit un nom', () => {
    const { container } = render(
      <>
        <GoodIcon goodId="wheat" />
        <GoodIcon goodId="wine" size={48} label="Vin" />
      </>,
    );
    const [decorative] = container.querySelectorAll('svg');
    expect(decorative?.getAttribute('aria-hidden')).toBe('true');
    expect(decorative?.getAttribute('width')).toBe('24');
    const named = screen.getByRole('img', { name: 'Vin' });
    expect(named.getAttribute('width')).toBe('48');
    expect(named.hasAttribute('aria-hidden')).toBe(false);
  });

  it('dessine une caisse neutre pour un bien inconnu, même au nom d’une propriété d’objet', () => {
    const unknown = renderToStaticMarkup(<GoodIcon goodId="ambrosia" />);
    expect(renderToStaticMarkup(<GoodIcon goodId="constructor" />)).toBe(unknown);
    expect(renderToStaticMarkup(<GoodIcon goodId="wheat" />)).not.toBe(unknown);
    // Chaque bien a son propre dessin.
    const drawings = GOOD_ICON_IDS.map((id) => renderToStaticMarkup(<GoodIcon goodId={id} />));
    expect(new Set([...drawings, unknown]).size).toBe(GOOD_ICON_IDS.length + 1);
  });
});

describe.each([
  ['GodEmblem', GOD_EMBLEM_IDS, 'gods', (id: string) => <GodEmblem godId={id} label={id} />],
  ['CityVignette', CITY_VIGNETTE_IDS, 'cities', (id: string) => <CityVignette cityId={id} />],
] as const)('%s', (_name, drawn, key, draw) => {
  it('dessine chaque entrée de la configuration, chacune autrement', () => {
    expect([...drawn].sort()).toEqual(ids(key));
    const markups = [...drawn, 'unknown'].map((id) => renderToStaticMarkup(draw(id)));
    expect(new Set(markups.map((m) => m.replace(/aria-label="[^"]*"/, ''))).size).toBe(
      drawn.length + 1,
    );
  });

  it('a un repli neutre pour une entrée inconnue', () => {
    const strip = (id: string) => renderToStaticMarkup(draw(id)).replace(/aria-label="[^"]*"/, '');
    expect(strip('constructor')).toBe(strip('unknown'));
  });
});

describe('GodEmblem et CityVignette', () => {
  it('sont décoratifs par défaut, nommés sur demande', () => {
    render(
      <>
        <GodEmblem godId="athena" label="Athéna" size={96} />
        <CityVignette cityId="halos" label="Halos" className="w-full" />
        <CityVignette cityId="elaia" />
      </>,
    );
    expect(screen.getByRole('img', { name: 'Athéna' }).getAttribute('width')).toBe('96');
    expect(screen.getByRole('img', { name: 'Halos' }).getAttribute('class')).toContain('w-full');
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });
});
