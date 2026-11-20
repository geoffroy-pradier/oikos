import { Card, EmptyState, House, Inbox, ScrollText, StatusRegion } from '@oikos/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { propertyCommand } from '../api';
import { useRows } from '../data';
import { useHouse } from '../house';
import { HouseNav } from '../HouseNav';
import { cityMarketTax, parseMarketTax } from '../market-rules';
import { useMoney } from '../money';
import {
  conditionShare,
  parseLeases,
  parseMyProperties,
  parseOffers,
  parsePropertyRules,
} from '../property';
import { pendingKeys, sendUnderKey } from '../pending-keys';
import { ScreenHeader } from '../ScreenHeader';
import { LoadProblem, Loading } from './LoadProblem';
import { ownerIntents, PropertyActions } from './PropertyActions';
import { endIntent, PropertyLeases } from './PropertyLeases';
import { offerIntent, PropertyOffers } from './PropertyOffers';
import type { RunCommand } from './PropertySheet';

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
const ROW =
  'flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-raised p-3 shadow-sm';

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
  // le foyer, retombé sur la page, va au résultat, annoncé près de l'action. Une commande aboutie depuis
  // une feuille la ferme, et son bouton avec elle : le foyer va toujours au résultat.
  const noticeElement = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const fromSheet = useRef(false);
  const run: RunCommand = async (intent, name, input, sheet) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    sheet?.refuse(null);
    try {
      const result = await sendUnderKey(
        pending,
        intent,
        () => crypto.randomUUID(),
        input,
        (key, sent) => propertyCommand(name, sent ?? input, house.accessToken, key),
      );
      const text = result.ok
        ? t(`property.done.${name.slice('property.'.length)}`)
        : t([`errors.${result.error.code}`, 'errors.INTERNAL']);
      // Refus ou réponse perdue : la feuille reste ouverte, saisie gardée, et le dit près du bouton.
      if (sheet && !result.ok) sheet.refuse(text);
      else {
        fromSheet.current = sheet !== undefined;
        sheet?.close();
        setNotice({ kind: result.ok ? 'status' : 'alert', text, place: PLACE[name] });
      }
      await reload();
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const active = document.activeElement;
    const lost = active === document.body || active?.getAttribute('aria-disabled') === 'true';
    if (notice && (fromSheet.current || lost)) noticeElement.current?.focus();
    fromSheet.current = false;
  }, [notice]);
  // Toujours présente dans chaque carte : une région vivante annonce le résultat dès qu'il paraît. Une
  // alerte remonte la région sous son rôle (fixé au montage), annoncée dès qu'elle paraît.
  const said = (place: Place) => {
    const here = notice?.place === place ? notice : null;
    return (
      <StatusRegion
        key={here?.kind ?? 'status'}
        ref={here ? noticeElement : null}
        role={here?.kind ?? 'status'}
        tone={here?.kind === 'alert' ? 'danger' : 'success'}
      >
        {here?.text}
      </StatusRegion>
    );
  };

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

  return (
    <div className="flex flex-col gap-4 [overflow-wrap:anywhere]">
      <ScreenHeader title={t('property.title')} titleRef={title} />
      <HouseNav />
      <p className="max-w-3xl text-sm text-muted-foreground">{t('property.intro')}</p>
      {loading && <Loading />}
      {failed && <LoadProblem heading={title} onRetry={reload} />}
      {!loading && !failed && (
        <>
          <Card className="flex flex-col gap-3" aria-labelledby="property-offers">
            <h2 id="property-offers" className="flex items-center gap-2 text-lg font-semibold">
              <Inbox aria-hidden="true" className="size-5 shrink-0 text-accent" />
              {t('property.offers')}
            </h2>
            {said('offers')}
            {offers?.length === 0 ? (
              <EmptyState icon={<Inbox />} title={t('property.noOffers')} headingLevel={3} />
            ) : (
              <PropertyOffers
                offers={offers ?? []}
                mineIds={mineIds}
                sizes={sizes}
                describe={describe}
                busy={busy}
                run={run}
              />
            )}
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
          <Card className="flex flex-col gap-3" aria-labelledby="property-leases">
            <h2 id="property-leases" className="flex items-center gap-2 text-lg font-semibold">
              <ScrollText aria-hidden="true" className="size-5 shrink-0 text-accent" />
              {t('property.leases')}
            </h2>
            {said('leases')}
            {leases?.length === 0 ? (
              <EmptyState icon={<ScrollText />} title={t('property.noLeases')} headingLevel={3} />
            ) : (
              <PropertyLeases leases={leases ?? []} describe={describe} busy={busy} run={run} />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
