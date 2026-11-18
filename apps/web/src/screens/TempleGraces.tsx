import { Button } from '@oikos/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invokeGrace } from '../api';
import { useRows } from '../data';
import { graceStates, parseGraceUses, type GraceShown } from '../graces';
import { useHouse } from '../house';
import { pendingKeys, sendUnderKey } from '../pending-keys';
import { serverClock } from '../server-clock';
import type { TempleRules } from '../temple';
import { useCommandNotice } from './CommandNotice';
import { LoadProblem, Loading } from './LoadProblem';

const COLUMNS =
  'id, house_id, grace_id, god_id, effect, magnitude_bps, charis_spent, invoked_at, ready_at, consumed_at';
const EFFECTS = ['blessed_harvest', 'inspired_workshop', 'fair_wind'];

/**
 * Grâces du temple (7.1) : chacune avec son effet, son coût et son état pour la maison (en attente de son action,
 * en recharge jusqu'à une date, à invoquer, ou Charis insuffisante), d'après `temple_rules`, `my_graces` et
 * `my_favor`, à l'heure du serveur relue chaque minute. Une grâce s'invoque d'une touche, son bouton nommant la
 * Charis dépensée, envoyée telle quelle ; restée sans réponse, l'invocation repart sous la même clé.
 */
export function TempleGraces(props: {
  rules: TempleRules;
  favor: ReadonlyMap<string, number>;
  onDone: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const title = useRef<HTMLHeadingElement>(null);
  const read = useRows<unknown>('my_graces', COLUMNS, 'invoked_at', { house_id: house.id });
  const uses = read.rows === null ? null : parseGraceUses(read.rows, house.id);
  const [now, setNow] = useState(() => serverClock.now().getTime());
  useEffect(() => {
    const timer = setInterval(() => setNow(serverClock.now().getTime()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const items = uses && graceStates(props.rules.graces, uses, props.favor, now);
  const keys = useMemo(
    () => pendingKeys(`temple.${house.id}`, () => window.sessionStorage),
    [house.id],
  );
  // Une grâce lue en attente ou en recharge a reçu son invocation : la clé d'un essai sans réponse est rendue.
  const invoked = JSON.stringify(
    (items ?? []).flatMap(({ grace, state }) =>
      state.kind === 'pending' || state.kind === 'recharging' ? [`grace:${grace.id}`] : [],
    ),
  );
  useLayoutEffect(() => {
    const shown = new Set(JSON.parse(invoked) as string[]);
    keys.settleWhere((intent) => shown.has(intent));
  }, [keys, invoked]);
  const [busy, setBusy] = useState(false);
  const { setNotice, region } = useCommandNotice();
  const number = new Intl.NumberFormat(i18n.language);
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 2,
  });
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const godName = (id: string) => t(`gods.${id}`, { defaultValue: id });
  const name = (grace: GraceShown) =>
    t('temple.graces.name', {
      effect: EFFECTS.includes(grace.effect)
        ? t(`temple.graces.effects.${grace.effect}`)
        : grace.effect,
      god: godName(grace.godId),
    });

  async function invoke(grace: GraceShown, spent: number) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      // Sans réponse, la même Charis dépensée repart sous la même clé ; une autre en vigueur est une demande neuve.
      const intent = `grace:${grace.id}`;
      const fresh = () => crypto.randomUUID();
      if (keys.entryFor(intent, fresh, spent).input !== spent) keys.settle(intent);
      const result = await sendUnderKey(keys, intent, fresh, spent, (key, sent) =>
        invokeGrace(grace.id, sent ?? spent, house.accessToken, key),
      );
      setNotice(
        result.ok
          ? {
              kind: 'status',
              text: t('temple.graces.done', {
                grace: name(grace),
                date: date.format(new Date(result.data.readyAt)),
                charis: number.format(result.data.charis),
              }),
            }
          : { kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) },
      );
      await Promise.all([read.reload(), props.onDone()]);
      setNow(serverClock.now().getTime());
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 ref={title} tabIndex={-1} className="text-xl">
        {t('temple.graces.title')}
      </h2>
      {read.rows === null && !read.failed && <Loading />}
      {(read.failed || (read.rows !== null && uses === null)) && (
        <LoadProblem heading={title} onRetry={() => read.reload()} />
      )}
      {items?.length === 0 && <p className="text-muted-foreground">{t('temple.graces.none')}</p>}
      {items && items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map(({ grace, state }) => (
            <li
              key={grace.id}
              className="flex flex-col gap-1 border-t border-border pt-2 first:border-t-0"
            >
              <h3 className="font-semibold">{name(grace)}</h3>
              <p>
                {EFFECTS.includes(grace.effect)
                  ? t(`temple.graces.effect.${grace.effect}`, {
                      percent: percent.format(grace.magnitudeBps / 10_000),
                    })
                  : t('temple.graces.effect.unknown')}
              </p>
              {grace.charisRequired !== undefined && (
                <p className="text-muted-foreground">
                  {t('temple.graces.cost', {
                    count: grace.cooldownDays,
                    god: godName(grace.godId),
                    required: number.format(grace.charisRequired),
                    spent: number.format(grace.charisSpent ?? 0),
                  })}
                </p>
              )}
              {state.kind === 'ready' ? (
                <Button
                  className="self-start"
                  disabled={busy}
                  onClick={() => void invoke(grace, grace.charisSpent ?? 0)}
                >
                  {t('temple.graces.invoke', {
                    grace: name(grace),
                    spent: number.format(grace.charisSpent ?? 0),
                  })}
                </Button>
              ) : (
                <p className="font-medium">
                  {state.kind === 'short'
                    ? t('temple.graces.short', { missing: number.format(state.missing) })
                    : t(
                        state.kind === 'recharging'
                          ? 'temple.graces.recharging'
                          : state.readyAt > now
                            ? 'temple.graces.pendingRecharging'
                            : 'temple.graces.pending',
                        { date: date.format(new Date(state.readyAt)) },
                      )}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {region}
    </>
  );
}
