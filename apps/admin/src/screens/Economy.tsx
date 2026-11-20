import type { AdminEconomy } from '@oikos/contracts';
import {
  Button,
  CalendarDays,
  Card,
  ChevronRight,
  cn,
  Coins,
  EmptyState,
  Globe,
  type Icon,
  PageHeader,
  RefreshCw,
  Scale,
  StatCard,
  StatGrid,
} from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../LoadError';
import { TABLE } from '../table';
import { ALERT } from '../ui';
import { useAdmin } from '../useAdmin';
import { DailyFlows, SinkShares } from './EconomyCharts';
import { SectionTitle } from './SectionTitle';

type World = AdminEconomy['worlds'][number];
type Account = World['systemAccounts'][number];
const DAY_MS = 86_400_000;
const outOfTarget = ({ priceIndex }: World) =>
  priceIndex.status === 'above' || priceIndex.status === 'below';

/**
 * Module Économie (15.1 ; 5.5) : par monde, indice des prix et inflation, masse monétaire, robinets et
 * puits. Montants en oboles, nets : un montant négatif est affiché tel quel, avec son signe. Hors de la
 * cible, l'inflation est annoncée par une alerte écrite, jamais par la seule couleur ; une mesure
 * absente est dite telle, jamais remplacée par un zéro. Avec plusieurs mondes, les alertes sont
 * rappelées en tête de page, chacune avec un lien vers son monde.
 */
export function Economy({ accessToken }: { accessToken: string }) {
  const { t, i18n } = useTranslation();
  const { data, error, reload } = useAdmin<AdminEconomy>('economy', accessToken);
  const number = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });
  // Indice : toujours ses deux décimales (points de base ÷ 100), 100,00 compris.
  const index100 = new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 2 });
  // Points de base rendus en pourcentage : 10 000 font 100 %.
  const share = (bps: number, signDisplay: 'auto' | 'exceptZero' = 'auto') => {
    const options = { style: 'percent', maximumFractionDigits: 2, signDisplay } as const;
    return new Intl.NumberFormat(i18n.language, options).format(bps / 10_000);
  };
  // Date civile d'un jour de jeu : son rang en jours depuis 1970, à lire en temps universel.
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' });
  const date = (gameDay: number) => dates.format(new Date(gameDay * DAY_MS));
  const list = new Intl.ListFormat(i18n.language, { type: 'conjunction' });
  // Compte système inconnu de l'écran (ajouté au catalogue depuis) : sa clé, plutôt que rien.
  const name = ({ key, kind }: Account) =>
    t(`economy.kind.${kind}`, { name: t(`economy.accounts.${key}`, { defaultValue: key }) });
  /** Tableau à deux colonnes, intitulé et montant ; `total` met la dernière ligne en avant. */
  const amounts = (
    caption: string,
    Glyph: Icon,
    slug: string,
    rows: [string, number][],
    total = false,
  ) => (
    <Card className="px-3 pt-3 pb-1 lg:px-4 lg:pt-4">
      <table className={cn(TABLE, '[&_th]:font-normal')}>
        <caption className="pb-2 text-left text-lg font-semibold">
          <span className="flex items-center gap-2">
            <Glyph aria-hidden="true" className="size-5 shrink-0 text-accent" />
            <span>
              {caption}
              <span className="sr-only">{t('economy.ofWorld', { slug })}</span>
            </span>
          </span>
        </caption>
        <tbody>
          {rows.map(([label, amount], row) => (
            <tr
              key={label}
              className={
                total && row === rows.length - 1 ? 'font-semibold [&_th]:font-semibold' : ''
              }
            >
              <th scope="row" className="wrap-anywhere">
                {label}
              </th>
              <td className="text-right tabular-nums">{number.format(amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
  const header = (
    <>
      <PageHeader
        title={t('economy.title')}
        subtitle={data && t('economy.intro')}
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
      {/* Un « Actualiser » en échec laisse la lecture précédente à l'écran : il le dit. */}
      {error && data && <p className="text-sm font-semibold">{t('economy.stale')}</p>}
    </>
  );
  if (!data) {
    return (
      <>
        {header}
        {!error && <p>{t('app.loading')}</p>}
      </>
    );
  }

  const { min, max } = data.inflationTargetBps;
  // `count` accorde les intitulés au nombre de jours d'une fenêtre de prix (« 1 jour »).
  const target = { count: data.priceWindowDays, min: share(min), max: share(max) };
  const known = (bps: number | null, shown: (value: number) => string) =>
    bps === null ? t('economy.status.unknown') : shown(bps);
  const inflationOf = ({ priceIndex }: World) =>
    known(priceIndex.inflationBps, (value) => share(value, 'exceptZero'));
  const statusOf = ({ priceIndex }: World) => t(`economy.status.${priceIndex.status}`, target);
  const alerts = data.worlds.filter(outOfTarget);
  return (
    <>
      {header}
      {data.worlds.length > 1 && alerts.length > 0 && (
        <section aria-labelledby="economy-alerts" className={cn(ALERT, 'font-normal')}>
          <h2 id="economy-alerts" className="text-sm font-semibold">
            {t('economy.alerts', { count: alerts.length })}
          </h2>
          <ul className="list-disc pl-5">
            {alerts.map((world) => (
              <li key={world.worldId} className="wrap-anywhere">
                <a href={`#world-${world.worldId}`} className="underline">
                  {t('economy.world', { slug: world.slug })}
                </a>
                {t('economy.alertItem', { inflation: inflationOf(world), status: statusOf(world) })}
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.worlds.map((world) => {
        const { worldId, slug, moneySupply, systemAccounts, priceIndex: index } = world;
        const per100 = (bps: number | null) => known(bps, (value) => index100.format(value / 100));
        const [inflation, status] = [inflationOf(world), statusOf(world)];
        const partial = index.partialWindow && t(`economy.partial.${index.partialWindow}`, target);
        // Fenêtres sans échange d'un bien, nommées pour chacun (la courante d'abord).
        const { current, previous } = index.unpricedByWindow;
        const windows = (good: string) =>
          list.format(
            Object.entries({ current, previous })
              .filter(([, goods]) => goods.includes(good))
              .map(([window]) => t(`economy.window.${window}`, target)),
          );
        const { other, total, ...parts } = moneySupply;
        const supply = Object.entries({ ...parts, ...(other !== 0 && { other }), total });
        const moving = systemAccounts.filter((account) => account.days.length > 0);
        const days = [...new Set(moving.flatMap((account) => account.days.map((d) => d.gameDay)))];
        days.sort((a, b) => b - a);
        const on = (account: Account, day: number) =>
          account.days.find((candidate) => candidate.gameDay === day)?.amount;
        const flows = days.map((gameDay) => {
          const sum = (kind: Account['kind']) =>
            moving
              .filter((account) => account.kind === kind)
              .reduce((total, account) => total + (on(account, gameDay) ?? 0), 0);
          return { gameDay, faucets: sum('faucet'), sinks: sum('sink') };
        });
        const sinks = systemAccounts
          .filter((account) => account.kind === 'sink')
          .map(({ key, total }) => ({
            name: t(`economy.accounts.${key}`, { defaultValue: key }),
            total,
          }));
        return (
          <section key={worldId} id={`world-${worldId}`} className="flex flex-col gap-4">
            <Card className="p-3">
              <SectionTitle icon={<Globe />} className="wrap-anywhere">
                {t('economy.world', { slug })}
              </SectionTitle>
            </Card>
            {outOfTarget(world) && (
              <p role="alert" className={ALERT}>
                {t('economy.alert', { ...target, inflation, status })}
                {partial && ` ${partial}`}
              </p>
            )}
            <StatGrid as="dl">
              {[
                [t('economy.indexCurrent', target), per100(index.currentBps)],
                [t('economy.indexPrevious', target), per100(index.previousBps)],
                [t('economy.inflation', target), inflation],
                [t('economy.statusLabel'), status],
              ].map(([label, value]) => (
                <StatCard key={label} definition dense label={label} value={value} />
              ))}
            </StatGrid>
            {partial && <p className="text-sm">{partial}</p>}
            {/* Panier vide : lu dans la réponse, jamais déduit d'une liste de biens vide. */}
            {index.status === 'unknown' && data.basketEmpty && <p>{t('economy.noBasket')}</p>}
            {index.status === 'unknown' && !data.basketEmpty && index.unpricedGoods.length > 0 && (
              <div className="rounded-xl bg-surface-raised p-4 text-sm">
                <p className="mb-1 font-medium">{t('economy.unpriced')}</p>
                <ul className="list-disc pl-5">
                  {index.unpricedGoods.map((good) => (
                    <li key={good} className="wrap-anywhere">
                      {t('economy.unpricedGood', { good, windows: windows(good) })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {flows.length > 0 && (
              <div className="grid items-start gap-4 lg:grid-cols-3">
                <div className="min-w-0 lg:col-span-2">
                  <DailyFlows days={flows} date={date} caption={t('economy.chart.title')} />
                </div>
                <SinkShares sinks={sinks} />
              </div>
            )}
            <div className="grid items-start gap-4 lg:grid-cols-2">
              {amounts(
                t('economy.supply.title'),
                Coins,
                slug,
                supply.map(([part, amount]) => [t(`economy.supply.${part}`), amount]),
                true,
              )}
              {amounts(
                t('economy.totals'),
                Scale,
                slug,
                systemAccounts.map((account) => [name(account), account.total]),
              )}
            </div>
            <Card className="flex flex-col gap-3 lg:p-5">
              <SectionTitle as="h3" icon={<CalendarDays />}>
                {t('economy.byDay', { count: data.windowDays })}
              </SectionTitle>
              {days.length === 0 ? (
                <EmptyState compact illustration="noEntry" title={t('economy.noDays')} />
              ) : (
                // Détail par compte, replié : le dessin et son tableau donnent déjà les totaux du jour.
                <details className="group">
                  <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg text-sm font-medium text-accent">
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 transition-transform duration-(--motion-fast) group-open:rotate-90"
                    />
                    {t('economy.dayDetail')}
                  </summary>
                  {/* Une fiche par jour de jeu, du plus récent au plus ancien : empilées sur téléphone, en grille au-delà. */}
                  <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {days.map((day) => (
                      <li
                        key={day}
                        className="rounded-xl border border-border-subtle bg-surface-raised p-4 text-sm"
                      >
                        <h4 className="mb-2 font-semibold">{date(day)}</h4>
                        <dl className="flex flex-col gap-1 tabular-nums [&_dd]:whitespace-nowrap">
                          {moving
                            .filter((account) => on(account, day) !== undefined)
                            .map((account) => (
                              <div key={account.key} className="flex justify-between gap-x-4">
                                <dt className="min-w-0 text-foreground-secondary wrap-anywhere">
                                  {name(account)}
                                </dt>
                                <dd>{number.format(on(account, day) ?? 0)}</dd>
                              </div>
                            ))}
                        </dl>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          </section>
        );
      })}
    </>
  );
}
