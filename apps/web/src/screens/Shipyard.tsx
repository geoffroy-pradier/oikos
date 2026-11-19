import { Button, Card, CircleAlert, Hammer, Info } from '@oikos/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { acquireShip } from '../api';
import type { ShipRow } from '../fleet';
import { useHouse } from '../house';
import { useMoney } from '../money';
import { countedIntent, countedIntentBelow, pendingKeys, sendUnderKey } from '../pending-keys';
import type { ShipRules } from '../ship-rules';

type Notice = { kind: 'status' | 'alert'; text: string; unanswered?: true } | null;

/** Chantier naval de l'onglet Carte : chaque classe de navire à son prix, et son achat (4.6). */
export function Shipyard(props: {
  ships: ShipRow[] | null;
  rules: ShipRules | null;
  reloadShips: () => Promise<ShipRow[] | null>;
  reloadFleet: () => Promise<unknown>;
}) {
  const { ships, rules } = props;
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const money = useMoney();
  const number = new Intl.NumberFormat(i18n.language);
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
  const recalled = useRef(false);
  // Le bouton qui a lancé l'achat a pu devenir inactif : le foyer, retombé sur la page, va au message.
  const noticeElement = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (active === document.body || active?.matches(':disabled') === true)
      noticeElement.current?.focus();
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
      <h2 className="flex items-center gap-2 text-xl">
        <Hammer aria-hidden="true" className="size-5 shrink-0 text-accent" />
        {t('map.shipyard')}
      </h2>
      <p className="text-muted-foreground">{t('map.shipyardIntro', { city: house.cityName })}</p>
      {rules?.classes.length === 0 && <p>{t('map.noClasses')}</p>}
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
            <Button
              className="w-full sm:w-auto"
              disabled={busy || ships === null}
              onClick={() => void buy(shipClass.id, shipClass.purchaseCostOboles)}
            >
              {t('map.buy', { cost: money(shipClass.purchaseCostOboles) })}
            </Button>
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
