/**
 * Catalogue de composants, consultable en local : `pnpm dev` puis http://localhost:5173/catalogue.html.
 * Outil de développement, absent de la construction de production ; ses libellés d'exemple ne sont pas
 * des textes d'interface du jeu.
 */
import { Button, Card, CONTRAST_PAIRS, Field } from '@oikos/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const THEMES = ['light', 'dark'] as const;
const VARIANTS = ['primary', 'secondary', 'ghost'] as const;
const TOKENS = [
  ...new Set(CONTRAST_PAIRS.flatMap(([foreground, background]) => [foreground, background])),
];

function Specimen({ theme }: { theme: (typeof THEMES)[number] }) {
  return (
    <section data-theme={theme} className="flex flex-col gap-6 bg-background p-6 text-foreground">
      <h2 className="text-2xl">{theme}</h2>
      <div className="meander" aria-hidden="true" />

      <div className="flex flex-wrap gap-2">
        {VARIANTS.map((variant) => (
          <Button key={variant} variant={variant}>
            {variant}
          </Button>
        ))}
        <Button size="lg">lg</Button>
        <Button disabled>disabled</Button>
      </div>

      <Card className="flex max-w-md flex-col gap-3">
        <h3 className="text-xl">Card</h3>
        <Field label="Field" hint="hint" defaultValue="value" />
        <Field label="Field · error" error="error" defaultValue="value" />
      </Card>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TOKENS.map((token) => (
          <li key={token} className="rounded-md border border-border p-2 text-sm">
            <span className="mb-1 block h-8 rounded" style={{ background: `var(--${token})` }} />
            {token}
          </li>
        ))}
      </ul>
    </section>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <h1 className="p-6 text-3xl">@oikos/ui</h1>
    <div className="grid lg:grid-cols-2">
      {THEMES.map((theme) => (
        <Specimen key={theme} theme={theme} />
      ))}
    </div>
  </StrictMode>,
);
