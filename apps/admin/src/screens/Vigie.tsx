import {
  Ban,
  Button,
  CircleAlert,
  CircleCheck,
  cn,
  Cpu,
  DataTable,
  EmptyState,
  Gauge,
  Hourglass,
  PageHeader,
  RefreshCw,
  ShieldCheck,
  type SortDirection,
  Sparkles,
  StatCard,
  StatGrid,
  Users,
} from '@oikos/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../LoadError';
import { ALERT, FRAME } from '../ui';
import { useAdmin } from '../useAdmin';
import { StaleReportsAlert } from './Moderation';
import { SectionTitle } from './SectionTitle';

interface VigieData {
  houses: number;
  activeAccounts24h: number;
  /** Commandes des joueurs eux-mêmes, hors opérations de leurs intendants (#563). */
  commands24h: { ok: number; rejected: number; failed: number };
  /** Opérations des intendants, comptées à part (#563) ; absent d'une API antérieure : rien n'est affiché. */
  stewardOperations24h?: { ok: number; rejected: number; failed: number };
  ticks24h: { failed: number; maxDurationMs: number | null };
  /**
   * Voyages encore en mer alors que le tick qui devait les décharger est terminé (4.6), tous mondes
   * confondus. `null` sans configuration en vigueur lisible ; absent d'une API antérieure : rien n'est affiché.
   */
  voyagesOverdue?: number | null;
  /**
   * Signalements ouverts depuis plus de `afterHours` (`moderation.staleReportHours`), et ancienneté du plus
   * ancien, en heures. `null` sans configuration lisible ; absent d'une API antérieure : rien n'est affiché.
   */
  staleReports?: { afterHours: number; count: number; oldestHours: number | null } | null;
  /** Absent d'une API antérieure à ce champ : rien n'est affiché à sa place. */
  closes24h?: { failed: number; lastError: string | null };
  recentTicks: {
    worldId: string;
    /** Nom du monde ; absent d'une API antérieure, ou monde disparu : l'identifiant abrégé le remplace. */
    worldSlug?: string | null;
    tickIndex: number;
    status: 'done' | 'skipped' | 'failed';
    durationMs: number;
    error: string | null;
    createdAt: string;
  }[];
  queuePending: number | null;
  refusals24h: {
    unauthenticated: number;
    payloadTooLarge: number;
    rateLimited: number;
    forbidden: number;
  };
  adminReads24h: number;
  /**
   * Fuseau de la configuration en vigueur, le même pour tous les mondes (`worlds` : leur nombre).
   * `null` sans configuration en vigueur ; absent d'une API antérieure : rien n'est affiché.
   * `invalidConfig` : version en vigueur hors du schéma, dont le fuseau est lu tel qu'enregistré
   * (`timezone` et `knownToDatabase` nuls s'il n'est pas une chaîne).
   */
  clock?: {
    timezone: string | null;
    knownToDatabase: boolean | null;
    worlds: number;
    invalidConfig?: boolean;
  } | null;
  /** Absent d'une API antérieure à ce champ : l'écran affiche alors un état inconnu, pas « Exigée ». */
  selfReviewAllowed?: boolean | null;
  /**
   * Passerelle IA (ADR 0005), un élément par usage, montants en millionièmes d'euro. `null` sans
   * configuration en vigueur lisible ; absent d'une API antérieure : rien n'est affiché.
   */
  ai?:
    | {
        usage: 'oracle' | 'chronicle' | 'steward';
        cut: 'disabled' | 'capped' | null;
        capMicroEuros: number;
        spentTodayMicroEuros: number;
        spentMonthMicroEuros: number;
        answeredMonth: number;
        rejectedMonth: number;
      }[]
    | null;
}

/** Seul un booléen rendu par l'API dit si la double validation est exigée ou levée. */
const review = (selfReviewAllowed: unknown) =>
  selfReviewAllowed === true
    ? 'reviewLifted'
    : selfReviewAllowed === false
      ? 'reviewRequired'
      : 'reviewUnknown';

/** Icône de chaque famille de chiffres. */
const GROUP_ICONS: Record<string, ReactNode> = {
  players: <Users />,
  engine: <Cpu />,
  api: <ShieldCheck />,
};

/** Module Vigie : joueurs, commandes, ticks et file de tâches (15.1). */
export function Vigie({ accessToken }: { accessToken: string }) {
  const { t, i18n } = useTranslation();
  const { data, error, reload } = useAdmin<VigieData>('vigie', accessToken);
  const number = new Intl.NumberFormat(i18n.language);
  const time = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'medium' });
  const euros = new Intl.NumberFormat(i18n.language, {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 4,
  });
  const cost = (microEuros: number) => euros.format(microEuros / 1_000_000);
  const duration = (ms: number | null) =>
    ms === null ? t('vigie.none') : t('vigie.duration', { ms: number.format(ms) });

  const clock = data?.clock;
  const timezone = (value: NonNullable<typeof clock>) =>
    value.timezone === null
      ? t('vigie.timezoneMissing')
      : value.knownToDatabase === false
        ? t('vigie.timezoneUnknownValue', { timezone: value.timezone })
        : value.timezone;

  type State = { tone: 'success' | 'warning' | 'danger'; icon: ReactNode };
  type Figure = [label: string, value: string, state?: State];
  // Les cartes d'échecs et de refus portent leur état par une icône et une teinte : à zéro, rien à signaler.
  const failing = (count: number): State =>
    count > 0
      ? { tone: 'danger', icon: <CircleAlert /> }
      : { tone: 'success', icon: <CircleCheck /> };
  const refusing = (count: number): State =>
    count > 0 ? { tone: 'warning', icon: <Ban /> } : { tone: 'success', icon: <CircleCheck /> };
  const none: Figure[] = [];
  const some = <T,>(when: boolean, items: T[]) => (when ? items : []);
  // Chiffres par famille ; l'état du service (dernière erreur, réglages en vigueur) se lit en clair, à part.
  const groups: { id: string; figures: Figure[] }[] = data
    ? [
        {
          id: 'players',
          figures: [
            [t('vigie.houses'), number.format(data.houses)],
            [t('vigie.activeAccounts'), number.format(data.activeAccounts24h)],
            [t('vigie.commandsOk'), number.format(data.commands24h.ok)],
            [
              t('vigie.commandsRejected'),
              number.format(data.commands24h.rejected),
              refusing(data.commands24h.rejected),
            ],
            [
              t('vigie.commandsFailed'),
              number.format(data.commands24h.failed),
              failing(data.commands24h.failed),
            ],
            ...(data.stewardOperations24h
              ? ([
                  [t('vigie.stewardOk'), number.format(data.stewardOperations24h.ok)],
                  [
                    t('vigie.stewardRejected'),
                    number.format(data.stewardOperations24h.rejected),
                    refusing(data.stewardOperations24h.rejected),
                  ],
                  [
                    t('vigie.stewardFailed'),
                    number.format(data.stewardOperations24h.failed),
                    failing(data.stewardOperations24h.failed),
                  ],
                ] as Figure[])
              : none),
          ],
        },
        {
          id: 'engine',
          figures: [
            [
              t('vigie.ticksFailed'),
              number.format(data.ticks24h.failed),
              failing(data.ticks24h.failed),
            ],
            [t('vigie.tickMax'), duration(data.ticks24h.maxDurationMs)],
            ...some<Figure>(data.voyagesOverdue !== undefined, [
              [
                t('vigie.voyagesOverdue'),
                data.voyagesOverdue == null
                  ? t('vigie.voyagesOverdueUnknown')
                  : number.format(data.voyagesOverdue),
              ],
            ]),
            ...some<Figure>(data.closes24h !== undefined, [
              [
                t('vigie.closesFailed'),
                number.format(data.closes24h?.failed ?? 0),
                failing(data.closes24h?.failed ?? 0),
              ],
            ]),
            [
              t('vigie.queue'),
              data.queuePending === null
                ? t('vigie.queueUnknown')
                : number.format(data.queuePending),
            ],
            ...some<Figure>(data.staleReports !== undefined, [
              [
                data.staleReports
                  ? t('vigie.staleReports', { hours: data.staleReports.afterHours })
                  : t('vigie.staleReportsUnknown'),
                data.staleReports ? number.format(data.staleReports.count) : t('vigie.none'),
              ],
            ]),
          ],
        },
        {
          id: 'api',
          figures: [
            [
              t('vigie.refusedUnauthenticated'),
              number.format(data.refusals24h.unauthenticated),
              refusing(data.refusals24h.unauthenticated),
            ],
            [
              t('vigie.refusedRateLimited'),
              number.format(data.refusals24h.rateLimited),
              refusing(data.refusals24h.rateLimited),
            ],
            [
              t('vigie.refusedTooLarge'),
              number.format(data.refusals24h.payloadTooLarge),
              refusing(data.refusals24h.payloadTooLarge),
            ],
            [
              t('vigie.refusedForbidden'),
              number.format(data.refusals24h.forbidden),
              refusing(data.refusals24h.forbidden),
            ],
            [t('vigie.adminReads'), number.format(data.adminReads24h)],
          ],
        },
      ]
    : [];
  const facts: Figure[] = data
    ? [
        ...some<Figure>(data.closes24h !== undefined, [
          [t('vigie.closeLastError'), data.closes24h?.lastError ?? t('vigie.none')],
        ]),
        [t('vigie.review'), t(`vigie.${review(data.selfReviewAllowed)}`)],
        ...some<Figure>(clock !== undefined, [
          [t('vigie.timezone'), clock ? timezone(clock) : t('vigie.timezoneNone')],
        ]),
      ]
    : [];
  const sorted = (header: string, direction: SortDirection) =>
    t('app.sorted', { column: header, direction: t(`app.${direction}`) });

  return (
    <>
      <PageHeader
        title={t('vigie.title')}
        subtitle={t('vigie.subtitle')}
        action={
          <Button
            variant="secondary"
            icon={<RefreshCw aria-hidden="true" />}
            onClick={() => void reload()}
          >
            {t('app.refresh')}
          </Button>
        }
      />
      {error && <LoadError code={error} onRetry={() => void reload()} />}
      {!data && !error && <p>{t('app.loading')}</p>}
      {/* Signalements ouverts au-delà du seuil de la configuration (15.5) : l'API les compte. */}
      {data?.staleReports && data.staleReports.count > 0 && (
        <StaleReportsAlert
          hours={data.staleReports.oldestHours ?? data.staleReports.afterHours}
          limit={data.staleReports.afterHours}
        />
      )}
      {/* Réglage d'un monde de test : mis en avant, il ne doit pas rester actif sans qu'on le voie. */}
      {data?.selfReviewAllowed === true && (
        <p className={ALERT}>{t('vigie.reviewLiftedWarning')}</p>
      )}
      {/* Version en vigueur hors du schéma : l'API et le moteur ne la chargent pas. */}
      {clock?.invalidConfig === true && (
        <p role="alert" className={ALERT}>
          {t('vigie.configInvalidWarning')}
        </p>
      )}
      {/* Fuseau sorti de la base : les comptes de tous les mondes perdent jour et saison (3). */}
      {clock?.knownToDatabase === false && (
        <p role="alert" className={cn(ALERT, 'wrap-anywhere')}>
          {clock.worlds > 0
            ? t('vigie.timezoneUnknownWarning', {
                timezone: clock.timezone,
                worlds: number.format(clock.worlds),
              })
            : t('vigie.timezoneUnknownWarningNoWorld', { timezone: clock.timezone })}
        </p>
      )}
      {groups.map(({ id, figures }) => (
        <section key={id} aria-labelledby={`vigie-${id}`} className="flex flex-col gap-3">
          <SectionTitle id={`vigie-${id}`} icon={GROUP_ICONS[id]}>
            {t(`vigie.groups.${id}`)}
          </SectionTitle>
          <StatGrid as="dl">
            {figures.map(([label, value, state]) => (
              <StatCard key={label} definition dense label={label} value={value} state={state} />
            ))}
          </StatGrid>
        </section>
      ))}
      {facts.length > 0 && (
        <section aria-labelledby="vigie-state" className="flex flex-col gap-3">
          <SectionTitle id="vigie-state" icon={<Gauge />}>
            {t('vigie.groups.state')}
          </SectionTitle>
          <dl className="divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface px-4 text-sm shadow-sm">
            {facts.map(([label, value]) => (
              <div key={label} className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 font-medium wrap-anywhere">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {data?.ai && (
        <section aria-labelledby="ai-gateway" className="flex flex-col gap-3">
          <SectionTitle id="ai-gateway" icon={<Sparkles />}>
            {t('vigie.ai.title')}
          </SectionTitle>
          <DataTable
            caption={t('vigie.ai.title')}
            className={FRAME}
            rows={data.ai}
            rowKey={(row) => row.usage}
            locale={i18n.language}
            sortAnnouncement={sorted}
            columns={[
              {
                id: 'usage',
                header: t('vigie.ai.usage'),
                cell: (row) => t(`vigie.ai.usages.${row.usage}`),
              },
              {
                id: 'state',
                header: t('vigie.ai.state'),
                cell: (row) => (
                  <span className={row.cut === 'capped' ? 'font-semibold text-danger' : undefined}>
                    {t(`vigie.ai.cut.${row.cut ?? 'open'}`)}
                  </span>
                ),
              },
              {
                id: 'today',
                header: t('vigie.ai.today'),
                numeric: true,
                cell: (row) => cost(row.spentTodayMicroEuros),
                sortValue: (row) => row.spentTodayMicroEuros,
              },
              {
                id: 'month',
                header: t('vigie.ai.month'),
                numeric: true,
                cell: (row) =>
                  t('vigie.ai.ofCap', {
                    spent: cost(row.spentMonthMicroEuros),
                    cap: cost(row.capMicroEuros),
                  }),
                sortValue: (row) => row.spentMonthMicroEuros,
              },
              {
                id: 'rejected',
                header: t('vigie.ai.rejected'),
                numeric: true,
                cell: (row) =>
                  t('vigie.ai.rejectedOf', {
                    rejected: number.format(row.rejectedMonth),
                    answered: number.format(row.answeredMonth),
                  }),
                sortValue: (row) => row.rejectedMonth,
              },
            ]}
          />
        </section>
      )}
      {data && (
        <section aria-labelledby="recent-ticks" className="flex flex-col gap-3">
          <SectionTitle id="recent-ticks" icon={<Hourglass />}>
            {t('vigie.recentTicks')}
          </SectionTitle>
          {data.recentTicks.length === 0 ? (
            <EmptyState compact illustration="noEntry" title={t('vigie.noTicks')} />
          ) : (
            <DataTable
              caption={t('vigie.recentTicks')}
              className={FRAME}
              rows={data.recentTicks}
              rowKey={(tick) => `${tick.worldId}:${tick.tickIndex}:${tick.createdAt}`}
              locale={i18n.language}
              sortAnnouncement={sorted}
              columns={[
                {
                  id: 'time',
                  header: t('vigie.time'),
                  cell: (tick) => time.format(new Date(tick.createdAt)),
                  sortValue: (tick) => tick.createdAt,
                },
                {
                  id: 'world',
                  header: t('vigie.world'),
                  // Le nom du monde ; l'identifiant abrégé seulement quand l'API ne le donne pas.
                  cell: (tick) =>
                    tick.worldSlug ? (
                      <span className="wrap-anywhere">{tick.worldSlug}</span>
                    ) : (
                      <code className="whitespace-nowrap">{tick.worldId.slice(0, 8)}</code>
                    ),
                  sortValue: (tick) => tick.worldSlug ?? tick.worldId,
                },
                {
                  id: 'tick',
                  header: t('vigie.tick'),
                  numeric: true,
                  cell: (tick) => tick.tickIndex,
                  sortValue: (tick) => tick.tickIndex,
                },
                {
                  id: 'status',
                  header: t('vigie.status'),
                  cell: (tick) => t(`vigie.tickStatus.${tick.status}`),
                  sortValue: (tick) => tick.status,
                },
                {
                  id: 'duration',
                  header: t('vigie.tickDuration'),
                  numeric: true,
                  cell: (tick) => duration(tick.durationMs),
                  sortValue: (tick) => tick.durationMs,
                },
                {
                  id: 'error',
                  header: t('vigie.error'),
                  cell: (tick) => <span className="wrap-anywhere">{tick.error ?? ''}</span>,
                },
              ]}
            />
          )}
        </section>
      )}
    </>
  );
}
