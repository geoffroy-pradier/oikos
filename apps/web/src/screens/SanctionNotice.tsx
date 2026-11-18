import { Button, Card, TriangleAlert } from '@oikos/ui';
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
        <Card elevation="raised" className="mb-4 flex flex-col gap-3 border-2 border-primary">
          <h2 className="text-xl">
            <TriangleAlert
              aria-hidden="true"
              className="mr-2 inline size-5 align-[-0.15em] text-primary"
            />
            {t('sanctions.title')}
          </h2>
          <ul className="flex flex-col gap-3">
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
        </Card>
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
    <li className="flex flex-col gap-1 rounded-lg bg-muted/50 p-3">
      <h3 id={heading} className="font-semibold">
        {t(`sanctions.kind.${sanction.kind}`)}
      </h3>
      {!ended && <p>{t(`sanctions.effect.${sanction.kind}`)}</p>}
      <p className="break-words">{t('sanctions.reason', { reason: sanction.reason })}</p>
      {future && <p>{t('sanctions.starts', { date: date.format(sanction.startsAt) })}</p>}
      <p>
        {sanction.endsAt === null
          ? t('sanctions.permanent')
          : t(ended ? 'sanctions.ended' : 'sanctions.until', {
              date: date.format(sanction.endsAt),
            })}
      </p>
      {sanction.appealedAt !== null && (
        <>
          <p>{t('sanctions.appealed', { date: date.format(sanction.appealedAt) })}</p>
          <blockquote className="border-l-4 border-accent pl-3 break-words whitespace-pre-wrap">
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
      {ended ? (
        <div>
          <Button type="button" variant="ghost" aria-describedby={heading} onClick={onDismiss}>
            {t('sanctions.dismiss')}
          </Button>
        </div>
      ) : (
        <SanctionAppeal
          sanctionId={sanction.id}
          appealed={sanction.appealedAt !== null}
          onAppealed={onAppealed}
        />
      )}
    </li>
  );
}
