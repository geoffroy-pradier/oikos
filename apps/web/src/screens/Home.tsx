import { Card } from '@oikos/ui';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useRows } from '../data';
import { useHouse } from '../house';
import { stockByCity } from '../site-rules';
import { SitesCard } from './Sites';
import { useMoney } from '../money';
import { LoadProblem, Loading } from './LoadProblem';

interface Treasury {
  balance: number;
}
interface Inventory {
  id: string;
  city_id: string;
  good_id: string;
  quantity: number;
  reserved: number;
}

/** Onglet Maison : trésorerie, entrepôt et sites de la maison (`SitesCard`). */
export function HomeScreen() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const treasury = useRows<Treasury>('my_treasury', 'balance', 'house_id');
  // Ordres ouverts à l'agora. Le prix des achats (prix limite × reste) est retenu hors de la trésorerie.
  const orders = useRows<{ side: 'buy' | 'sell'; price: number; remaining: number }>(
    'my_orders',
    'side, price, remaining',
    'created_at',
    { status: 'open' },
  );
  const buys = (orders.rows ?? []).filter((order) => order.side === 'buy');
  const sells = (orders.rows ?? []).filter((order) => order.side === 'sell');
  const held = buys.reduce((sum, order) => sum + order.price * order.remaining, 0);
  const stock = useRows<Inventory>(
    'my_inventories',
    'id, city_id, good_id, quantity, reserved',
    'good_id',
  );

  const number = new Intl.NumberFormat(i18n.language);
  const money = useMoney();
  // Un bien ou une recette ajoutés par le back-office sans traduction s'affichent par leur identifiant.
  const goodName = (id: string) => t(`goods.${id}`, { defaultValue: id });
  const failed = treasury.failed || stock.failed || orders.failed;
  const groups = stockByCity(stock.rows ?? [], house.cityId);
  const titled = groups.some(({ cityId }) => cityId !== house.cityId);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h1 className="text-2xl">{t('home.title', { name: house.name })}</h1>
        <p className="text-muted-foreground">
          {t(`home.status.${house.citizenshipStatus}`, { city: house.cityName })}
        </p>
      </Card>
      {failed && (
        <LoadProblem
          onRetry={() => Promise.all([treasury.reload(), stock.reload(), orders.reload()])}
        />
      )}

      <Card>
        <h2 className="text-xl">{t('home.treasury')}</h2>
        {treasury.rows === null && !treasury.failed && <Loading />}
        {treasury.rows?.map((account) => (
          <p key="balance" className="text-2xl font-semibold">
            {t('home.balance', { amount: money(account.balance) })}
          </p>
        ))}
        {held > 0 && (
          <p className="text-muted-foreground">{t('home.held', { amount: money(held) })}</p>
        )}
        {orders.rows === null && !orders.failed && <Loading />}
        {orders.rows && (
          <p>
            {orders.rows.length === 0
              ? t('home.openOrdersNone')
              : t('home.openOrders', {
                  buys: t('home.openBuys', {
                    count: buys.length,
                    number: number.format(buys.length),
                  }),
                  sells: t('home.openSells', {
                    count: sells.length,
                    number: number.format(sells.length),
                  }),
                })}{' '}
            <Link to="/agora" className="underline">
              {t('home.toAgora')}
            </Link>
          </p>
        )}
        <Link
          to="/comptes"
          className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
        >
          {t('home.accounts')}
        </Link>
      </Card>

      <Card>
        <h2 className="text-xl">{t('home.stock')}</h2>
        {stock.rows === null && !stock.failed && <Loading />}
        {stock.rows?.length === 0 && (
          <p className="text-muted-foreground">{t('home.stockEmpty')}</p>
        )}
        {/* Une seule cité, celle de la maison : pas de titre. Sinon chaque cité a le sien. */}
        {groups.map(({ cityId, lines }) => (
          <section key={cityId} aria-labelledby={titled ? `stock-${cityId}` : undefined}>
            {titled && (
              <h3 id={`stock-${cityId}`} className="mt-2 font-semibold">
                {t('home.stockCity', { city: house.cityNames[cityId] ?? cityId })}
              </h3>
            )}
            <ul>
              {lines.map((line) => (
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
          </section>
        ))}
      </Card>

      <SitesCard
        stock={stock.rows}
        onChanged={() => Promise.all([treasury.reload(), stock.reload()])}
      />
    </div>
  );
}
