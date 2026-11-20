import type { MarketPlaceOrderInput } from '@oikos/contracts';
import { Badge, Button, Card, GoodIcon, Select, StatusRegion, TableScroll } from '@oikos/ui';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { cancelOrder, placeOrder } from '../api';
import { useRows } from '../data';
import { LoadProblem, Loading } from './LoadProblem';
import { useHouse } from '../house';
import { cityMarketTax, parseMarketTax } from '../market-rules';
import { orderNotice } from '../order-notice';
import fr from '../locales/fr.json';
import { parseCandleSeconds } from '../price-history';
import { AgoraOrderSheet, type Side } from './AgoraOrderSheet';
import { PriceChart, PriceQuote, usePriceHistory } from './PriceHistory';
import { formatOboles, useMoney } from '../money';
import { bestOpposite } from '../order-book';
import { ScreenHeader } from '../ScreenHeader';

/**
 * Biens proposés : ceux qui ont un nom (un test tient les traductions alignées sur la configuration).
 * L'API fait foi : un bien absent de la configuration en vigueur est refusé.
 */
const GOOD_IDS = Object.keys(fr.goods);
const DEFAULT_GOOD = 'wheat';
/** Part de la quantité du niveau le plus fourni, en pourcentage : la profondeur du carnet, en fond de ligne. */
const depthOf = (quantity: number, deepest: number) => Math.round((quantity / deepest) * 100);

interface Level {
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
}
interface Stock {
  city_id: string;
  good_id: string;
  quantity: number;
  reserved: number;
}
interface Order {
  id: string;
  side: 'buy' | 'sell';
  good_id: string;
  price: number;
  quantity: number;
  remaining: number;
}
/** Résultat annoncé, près du dépôt (`place`) ou de la liste des ordres (`cancel`). */
type Notice = { where: 'place' | 'cancel'; kind: 'status' | 'alert'; text: string } | null;

/** Onglet Agora : carnet d'ordres agrégé (ventes et achats), dépôt d'un ordre à cours limité, ordres en attente de la maison. */
export function AgoraScreen() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const [goodId, setGoodId] = useState(DEFAULT_GOOD);
  // Cités où la maison a un stock ou un site (lectures existantes) ; sa cité d'origine d'abord et par défaut.
  const stock = useRows<Stock>('my_inventories', 'city_id, good_id, quantity, reserved', 'city_id');
  const siteCities = useRows<{ city_id: string }>('my_sites', 'city_id', 'id');
  const cityIds = [
    house.cityId,
    ...new Set(
      [...(stock.rows ?? []), ...(siteCities.rows ?? [])]
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
  const freeOf = (rows: readonly Stock[]) =>
    rows
      .filter((row) => row.city_id === cityId && row.good_id === goodId)
      .reduce((sum, row) => sum + row.quantity - row.reserved, 0);
  const treasury = useRows<{ balance: number }>('my_treasury', 'balance', 'house_id');
  const history = usePriceHistory(cityId, goodId, candleSeconds);
  // Sens de l'ordre en cours de saisie dans la feuille ; `null` : feuille fermée.
  const [side, setSide] = useState<Side | null>(null);
  // Bornes de la feuille : stock libre et trésorerie relus à son ouverture. Seule cette lecture borne la
  // saisie et fonde un refus ici ; en cours ou en échec, `null` : l'API juge seule.
  const [bounds, setBounds] = useState<{ free: number | null; cash: number | null } | null>(null);
  const opening = useRef(0);
  async function openSheet(choice: Side) {
    const round = ++opening.current;
    setBounds(null);
    setSide(choice);
    const [stockRows, cashRows] = await Promise.all([stock.reload(), treasury.reload()]);
    if (round !== opening.current) return;
    setBounds({
      free: stockRows ? freeOf(stockRows) : null,
      cash: cashRows?.[0]?.balance ?? null,
    });
  }
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  // Intentions en attente de réponse, chacune avec sa clé : la même saisie renvoyée après une panne
  // réutilise la sienne, pour que l'API rejoue l'ordre déjà déposé au lieu d'en déposer un second.
  // Une autre action entre-temps (une annulation, un autre ordre) ne la fait pas oublier.
  const pending = useRef(new Map<string, string>());
  // Titre du carnet : le foyer y va après une relecture réussie.
  const bookTitle = useRef<HTMLHeadingElement>(null);
  // Régions où paraît le résultat d'un dépôt (la feuille fermée) ou d'une annulation (le bouton disparu).
  const placed = useRef<HTMLDivElement>(null);
  const cancelled = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice?.kind === 'status') (notice.where === 'place' ? placed : cancelled).current?.focus();
  }, [notice]);
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
  // Meilleure offre que la feuille propose : le premier niveau opposé hors des ordres de la maison.
  const best =
    side &&
    bestOpposite(
      (side === 'sell' ? bids : asks) ?? [],
      (mine.rows ?? []).filter((order) => order.good_id === goodId && order.side !== side),
    );
  // En tête de la fiche du bien : le premier niveau de chaque côté du carnet public.
  const tops = [
    ['bestBuy', bids?.[0]],
    ['bestSell', asks?.[0]],
  ] as const;
  const reloadAll = () =>
    Promise.all([
      book.reload(),
      mine.reload(),
      rules.reload(),
      cityRate.reload(),
      stock.reload(),
      treasury.reload(),
    ]);

  /** Dépose l'ordre saisi dans la feuille : rend le message d'un refus, ou `null` une fois annoncé. */
  async function place(input: MarketPlaceOrderInput): Promise<string | null> {
    setBusy(true);
    setNotice(null);
    const intent = `place:${JSON.stringify(input)}`;
    const result = await placeOrder(input, house.accessToken, keyFor(intent));
    // Sans réponse de l'API (`INTERNAL`), l'intention reste en attente : son issue est inconnue.
    if (result.ok || result.error.code !== 'INTERNAL') pending.current.delete(intent);
    if (!result.ok) {
      await reloadAll();
      setBusy(false);
      return t([`errors.${result.error.code}`, 'errors.INTERNAL']);
    }
    const outcome = orderNotice(input, result.data, tax);
    // Carnet relu avant d'annoncer le résultat : quand le message paraît, l'écran est de nouveau prêt.
    await reloadAll();
    setNotice({
      where: 'place',
      kind: 'status',
      text: t(`agora.${outcome.key}`, {
        good,
        price: money(input.price),
        quantity: number.format(outcome.quantity),
        wanted: number.format(outcome.wanted),
        amount: money(outcome.amount),
        held: money(outcome.held),
      }),
    });
    setSide(null);
    setBusy(false);
    return null;
  }

  async function cancel(order: Order) {
    setBusy(true);
    setNotice(null);
    const intent = `cancel:${order.id}`;
    const result = await cancelOrder(order.id, house.accessToken, keyFor(intent));
    if (result.ok || result.error.code !== 'INTERNAL') pending.current.delete(intent);
    const next: Notice = result.ok
      ? {
          where: 'cancel',
          kind: 'status',
          text: t(order.side === 'buy' ? 'agora.cancelledBuy' : 'agora.cancelled', {
            quantity: number.format(result.data.released),
            good: t(`goods.${order.good_id}`),
            // Ce que le séquestre retenait pour le reste : prix limite × quantité non servie.
            amount: money(order.price * result.data.released),
          }),
        }
      : {
          where: 'cancel',
          kind: 'alert',
          text: t([`errors.${result.error.code}`, 'errors.INTERNAL']),
        };
    await reloadAll();
    setNotice(next);
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title={t('agora.title', { city: cityName })}
        action={
          // Pas de changement de marché pendant qu'une commande est en route : son résultat et le carnet
          // relu ensuite portent sur le bien et la cité affichés.
          <div className="grid w-full gap-3 sm:w-auto sm:grid-flow-col sm:auto-cols-[12rem]">
            <Select
              id="good"
              label={t('agora.good')}
              quiet
              value={goodId}
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
            </Select>
            {cityIds.length > 1 && (
              <Select
                id="city"
                label={t('agora.city')}
                quiet
                value={cityId}
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
              </Select>
            )}
          </div>
        }
      />
      {(book.failed ||
        mine.failed ||
        rules.failed ||
        cityRate.failed ||
        stock.failed ||
        treasury.failed ||
        (rules.rows && cityRate.rows && !(tax && candleSeconds))) && (
        <LoadProblem heading={bookTitle} onRetry={reloadAll} />
      )}

      {/* Téléphone : une colonne. Ordinateur : bien et carnet à gauche, chandeliers et ordres à droite. */}
      <div className="grid grid-cols-1 gap-4 [overflow-wrap:anywhere] lg:grid-cols-2">
        <Card elevation="raised" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <GoodIcon goodId={goodId} size={48} className="size-14 rounded-2xl bg-muted p-1" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="text-xl font-bold">{good}</h2>
              <p className="text-sm text-muted-foreground">
                {stock.rows === null
                  ? cityName
                  : t('agora.freeStock', {
                      quantity: number.format(freeOf(stock.rows)),
                      good,
                      city: cityName,
                    })}
              </p>
            </div>
          </div>
          <PriceQuote history={history} />
          <div className="mt-auto">
            <dl className="mb-3 flex flex-wrap gap-2 text-sm *:flex-1 *:basis-32">
              {tops.map(([key, level]) => (
                <div key={key} className="rounded-lg bg-muted px-3 py-2">
                  <dt className="text-muted-foreground">{t(`agora.${key}`)}</dt>
                  <dd className="font-semibold tabular-nums">
                    {level ? formatOboles(level.price, t, i18n.language) : t('agora.bestNone')}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap gap-2 *:flex-1 *:basis-32">
              {(['sell', 'buy'] as const).map((choice) => (
                <Button
                  key={choice}
                  variant={choice === 'sell' ? 'primary' : 'secondary'}
                  disabled={busy}
                  onClick={() => void openSheet(choice)}
                >
                  {t(`agora.${choice}`)}
                </Button>
              ))}
            </div>
            <Notices notice={notice} where="place" status={placed} />
          </div>
        </Card>

        {candleSeconds && <PriceChart history={history} />}

        <Card className="@container flex flex-col gap-3">
          <h2 ref={bookTitle} tabIndex={-1} className="text-lg">
            {t('agora.book', { good })}
          </h2>
          {book.rows === null && !book.failed && <Loading />}
          {book.rows !== null && (
            <div className="grid gap-3 @md:grid-cols-2">
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
                  <TableScroll
                    key={key}
                    label={t(`agora.${caption}`)}
                    className="rounded-lg bg-muted/40 p-2"
                  >
                    <table className="w-full text-left tabular-nums">
                      <caption className="px-2 pb-2 text-left text-sm text-muted-foreground">
                        {t(`agora.${caption}`)}
                      </caption>
                      <thead>
                        <tr className="border-b border-border-subtle">
                          <th
                            scope="col"
                            className="px-2 py-1 text-xs font-semibold text-muted-foreground"
                          >
                            {t('agora.price')}
                          </th>
                          <th
                            scope="col"
                            className="px-2 py-1 text-right text-xs font-semibold text-muted-foreground"
                          >
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
                  </TableScroll>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="text-lg">{t('agora.myOrders')}</h2>
          {mine.rows === null && !mine.failed && <Loading />}
          {mine.rows?.length === 0 && (
            <p className="rounded-lg border border-dashed border-border-subtle p-4 text-muted-foreground">
              {t('agora.myOrdersEmpty')}
            </p>
          )}
          <ul className="flex flex-col divide-y divide-border-subtle">
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
                <li key={order.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <GoodIcon goodId={order.good_id} className="text-muted-foreground" />
                  <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                    <Badge tone={buying ? 'success' : 'primary'}>
                      {t(buying ? 'agora.sideBuy' : 'agora.sideSell')}
                    </Badge>
                    <span className="tabular-nums">
                      {t('agora.myOrder', values)}
                      {buying && (
                        <span className="block text-sm text-muted-foreground">
                          {` (${t('agora.myOrderHeld', values)})`}
                        </span>
                      )}
                    </span>
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
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
          <div className="-mt-3">
            <Notices notice={notice} where="cancel" status={cancelled} />
          </div>
        </Card>
      </div>
      <AgoraOrderSheet
        // Saisie propre à un marché : un autre bien ou une autre cité repart d'une feuille vide.
        key={`${cityId}:${goodId}`}
        side={side}
        onClose={() => setSide(null)}
        cityId={cityId}
        cityName={cityName}
        goodId={goodId}
        tax={tax}
        free={bounds?.free ?? null}
        cash={bounds?.cash ?? null}
        best={best}
        onPlace={place}
      />
    </div>
  );
}

/** Une région vide ne prend pas de place ; remplie, elle se détache de ce qui la précède. */
const SPACED = 'has-[p]:mt-3 [overflow-wrap:anywhere]';

/** Régions vivantes d'un endroit, présentes avant tout résultat : succès poli, refus en alerte. */
function Notices(props: {
  notice: Notice;
  where: 'place' | 'cancel';
  status: RefObject<HTMLDivElement | null>;
}) {
  const here = props.notice?.where === props.where ? props.notice : null;
  return (
    <>
      <StatusRegion ref={props.status} tone="success" className={SPACED}>
        {here?.kind === 'status' && here.text}
      </StatusRegion>
      <StatusRegion role="alert" tone="danger" className={SPACED}>
        {here?.kind === 'alert' && here.text}
      </StatusRegion>
    </>
  );
}
