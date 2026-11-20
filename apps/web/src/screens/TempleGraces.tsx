import { Bird, Button, EmptyState, GodEmblem, LoaderCircle, Sheet, StatusRegion } from '@oikos/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invokeGrace } from '../api';
import { useRows } from '../data';
import { graceStates, parseGraceUses, type GraceShown } from '../graces';
import { useHouse } from '../house';
import { pendingKeys, sendUnderKey } from '../pending-keys';
import { serverClock } from '../server-clock';
import type { TempleRules } from '../temple';
import { noticeClass, type Notice } from './CommandNotice';
import { LoadProblem, Loading } from './LoadProblem';

const COLUMNS =
  'id, house_id, grace_id, god_id, effect, magnitude_bps, charis_spent, invoked_at, ready_at, consumed_at';
const EFFECTS = ['blessed_harvest', 'inspired_workshop', 'fair_wind'];

/**
 * Grâces du temple (7.1) : chacune avec son effet, son coût et son état pour la maison (en attente de son action,
 * en recharge jusqu'à une date, à invoquer, ou Charis insuffisante), d'après `temple_rules`, `my_graces` et
 * `my_favor`, à l'heure du serveur relue chaque minute. Son bouton, qui nomme la Charis dépensée, ouvre une feuille
 * (ADR 0011) : le récapitulatif au coût vu, foyer sur la confirmation ; la Charis dépensée part telle quelle. Restée
 * sans réponse, l'invocation repart sous la même clé ; faite, la feuille se ferme et le foyer passe sur le résultat.
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
  const [notice, setNotice] = useState<Notice>(null);
  const done = useRef<HTMLParagraphElement>(null);
  // La feuille fermée, le bouton de la grâce a disparu (elle attend) : le foyer passe sur le résultat.
  useEffect(() => {
    if (notice?.kind === 'status') done.current?.focus();
  }, [notice]);
  // Grâce dont la feuille est ouverte ; `null` : fermée.
  const [chosen, setChosen] = useState<string | null>(null);
  const open = items?.find(({ grace }) => grace.id === chosen);
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
      if (result.ok) setChosen(null);
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

  const close = () => {
    // Invocation en vol : la feuille reste ouverte, pour que son issue y soit dite.
    if (busy) return;
    setChosen(null);
    setNotice(null);
  };
  const spentOf = (grace: GraceShown) => number.format(grace.charisSpent ?? 0);
  const line = (term: string, value: string) => (
    <div className="flex flex-wrap justify-between gap-x-4 py-2">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );

  return (
    <>
      <h2 ref={title} tabIndex={-1} className="flex items-center gap-2 text-xl">
        <Bird aria-hidden="true" className="size-5 shrink-0 text-accent" />
        {t('temple.graces.title')}
      </h2>
      {read.rows === null && !read.failed && <Loading />}
      {(read.failed || (read.rows !== null && uses === null)) && (
        <LoadProblem heading={title} onRetry={() => read.reload()} />
      )}
      {items?.length === 0 && (
        <EmptyState compact illustration="noEvent" title={t('temple.graces.none')} />
      )}
      {items && items.length > 0 && (
        <ul className="flex flex-col divide-y divide-border-subtle sm:gap-3 sm:divide-y-0">
          {items.map(({ grace, state }) => (
            <li
              key={grace.id}
              className="flex items-start gap-3 py-3 break-words first:pt-0 last:pb-0 sm:rounded-xl sm:border sm:border-border-subtle sm:bg-surface-raised sm:p-4 sm:first:pt-4 sm:last:pb-4"
            >
              <GodEmblem godId={grace.godId} size={40} className="size-10 shrink-0 text-accent" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h3 className="font-semibold">{name(grace)}</h3>
                <p>
                  {EFFECTS.includes(grace.effect)
                    ? t(`temple.graces.effect.${grace.effect}`, {
                        percent: percent.format(grace.magnitudeBps / 10_000),
                      })
                    : t('temple.graces.effect.unknown')}
                </p>
                {grace.charisRequired !== undefined && (
                  <p className="text-sm text-muted-foreground">
                    {t('temple.graces.cost', {
                      count: grace.cooldownDays,
                      god: godName(grace.godId),
                      required: number.format(grace.charisRequired),
                      spent: spentOf(grace),
                    })}
                  </p>
                )}
                {state.kind === 'ready' ? (
                  <Button
                    className="mt-1 max-w-full self-start text-wrap wrap-anywhere"
                    aria-haspopup="dialog"
                    disabled={busy}
                    onClick={() => setChosen(grace.id)}
                  >
                    {t('temple.graces.invoke', { grace: name(grace), spent: spentOf(grace) })}
                  </Button>
                ) : (
                  <p
                    className={`mt-1 self-start rounded-lg px-3 py-1.5 text-sm font-medium ${state.kind === 'short' ? 'bg-warning-subtle text-warning' : 'bg-muted'}`}
                  >
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
              </div>
            </li>
          ))}
        </ul>
      )}
      {/* Région présente avant son texte : l'invocation faite s'annonce sous les grâces. */}
      <p ref={done} role="status" tabIndex={-1} className={noticeClass('status')}>
        {notice?.kind === 'status' ? notice.text : ''}
      </p>
      <Sheet
        open={open !== undefined}
        onClose={close}
        title={open ? name(open.grace) : ''}
        description={t('temple.graces.sheet')}
        closeLabel={t('shell.close')}
        closeDisabled={busy}
        footer={
          open && (
            <Button
              autoFocus
              // Inactif par `aria-disabled` pendant l'envoi : refusée, la confirmation garde le foyer.
              aria-disabled={busy}
              aria-busy={busy || undefined}
              icon={busy ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : undefined}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
              disabled={open.state.kind !== 'ready'}
              onClick={() => void invoke(open.grace, open.grace.charisSpent ?? 0)}
            >
              {t('temple.graces.confirm', { spent: spentOf(open.grace) })}
            </Button>
          )
        }
      >
        {open && (
          <div className="flex flex-col gap-3">
            <p>
              {EFFECTS.includes(open.grace.effect)
                ? t(`temple.graces.effect.${open.grace.effect}`, {
                    percent: percent.format(open.grace.magnitudeBps / 10_000),
                  })
                : t('temple.graces.effect.unknown')}
            </p>
            <dl className="divide-y divide-border-subtle rounded-lg border border-border-subtle px-3 tabular-nums">
              {line(t('temple.graces.recapSpent'), `−${spentOf(open.grace)}`)}
              {line(
                t('temple.graces.recapAfter', { god: godName(open.grace.godId) }),
                number.format(
                  (props.favor.get(open.grace.godId) ?? 0) - (open.grace.charisSpent ?? 0),
                ),
              )}
              {line(
                t('temple.graces.recapCooldown'),
                t('temple.graces.days', { count: open.grace.cooldownDays ?? 0 }),
              )}
            </dl>
            <p className="text-sm text-muted-foreground">{t('temple.graces.recapNote')}</p>
            <StatusRegion role="alert" tone="danger">
              {notice?.kind === 'alert' && notice.text}
            </StatusRegion>
          </div>
        )}
      </Sheet>
    </>
  );
}
