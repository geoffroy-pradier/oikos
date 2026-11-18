import {
  Badge,
  Card,
  Coins,
  EmptyState,
  Frieze,
  Landmark,
  Package,
  Stat,
  Warehouse,
} from '@oikos/ui';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useRows } from '../data';
import { useHouse } from '../house';
import { stockByCity } from '../site-rules';
import { HouseAlerts } from './HouseAlerts';
import { SitesCard } from './Sites';
import { useMoney } from '../money';
import { LoadProblem, Loading } from './LoadProblem';

interface Treasury {
  balance: number;
}
/** Un voyage de la maison (vue `my_voyages`) : ce qui est en mer n'est dans aucun stock (4.6). */
interface Voyage {
  id: string;
  to_city_id: string;
  arrived_at: string | null;
  cargo: { goodId: string; quantity: number }[];
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
  const voyages = useRows<Voyage>('my_voyages', 'id, to_city_id, arrived_at, cargo', 'departed_at');
  const atSea = (voyages.rows ?? []).filter(
    (voyage) => voyage.arrived_at === null && voyage.cargo.length > 0,
  );

  const number = new Intl.NumberFormat(i18n.language);
  const money = useMoney();
  // Un bien ou une recette ajoutés par le back-office sans traduction s'affichent par leur identifiant.
  const goodName = (id: string) => t(`goods.${id}`, { defaultValue: id });
  const failed = treasury.failed || stock.failed || orders.failed || voyages.failed;
  const groups = stockByCity(stock.rows ?? [], house.cityId);
  const titled = atSea.length > 0 || groups.some(({ cityId }) => cityId !== house.cityId);

  return (
    <div className="flex flex-col gap-4">
      <Card elevation="raised" className="overflow-hidden p-0">
        <Frieze tone="accent" />
        <div className="flex flex-wrap items-center justify-between gap-2 p-4">
          <h1 className="text-2xl">{t('home.title', { name: house.name })}</h1>
          <Badge
            tone={house.citizenshipStatus === 'citizen' ? 'success' : 'aegean'}
            icon={<Landmark aria-hidden="true" />}
          >
            {t(`home.status.${house.citizenshipStatus}`, { city: house.cityName })}
          </Badge>
        </div>
      </Card>
      {failed && (
        <LoadProblem
          onRetry={() =>
            Promise.all([treasury.reload(), stock.reload(), orders.reload(), voyages.reload()])
          }
        />
      )}

      <HouseAlerts />

      <Card className="flex flex-col gap-3">
        <h2 className="text-xl">{t('home.treasury')}</h2>
        {treasury.rows === null && !treasury.failed && <Loading />}
        {treasury.rows?.map((account) => (
          <Stat
            key="balance"
            icon={<Coins />}
            label={t('home.balanceLabel')}
            value={t('home.balance', { amount: money(account.balance) })}
            hint={held > 0 ? t('home.held', { amount: money(held) }) : undefined}
          />
        ))}
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
            <Link to="/agora" className="underline underline-offset-4">
              {t('home.toAgora')}
            </Link>
          </p>
        )}
        <nav
          aria-label={t('home.sectionsNav')}
          className="flex flex-wrap gap-x-4 border-t border-border-subtle pt-2"
        >
          <Link
            to="/comptes"
            className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
          >
            {t('home.accounts')}
          </Link>
          <Link
            to="/personnel"
            className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
          >
            {t('home.staffLink')}
          </Link>
          <Link
            to="/immobilier"
            className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
          >
            {t('home.propertyLink')}
          </Link>
        </nav>
      </Card>

      <Card>
        <h2 className="flex items-center gap-2 text-xl">
          <Warehouse aria-hidden="true" className="size-5 text-accent" />
          {t('home.stock')}
        </h2>
        {stock.rows === null && !stock.failed && <Loading />}
        {stock.rows?.length === 0 && atSea.length === 0 && (
          <EmptyState icon={<Package />} title={t('home.stockEmpty')} headingLevel={3} />
        )}
        {/* Une seule cité, celle de la maison : pas de titre. Sinon chaque cité a le sien. */}
        {groups.map(({ cityId, lines }) => (
          <section key={cityId} aria-labelledby={titled ? `stock-${cityId}` : undefined}>
            {titled && (
              <h3 id={`stock-${cityId}`} className="mt-2 font-semibold">
                {t('home.stockCity', { city: house.cityNames[cityId] ?? cityId })}
              </h3>
            )}
            <ul className="divide-y divide-border-subtle">
              {lines.map((line) => (
                <li key={line.id} className="py-1.5">
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
        {/* Cargaisons en mer, par voyage : elles entreront dans le stock de la cité d'arrivée. */}
        {atSea.map((voyage) => (
          <section key={voyage.id} aria-labelledby={`sea-${voyage.id}`}>
            <h3 id={`sea-${voyage.id}`} className="mt-2 font-semibold">
              {t('home.atSea', { city: house.cityNames[voyage.to_city_id] ?? voyage.to_city_id })}
            </h3>
            <ul className="divide-y divide-border-subtle">
              {voyage.cargo.map((line) => (
                <li key={line.goodId} className="py-1.5">
                  {t('home.stockLine', {
                    good: goodName(line.goodId),
                    quantity: number.format(line.quantity),
                  })}
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
