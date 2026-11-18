import { Button, Hourglass, RefreshCw, Sparkles } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../LoadError';
import { TABLE } from '../table';
import { useAdmin } from '../useAdmin';
import { StaleReportsAlert } from './Moderation';

interface VigieData {
  houses: number;
  activeAccounts24h: number;
  commands24h: { ok: number; rejected: number; failed: number };
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

/** Module Vigie : joueurs, commandes, ticks et file de tâches (15.1). */
export function Vigie({ accessToken }: { accessToken: string }) {
  const { t, i18n } = useTranslation();
  const { data, error, reload } = useAdmin<VigieData>('vigie', accessToken);
  const number = new Intl.NumberFormat(i18n.language);
  const time = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'medium' });
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

  const figures: [string, string][] = data
    ? [
        [t('vigie.houses'), number.format(data.houses)],
        [t('vigie.activeAccounts'), number.format(data.activeAccounts24h)],
        [t('vigie.commandsOk'), number.format(data.commands24h.ok)],
        [t('vigie.commandsRejected'), number.format(data.commands24h.rejected)],
        [t('vigie.commandsFailed'), number.format(data.commands24h.failed)],
        [t('vigie.ticksFailed'), number.format(data.ticks24h.failed)],
        [t('vigie.tickMax'), duration(data.ticks24h.maxDurationMs)],
        ...(data.voyagesOverdue === undefined
          ? []
          : ([
              [
                t('vigie.voyagesOverdue'),
                data.voyagesOverdue === null
                  ? t('vigie.voyagesOverdueUnknown')
                  : number.format(data.voyagesOverdue),
              ],
            ] as [string, string][])),
        ...(data.staleReports === undefined
          ? []
          : ([
              [
                data.staleReports === null
                  ? t('vigie.staleReportsUnknown')
                  : t('vigie.staleReports', { hours: data.staleReports.afterHours }),
                data.staleReports === null
                  ? t('vigie.none')
                  : number.format(data.staleReports.count),
              ],
            ] as [string, string][])),
        ...(data.closes24h
          ? ([
              [t('vigie.closesFailed'), number.format(data.closes24h.failed)],
              [t('vigie.closeLastError'), data.closes24h.lastError ?? t('vigie.none')],
            ] as [string, string][])
          : []),
        [
          t('vigie.queue'),
          data.queuePending === null ? t('vigie.queueUnknown') : number.format(data.queuePending),
        ],
        [t('vigie.refusedUnauthenticated'), number.format(data.refusals24h.unauthenticated)],
        [t('vigie.refusedRateLimited'), number.format(data.refusals24h.rateLimited)],
        [t('vigie.refusedTooLarge'), number.format(data.refusals24h.payloadTooLarge)],
        [t('vigie.refusedForbidden'), number.format(data.refusals24h.forbidden)],
        [t('vigie.adminReads'), number.format(data.adminReads24h)],
        [t('vigie.review'), t(`vigie.${review(data.selfReviewAllowed)}`)],
        ...(clock === undefined
          ? []
          : ([
              [t('vigie.timezone'), clock === null ? t('vigie.timezoneNone') : timezone(clock)],
            ] as [string, string][])),
      ]
    : [];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl">{t('vigie.title')}</h1>
        <Button
          variant="secondary"
          icon={<RefreshCw aria-hidden="true" />}
          onClick={() => void reload()}
        >
          {t('app.refresh')}
        </Button>
      </div>
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
        <p className="rounded-md border border-danger p-3 font-semibold text-danger">
          {t('vigie.reviewLiftedWarning')}
        </p>
      )}
      {/* Version en vigueur hors du schéma : l'API et le moteur ne la chargent pas. */}
      {clock?.invalidConfig === true && (
        <p role="alert" className="rounded-md border border-danger p-3 font-semibold text-danger">
          {t('vigie.configInvalidWarning')}
        </p>
      )}
      {/* Fuseau sorti de la base des fuseaux : les comptes de tous les mondes perdent jour et saison (3). */}
      {clock?.knownToDatabase === false && (
        <p
          role="alert"
          className="rounded-md border border-danger p-3 font-semibold wrap-anywhere text-danger"
        >
          {clock.worlds > 0
            ? t('vigie.timezoneUnknownWarning', {
                timezone: clock.timezone,
                worlds: number.format(clock.worlds),
              })
            : t('vigie.timezoneUnknownWarningNoWorld', { timezone: clock.timezone })}
        </p>
      )}
      {data && (
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {figures.map(([label, value]) => (
            <div
              key={label}
              className="min-w-0 rounded-lg border border-border-subtle bg-muted/40 p-3 shadow-sm"
            >
              <dt className="eyebrow">{label}</dt>
              <dd className="mt-1 font-display text-2xl font-semibold tabular-nums wrap-anywhere">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {data?.ai && (
        <>
          <h2 id="ai-gateway" className="text-xl">
            <Sparkles
              aria-hidden="true"
              className="mr-2 inline size-5 align-[-0.15em] text-accent"
            />
            {t('vigie.ai.title')}
          </h2>
          {/* Région focalisable : à 360 px, le tableau défile aussi au clavier. */}
          <div className="overflow-x-auto" role="region" aria-labelledby="ai-gateway" tabIndex={0}>
            <table aria-labelledby="ai-gateway" className={TABLE}>
              <thead>
                <tr>
                  <th scope="col">{t('vigie.ai.usage')}</th>
                  <th scope="col">{t('vigie.ai.state')}</th>
                  <th scope="col">{t('vigie.ai.today')}</th>
                  <th scope="col">{t('vigie.ai.month')}</th>
                  <th scope="col">{t('vigie.ai.rejected')}</th>
                </tr>
              </thead>
              <tbody>
                {data.ai.map((row) => (
                  <tr key={row.usage}>
                    <th scope="row">{t(`vigie.ai.usages.${row.usage}`)}</th>
                    <td className={row.cut === 'capped' ? 'font-semibold text-danger' : undefined}>
                      {t(`vigie.ai.cut.${row.cut ?? 'open'}`)}
                    </td>
                    <td>{cost(row.spentTodayMicroEuros)}</td>
                    <td>
                      {t('vigie.ai.ofCap', {
                        spent: cost(row.spentMonthMicroEuros),
                        cap: cost(row.capMicroEuros),
                      })}
                    </td>
                    <td>
                      {t('vigie.ai.rejectedOf', {
                        rejected: number.format(row.rejectedMonth),
                        answered: number.format(row.answeredMonth),
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {data && (
        <>
          <h2 id="recent-ticks" className="text-xl">
            <Hourglass
              aria-hidden="true"
              className="mr-2 inline size-5 align-[-0.15em] text-accent"
            />
            {t('vigie.recentTicks')}
          </h2>
          {data.recentTicks.length === 0 ? (
            <p className="text-muted-foreground">{t('vigie.noTicks')}</p>
          ) : (
            <div
              className="overflow-x-auto"
              role="region"
              aria-labelledby="recent-ticks"
              tabIndex={0}
            >
              <table aria-labelledby="recent-ticks" className={TABLE}>
                <thead>
                  <tr>
                    <th scope="col">{t('vigie.time')}</th>
                    <th scope="col">{t('vigie.world')}</th>
                    <th scope="col">{t('vigie.tick')}</th>
                    <th scope="col">{t('vigie.status')}</th>
                    <th scope="col">{t('vigie.tickDuration')}</th>
                    <th scope="col">{t('vigie.error')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentTicks.map((tick) => (
                    <tr key={`${tick.worldId}:${tick.tickIndex}:${tick.createdAt}`}>
                      <td>{time.format(new Date(tick.createdAt))}</td>
                      <td>
                        <code className="whitespace-nowrap">{tick.worldId.slice(0, 8)}</code>
                      </td>
                      <td>{tick.tickIndex}</td>
                      <td>{t(`vigie.tickStatus.${tick.status}`)}</td>
                      <td>{duration(tick.durationMs)}</td>
                      <td>{tick.error ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
