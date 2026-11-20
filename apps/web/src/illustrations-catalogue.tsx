/**
 * Catalogue des illustrations, en local : `pnpm dev` puis http://localhost:5173/illustrations.html
 * (`?theme=dark`, `?lang=en`). Outil de développement, absent de la construction de production.
 * Chaque dessin est montré dans les deux thèmes côte à côte ; les noms viennent des traductions.
 */
import {
  Archipelago,
  Card,
  CITY_VIGNETTE_IDS,
  CityVignette,
  EMPTY_ILLUSTRATION_IDS,
  EmptyIllustration,
  GOD_EMBLEM_IDS,
  GodEmblem,
  GOOD_ICON_IDS,
  GOOD_TIER_IDS,
  GoodIcon,
  WelcomeScene,
} from '@oikos/ui';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import en from './locales/en.json';
import fr from './locales/fr.json';
import './styles.css';

const params = new URLSearchParams(location.search);
const texts = params.get('lang') === 'en' ? en : fr;
const nameOf = (names: Record<string, string>, id: string) => names[id] ?? '?';

/** Une rubrique : le même contenu dans le thème clair puis dans le sombre, quel que soit celui de la page. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="flex animate-rise flex-col gap-4">
      <h2 className="eyebrow">{title}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {['light', 'dark'].map((theme) => (
          <div
            key={theme}
            data-theme={theme}
            className="rounded-xl border border-border-subtle bg-surface p-4 text-foreground"
          >
            {children}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Goods() {
  return (
    <ul className="grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-4 xl:grid-cols-6">
      {[...GOOD_ICON_IDS, 'unknown'].map((id) => (
        <li key={id} className="flex flex-col items-center gap-1.5 text-center">
          <div className="flex items-end gap-2">
            <GoodIcon goodId={id} size={48} label={nameOf(texts.goods, id)} />
            <GoodIcon goodId={id} />
          </div>
          <span className="text-xs text-muted-foreground">{nameOf(texts.goods, id)}</span>
        </li>
      ))}
      {GOOD_TIER_IDS.map((tier) => (
        <li key={tier} className="flex flex-col items-center gap-1.5 text-center">
          <div className="flex items-end gap-2">
            <GoodIcon goodId="unknown" tier={tier} size={48} />
            <GoodIcon goodId="unknown" tier={tier} />
          </div>
          <span className="text-xs text-muted-foreground">? · {tier}</span>
        </li>
      ))}
    </ul>
  );
}

function Gods() {
  return (
    <ul className="grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-6">
      {[...GOD_EMBLEM_IDS, 'unknown'].map((id) => (
        <li key={id} className="flex flex-col items-center gap-1.5 text-center">
          <div className="flex items-end gap-2">
            <GodEmblem godId={id} label={nameOf(texts.gods, id)} />
            <GodEmblem godId={id} size={24} />
          </div>
          <span className="text-xs text-muted-foreground">{nameOf(texts.gods, id)}</span>
        </li>
      ))}
    </ul>
  );
}

function Cities() {
  return (
    <ul className="flex flex-col gap-4">
      {[...CITY_VIGNETTE_IDS, 'unknown'].map((id) => (
        <li key={id} className="flex flex-wrap items-end gap-3">
          <CityVignette cityId={id} label={nameOf(texts.cities, id)} className="h-auto w-60" />
          <CityVignette cityId={id} />
          <span className="text-xs text-muted-foreground">{nameOf(texts.cities, id)}</span>
        </li>
      ))}
    </ul>
  );
}

function Scenes() {
  return (
    <div className="flex flex-col gap-4">
      <WelcomeScene className="h-auto w-full rounded-lg" />
      <ul className="grid grid-cols-2 gap-3">
        {EMPTY_ILLUSTRATION_IDS.map((id) => (
          <li key={id} className="flex flex-col items-center gap-1 text-center">
            <EmptyIllustration kind={id} className="h-auto w-full max-w-40" />
            <span className="text-xs text-muted-foreground">{id}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Catalogue() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-8">
      <header>
        <p className="eyebrow">@oikos/ui · illustrations</p>
        <h1 className="text-3xl sm:text-4xl">SVG</h1>
      </header>
      <Section title="GoodIcon · 48 · 24">
        <Goods />
      </Section>
      <Section title="GodEmblem · 48 · 24">
        <Gods />
      </Section>
      <Section title="CityVignette · 240 × 160 · 120 × 80">
        <Cities />
      </Section>
      <Section title="WelcomeScene · EmptyIllustration">
        <Scenes />
      </Section>
      <Section title="Archipelago · 1 000 × 700">
        <Archipelago className="h-auto w-full rounded-lg" />
      </Section>
    </main>
  );
}

document.documentElement.dataset['theme'] = params.get('theme') === 'dark' ? 'dark' : 'light';
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Catalogue />
  </StrictMode>,
);
