import { marketPlaceOrderInputSchema } from '@oikos/contracts';
import { Badge, Button, Card, CircleAlert, Info, Scale, Store } from '@oikos/ui';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cancelOrder, placeOrder } from '../api';
import { useRows } from '../data';
import { LoadProblem, Loading } from './LoadProblem';
import { useHouse } from '../house';
import { cityMarketTax, parseMarketTax, previewSale } from '../market-rules';
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
const CONTROL =
  'min-h-11 w-full rounded-md border border-border bg-surface-raised px-3 text-foreground ' +
  'transition-[border-color,box-shadow] duration-(--motion-fast) hover:border-foreground/60';
const LABEL = 'text-sm font-medium';
/** Part de la quantité du niveau le plus fourni, en pourcentage : la profondeur du carnet, en fond de ligne. */
const depthOf = (quantity: number, deepest: number) => Math.round((quantity / deepest) * 100);

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
  // Cités où la maison a un stock ou un site (lectures existantes) ; sa cité d'origine d'abord et par défaut.
  const stockCities = useRows<{ city_id: string }>('my_inventories', 'city_id', 'city_id');
  const siteCities = useRows<{ city_id: string }>('my_sites', 'city_id', 'id');
  const cityIds = [
    house.cityId,
    ...new Set(
      [...(stockCities.rows ?? []), ...(siteCities.rows ?? [])]
        .map((row) => row.city_id)
        .filter((id) => id !== house.cityId),
    ),
  ];
  // Ouverte depuis le panneau d'une cité de la carte (`?cite=`) : cette cité, si l'agora la propose.
  const [chosenCity, setChosenCity] = useState(
    () => new URLSearchParams(window.location.search).get('cite') ?? house.cityId,
  );
  // Une cité qui n'est plus proposée (stock vendu, site perdu) ramène à la cité d'origine.
  const cityId = cityIds.includes(chosenCity) ? chosenCity : house.cityId;
  const nameOf = (id: string) => house.cityNames[id] ?? (id === house.cityId ? house.cityName : id);
  const cityName = nameOf(cityId);
  const book = useRows<Level>('order_book', 'side, price, quantity', 'price', {
    city_id: cityId,
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
      city_id: cityId,
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
  // Taux de la cité du marché (5.6) : il remplace celui du monde dès qu'un décret y est appliqué.
  const cityRate = useRows<unknown>('city_rates', 'market_tax_rate_bps', 'city_id', {
    city_id: cityId,
  });
  const tax =
    rules.rows && cityRate.rows
      ? cityMarketTax(parseMarketTax(rules.rows[0] ?? null), cityRate.rows[0] ?? null)
      : null;
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
      cityId,
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
    await Promise.all([book.reload(), mine.reload(), rules.reload(), cityRate.reload()]);
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
    await Promise.all([book.reload(), mine.reload(), rules.reload(), cityRate.reload()]);
    setNotice(next);
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card elevation="raised" className="flex flex-col gap-3 overflow-hidden p-0">
        <div className="flex flex-col gap-3 p-4">
          {/* Icône dans le fil du texte, pas en flex : à police très agrandie, le titre se replie sans déborder. */}
          <h1 className="text-2xl">
            <Store aria-hidden="true" className="mr-2 inline size-6 align-[-0.15em] text-accent" />
            {t('agora.title', { city: cityName })}
          </h1>
          {cityIds.length > 1 && (
            <>
              <label htmlFor="city" className={LABEL}>
                {t('agora.city')}
              </label>
              <select
                className={CONTROL}
                id="city"
                value={cityId}
                // Comme le bien : pas de changement de marché pendant qu'une commande est en route.
                disabled={busy}
                onChange={(event) => {
                  setChosenCity(event.target.value);
                  setNotice(null);
                }}
              >
                {cityIds.map((id) => (
                  <option key={id} value={id}>
                    {nameOf(id)}
                  </option>
                ))}
              </select>
            </>
          )}
          <label htmlFor="good" className={LABEL}>
            {t('agora.good')}
          </label>
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
        </div>
      </Card>
      {(book.failed ||
        mine.failed ||
        rules.failed ||
        cityRate.failed ||
        (rules.rows && cityRate.rows && !(tax && candleSeconds))) && (
        <LoadProblem
          heading={bookTitle}
          onRetry={() =>
            Promise.all([book.reload(), mine.reload(), rules.reload(), cityRate.reload()])
          }
        />
      )}

      {candleSeconds && (
        <PriceHistory cityId={cityId} goodId={goodId} periodSeconds={candleSeconds} />
      )}

      <Card className="flex flex-col gap-3">
        <h2 ref={bookTitle} tabIndex={-1} className="text-xl">
          {t('agora.book', { good })}
        </h2>
        {book.rows === null && !book.failed && <Loading />}
        {book.rows !== null && (
          <div className="grid gap-4 md:grid-cols-2">
            {(
              [
                ['asks', asks, 'bookCaption', 'offered', 'bookEmpty', 'danger'],
                ['bids', bids, 'bidsCaption', 'wanted', 'bidsEmpty', 'success'],
              ] as const
            ).map(([key, levels, caption, column, empty, tone]) => {
              const deepest = Math.max(1, ...(levels ?? []).map((level) => level.quantity));
              return levels?.length === 0 ? (
                <p
                  key={key}
                  className="rounded-lg border border-dashed border-border-subtle p-4 text-sm text-muted-foreground"
                >
                  {t(`agora.${empty}`)}
                </p>
              ) : (
                // En police agrandie sur petit écran, le tableau défile dans sa carte au lieu de faire
                // défiler la page ; un prix ou une quantité ne se coupe jamais entre deux chiffres.
                <div key={key} className="overflow-x-auto rounded-lg bg-muted/40 p-2">
                  <table className="w-full text-left tabular-nums">
                    <caption className="px-2 pb-2 text-left text-sm text-muted-foreground">
                      {t(`agora.${caption}`)}
                    </caption>
                    <thead>
                      <tr className="border-b border-border-subtle">
                        <th scope="col" className="eyebrow px-2 py-1 font-semibold">
                          {t('agora.price')}
                        </th>
                        <th scope="col" className="eyebrow px-2 py-1 text-right font-semibold">
                          {t(`agora.${column}`)}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {levels?.map((level) => (
                        <tr key={level.price} className="border-b border-border-subtle/60">
                          <td className="px-2 py-1.5 font-semibold whitespace-nowrap">
                            {number.format(level.price)}
                          </td>
                          <td
                            className="px-2 py-1.5 text-right whitespace-nowrap"
                            // Profondeur du niveau : une barre qui part de la droite, sous le chiffre.
                            style={{
                              backgroundImage: `linear-gradient(to left, var(--${tone}-subtle) ${depthOf(level.quantity, deepest)}%, transparent ${depthOf(level.quantity, deepest)}%)`,
                            }}
                          >
                            {number.format(level.quantity)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <h2 className="text-xl">
            <Scale aria-hidden="true" className="mr-2 inline size-5 align-[-0.15em] text-accent" />
            {t('agora.place', { good })}
          </h2>
          <div className="flex flex-col gap-1">
            <label htmlFor="side" className={LABEL}>
              {t('agora.side')}
            </label>
            <select
              className={CONTROL}
              id="side"
              value={side}
              onChange={(event) => setSide(event.target.value === 'buy' ? 'buy' : 'sell')}
            >
              <option value="sell">{t('agora.sell')}</option>
              <option value="buy">{t('agora.buy')}</option>
            </select>
          </div>
          {/* min-w-0 : à police très agrandie, les champs rétrécissent avec la page au lieu de la déborder. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="price" className={LABEL}>
                {t('agora.limitPrice')}
              </label>
              <input
                className={CONTROL}
                id="price"
                inputMode="numeric"
                value={price}
                aria-describedby="expected-net"
                onChange={(event) => setPrice(event.target.value)}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="quantity" className={LABEL}>
                {t('agora.quantity')}
              </label>
              <input
                className={CONTROL}
                id="quantity"
                inputMode="numeric"
                value={quantity}
                aria-describedby="expected-net"
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>
          </div>
          {/* Description des deux champs et du bouton : lue en y arrivant, pas annoncée à chaque frappe. */}
          <p
            id="expected-net"
            className="rounded-md bg-aegean-subtle p-2 text-sm text-foreground empty:hidden"
          >
            {preview &&
              t('agora.expectedNet', {
                net: money(preview.net),
                gross: money(preview.gross),
                tax: money(preview.tax),
              })}
          </p>
          <Button
            type="submit"
            disabled={busy}
            aria-describedby="expected-net"
            className="w-full sm:w-auto sm:self-start"
          >
            {t('agora.submit')}
          </Button>
        </form>
      </Card>

      {/* Toujours présent : un lecteur d'écran annonce le résultat dès qu'il apparaît. Vide, il est masqué
          visuellement (sr-only) mais reste dans l'arbre d'accessibilité, jamais en display:none. */}
      <p
        role={notice?.kind ?? 'status'}
        className={
          'flex items-start gap-2 rounded-lg p-3 empty:sr-only ' +
          (notice?.kind === 'alert'
            ? 'bg-danger-subtle font-semibold text-danger'
            : 'bg-success-subtle text-foreground')
        }
      >
        {notice &&
          (notice.kind === 'alert' ? (
            <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          ) : (
            <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          ))}
        {notice?.text}
      </p>

      <Card className="flex flex-col gap-3">
        <h2 className="text-xl">{t('agora.myOrders')}</h2>
        {mine.rows === null && !mine.failed && <Loading />}
        {mine.rows?.length === 0 && (
          <p className="rounded-lg border border-dashed border-border-subtle p-4 text-muted-foreground">
            {t('agora.myOrdersEmpty')}
          </p>
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
              <li
                key={order.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 p-3"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge tone={buying ? 'success' : 'primary'}>
                    {t(buying ? 'agora.sideBuy' : 'agora.sideSell')}
                  </Badge>
                  <span>
                    {t('agora.myOrder', values)}
                    {buying && ` (${t('agora.myOrderHeld', values)})`}
                  </span>
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
