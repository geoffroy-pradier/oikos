import { marketPlaceOrderInputSchema } from '@oikos/contracts';
import { Button, Card } from '@oikos/ui';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cancelOrder, placeOrder } from '../api';
import { useRows } from '../data';
import { LoadProblem, Loading } from './LoadProblem';
import { useHouse } from '../house';
import { parseMarketTax, previewSale } from '../market-rules';
import { orderNotice } from '../order-notice';
import fr from '../locales/fr.json';
import { parseCandleSeconds } from '../price-history';
import { PriceHistory } from './PriceHistory';
import { useMoney } from '../money';

/**
 * Biens proposés : ceux qui ont un nom (un test tient les traductions alignées sur la configuration).
 * L'API fait foi : un bien absent de la configuration en vigueur est refusé.
 */
const GOOD_IDS = Object.keys(fr.goods);
const DEFAULT_GOOD = 'wheat';
const CONTROL = 'min-h-11 w-full rounded-md border border-border bg-surface px-3';

interface Level {
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
}
interface Order {
  id: string;
  side: 'buy' | 'sell';
  good_id: string;
  price: number;
  quantity: number;
  remaining: number;
}
type Notice = { kind: 'status' | 'alert'; text: string } | null;

/** Onglet Agora : carnet d'ordres agrégé (ventes et achats), dépôt d'un ordre à cours limité, ordres en attente de la maison. */
export function AgoraScreen() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const [goodId, setGoodId] = useState(DEFAULT_GOOD);
  const book = useRows<Level>('order_book', 'side, price, quantity', 'price', {
    city_id: house.cityId,
    good_id: goodId,
  });
  // Ventes de la moins chère à la plus chère ; achats du plus offrant au moins offrant.
  const asks = book.rows?.filter((level) => level.side === 'sell');
  const bids = book.rows?.filter((level) => level.side === 'buy').reverse();
  // Tous les ordres en attente de la maison dans cette cité, quel que soit le bien affiché.
  const mine = useRows<Order>(
    'my_orders',
    'id, side, good_id, price, quantity, remaining',
    'created_at',
    {
      city_id: house.cityId,
      status: 'open',
    },
  );
  // Taxe de marché en vigueur, relue après chaque commande : `null` tant qu'elle n'est pas lue, ou si
  // elle est illisible.
  const rules = useRows<{ market_tax: unknown }>(
    'market_rules',
    'market_tax, price_history',
    'market_tax',
  );
  const tax = rules.rows ? parseMarketTax(rules.rows[0] ?? null) : null;
  // Durée des chandeliers en vigueur : elle désigne la série de prix à afficher.
  const candleSeconds = rules.rows ? parseCandleSeconds(rules.rows[0] ?? null) : null;
  const [side, setSide] = useState<'sell' | 'buy'>('sell');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  // Intentions en attente de réponse, chacune avec sa clé : la même saisie renvoyée après une panne
  // réutilise la sienne, pour que l'API rejoue l'ordre déjà déposé au lieu d'en déposer un second.
  // Une autre action entre-temps (une annulation, un autre ordre) ne la fait pas oublier.
  const pending = useRef(new Map<string, string>());
  // Titre du carnet : le foyer y va après une relecture réussie.
  const bookTitle = useRef<HTMLHeadingElement>(null);
  const keyFor = (intent: string) => {
    const known = pending.current.get(intent);
    if (known) return known;
    const key = crypto.randomUUID();
    pending.current.set(intent, key);
    return key;
  };

  const number = new Intl.NumberFormat(i18n.language);
  const money = useMoney();
  const good = t(`goods.${goodId}`);
  const preview = previewSale(tax, side, price, quantity);

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
    } else {
      const outcome = orderNotice(input.data, result.data, tax);
      next = {
        kind: 'status',
        text: t(`agora.${outcome.key}`, {
          good,
          price: money(input.data.price),
          quantity: number.format(outcome.quantity),
          wanted: number.format(outcome.wanted),
          amount: money(outcome.amount),
          held: money(outcome.held),
        }),
      };
    }
    // Carnet relu avant d'annoncer le résultat : quand le message paraît, le formulaire est de nouveau prêt.
    await Promise.all([book.reload(), mine.reload(), rules.reload()]);
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
          text: t(order.side === 'buy' ? 'agora.cancelledBuy' : 'agora.cancelled', {
            quantity: number.format(result.data.released),
            good: t(`goods.${order.good_id}`),
            // Ce que le séquestre retenait pour le reste : prix limite × quantité non servie.
            amount: money(order.price * result.data.released),
          }),
        }
      : { kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) };
    await Promise.all([book.reload(), mine.reload(), rules.reload()]);
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
      {(book.failed || mine.failed || rules.failed || (rules.rows && !(tax && candleSeconds))) && (
        <LoadProblem
          heading={bookTitle}
          onRetry={() => Promise.all([book.reload(), mine.reload(), rules.reload()])}
        />
      )}

      {candleSeconds && (
        <PriceHistory cityId={house.cityId} goodId={goodId} periodSeconds={candleSeconds} />
      )}

      <Card>
        <h2 ref={bookTitle} tabIndex={-1} className="text-xl">
          {t('agora.book', { good })}
        </h2>
        {book.rows === null && !book.failed && <Loading />}
        {book.rows !== null &&
          (
            [
              ['asks', asks, 'bookCaption', 'offered', 'bookEmpty'],
              ['bids', bids, 'bidsCaption', 'wanted', 'bidsEmpty'],
            ] as const
          ).map(([key, levels, caption, column, empty]) =>
            levels?.length === 0 ? (
              <p key={key} className="text-muted-foreground">
                {t(`agora.${empty}`)}
              </p>
            ) : (
              // En police agrandie sur petit écran, le tableau défile dans sa carte au lieu de faire
              // défiler la page ; un prix ou une quantité ne se coupe jamais entre deux chiffres.
              <div key={key} className="overflow-x-auto">
                <table className="w-full text-left">
                  <caption className="text-left text-sm text-muted-foreground">
                    {t(`agora.${caption}`)}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('agora.price')}</th>
                      <th scope="col">{t(`agora.${column}`)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {levels?.map((level) => (
                      <tr key={level.price}>
                        <td className="whitespace-nowrap">{number.format(level.price)}</td>
                        <td className="whitespace-nowrap">{number.format(level.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ),
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
            aria-describedby="expected-net"
            onChange={(event) => setPrice(event.target.value)}
          />
          <label htmlFor="quantity">{t('agora.quantity')}</label>
          <input
            className={CONTROL}
            id="quantity"
            inputMode="numeric"
            value={quantity}
            aria-describedby="expected-net"
            onChange={(event) => setQuantity(event.target.value)}
          />
          {/* Description des deux champs et du bouton : lue en y arrivant, pas annoncée à chaque frappe. */}
          <p id="expected-net" className="text-sm text-muted-foreground">
            {preview &&
              t('agora.expectedNet', {
                net: money(preview.net),
                gross: money(preview.gross),
                tax: money(preview.tax),
              })}
          </p>
          <Button type="submit" disabled={busy} aria-describedby="expected-net">
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
        {mine.rows === null && !mine.failed && <Loading />}
        {mine.rows?.length === 0 && (
          <p className="text-muted-foreground">{t('agora.myOrdersEmpty')}</p>
        )}
        <ul className="flex flex-col gap-2">
          {mine.rows?.map((order) => {
            const values = {
              good: t(`goods.${order.good_id}`),
              remaining: number.format(order.remaining),
              quantity: number.format(order.quantity),
              price: money(order.price),
              held: money(order.price * order.remaining),
            };
            const buying = order.side === 'buy';
            return (
              <li key={order.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>{t(buying ? 'agora.sideBuy' : 'agora.sideSell')}</strong>
                  {' · '}
                  {t('agora.myOrder', values)}
                  {buying && ` (${t('agora.myOrderHeld', values)})`}
                </span>
                <Button
                  variant="secondary"
                  disabled={busy}
                  aria-label={t(buying ? 'agora.cancelBuyOrder' : 'agora.cancelOrder', values)}
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
