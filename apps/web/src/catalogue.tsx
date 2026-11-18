/**
 * Catalogue de composants, consultable en local : `pnpm dev` puis http://localhost:5173/catalogue.html
 * (`?theme=dark` pour le thème sombre). Outil de développement, absent de la construction de production ;
 * ses libellés d'exemple ne sont pas des textes d'interface du jeu.
 */
import * as ui from '@oikos/ui';
import {
  Amphora,
  Badge,
  Button,
  Card,
  Coins,
  CONTRAST_PAIRS,
  EmptyState,
  Field,
  Frieze,
  Moon,
  Plus,
  Ship,
  Skeleton,
  Stat,
  Sun,
  Tabs,
  Wheat,
} from '@oikos/ui';
import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const TOKENS = [...new Set(CONTRAST_PAIRS.flatMap(([fg, bg]) => [fg, bg]))];
const ICONS = Object.entries(ui).filter(
  (entry): entry is [string, ui.Icon] => typeof entry[1] === 'object' && 'render' in entry[1],
);
const TONES = ['neutral', 'primary', 'accent', 'aegean', 'success', 'danger'] as const;

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
        <Button variant="secondary" icon={theme === 'dark' ? <Sun /> : <Moon />} onClick={toggle}>
          {theme === 'dark' ? 'light' : 'dark'}
        </Button>
      </header>
      <Frieze />

      <Card elevation="raised" className="grid grid-cols-2 gap-6 p-6 md:grid-cols-4">
        <Stat
          label="Trésorerie"
          icon={<Coins />}
          value="1 248 dr."
          delta={{ value: '+4,2 %', trend: 'up' }}
          hint="depuis hier"
        />
        <Stat
          label="Production"
          icon={<Wheat />}
          value="312"
          delta={{ value: '−8 %', trend: 'down' }}
        />
        <Stat
          label="Navires en mer"
          icon={<Ship />}
          value="4"
          delta={{ value: '0', trend: 'flat' }}
        />
        <Stat
          label="Charges"
          icon={<Amphora />}
          value="96 dr."
          delta={{ value: '+3 %', trend: 'up', tone: 'negative' }}
        />
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Section title="Button">
          <div className="flex flex-wrap gap-2">
            <Button icon={<Plus />}>primary</Button>
            <Button variant="secondary">secondary</Button>
            <Button variant="ghost">ghost</Button>
            <Button variant="danger">danger</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">sm</Button>
            <Button size="lg">lg</Button>
            <Button size="icon" variant="secondary" icon={<Ship />} aria-label="icon" />
            <Button loading>loading</Button>
            <Button disabled>disabled</Button>
          </div>
        </Section>

        <Section title="Badge · Field">
          <div className="flex flex-wrap gap-2">
            {TONES.map((tone) => (
              <Badge key={tone} tone={tone}>
                {tone}
              </Badge>
            ))}
          </div>
          <Field label="Field" hint="hint" defaultValue="value" />
          <Field label="Field · error" error="error" defaultValue="value" />
        </Section>

        <Section title="Tabs">
          <Tabs
            label="Tabs"
            items={['Agora', 'Contrats', 'Fret'].map((id) => ({
              id,
              label: id,
              content: (
                <p className="text-muted-foreground">Panneau {id} : flèches, Début et Fin.</p>
              ),
            }))}
          />
        </Section>

        <Section title="Skeleton">
          <div role="status" aria-label="loading" className="flex items-center gap-4">
            <Skeleton round className="size-12 shrink-0" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="w-2/3" />
              <Skeleton className="w-1/2" />
              <Skeleton className="h-8 w-full" />
            </div>
          </div>
        </Section>

        <Section title="EmptyState">
          <EmptyState
            icon={<Ship />}
            title="Aucun navire au port"
            description="Le chantier naval vend chaque classe à son prix."
            action={<Button icon={<Plus />}>Ouvrir le chantier</Button>}
          />
        </Section>

        <Section title="Icons · Frieze">
          <ul className="grid grid-cols-8 gap-3 text-muted-foreground">
            {ICONS.map(([name, Icon]) => (
              <li key={name} title={name}>
                <Icon aria-hidden="true" className="size-5" />
              </li>
            ))}
          </ul>
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
