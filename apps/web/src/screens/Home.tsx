import { Button, Card } from '@oikos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collectSite } from '../api';
import { useRows } from '../data';
import { useHouse } from '../house';

interface Treasury {
  balance: number;
}
interface Inventory {
  id: string;
  good_id: string;
  quantity: number;
  reserved: number;
}
interface Site {
  id: string;
  recipe_id: string;
  cycle_started_at: string;
}
type Notice = { kind: 'status' | 'alert'; text: string } | null;

/** Onglet Maison : trésorerie, entrepôt et sites de la maison, avec la récolte de chaque site. */
export function HomeScreen() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const treasury = useRows<Treasury>('my_treasury', 'balance', 'house_id');
  const stock = useRows<Inventory>('my_inventories', 'id, good_id, quantity, reserved', 'good_id');
  const sites = useRows<Site>('my_sites', 'id, recipe_id, cycle_started_at', 'cycle_started_at');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const number = new Intl.NumberFormat(i18n.language);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  // Un bien ou une recette ajoutés par le back-office sans traduction s'affichent par leur identifiant.
  const goodName = (id: string) => t(`goods.${id}`, { defaultValue: id });
  const failed = treasury.failed || stock.failed || sites.failed;

  async function collect(site: Site) {
    setBusy(site.id);
    setNotice(null);
    const result = await collectSite(site.id, house.accessToken);
    if (result.ok) {
      const list = result.data.outputs
        .map((stack) =>
          t('home.stack', {
            quantity: number.format(stack.quantity),
            good: goodName(stack.goodId),
          }),
        )
        .join(', ');
      setNotice({ kind: 'status', text: t('home.collected', { list }) });
      await Promise.all([stock.reload(), sites.reload()]);
    } else {
      setNotice({ kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) });
    }
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h1 className="text-2xl">{t('home.title', { name: house.name })}</h1>
        <p className="text-muted-foreground">
          {t(`home.status.${house.citizenshipStatus}`, { city: house.cityName })}
        </p>
      </Card>
      {failed && <p role="alert">{t('app.loadFailed')}</p>}

      <Card>
        <h2 className="text-xl">{t('home.treasury')}</h2>
        {treasury.rows?.map((account) => (
          <p key="balance" className="text-2xl font-semibold">
            {t('home.balance', { amount: number.format(account.balance) })}
          </p>
        ))}
      </Card>

      <Card>
        <h2 className="text-xl">{t('home.stock')}</h2>
        {stock.rows?.length === 0 && (
          <p className="text-muted-foreground">{t('home.stockEmpty')}</p>
        )}
        <ul>
          {stock.rows?.map((line) => (
            <li key={line.id}>
              {t('home.stockLine', {
                good: goodName(line.good_id),
                quantity: number.format(line.quantity),
              })}
              {line.reserved > 0 && (
                <span className="text-muted-foreground">
                  {' '}
                  ({t('home.stockReserved', { reserved: number.format(line.reserved) })})
                </span>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-xl">{t('home.sites')}</h2>
        {sites.rows?.length === 0 && (
          <p className="text-muted-foreground">{t('home.sitesEmpty')}</p>
        )}
        <ul className="flex flex-col gap-3">
          {sites.rows?.map((site) => {
            const name = t(`recipes.${site.recipe_id}`, { defaultValue: site.recipe_id });
            return (
              <li key={site.id} className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-lg">{name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t('home.siteSince', { date: date.format(new Date(site.cycle_started_at)) })}
                  </p>
                </div>
                <Button
                  disabled={busy !== null}
                  aria-label={t('home.collectSite', { site: name })}
                  onClick={() => void collect(site)}
                >
                  {t('home.collect')}
                </Button>
              </li>
            );
          })}
        </ul>
        {/* Toujours présent : un lecteur d'écran annonce le résultat dès qu'il apparaît. */}
        <p
          role={notice?.kind ?? 'status'}
          className={notice?.kind === 'alert' ? 'font-semibold text-danger' : ''}
        >
          {notice?.text}
        </p>
      </Card>
    </div>
  );
}
