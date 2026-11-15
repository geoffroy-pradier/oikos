import { Button } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../LoadError';
import { TABLE } from '../table';
import { useAdmin } from '../useAdmin';

interface VigieData {
  houses: number;
  activeAccounts24h: number;
  commands24h: { ok: number; rejected: number; failed: number };
  ticks24h: { failed: number; maxDurationMs: number | null };
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
   * `null` sans configuration en vigueur lisible ; absent d'une API antérieure : rien n'est affiché.
   */
  clock?: { timezone: string; knownToDatabase: boolean; worlds: number } | null;
  /** Absent d'une API antérieure à ce champ : l'écran affiche alors un état inconnu, pas « Exigée ». */
  selfReviewAllowed?: boolean | null;
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
  const duration = (ms: number | null) =>
    ms === null ? t('vigie.none') : t('vigie.duration', { ms: number.format(ms) });

  const clock = data?.clock;
  const timezone = (value: NonNullable<typeof clock>) =>
    value.knownToDatabase
      ? value.timezone
      : t('vigie.timezoneUnknownValue', { timezone: value.timezone });

  const figures: [string, string][] = data
    ? [
        [t('vigie.houses'), number.format(data.houses)],
        [t('vigie.activeAccounts'), number.format(data.activeAccounts24h)],
        [t('vigie.commandsOk'), number.format(data.commands24h.ok)],
        [t('vigie.commandsRejected'), number.format(data.commands24h.rejected)],
        [t('vigie.commandsFailed'), number.format(data.commands24h.failed)],
        [t('vigie.ticksFailed'), number.format(data.ticks24h.failed)],
        [t('vigie.tickMax'), duration(data.ticks24h.maxDurationMs)],
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
        <Button variant="secondary" onClick={() => void reload()}>
          {t('app.refresh')}
        </Button>
      </div>
      {error && <LoadError code={error} onRetry={() => void reload()} />}
      {!data && !error && <p>{t('app.loading')}</p>}
      {/* Réglage d'un monde de test : mis en avant, il ne doit pas rester actif sans qu'on le voie. */}
      {data?.selfReviewAllowed === true && (
        <p className="rounded-md border border-danger p-3 font-semibold text-danger">
          {t('vigie.reviewLiftedWarning')}
        </p>
      )}
      {/* Fuseau sorti de la base des fuseaux : les comptes de tous les mondes perdent jour et saison (3). */}
      {clock?.knownToDatabase === false && (
        <p className="rounded-md border border-danger p-3 font-semibold wrap-anywhere text-danger">
          {t('vigie.timezoneUnknownWarning', {
            timezone: clock.timezone,
            worlds: number.format(clock.worlds),
          })}
        </p>
      )}
      {data && (
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {figures.map(([label, value]) => (
            <div key={label} className="rounded-md border border-border p-3">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-2xl font-semibold wrap-anywhere">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {data && (
        <>
          <h2 id="recent-ticks" className="text-xl">
            {t('vigie.recentTicks')}
          </h2>
          {data.recentTicks.length === 0 ? (
            <p className="text-muted-foreground">{t('vigie.noTicks')}</p>
          ) : (
            <div className="overflow-x-auto">
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
