import type { AdminEconomy } from '@oikos/contracts';
import { Button } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../LoadError';
import { TABLE } from '../table';
import { useAdmin } from '../useAdmin';

type Account = AdminEconomy['worlds'][number]['systemAccounts'][number];
const DAY_MS = 86_400_000;
const BOX = 'rounded-md border p-3';

/**
 * Module Économie (15.1 ; 5.5) : par monde, indice des prix et inflation, masse monétaire, robinets et
 * puits. Montants en oboles, nets : un montant négatif est affiché tel quel, avec son signe. Hors de la
 * cible, l'inflation est annoncée par une alerte écrite, jamais par la seule couleur ; une mesure
 * absente est dite telle, jamais remplacée par un zéro.
 */
export function Economy({ accessToken }: { accessToken: string }) {
  const { t, i18n } = useTranslation();
  const { data, error, reload } = useAdmin<AdminEconomy>('economy', accessToken);
  const number = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });
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
  const amounts = (caption: string, rows: [string, number][], total = false) => (
    <table className={TABLE}>
      <caption className="text-left text-lg">{caption}</caption>
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

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl">{t('economy.title')}</h1>
        <Button variant="secondary" onClick={() => void reload()}>
          {t('app.refresh')}
        </Button>
      </div>
      {error && <LoadError code={error} onRetry={() => void reload()} />}
      {!data && !error && <p>{t('app.loading')}</p>}
      {data && <p className="text-sm text-muted-foreground">{t('economy.intro')}</p>}
      {data?.worlds.map(({ worldId, slug, moneySupply, systemAccounts, priceIndex: index }) => {
        const { min, max } = data.inflationTargetBps;
        const target = { days: data.priceWindowDays, min: share(min), max: share(max) };
        const or = (bps: number | null, shown: (known: number) => string) =>
          bps === null ? t('economy.status.unknown') : shown(bps);
        const per100 = (bps: number | null) => or(bps, (known) => number.format(known / 100));
        const inflation = or(index.inflationBps, (known) => share(known, 'exceptZero'));
        const goods = list.format(index.unpricedGoods);
        const status = t(`economy.status.${index.status}`, target);
        const { other, total, ...parts } = moneySupply;
        const supply = Object.entries({ ...parts, ...(other !== 0 && { other }), total });
        const moving = systemAccounts.filter((account) => account.days.length > 0);
        const days = [...new Set(moving.flatMap((account) => account.days.map((d) => d.gameDay)))];
        days.sort((a, b) => b - a);
        const on = (account: Account, day: number) =>
          account.days.find((candidate) => candidate.gameDay === day)?.amount;
        return (
          <section key={worldId} className="flex flex-col gap-3">
            <h2 className="text-xl">{t('economy.world', { slug })}</h2>
            {(index.status === 'above' || index.status === 'below') && (
              <p role="alert" className={`${BOX} border-danger font-semibold text-danger`}>
                {t('economy.alert', { ...target, inflation, status })}
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
            {/* Panier vide : lu dans la réponse, jamais déduit d'une liste de biens vide. */}
            {index.status === 'unknown' && data.basketEmpty && <p>{t('economy.noBasket')}</p>}
            {index.status === 'unknown' && !data.basketEmpty && goods && (
              <p>{t('economy.unpriced', { goods })}</p>
            )}
            {amounts(
              t('economy.supply.title'),
              supply.map(([part, amount]) => [t(`economy.supply.${part}`), amount]),
              true,
            )}
            {amounts(
              t('economy.totals'),
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
