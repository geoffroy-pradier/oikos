import { marketPlaceOrderInputSchema } from '@oikos/contracts';
import { Button, Card } from '@oikos/ui';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cancelOrder, placeOrder } from '../api';
import { useRows } from '../data';
import { useHouse } from '../house';
import fr from '../locales/fr.json';

/**
 * Biens proposés : ceux qui ont un nom (un test tient les traductions alignées sur la configuration).
 * L'API fait foi : un bien absent de la configuration en vigueur est refusé.
 */
const GOOD_IDS = Object.keys(fr.goods);
const DEFAULT_GOOD = 'wheat';
const CONTROL = 'min-h-11 w-full rounded-md border border-border bg-surface px-3';

interface Level {
  price: number;
  quantity: number;
}
interface Order {
  id: string;
  good_id: string;
  price: number;
  quantity: number;
  remaining: number;
}
type Notice = { kind: 'status' | 'alert'; text: string } | null;

/** Onglet Agora : carnet d'ordres agrégé, dépôt d'un ordre à cours limité, ventes en attente de la maison. */
export function AgoraScreen() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const [goodId, setGoodId] = useState(DEFAULT_GOOD);
  const book = useRows<Level>('order_book', 'price, quantity', 'price', {
    city_id: house.cityId,
    good_id: goodId,
    side: 'sell',
  });
  // Toutes les ventes en attente de la maison dans cette cité, quel que soit le bien affiché.
  const mine = useRows<Order>(
    'my_orders',
    'id, good_id, price, quantity, remaining',
    'created_at',
    {
      city_id: house.cityId,
      side: 'sell',
      status: 'open',
    },
  );
  const [side, setSide] = useState<'sell' | 'buy'>('sell');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  // Intentions en attente de réponse, chacune avec sa clé : la même saisie renvoyée après une panne
  // réutilise la sienne, pour que l'API rejoue l'ordre déjà déposé au lieu d'en déposer un second.
  // Une autre action entre-temps (une annulation, un autre ordre) ne la fait pas oublier.
  const pending = useRef(new Map<string, string>());
  const keyFor = (intent: string) => {
    const known = pending.current.get(intent);
    if (known) return known;
    const key = crypto.randomUUID();
    pending.current.set(intent, key);
    return key;
  };

  const number = new Intl.NumberFormat(i18n.language);
  const good = t(`goods.${goodId}`);

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Entiers écrits en chiffres seulement : `Number` accepterait aussi « 1e3 » ou « 0x10 ».
    const digits = /^\d+$/;
    const input = marketPlaceOrderInputSchema.safeParse({
      cityId: house.cityId,
      goodId,
      side,
      price: Number(price.trim()),
      quantity: Number(quantity.trim()),
    });
    if (!input.success || !digits.test(price.trim()) || !digits.test(quantity.trim()))
      return setNotice({ kind: 'alert', text: t('errors.VALIDATION_FAILED') });
    setBusy(true);
    setNotice(null);
    const intent = `place:${JSON.stringify(input.data)}`;
    const result = await placeOrder(input.data, house.accessToken, keyFor(intent));
    // Sans réponse de l'API (`INTERNAL`), l'intention reste en attente : son issue est inconnue.
    if (result.ok || result.error.code !== 'INTERNAL') pending.current.delete(intent);
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
          bought === 0
            ? t('agora.nothingBought', { good })
            : t(bought < input.data.quantity ? 'agora.boughtPartly' : 'agora.bought', {
                quantity: number.format(bought),
                wanted: number.format(input.data.quantity),
                good,
                cost: number.format(cost),
              }),
      };
    }
    // Carnet relu avant d'annoncer le résultat : quand le message paraît, le formulaire est de nouveau prêt.
    await Promise.all([book.reload(), mine.reload()]);
    setNotice(next);
    setBusy(false);
  }

  async function cancel(order: Order) {
    setBusy(true);
    setNotice(null);
    const intent = `cancel:${order.id}`;
    const result = await cancelOrder(order.id, house.accessToken, keyFor(intent));
    if (result.ok || result.error.code !== 'INTERNAL') pending.current.delete(intent);
    const next: Notice = result.ok
      ? {
          kind: 'status',
          text: t('agora.cancelled', {
            quantity: number.format(result.data.released),
            good: t(`goods.${order.good_id}`),
          }),
        }
      : { kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) };
    await Promise.all([book.reload(), mine.reload()]);
    setNotice(next);
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h1 className="text-2xl">{t('agora.title', { city: house.cityName })}</h1>
        <label htmlFor="good">{t('agora.good')}</label>
        <select
          className={CONTROL}
          id="good"
          value={goodId}
          // Pas de changement de bien pendant qu'une commande est en route : son résultat et le carnet
          // relu ensuite portent sur le bien affiché.
          disabled={busy}
          onChange={(event) => {
            setGoodId(event.target.value);
            setNotice(null);
          }}
        >
          {GOOD_IDS.map((id) => (
            <option key={id} value={id}>
              {t(`goods.${id}`)}
            </option>
          ))}
        </select>
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
          <h2 className="text-xl">{t('agora.place', { good })}</h2>
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
        </form>
      </Card>

      {/* Toujours présent : un lecteur d'écran annonce le résultat dès qu'il apparaît. */}
      <p
        role={notice?.kind ?? 'status'}
        className={notice?.kind === 'alert' ? 'font-semibold text-danger' : ''}
      >
        {notice?.text}
      </p>

      <Card>
        <h2 className="text-xl">{t('agora.myOrders')}</h2>
        {mine.rows?.length === 0 && (
          <p className="text-muted-foreground">{t('agora.myOrdersEmpty')}</p>
        )}
        <ul className="flex flex-col gap-2">
          {mine.rows?.map((order) => {
            const values = {
              good: t(`goods.${order.good_id}`),
              remaining: number.format(order.remaining),
              quantity: number.format(order.quantity),
              price: number.format(order.price),
            };
            return (
              <li key={order.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{t('agora.myOrder', values)}</span>
                <Button
                  variant="secondary"
                  disabled={busy}
                  aria-label={t('agora.cancelOrder', values)}
                  onClick={() => void cancel(order)}
                >
                  {t('agora.cancel')}
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
