/**
 * Catalogue de composants, consultable en local : `pnpm dev` puis http://localhost:5173/catalogue.html
 * (`?theme=dark` pour le thème sombre). Outil de développement, absent de la construction de production ;
 * ses libellés d'exemple ne sont pas des textes d'interface du jeu.
 */
import * as ui from '@oikos/ui';
import { Button, Card, CONTRAST_PAIRS, Field, Frieze } from '@oikos/ui';
import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const TOKENS = [...new Set(CONTRAST_PAIRS.flatMap(([fg, bg]) => [fg, bg]))];

function Section({
  title,
  children,
  wide,
}: {
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Card className={ui.cn('flex animate-rise flex-col gap-4', wide && 'lg:col-span-2')}>
      <h2 className="eyebrow">{title}</h2>
      {children}
    </Card>
  );
}

function Catalogue() {
  const [theme, setTheme] = useState(document.documentElement.dataset['theme'] ?? 'light');
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset['theme'] = next;
    setTheme(next);
  };
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">@oikos/ui · ADR 0010</p>
          <h1 className="text-4xl sm:text-5xl">Oikos, maison d’Athènes</h1>
          <p className="mt-2 text-muted-foreground">
            Fraunces pour les titres, Inter pour le reste.
          </p>
        </div>
        <Button variant="secondary" onClick={toggle}>
          {theme === 'dark' ? 'light' : 'dark'}
        </Button>
      </header>
      <Frieze />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Section title="Button">
          <div className="flex flex-wrap items-center gap-2">
            <Button>primary</Button>
            <Button variant="secondary">secondary</Button>
            <Button variant="ghost">ghost</Button>
            <Button size="lg">lg</Button>
            <Button disabled>disabled</Button>
          </div>
        </Section>

        <Section title="Field">
          <Field label="Field" hint="hint" defaultValue="value" />
          <Field label="Field · error" error="error" defaultValue="value" />
        </Section>

        <Section title="Frieze">
          <Frieze tone="foreground" />
          <Frieze pattern="wave" tone="aegean" />
          <Frieze tone="accent" />
        </Section>

        <Section title="Tokens" wide>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {TOKENS.map((token) => (
              <li key={token} className="text-xs text-muted-foreground">
                <span
                  className="mb-1.5 block h-10 rounded-md ring-1 ring-border-subtle"
                  style={{ background: `var(--${token})` }}
                />
                {token}
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </main>
  );
}

const asked = new URLSearchParams(location.search).get('theme');
document.documentElement.dataset['theme'] =
  asked ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Catalogue />
  </StrictMode>,
);
