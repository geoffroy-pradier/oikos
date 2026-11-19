/**
 * Catalogue des illustrations, en local : `pnpm dev` puis http://localhost:5173/illustrations.html
 * (`?theme=dark`, `?lang=en`). Outil de développement, absent de la construction de production.
 * Chaque dessin est montré dans les deux thèmes côte à côte ; les noms viennent des traductions.
 */
import { Card, GOOD_ICON_IDS, GoodIcon } from '@oikos/ui';
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
    </ul>
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
    </main>
  );
}

document.documentElement.dataset['theme'] = params.get('theme') === 'dark' ? 'dark' : 'light';
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Catalogue />
  </StrictMode>,
);
