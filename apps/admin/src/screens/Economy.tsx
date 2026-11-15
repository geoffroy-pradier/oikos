import type { AdminEconomy } from '@oikos/contracts';
import { Button } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../LoadError';
import { TABLE } from '../table';
import { useAdmin } from '../useAdmin';

type World = AdminEconomy['worlds'][number];
type Account = World['systemAccounts'][number];
const DAY_MS = 86_400_000;
const BOX = 'rounded-md border p-3';
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
  const amounts = (caption: string, slug: string, rows: [string, number][], total = false) => (
    <table className={TABLE}>
      <caption className="text-left text-lg">
        {caption}
        <span className="sr-only">{t('economy.ofWorld', { slug })}</span>
      </caption>
      <tbody>
        {rows.map(([label, amount], row) => (
          <tr key={label} className={total && row === rows.length - 1 ? 'font-semibold' : ''}>
            <th scope="row" className="wrap-anywhere">
              {label}
            </th>
            <td className="text-right">{number.format(amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  const header = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl">{t('economy.title')}</h1>
        <Button variant="secondary" onClick={() => void reload()}>
          {t('app.refresh')}
        </Button>
      </div>
      {error && <LoadError code={error} onRetry={() => void reload()} />}
      {/* Un « Actualiser » en échec laisse la lecture précédente à l'écran : il le dit. */}
      {error && data && <p className="font-semibold">{t('economy.stale')}</p>}
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
      <p className="text-sm text-muted-foreground">{t('economy.intro')}</p>
      {data.worlds.length > 1 && alerts.length > 0 && (
        <section aria-labelledby="economy-alerts" className={`${BOX} border-danger`}>
          <h2 id="economy-alerts" className="font-semibold text-danger">
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
        return (
          <section key={worldId} id={`world-${worldId}`} className="flex flex-col gap-3">
            <h2 className="text-xl wrap-anywhere">{t('economy.world', { slug })}</h2>
            {outOfTarget(world) && (
              <p role="alert" className={`${BOX} border-danger font-semibold text-danger`}>
                {t('economy.alert', { ...target, inflation, status })}
                {partial && ` ${partial}`}
              </p>
            )}
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [t('economy.indexCurrent', target), per100(index.currentBps)],
                [t('economy.indexPrevious', target), per100(index.previousBps)],
                [t('economy.inflation', target), inflation],
                [t('economy.statusLabel'), status],
              ].map(([label, value]) => (
                <div key={label} className={`${BOX} border-border`}>
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="text-2xl font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            {partial && <p>{partial}</p>}
            {/* Panier vide : lu dans la réponse, jamais déduit d'une liste de biens vide. */}
            {index.status === 'unknown' && data.basketEmpty && <p>{t('economy.noBasket')}</p>}
            {index.status === 'unknown' && !data.basketEmpty && index.unpricedGoods.length > 0 && (
              <div>
                <p>{t('economy.unpriced')}</p>
                <ul className="list-disc pl-5">
                  {index.unpricedGoods.map((good) => (
                    <li key={good} className="wrap-anywhere">
                      {t('economy.unpricedGood', { good, windows: windows(good) })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {amounts(
              t('economy.supply.title'),
              slug,
              supply.map(([part, amount]) => [t(`economy.supply.${part}`), amount]),
              true,
            )}
            {amounts(
              t('economy.totals'),
              slug,
              systemAccounts.map((account) => [name(account), account.total]),
            )}
            <h3 className="text-lg">{t('economy.byDay', { count: data.windowDays })}</h3>
            {days.length === 0 ? (
              <p className="text-muted-foreground">{t('economy.noDays')}</p>
            ) : (
              // Une fiche par jour de jeu, du plus récent au plus ancien : empilées sur téléphone, en grille au-delà.
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {days.map((day) => (
                  <li key={day} className={`${BOX} border-border`}>
                    <h4 className="font-semibold">{date(day)}</h4>
                    <dl className="[&_dd]:whitespace-nowrap">
                      {moving
                        .filter((account) => on(account, day) !== undefined)
                        .map((account) => (
                          <div key={account.key} className="flex justify-between gap-x-4">
                            <dt className="min-w-0 wrap-anywhere">{name(account)}</dt>
                            <dd>{number.format(on(account, day) ?? 0)}</dd>
                          </div>
                        ))}
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}
