import { Button, Card, CircleAlert, EmptyState, Hammer, Info, Sheet } from '@oikos/ui';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { acquireShip } from '../api';
import type { ShipRow } from '../fleet';
import { useHouse } from '../house';
import { shortfall, useMoney } from '../money';
import { countedIntent, countedIntentBelow, pendingKeys, sendUnderKey } from '../pending-keys';
import type { ShipClassRule, ShipRules } from '../ship-rules';

type Notice = { kind: 'status' | 'alert'; text: string; unanswered?: true } | null;

/**
 * Chantier naval de l'onglet Carte : chaque classe de navire à son prix, et son achat (4.6). « Acheter » est
 * secondaire, comme sur Immobilier, et inactif sous le prix, ce qui manque à la trésorerie dit à côté (#864).
 */
export function Shipyard(props: {
  ships: ShipRow[] | null;
  rules: ShipRules | null;
  /** Trésorerie de la maison ; `null` tant qu'elle n'est pas connue : l'API juge seule. */
  balance: number | null;
  reloadShips: () => Promise<ShipRow[] | null>;
  reloadFleet: () => Promise<unknown>;
}) {
  const { ships, rules } = props;
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const money = useMoney();
  const number = new Intl.NumberFormat(i18n.language);
  const ids = useId();
  const missing = (shipClass: ShipClassRule) =>
    shortfall(props.balance, shipClass.purchaseCostOboles);
  // Achat d'un navire, comme l'acquisition d'un site (4.2) : la clé d'un achat resté sans réponse est
  // gardée tant qu'aucune relecture ne montre un navire de plus ; s'il en paraît un, le joueur est prévenu
  // à chaque ouverture de l'écran, tant qu'il n'a pas dit avoir vérifié sa flotte. Portée des clés
  // disjointe de celle des sites (`oikos.pending.<maison>.`).
  const pending = useMemo(
    () => pendingKeys(`ships.${house.id}`, () => window.sessionStorage),
    [house.id],
  );
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  // Classe dont la feuille d'achat est ouverte.
  const [buying, setBuying] = useState<ShipClassRule | null>(null);
  const recalled = useRef(false);
  // L'achat confirmé ferme sa feuille, et son bouton avec elle : le foyer va au message qui dit l'issue.
  // À l'ouverture de l'écran, un rappel ne le prend que s'il est retombé sur la page.
  const purchased = useRef(false);
  const noticeElement = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (purchased.current || active === document.body || active?.matches(':disabled') === true)
      noticeElement.current?.focus();
    purchased.current = false;
  }, [notice]);
  useLayoutEffect(() => {
    if (running.current || !ships) return;
    const count = ships.length;
    const abandoned = pending.settleWhere(countedIntentBelow('ship', () => count)) > 0;
    if (abandoned) pending.warning.set(true);
    const opening = !recalled.current;
    recalled.current = true;
    if ((abandoned || opening) && pending.warning.get())
      setNotice({ kind: 'alert', text: t('map.buyUnanswered'), unanswered: true });
  }, [pending, ships, busy, t]);

  async function buy(classId: string, costOboles: number) {
    const before = ships?.length ?? null;
    const intent = countedIntent('ship', classId, before);
    if (intent === null || before === null || running.current) return;
    running.current = true;
    setBusy(true);
    setNotice(null);
    pending.warning.set(false);
    const send = () =>
      sendUnderKey(
        pending,
        intent,
        () => crypto.randomUUID(),
        costOboles,
        (key, sent) => acquireShip(classId, sent ?? costOboles, house.accessToken, key),
        true,
      );
    try {
      let result = await send();
      // Sans réponse, mais un navire de plus qu'à l'envoi : l'achat a sans doute abouti. La même clé
      // repart une fois, pour connaître l'issue.
      if (!result.ok && result.error.code === 'INTERNAL') {
        const read = await props.reloadShips();
        if (read !== null && read.length > before) result = await send();
      }
      await props.reloadFleet();
      purchased.current = true;
      setBuying(null);
      setNotice(
        result.ok
          ? {
              kind: 'status',
              text: t(result.replayed ? 'map.alreadyBought' : 'map.bought', {
                ship: t(`shipClasses.${classId}`, { defaultValue: classId }),
                cost: money(result.data.costOboles),
              }),
            }
          : { kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) },
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 id="shipyard" tabIndex={-1} className="flex items-center gap-2 text-xl">
        <Hammer aria-hidden="true" className="size-5 shrink-0 text-accent" />
        {t('map.shipyard')}
      </h2>
      <p className="text-muted-foreground">{t('map.shipyardIntro', { city: house.cityName })}</p>
      {rules?.classes.length === 0 && (
        <EmptyState compact illustration="noShip" title={t('map.noClasses')} />
      )}
      <ul className="flex flex-col gap-2">
        {(rules?.classes ?? []).map((shipClass) => (
          <li
            key={shipClass.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3"
          >
            <span>
              <span className="font-semibold">
                {t(`shipClasses.${shipClass.id}`, { defaultValue: shipClass.id })}
              </span>{' '}
              {t('map.classLine', {
                capacity: number.format(shipClass.capacityUnits),
                upkeep: money(shipClass.dailyUpkeepOboles),
              })}
            </span>
            <span className="flex w-full flex-col gap-1 sm:w-auto sm:items-end">
              <Button
                variant="secondary"
                inactive={missing(shipClass) !== null}
                aria-describedby={missing(shipClass) === null ? undefined : `${ids}${shipClass.id}`}
                disabled={busy || ships === null}
                onClick={() => setBuying(shipClass)}
              >
                {t('map.buy', { cost: money(shipClass.purchaseCostOboles) })}
              </Button>
              {missing(shipClass) !== null && (
                <span id={`${ids}${shipClass.id}`} className="text-sm text-muted-foreground">
                  {t('controls.shortfall', { missing: money(missing(shipClass) ?? 0) })}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {notice && (
        <p
          ref={noticeElement}
          tabIndex={-1}
          role={notice.kind}
          className={
            'flex items-start gap-2 rounded-lg p-3 ' +
            (notice.kind === 'alert'
              ? 'bg-danger-subtle font-semibold text-danger'
              : 'bg-success-subtle text-foreground')
          }
        >
          {notice.kind === 'alert' ? (
            <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          ) : (
            <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          )}
          {notice.text}
        </p>
      )}
      <Sheet
        open={buying !== null}
        onClose={() => setBuying(null)}
        title={t('map.buyTitle', {
          ship: t(`shipClasses.${buying?.id ?? ''}`, { defaultValue: buying?.id }),
        })}
        description={t('map.shipyardIntro', { city: house.cityName })}
        closeLabel={t('shell.close')}
        footer={
          buying && (
            <Button
              loading={busy}
              onClick={() => void buy(buying.id, buying.purchaseCostOboles)}
              className="w-full sm:w-auto"
            >
              {t('map.buyConfirm', { cost: money(buying.purchaseCostOboles) })}
            </Button>
          )
        }
      >
        {buying && (
          <dl className="grid grid-cols-2 gap-2.5">
            {[
              [t('map.buyPrice'), money(buying.purchaseCostOboles)],
              [t('map.buyCapacity'), number.format(buying.capacityUnits)],
              [t('map.buyUpkeep'), money(buying.dailyUpkeepOboles)],
              [t('map.buyHome'), house.cityName],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-surface-raised p-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 font-bold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Sheet>
      {notice?.unanswered && (
        <Button
          variant="secondary"
          onClick={() => {
            pending.warning.set(false);
            setNotice(null);
          }}
        >
          {t('map.buyChecked')}
        </Button>
      )}
    </Card>
  );
}
