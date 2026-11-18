import { Button } from '@oikos/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { reportMessage } from '../api';
import { ALERT_BOX, STATUS_BOX } from './CommandNotice';
import { useHouse } from '../house';
import { pendingKeys, sendUnderKey } from '../pending-keys';

const session = () => window.sessionStorage;

/**
 * « Signaler » sous un message d'une autre maison (#275) : un motif de la configuration, puis l'envoi. Un message
 * déjà signalé est dit tel. Le même signalement resté sans réponse repart sous la même clé. Envoyé, le choix
 * disparaît et le foyer passe sur le résultat ; annulé, il revient au bouton.
 */
export function ReportMessage({
  messageId,
  author,
  reasons,
  reported,
  onReported,
}: {
  messageId: string;
  /** Nom de la maison qui a écrit le message, pour nommer le bouton. */
  author: string;
  reasons: readonly string[];
  reported: boolean;
  onReported: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const house = useHouse();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(reasons[0] ?? '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'status' | 'alert'; text: string } | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const choice = useRef<HTMLSelectElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const keys = pendingKeys(`report.${house.id}`, session);
  useEffect(() => {
    if (open) choice.current?.focus();
  }, [open]);
  const label = (value: string) => t(`reports.reasons.${value}`, { defaultValue: value });

  async function send() {
    if (busy || !reasons.includes(reason)) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await sendUnderKey(
        keys,
        `report:${messageId}:${reason}`,
        () => crypto.randomUUID(),
        { reason },
        (key) => reportMessage(messageId, reason, house.accessToken, key),
      );
      // Déjà signalé (sur un autre appareil, ou réponse perdue) : le but est atteint.
      if (result.ok || result.error.code === 'ALREADY_REPORTED') {
        setOpen(false);
        setNotice({ kind: 'status', text: t('reports.sent') });
        // Le choix disparaît : le foyer passe sur le résultat.
        status.current?.focus();
        await onReported();
      } else
        setNotice({ kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {reported ? (
        <p className="text-sm text-muted-foreground">{t('reports.reported')}</p>
      ) : open ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={id} className="text-sm font-semibold">
              {t('reports.reason', { house: author })}
            </label>
            <select
              id={id}
              ref={choice}
              value={reason}
              className="min-h-11 max-w-full rounded-md border border-border bg-surface px-2"
              onChange={(event) => setReason(event.target.value)}
            >
              {reasons.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="submit"
            aria-disabled={busy}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          >
            {t('reports.send')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setOpen(false);
              setNotice(null);
              setTimeout(() => opener.current?.focus());
            }}
          >
            {t('reports.cancel')}
          </Button>
        </form>
      ) : (
        <div>
          <Button
            ref={opener}
            type="button"
            variant="ghost"
            className="text-sm"
            aria-label={t('reports.open', { house: author })}
            onClick={() => setOpen(true)}
          >
            {t('reports.button')}
          </Button>
        </div>
      )}
      {/* Régions présentes avant leur texte : le résultat est annoncé près de l'action. */}
      <p role="status" tabIndex={-1} ref={status} className={STATUS_BOX + ' text-sm'}>
        {notice?.kind === 'status' ? notice.text : ''}
      </p>
      <p role="alert" className={ALERT_BOX + ' text-sm'}>
        {notice?.kind === 'alert' ? notice.text : ''}
      </p>
    </div>
  );
}
