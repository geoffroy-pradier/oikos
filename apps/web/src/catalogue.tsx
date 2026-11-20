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
  COLOR_TOKENS,
  DataTable,
  Dialog,
  EmptyState,
  IconButton,
  Moon,
  NumberField,
  Package,
  PillTabs,
  Plus,
  PageHeader,
  Progress,
  SegmentedControl,
  Select,
  Settings,
  Sheet,
  Ship,
  Skeleton,
  Stat,
  StatCard,
  StatusRegion,
  Stepper,
  Store,
  Sun,
  Switch,
  TextField,
  Wheat,
  X,
} from '@oikos/ui';
import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import fr from './locales/fr.json';
import './styles.css';

const ICONS = Object.entries(ui).filter(
  (entry): entry is [string, ui.Icon] => typeof entry[1] === 'object' && 'render' in entry[1],
);
const STOCKS = [
  { good: 'Huile', quantity: 120, value: 2_400 },
  { good: 'Blé', quantity: 800, value: 1_600 },
  { good: 'Vin', quantity: 45, value: null },
];
const TONES = ['neutral', 'primary', 'success', 'warning', 'danger', 'info'] as const;

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

/** Feuille et boîte de dialogue, ouvertes par un bouton ; `?sheet` ouvre la feuille d'emblée (captures). */
function Overlays() {
  const [sheet, setSheet] = useState(new URLSearchParams(location.search).has('sheet'));
  const [dialog, setDialog] = useState(false);
  const [done, setDone] = useState('');
  return (
    <div className="flex flex-wrap gap-2">
      <Button icon={<Store />} onClick={() => setSheet(true)}>
        Sheet
      </Button>
      <Button variant="secondary" onClick={() => setDialog(true)}>
        Dialog
      </Button>
      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Vendre du vin"
        description="Agora d’Athènes · 45 amphores en stock"
        closeLabel="Fermer"
      >
        <Stepper
          labels={{
            progress: 'Étapes',
            back: 'Retour',
            next: 'Continuer',
            confirm: 'Vendre',
            stepOf: (current, total) => `Étape ${current} sur ${total}`,
          }}
          onConfirm={() => setDone('Ordre passé : 20 amphores à 14 oboles.')}
          steps={[
            {
              id: 'quantity',
              title: 'Quantité',
              content: (
                <NumberField
                  label="Amphores"
                  locale="fr"
                  labels={fr.controls}
                  defaultValue={20}
                  min={1}
                  max={45}
                />
              ),
            },
            {
              id: 'price',
              title: 'Prix',
              content: (
                <NumberField
                  label="Prix unitaire (oboles)"
                  locale="fr"
                  labels={fr.controls}
                  defaultValue={14}
                  min={1}
                />
              ),
            },
            {
              id: 'summary',
              title: 'Récapitulatif',
              content: (
                <dl className="grid grid-cols-2 gap-y-1 text-sm tabular-nums">
                  <dt className="text-muted-foreground">Quantité</dt>
                  <dd className="text-right">20 amphores</dd>
                  <dt className="text-muted-foreground">Total</dt>
                  <dd className="text-right font-semibold">280 oboles</dd>
                </dl>
              ),
            },
          ]}
        />
        <StatusRegion tone="success" className="mt-4">
          {done}
        </StatusRegion>
      </Sheet>
      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Démolir l’atelier ?"
        description="Les stocks restent dans l’entrepôt. Rien n’est remboursé."
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialog(false)}>
              Annuler
            </Button>
            <Button variant="danger" onClick={() => setDialog(false)}>
              Démolir
            </Button>
          </>
        }
      />
    </div>
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
          <p className="eyebrow">@oikos/ui · ADR 0011</p>
          <h1 className="text-4xl sm:text-5xl">Oikos, maison d’Athènes</h1>
          <p className="mt-2 text-foreground-secondary">Inter seule, un seul accent orange.</p>
          <p className="text-muted-foreground tabular-nums">0123456789 · 1 248 dr. 5 ob.</p>
        </div>
        <Button variant="secondary" icon={theme === 'dark' ? <Sun /> : <Moon />} onClick={toggle}>
          {theme === 'dark' ? 'light' : 'dark'}
        </Button>
      </header>

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Trésorerie"
          icon={<Coins />}
          value="1 248 dr."
          delta={{ value: '+4,2 %', trend: 'up' }}
          hint="depuis hier"
        />
        <StatCard
          label="Production"
          icon={<Wheat />}
          value="312"
          delta={{ value: '−8 %', trend: 'down' }}
        />
        <StatCard label="Navires en mer" icon={<Ship />} value="4" />
        <StatCard
          label="Charges"
          icon={<Amphora />}
          value="96 dr."
          delta={{ value: '+3 %', trend: 'up', tone: 'negative' }}
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Section title="DataTable" wide>
          <DataTable
            caption="DataTable"
            rows={STOCKS}
            rowKey={(row) => row.good}
            defaultSort={{ column: 'value', direction: 'descending' }}
            sortAnnouncement={(header, direction) => `${header} · ${direction}`}
            columns={[
              { id: 'good', header: 'Bien', cell: (r) => r.good, sortValue: (r) => r.good },
              {
                id: 'quantity',
                header: 'Quantité',
                numeric: true,
                cell: (r) => r.quantity,
                sortValue: (r) => r.quantity,
              },
              {
                id: 'value',
                header: 'Valeur',
                numeric: true,
                cell: (r) => (r.value === null ? '—' : `${r.value} ob.`),
                sortValue: (r) => r.value,
              },
            ]}
          />
        </Section>

        <Section title="Sheet · Dialog">
          <Overlays />
        </Section>

        <Section title="PageHeader" wide>
          <PageHeader
            title="Agora de Kallistè"
            subtitle="Il est 14:05 · prochaine clôture à 04:00"
            action={<Button icon={<Plus />}>Passer un ordre</Button>}
          />
        </Section>
        <Section title="Progress · StatusRegion">
          <Progress label="Moisson" value={3} max={5} valueText="3 jours sur 5" />
          <StatusRegion tone="success">Ordre passé : 20 amphores de vin.</StatusRegion>
          <StatusRegion role="alert" tone="danger">
            Trésorerie insuffisante.
          </StatusRegion>
        </Section>

        <Section title="Button · IconButton">
          <div className="flex flex-wrap gap-2">
            <Button icon={<Plus />}>primary</Button>
            <Button variant="secondary">secondary</Button>
            <Button variant="ghost">ghost</Button>
            <Button variant="danger">danger</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">sm</Button>
            <Button size="lg">lg</Button>
            <Button loading>loading</Button>
            <Button disabled>disabled</Button>
            <Button variant="secondary" inactive>
              inactive
            </Button>
            <Button variant="secondary" icon={<Ship />} loading>
              loading
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <IconButton label="ghost" icon={<X />} />
            <IconButton label="secondary" variant="secondary" icon={<Settings />} />
            <IconButton label="primary" variant="primary" icon={<Plus />} />
            <IconButton label="loading" variant="secondary" icon={<Ship />} loading />
          </div>
        </Section>

        <Section title="TextField · Select">
          <TextField label="TextField" hint="hint" placeholder="placeholder" />
          <TextField label="TextField · error" error="error" defaultValue="value" />
          <Select label="Select" hint="hint" defaultValue="corinth">
            <option value="athens">Athènes</option>
            <option value="corinth">Corinthe</option>
          </Select>
          <TextField label="TextField · disabled" disabled defaultValue="value" />
        </Section>

        <Section title="NumberField">
          <NumberField
            label="NumberField"
            hint="0 – 1 250"
            locale="fr"
            defaultValue={300}
            min={0}
            max={1_250}
            step={10}
            labels={fr.controls}
            messages={{
              ...fr.controls,
              belowMin: fr.controls.belowMin.replace('{{min}}', '0'),
              aboveMax: fr.controls.aboveMax.replace('{{max}}', '1 250'),
            }}
          />
          <NumberField label="NumberField · error" locale="fr" labels={fr.controls} error="error" />
        </Section>

        <Section title="Switch · Badge">
          <Switch label="Switch" hint="hint" defaultChecked />
          <Switch label="Switch · off" />
          <Switch label="Switch · disabled" disabled />
          <div className="flex flex-wrap gap-2">
            {TONES.map((tone) => (
              <Badge key={tone} tone={tone}>
                {tone}
              </Badge>
            ))}
          </div>
        </Section>

        <Section title="PillTabs · SegmentedControl">
          <PillTabs
            label="PillTabs"
            items={['Agora', 'Contrats', 'Fret'].map((id) => ({
              id,
              label: id,
              content: (
                <p className="text-muted-foreground">Panneau {id} : flèches, Début et Fin.</p>
              ),
            }))}
          />
          <SegmentedControl
            label="SegmentedControl"
            options={[
              { value: 'sell', label: 'Vendre', icon: <Coins /> },
              { value: 'buy', label: 'Acheter', icon: <Package /> },
            ]}
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

        <Section title="Icons">
          <ul className="grid grid-cols-8 gap-3 text-muted-foreground">
            {ICONS.map(([name, Icon]) => (
              <li key={name} title={name}>
                <Icon aria-hidden="true" className="size-5" />
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Tokens" wide>
          {/* Les deux thèmes côte à côte, quel que soit celui de la page. */}
          <div className="grid gap-4 lg:grid-cols-2">
            {['light', 'dark'].map((name) => (
              <div
                key={name}
                data-theme={name}
                className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-background p-4 text-foreground"
              >
                <h3 className="eyebrow">{name}</h3>
                {Object.entries(COLOR_TOKENS).map(([group, tokens]) => (
                  <ul
                    key={group}
                    aria-label={group}
                    className="grid grid-cols-3 gap-3 sm:grid-cols-4"
                  >
                    {tokens.map((token) => (
                      <li key={token} className="text-xs break-words text-muted-foreground">
                        <span
                          className="mb-1.5 block h-10 rounded-md ring-1 ring-border-subtle"
                          style={{ background: `var(--${token})` }}
                        />
                        {token}
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
            ))}
          </div>
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
