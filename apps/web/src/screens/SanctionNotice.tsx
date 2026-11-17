import { Card } from '@oikos/ui';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRows } from '../data';
import {
  currentSanctions,
  nextSanctionEnd,
  SANCTION_COLUMNS,
  SANCTIONED_EVENT,
  type Sanction,
} from '../moderation';
import { serverClock } from '../server-clock';

/** Au-delà, `setTimeout` déborde : la liste se recalcule au plus tard à cette échéance. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Sanctions du compte (#275), annoncées en tête de chaque écran tant qu'elles ne sont pas finies : leur effet, leur
 * motif, leur fin, et le moyen d'en faire appel, une fois. Relues à chaque refus d'une commande pour une sanction,
 * et à la fin de la plus proche, à l'heure du serveur.
 */
export function SanctionNotice() {
  const { t } = useTranslation();
  const read = useRows<unknown>('my_sanctions', SANCTION_COLUMNS, 'starts_at');
  const { reload } = read;
  const [tick, setTick] = useState(0);
  const sanctions = useMemo(
    () => (read.rows === null ? null : currentSanctions(read.rows, serverClock.now().getTime())),
    // `tick` recalcule la liste à la fin d'une sanction.
    [read.rows, tick],
  );
  useEffect(() => {
    const again = () => void reload();
    window.addEventListener(SANCTIONED_EVENT, again);
    return () => window.removeEventListener(SANCTIONED_EVENT, again);
  }, [reload]);
  const end = sanctions ? nextSanctionEnd(sanctions) : null;
  useEffect(() => {
    if (end === null) return;
    const wait = Math.min(MAX_TIMER_MS, Math.max(0, end - serverClock.now().getTime()) + 1_000);
    const timer = setTimeout(() => setTick((n) => n + 1), wait);
    return () => clearTimeout(timer);
  }, [end]);

  if (!sanctions || sanctions.length === 0) return null;
  return (
    <Card className="mb-4 flex flex-col gap-3 border-2 border-primary">
      <h2 className="text-xl">{t('sanctions.title')}</h2>
      <ul className="flex flex-col gap-3">
        {sanctions.map((sanction) => (
          <SanctionItem key={sanction.id} sanction={sanction} />
        ))}
      </ul>
    </Card>
  );
}

function SanctionItem({ sanction }: { sanction: Sanction }) {
  const { t, i18n } = useTranslation();
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long', timeStyle: 'short' });
  const future = sanction.startsAt > serverClock.now().getTime();
  return (
    <li className="flex flex-col gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0">
      <h3 className="font-semibold">{t(`sanctions.kind.${sanction.kind}`)}</h3>
      <p>{t(`sanctions.effect.${sanction.kind}`)}</p>
      <p className="break-words">{t('sanctions.reason', { reason: sanction.reason })}</p>
      {future && <p>{t('sanctions.starts', { date: date.format(sanction.startsAt) })}</p>}
      <p>
        {sanction.endsAt === null
          ? t('sanctions.permanent')
          : t('sanctions.until', { date: date.format(sanction.endsAt) })}
      </p>
      {sanction.appealedAt !== null && (
        <>
          <p>{t('sanctions.appealed', { date: date.format(sanction.appealedAt) })}</p>
          <blockquote className="border-l-2 border-border pl-3 break-words whitespace-pre-wrap">
            {sanction.appealBody}
          </blockquote>
        </>
      )}
    </li>
  );
}
