import { Button, cn, Hourglass, PageHeader, RefreshCw, Sparkles, StatCard } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../LoadError';
import { TABLE } from '../table';
import { ALERT } from '../ui';
import { useAdmin } from '../useAdmin';
import { StaleReportsAlert } from './Moderation';

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

  type Figure = [label: string, value: string];
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
            [t('vigie.commandsRejected'), number.format(data.commands24h.rejected)],
            [t('vigie.commandsFailed'), number.format(data.commands24h.failed)],
            ...(data.stewardOperations24h
              ? ([
                  [t('vigie.stewardOk'), number.format(data.stewardOperations24h.ok)],
                  [t('vigie.stewardRejected'), number.format(data.stewardOperations24h.rejected)],
                  [t('vigie.stewardFailed'), number.format(data.stewardOperations24h.failed)],
                ] as Figure[])
              : none),
          ],
        },
        {
          id: 'engine',
          figures: [
            [t('vigie.ticksFailed'), number.format(data.ticks24h.failed)],
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
              [t('vigie.closesFailed'), number.format(data.closes24h?.failed ?? 0)],
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
            [t('vigie.refusedUnauthenticated'), number.format(data.refusals24h.unauthenticated)],
            [t('vigie.refusedRateLimited'), number.format(data.refusals24h.rateLimited)],
            [t('vigie.refusedTooLarge'), number.format(data.refusals24h.payloadTooLarge)],
            [t('vigie.refusedForbidden'), number.format(data.refusals24h.forbidden)],
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
          <h2 id={`vigie-${id}`} className="text-base font-semibold">
            {t(`vigie.groups.${id}`)}
          </h2>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {figures.map(([label, value]) => (
              <StatCard key={label} definition dense label={label} value={value} />
            ))}
          </dl>
        </section>
      ))}
      {facts.length > 0 && (
        <section aria-labelledby="vigie-state" className="flex flex-col gap-3">
          <h2 id="vigie-state" className="text-base font-semibold">
            {t('vigie.groups.state')}
          </h2>
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
