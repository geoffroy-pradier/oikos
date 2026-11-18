import { gameDayDate } from '@oikos/sim';
import { Button, Card, EmptyState, Frieze, House, Inbox, ScrollText } from '@oikos/ui';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { propertyCommand, type PropertyCommandInputs } from '../api';
import { useRows } from '../data';
import { useHouse } from '../house';
import { cityMarketTax, parseMarketTax } from '../market-rules';
import { useMoney } from '../money';
import {
  conditionShare,
  parseLeases,
  parseMyProperties,
  parseOffers,
  parsePropertyRules,
  type Offer,
} from '../property';
import { pendingKeys, sendUnderKey } from '../pending-keys';
import { LoadProblem, Loading } from './LoadProblem';
import { ownerIntents, PropertyActions } from './PropertyActions';

type Command = Parameters<typeof propertyCommand>[0];
/** Carte où s'annonce le résultat d'une commande : celle de l'action qui l'a lancée. */
type Place = 'offers' | 'mine' | 'leases';
type Notice = { kind: 'status' | 'alert'; text: string; place: Place } | null;
const PLACE: Record<Command, Place> = {
  'property.buy': 'offers',
  'property.buyListed': 'offers',
  'property.lease': 'offers',
  'property.renovate': 'mine',
  'property.listForSale': 'mine',
  'property.offerLease': 'mine',
  'property.withdrawOffer': 'mine',
  'property.endLease': 'leases',
};
const WAITING = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';
const ROW =
  'flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-raised p-3 shadow-sm';
/** L'intention porte le prix vu : un autre prix est une autre demande, sous une clé neuve. */
const offerIntent = (offer: Offer) => `${offer.kind}:${offer.propertyId}:${offer.priceOboles}`;
const endIntent = (leaseId: string) => `end:${leaseId}`;

/**
 * Immobilier de la maison (4.5) : biens offerts par la cité et par les maisons, ses biens et ses baux.
 * Chaque commande part au prix affiché, sous une clé gardée en stockage de session tant qu'elle reste
 * sans réponse, comme celles des sites et des navires : un nouvel essai, même après un rechargement,
 * rejoue la même commande au lieu d'en jouer une seconde.
 */
export function PropertyScreen() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const money = useMoney();
  const title = useRef<HTMLHeadingElement>(null);
  const rulesRows = useRows<unknown>('property_rules', 'properties', 'properties');
  const world = { city_id: Object.keys(house.cityNames) };
  const cityRows = useRows<unknown>(
    'city_properties',
    'id, city_id, size_id, lot, for_sale, condition',
    'lot',
    world,
  );
  // Les offres des maisons avec l'entretien impayé de leur bien (#403), que l'acheteur reprend.
  const offerRows = useRows<unknown>(
    'property_offers_upkeep',
    'property_id, city_id, size_id, lot, condition, kind, price_oboles, upkeep_unpaid, upkeep_unpaid_day',
    'listed_at',
    world,
  );
  const mineRows = useRows<unknown>(
    'my_properties',
    'id, city_id, size_id, lot, condition, upkeep_unpaid_since',
    'lot',
  );
  const leaseRows = useRows<unknown>(
    'my_leases',
    'id, property_id, city_id, size_id, lot, tenant_house_id, rent_oboles, end_requested_at, ended_at, ended_day, end_reason',
    'started_at',
  );
  // Taxe de marché de la cité de chaque bien (5.3, 5.6), prélevée sur une revente : elle n'est pas
  // nécessaire à l'écran ; illisible, le net du vendeur n'est simplement pas annoncé.
  const marketRows = useRows<unknown>('market_rules', 'market_tax', 'market_tax');
  const rateRows = useRows<{ city_id?: unknown }>(
    'city_rates',
    'city_id, market_tax_rate_bps',
    'city_id',
    world,
  );
  const reads = [rulesRows, cityRows, offerRows, mineRows, leaseRows];
  const sizes = rulesRows.rows === null ? null : parsePropertyRules(rulesRows.rows[0] ?? null);
  const offers =
    sizes && cityRows.rows && offerRows.rows
      ? parseOffers(cityRows.rows, offerRows.rows, sizes)
      : null;
  const mine = mineRows.rows === null ? null : parseMyProperties(mineRows.rows);
  const leases = leaseRows.rows === null ? null : parseLeases(leaseRows.rows, house.id);
  const loading = reads.some((read) => read.rows === null && !read.failed);
  const failed =
    reads.some((read) => read.failed) || (!loading && [sizes, offers, mine, leases].includes(null));
  const reload = () => Promise.all([...reads, marketRows, rateRows].map((read) => read.reload()));
  const worldTax = marketRows.rows && parseMarketTax(marketRows.rows[0] ?? null);
  const taxIn = (cityId: string) =>
    cityMarketTax(
      worldTax ?? null,
      rateRows.rows?.find((row) => row.city_id === cityId),
    );

  // Portée disjointe de celles des sites (`oikos.pending.<maison>.`) et des navires.
  const pending = useMemo(
    () => pendingKeys(`property.${house.id}`, () => window.sessionStorage),
    [house.id],
  );
  // Le contrôle qui a lancé la commande a pu disparaître (offre achetée, bail fini) ou devenir inactif :
  // le foyer, retombé sur la page, va au résultat, annoncé près de l'action.
  const noticeElement = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  async function run<N extends Command>(intent: string, name: N, input: PropertyCommandInputs[N]) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await sendUnderKey(
        pending,
        intent,
        () => crypto.randomUUID(),
        input,
        (key, sent) => propertyCommand(name, sent ?? input, house.accessToken, key),
      );
      setNotice(
        result.ok
          ? {
              kind: 'status',
              text: t(`property.done.${name.slice('property.'.length)}`),
              place: PLACE[name],
            }
          : {
              kind: 'alert',
              text: t([`errors.${result.error.code}`, 'errors.INTERNAL']),
              place: PLACE[name],
            },
      );
      await reload();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const active = document.activeElement;
    if (notice && (active === document.body || active?.getAttribute('aria-disabled') === 'true'))
      noticeElement.current?.focus();
  }, [notice]);
  // Toujours présente dans chaque carte : une région vivante annonce le résultat dès qu'il paraît.
  const said = (place: Place) => (
    <p
      ref={notice?.place === place ? noticeElement : undefined}
      tabIndex={-1}
      role={notice?.place === place ? notice.kind : 'status'}
      className={
        notice?.place === place && notice.kind === 'alert' ? 'font-semibold text-danger' : ''
      }
    >
      {notice?.place === place ? notice.text : ''}
    </p>
  );

  const number = new Intl.NumberFormat(i18n.language);
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 0,
  });
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  // Un jour de jeu se lit à sa date civile, rendue à minuit UTC (`gameDayDate`).
  const day = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' });
  const unpaidId = (offer: Offer) => `offer-unpaid-${offer.kind}-${offer.propertyId}`;
  const describe = (property: { sizeId: string; lot: number; cityId: string }) =>
    t('property.describe', {
      size: t(`propertySizes.${property.sizeId}`, { defaultValue: property.sizeId }),
      lot: number.format(property.lot),
      city: house.cityNames[property.cityId] ?? property.cityId,
    });
  const condition = (value: number | null) =>
    value === null
      ? null
      : t('property.condition', { percent: percent.format(conditionShare(value)) });
  const mineIds = new Set((mine ?? []).map((property) => property.id));
  const openOffer = (propertyId: string) =>
    (offers ?? []).find((offer) => offer.kind !== 'citySale' && offer.propertyId === propertyId);
  const leasedOut = (propertyId: string) =>
    (leases ?? []).find(
      (lease) => !lease.asTenant && lease.endedAt === null && lease.propertyId === propertyId,
    );

  // Intentions que l'écran propose encore, d'après la dernière lecture complète. Chaque contrôle disparaît
  // dès que l'effet de sa commande est lu (offre prise ou retirée, bien mis en vente, rénové, bail qui
  // finit) : une intention qu'il ne propose plus a donc son effet visible, ou ne peut plus être demandée.
  // Sa clé est rendue, et la même demande, proposée de nouveau plus tard, part sous une clé neuve au lieu
  // de rejouer l'ancienne réponse. Tant qu'elle est proposée, son effet n'est pas lu : la clé reste.
  const offered =
    loading || failed || !offers || !mine || !leases
      ? null
      : [
          ...offers.filter((offer) => !mineIds.has(offer.propertyId)).map(offerIntent),
          ...mine.flatMap((property) =>
            ownerIntents(
              property,
              sizes?.get(property.sizeId),
              openOffer(property.id),
              leasedOut(property.id) !== undefined,
            ),
          ),
          ...leases.filter((lease) => !lease.endedAt && !lease.ending).map((l) => endIntent(l.id)),
        ];
  const offeredKey = offered && JSON.stringify(offered);
  useEffect(() => {
    // Pendant une commande, la relecture qui suit sa réponse n'est pas encore faite.
    if (busy || offeredKey === null) return;
    const still = JSON.parse(offeredKey) as string[];
    pending.settleWhere(
      (intent) =>
        !still.some((open) => (open.endsWith(':') ? intent.startsWith(open) : intent === open)),
    );
  }, [busy, pending, offeredKey]);

  const offerAction = (offer: Offer) => {
    if (mineIds.has(offer.propertyId)) return null;
    const label = t(`property.take.${offer.kind}`, { cost: money(offer.priceOboles) });
    const { propertyId, priceOboles } = offer;
    const intent = offerIntent(offer);
    const send = () =>
      offer.kind === 'lease'
        ? run(intent, 'property.lease', { propertyId, expectedRentOboles: priceOboles })
        : run(intent, offer.kind === 'citySale' ? 'property.buy' : 'property.buyListed', {
            propertyId,
            expectedPriceOboles: priceOboles,
          });
    return (
      <Button
        className={WAITING}
        aria-disabled={busy}
        aria-label={`${label} — ${describe(offer)}`}
        aria-describedby={offer.unpaid ? unpaidId(offer) : undefined}
        onClick={() => void send()}
      >
        {label}
      </Button>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Card elevation="raised" className="flex flex-col gap-2 overflow-hidden p-0">
        <Frieze tone="accent" />
        <div className="flex flex-col gap-2 p-4">
          <h1 ref={title} tabIndex={-1} className="flex items-center gap-2 text-2xl">
            <House aria-hidden="true" className="size-6 text-accent" />
            {t('property.title')}
          </h1>
          <p className="text-muted-foreground">{t('property.intro')}</p>
          <Link to="/" className="inline-flex min-h-11 items-center underline underline-offset-4">
            {t('staff.back')}
          </Link>
        </div>
      </Card>
      {loading && <Loading />}
      {failed && <LoadProblem heading={title} onRetry={reload} />}
      {!loading && !failed && (
        <>
          <Card className="flex flex-col gap-3">
            <h2 className="text-xl">{t('property.offers')}</h2>
            {said('offers')}
            {offers?.length === 0 && (
              <EmptyState icon={<Inbox />} title={t('property.noOffers')} headingLevel={3} />
            )}
            <ul className="flex flex-col gap-3">
              {(offers ?? []).map((offer) => (
                <li key={`${offer.kind}:${offer.propertyId}`} className={ROW}>
                  <h3 className="font-semibold">{describe(offer)}</h3>
                  <p>{t(`property.offer.${offer.kind}`, { cost: money(offer.priceOboles) })}</p>
                  {condition(offer.condition) && <p>{condition(offer.condition)}</p>}
                  {offer.unpaid && (
                    <p id={unpaidId(offer)} className="font-semibold text-danger">
                      {offer.unpaid.day === null
                        ? t('property.offerUnpaidUndated')
                        : t('property.offerUnpaid', {
                            date: day.format(gameDayDate(offer.unpaid.day)),
                          })}
                    </p>
                  )}
                  {mineIds.has(offer.propertyId) && (
                    <p className="text-muted-foreground">{t('property.yourOffer')}</p>
                  )}
                  {offerAction(offer)}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="flex flex-col gap-3">
            <h2 className="text-xl">{t('property.mine')}</h2>
            {said('mine')}
            {mine?.length === 0 && (
              <EmptyState icon={<House />} title={t('property.noneMine')} headingLevel={3} />
            )}
            <ul className="flex flex-col gap-3">
              {(mine ?? []).map((property) => {
                const size = sizes?.get(property.sizeId);
                const lease = leasedOut(property.id);
                return (
                  <li key={property.id} className={ROW}>
                    <h3 className="font-semibold">{describe(property)}</h3>
                    <p>{condition(property.condition)}</p>
                    {size && <p>{t('property.upkeep', { cost: money(size.dailyUpkeepOboles) })}</p>}
                    {property.unpaidSince && (
                      <p className="font-semibold text-danger">
                        {t('property.unpaid', {
                          date: date.format(new Date(property.unpaidSince)),
                        })}
                      </p>
                    )}
                    {lease && <p>{t('property.leasedOut', { cost: money(lease.rentOboles) })}</p>}
                    <PropertyActions
                      property={property}
                      size={size}
                      tax={taxIn(property.cityId)}
                      offer={openOffer(property.id)}
                      leased={lease !== undefined}
                      name={describe(property)}
                      busy={busy}
                      run={run}
                    />
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card className="flex flex-col gap-3">
            <h2 className="text-xl">{t('property.leases')}</h2>
            {said('leases')}
            {leases?.length === 0 && (
              <EmptyState icon={<ScrollText />} title={t('property.noLeases')} headingLevel={3} />
            )}
            <ul className="flex flex-col gap-3">
              {(leases ?? []).map((lease) => (
                <li key={lease.id} className={ROW}>
                  <h3 className="font-semibold">{describe(lease)}</h3>
                  <p>
                    {t(lease.asTenant ? 'property.asTenant' : 'property.asLandlord', {
                      cost: money(lease.rentOboles),
                    })}
                  </p>
                  {lease.endReason && <p>{t(`property.ended.${lease.endReason}`)}</p>}
                  {lease.ending && <p>{t('property.ending')}</p>}
                  {!lease.endedAt && !lease.ending && (
                    <Button
                      variant="secondary"
                      className={WAITING}
                      aria-disabled={busy}
                      aria-label={`${t('property.endLease')} — ${describe(lease)}`}
                      onClick={() =>
                        void run(endIntent(lease.id), 'property.endLease', { leaseId: lease.id })
                      }
                    >
                      {t('property.endLease')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
