import { marketPlaceOrderInputSchema } from '@oikos/contracts';
import { Button, Card } from '@oikos/ui';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { placeOrder } from '../api';
import { useRows } from '../data';
import { useHouse } from '../house';

/** Première tranche : un seul carnet, celui du blé de la cité de la maison. */
const GOOD_ID = 'wheat';
const CONTROL = 'min-h-11 w-full rounded-md border border-border bg-surface px-3';

interface Level {
  price: number;
  quantity: number;
}
interface Order {
  id: string;
  price: number;
  quantity: number;
  remaining: number;
}
type Notice = { kind: 'status' | 'alert'; text: string } | null;

/** Onglet Agora : carnet d'ordres agrégé, dépôt d'un ordre à cours limité, ventes en attente de la maison. */
export function AgoraScreen() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const market = { city_id: house.cityId, good_id: GOOD_ID };
  const book = useRows<Level>('order_book', 'price, quantity', 'price', {
    ...market,
    side: 'sell',
  });
  const mine = useRows<Order>('my_orders', 'id, price, quantity, remaining', 'created_at', {
    ...market,
    side: 'sell',
    status: 'open',
  });
  const [side, setSide] = useState<'sell' | 'buy'>('sell');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  // Intention en attente de réponse : la même saisie renvoyée après une panne réutilise sa clé, pour que
  // l'API rejoue l'ordre déjà déposé au lieu d'en déposer un second.
  const pending = useRef<{ intent: string; key: string } | null>(null);

  const number = new Intl.NumberFormat(i18n.language);
  const good = t(`goods.${GOOD_ID}`);

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Entiers écrits en chiffres seulement : `Number` accepterait aussi « 1e3 » ou « 0x10 ».
    const digits = /^\d+$/;
    const input = marketPlaceOrderInputSchema.safeParse({
      cityId: house.cityId,
      goodId: GOOD_ID,
      side,
      price: Number(price.trim()),
      quantity: Number(quantity.trim()),
    });
    if (!input.success || !digits.test(price.trim()) || !digits.test(quantity.trim()))
      return setNotice({ kind: 'alert', text: t('errors.VALIDATION_FAILED') });
    setBusy(true);
    setNotice(null);
    const intent = JSON.stringify(input.data);
    if (pending.current?.intent !== intent) pending.current = { intent, key: crypto.randomUUID() };
    const result = await placeOrder(input.data, house.accessToken, pending.current.key);
    // Sans réponse de l'API (`INTERNAL`), l'intention reste en attente : son issue est inconnue.
    if (result.ok || result.error.code !== 'INTERNAL') pending.current = null;
    let next: Notice;
    if (!result.ok) {
      next = { kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) };
    } else if (side === 'sell') {
      const values = { quantity: number.format(input.data.quantity), good };
      next = {
        kind: 'status',
        text: t('agora.placedSell', { ...values, price: number.format(input.data.price) }),
      };
    } else {
      const bought = result.data.trades.reduce((sum, trade) => sum + trade.quantity, 0);
      const cost = result.data.trades.reduce((sum, trade) => sum + trade.price * trade.quantity, 0);
      next = {
        kind: 'status',
        text:
          bought > 0
            ? t('agora.bought', {
                quantity: number.format(bought),
                good,
                cost: number.format(cost),
              })
            : t('agora.nothingBought'),
      };
    }
    // Carnet relu avant d'annoncer le résultat : quand le message paraît, le formulaire est de nouveau prêt.
    await Promise.all([book.reload(), mine.reload()]);
    setNotice(next);
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h1 className="text-2xl">{t('agora.title', { city: house.cityName })}</h1>
      </Card>
      {(book.failed || mine.failed) && <p role="alert">{t('app.loadFailed')}</p>}

      <Card>
        <h2 className="text-xl">{t('agora.book', { good })}</h2>
        {book.rows?.length === 0 ? (
          <p className="text-muted-foreground">{t('agora.bookEmpty')}</p>
        ) : (
          <table className="w-full text-left">
            <caption className="text-left text-sm text-muted-foreground">
              {t('agora.bookCaption')}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('agora.price')}</th>
                <th scope="col">{t('agora.offered')}</th>
              </tr>
            </thead>
            <tbody>
              {book.rows?.map((level) => (
                <tr key={level.price}>
                  <td>{number.format(level.price)}</td>
                  <td>{number.format(level.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <form onSubmit={submit} noValidate className="flex flex-col gap-2">
          <h2 className="text-xl">{t('agora.place')}</h2>
          <label htmlFor="side">{t('agora.side')}</label>
          <select
            className={CONTROL}
            id="side"
            value={side}
            onChange={(event) => setSide(event.target.value === 'buy' ? 'buy' : 'sell')}
          >
            <option value="sell">{t('agora.sell')}</option>
            <option value="buy">{t('agora.buy')}</option>
          </select>
          <label htmlFor="price">{t('agora.limitPrice')}</label>
          <input
            className={CONTROL}
            id="price"
            inputMode="numeric"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
          <label htmlFor="quantity">{t('agora.quantity')}</label>
          <input
            className={CONTROL}
            id="quantity"
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
          <Button type="submit" disabled={busy}>
            {t('agora.submit')}
          </Button>
          {/* Toujours présent : un lecteur d'écran annonce le résultat dès qu'il apparaît. */}
          <p
            role={notice?.kind ?? 'status'}
            className={notice?.kind === 'alert' ? 'font-semibold text-danger' : ''}
          >
            {notice?.text}
          </p>
        </form>
      </Card>

      <Card>
        <h2 className="text-xl">{t('agora.myOrders')}</h2>
        {mine.rows?.length === 0 && (
          <p className="text-muted-foreground">{t('agora.myOrdersEmpty')}</p>
        )}
        <ul>
          {mine.rows?.map((order) => (
            <li key={order.id}>
              {t('agora.myOrder', {
                remaining: number.format(order.remaining),
                quantity: number.format(order.quantity),
                price: number.format(order.price),
              })}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
