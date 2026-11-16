import { Button, Card } from '@oikos/ui';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { propertyCommand, type PropertyCommandInputs } from '../api';
import { useRows } from '../data';
import { useHouse } from '../house';
import { useMoney } from '../money';
import {
  conditionShare,
  parseLeases,
  parseMyProperties,
  parseOffers,
  parsePropertyRules,
  type Offer,
} from '../property';
import { LoadProblem, Loading } from './LoadProblem';
import { PropertyActions } from './PropertyActions';

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
const ROW = 'flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0';

/**
 * Immobilier de la maison (4.5) : biens offerts par la cité et par les maisons, ses biens et ses baux.
 * Chaque commande part au prix affiché, sous une clé gardée tant qu'elle reste sans réponse : un nouvel
 * essai rejoue la même commande au lieu d'en jouer une seconde.
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
  const offerRows = useRows<unknown>(
    'property_offers',
    'property_id, city_id, size_id, lot, condition, kind, price_oboles',
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
  const reload = () => Promise.all(reads.map((read) => read.reload()));

  const keys = useRef(new Map<string, string>());
  // Le contrôle qui a lancé la commande a pu disparaître (offre achetée, bail fini) ou devenir inactif :
  // le foyer, retombé sur la page, va au résultat, annoncé près de l'action.
  const noticeElement = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  async function run<N extends Command>(intent: string, name: N, input: PropertyCommandInputs[N]) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const key = keys.current.get(intent) ?? crypto.randomUUID();
    keys.current.set(intent, key);
    try {
      const result = await propertyCommand(name, input, house.accessToken, key);
      if (result.ok || result.error.code !== 'INTERNAL') keys.current.delete(intent);
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

  const offerAction = (offer: Offer) => {
    if (mineIds.has(offer.propertyId)) return null;
    const label = t(`property.take.${offer.kind}`, { cost: money(offer.priceOboles) });
    const { propertyId, priceOboles } = offer;
    // L'intention porte le prix vu : un autre prix est une autre demande, sous une clé neuve.
    const intent = `${offer.kind}:${propertyId}:${priceOboles}`;
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
        onClick={() => void send()}
      >
        {label}
      </Button>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-2">
        <h1 ref={title} tabIndex={-1} className="text-2xl">
          {t('property.title')}
        </h1>
        <p className="text-muted-foreground">{t('property.intro')}</p>
        <Link to="/" className="inline-flex min-h-11 items-center underline underline-offset-4">
          {t('staff.back')}
        </Link>
      </Card>
      {loading && <Loading />}
      {failed && <LoadProblem heading={title} onRetry={reload} />}
      {!loading && !failed && (
        <>
          <Card className="flex flex-col gap-3">
            <h2 className="text-xl">{t('property.offers')}</h2>
            {said('offers')}
            {offers?.length === 0 && (
              <p className="text-muted-foreground">{t('property.noOffers')}</p>
            )}
            <ul className="flex flex-col gap-3">
              {(offers ?? []).map((offer) => (
                <li key={`${offer.kind}:${offer.propertyId}`} className={ROW}>
                  <h3 className="font-semibold">{describe(offer)}</h3>
                  <p>{t(`property.offer.${offer.kind}`, { cost: money(offer.priceOboles) })}</p>
                  {condition(offer.condition) && <p>{condition(offer.condition)}</p>}
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
              <p className="text-muted-foreground">{t('property.noneMine')}</p>
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
              <p className="text-muted-foreground">{t('property.noLeases')}</p>
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
                        void run(`end:${lease.id}`, 'property.endLease', { leaseId: lease.id })
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
