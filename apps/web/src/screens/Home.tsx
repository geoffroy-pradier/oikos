import { Card } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import { useRows } from '../data';
import { useHouse } from '../house';
import { SitesCard } from './Sites';
import { useMoney } from '../money';

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
  // Achats en attente à l'agora : leur prix (prix limite × reste) est retenu hors de la trésorerie.
  const buys = useRows<{ price: number; remaining: number }>(
    'my_orders',
    'price, remaining',
    'created_at',
    { side: 'buy', status: 'open' },
  );
  const held = (buys.rows ?? []).reduce((sum, order) => sum + order.price * order.remaining, 0);
  const stock = useRows<Inventory>(
    'my_inventories',
    'id, city_id, good_id, quantity, reserved',
    'good_id',
  );

  const number = new Intl.NumberFormat(i18n.language);
  const money = useMoney();
  // Un bien ou une recette ajoutés par le back-office sans traduction s'affichent par leur identifiant.
  const goodName = (id: string) => t(`goods.${id}`, { defaultValue: id });
  const failed = treasury.failed || stock.failed || buys.failed;

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
            {t('home.balance', { amount: money(account.balance) })}
          </p>
        ))}
        {held > 0 && (
          <p className="text-muted-foreground">{t('home.held', { amount: money(held) })}</p>
        )}
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

      <SitesCard
        stock={stock.rows}
        onChanged={() => Promise.all([treasury.reload(), stock.reload()])}
      />
    </div>
  );
}
