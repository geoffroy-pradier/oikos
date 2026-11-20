import { Button, EyeOff, ShieldAlert } from '@oikos/ui';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRows } from '../data';
import { useHouse } from '../house';
import {
  APPEAL_DECISION_COLUMNS,
  appealDecisions,
  dismissedDecisions,
  nextSanctionEnd,
  noticedSanctions,
  SANCTION_COLUMNS,
  sanctionEnded,
  SANCTIONED_EVENT,
  storeDismissedDecisions,
  type Sanction,
} from '../moderation';
import { serverClock } from '../server-clock';
import { STATUS_BOX } from './CommandNotice';
import { SanctionAppeal } from './SanctionAppeal';

/** Au-delà, `setTimeout` déborde : la liste se recalcule au plus tard à cette échéance. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Sanctions du compte (#275), annoncées en tête de chaque écran tant qu'elles ne sont pas finies : leur effet, leur
 * motif, leur fin, et le moyen d'en faire appel, une fois. La décision sur l'appel (#529) s'y lit ; une sanction
 * finie dont l'appel est tranché (un appel accueilli la lève) reste annoncée jusqu'à ce que le joueur masque cette
 * décision, sur cet appareil. Relues à chaque refus d'une commande pour une sanction, et à la fin de la plus proche,
 * à l'heure du serveur.
 */
export function SanctionNotice() {
  const { t } = useTranslation();
  const read = useRows<unknown>('my_sanctions', SANCTION_COLUMNS, 'starts_at');
  const decisionsRead = useRows<unknown>(
    'my_appeal_decisions',
    APPEAL_DECISION_COLUMNS,
    'decided_at',
  );
  const { reload } = read;
  const reloadDecisions = decisionsRead.reload;
  const [tick, setTick] = useState(0);
  const house = useHouse();
  const [dismissed, setDismissed] = useState(() => dismissedDecisions(house.id));
  const [announce, setAnnounce] = useState('');
  const status = useRef<HTMLParagraphElement>(null);
  // Sans décision lisible, les sanctions s'annoncent quand même : seule la décision manque.
  const decisions = useMemo(
    () => (decisionsRead.rows === null ? null : appealDecisions(decisionsRead.rows)) ?? new Map(),
    [decisionsRead.rows],
  );
  const now = useMemo(
    () => serverClock.now().getTime(),
    // `tick` relit l'heure à la fin d'une sanction.
    [read.rows, decisions, dismissed, tick],
  );
  const sanctions = useMemo(
    () => (read.rows === null ? null : noticedSanctions(read.rows, decisions, dismissed, now)),
    [read.rows, decisions, dismissed, now],
  );
  useEffect(() => {
    const again = () => void Promise.all([reload(), reloadDecisions()]);
    window.addEventListener(SANCTIONED_EVENT, again);
    return () => window.removeEventListener(SANCTIONED_EVENT, again);
  }, [reload, reloadDecisions]);
  const end = sanctions ? nextSanctionEnd(sanctions, now) : null;
  useEffect(() => {
    if (end === null) return;
    const wait = Math.min(MAX_TIMER_MS, Math.max(0, end - serverClock.now().getTime()) + 1_000);
    const timer = setTimeout(() => setTick((n) => n + 1), wait);
    return () => clearTimeout(timer);
  }, [end]);

  function dismiss(id: string) {
    const next = new Set(dismissed).add(id);
    storeDismissedDecisions(house.id, next);
    setDismissed(next);
    setAnnounce(t('sanctions.dismissed'));
    // L'avis disparaît : le foyer passe sur l'annonce, toujours présente.
    status.current?.focus();
  }

  const shown = sanctions !== null && sanctions.length > 0;
  return (
    <>
      {shown && (
        // Bandeau en tête de l'écran (ADR 0011) : l'appel s'écrit dans une feuille, rien n'y reste ouvert.
        <section
          aria-labelledby="sanctions-title"
          className="mb-4 flex animate-rise flex-col gap-3 rounded-xl border border-danger/40 bg-danger-subtle p-4"
        >
          <h2 id="sanctions-title" className="flex items-center gap-2 text-lg text-danger">
            <ShieldAlert aria-hidden="true" className="size-5 shrink-0" />
            {t('sanctions.title')}
          </h2>
          <ul className="flex flex-col divide-y divide-danger/20">
            {sanctions.map((sanction) => (
              <SanctionItem
                key={sanction.id}
                sanction={sanction}
                now={now}
                onAppealed={reload}
                onDismiss={() => dismiss(sanction.id)}
              />
            ))}
          </ul>
        </section>
      )}
      {/* Région présente avant son texte dès qu'un avis s'affiche, et gardée après le dernier masqué tant qu'elle
          annonce ; jamais en display:none. Sans rien à annoncer, aucune région : l'écran garde la sienne seule. */}
      {(shown || announce !== '') && (
        <p role="status" tabIndex={-1} ref={status} className={STATUS_BOX}>
          {announce}
        </p>
      )}
    </>
  );
}

function SanctionItem({
  sanction,
  now,
  onAppealed,
  onDismiss,
}: {
  sanction: Sanction;
  now: number;
  onAppealed: () => Promise<unknown>;
  onDismiss: () => void;
}) {
  const { t, i18n } = useTranslation();
  const heading = useId();
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long', timeStyle: 'short' });
  const ended = sanctionEnded(sanction, now);
  const future = sanction.startsAt > now;
  return (
    <li className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h3 id={heading} className="text-base font-semibold">
          {t(`sanctions.kind.${sanction.kind}`)}
        </h3>
        {future && <p>{t('sanctions.starts', { date: date.format(sanction.startsAt) })}</p>}
        <p>
          {sanction.endsAt === null
            ? t('sanctions.permanent')
            : t(ended ? 'sanctions.ended' : 'sanctions.until', {
                date: date.format(sanction.endsAt),
              })}
        </p>
      </div>
      {!ended && <p>{t(`sanctions.effect.${sanction.kind}`)}</p>}
      <p className="break-words">{t('sanctions.reason', { reason: sanction.reason })}</p>
      {sanction.appealedAt !== null && (
        <>
          <p>{t('sanctions.appealed', { date: date.format(sanction.appealedAt) })}</p>
          <blockquote className="border-l-2 border-danger/40 pl-3 break-words whitespace-pre-wrap italic">
            {sanction.appealBody}
          </blockquote>
        </>
      )}
      {sanction.decision !== null && (
        <p className="font-semibold">
          {t(`sanctions.decision.${sanction.decision.decision}`, {
            date: date.format(sanction.decision.decidedAt),
          })}
        </p>
      )}
      <div className="mt-1 flex flex-col">
        {ended ? (
          <Button
            icon={<EyeOff aria-hidden="true" />}
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 self-start"
            aria-describedby={heading}
            onClick={onDismiss}
          >
            {t('sanctions.dismiss')}
          </Button>
        ) : (
          <SanctionAppeal
            sanctionId={sanction.id}
            appealed={sanction.appealedAt !== null}
            describedBy={heading}
            name={t(`sanctions.kind.${sanction.kind}`)}
            onAppealed={onAppealed}
          />
        )}
      </div>
    </li>
  );
}
