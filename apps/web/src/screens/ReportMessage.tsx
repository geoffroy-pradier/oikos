import { Button, Flag, LoaderCircle, Select, Sheet, StatusRegion, X } from '@oikos/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { reportMessage } from '../api';
import { STATUS_BOX } from './CommandNotice';
import { useHouse } from '../house';
import { pendingKeys, sendUnderKey } from '../pending-keys';

const session = () => window.sessionStorage;

/**
 * « Signaler » sous un message d'une autre maison (#275) : un motif de la configuration, puis l'envoi. Un message
 * déjà signalé est dit tel. Le même signalement resté sans réponse repart sous la même clé. Le motif se choisit
 * dans une feuille (ADR 0011), foyer sur ce choix, un refus y est dit ; envoyé, la feuille se ferme et le foyer passe
 * sur le résultat, sous le message ; annulé, il revient au bouton.
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
  const status = useRef<HTMLParagraphElement>(null);
  const keys = pendingKeys(`report.${house.id}`, session);
  // La feuille fermée, son bouton a disparu : le foyer passe sur le résultat.
  useEffect(() => {
    if (notice?.kind === 'status') status.current?.focus();
  }, [notice]);
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
        await onReported();
      } else
        setNotice({ kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) });
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    // Envoi en vol : la feuille reste ouverte, pour que son issue y soit dite.
    if (busy) return;
    setOpen(false);
    setNotice(null);
    // La feuille fermée, le foyer revient au bouton, même ouvert sans lui avoir donné le foyer.
    setTimeout(() => opener.current?.focus());
  };

  return (
    <div className="flex flex-col gap-1">
      {reported ? (
        <p className="text-xs text-muted-foreground">{t('reports.reported')}</p>
      ) : (
        <Button
          ref={opener}
          type="button"
          variant="ghost"
          size="sm"
          className="-mb-1 -ml-2 h-8 self-start px-2 text-xs text-muted-foreground"
          icon={<Flag aria-hidden="true" />}
          aria-haspopup="dialog"
          aria-label={t('reports.open', { house: author })}
          onClick={() => setOpen(true)}
        >
          {t('reports.button')}
        </Button>
      )}
      {/* Région présente avant son texte : le signalement envoyé s'annonce sous le message. */}
      <p role="status" tabIndex={-1} ref={status} className={STATUS_BOX + ' text-sm'}>
        {notice?.kind === 'status' ? notice.text : ''}
      </p>
      <Sheet
        open={open && !reported}
        onClose={close}
        title={t('reports.open', { house: author })}
        description={t('reports.description')}
        closeLabel={t('shell.close')}
        closeDisabled={busy}
        footer={
          <>
            <Button
              icon={<X aria-hidden="true" />}
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={close}
            >
              {t('reports.cancel')}
            </Button>
            {/* Inactif par `aria-disabled` pendant l'envoi : refusé, le bouton garde le foyer. */}
            <Button
              type="submit"
              form={id}
              aria-disabled={busy}
              aria-busy={busy || undefined}
              icon={
                busy ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <Flag aria-hidden="true" />
                )
              }
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            >
              {t('reports.send')}
            </Button>
          </>
        }
      >
        <form
          id={id}
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Select
            label={t('reports.reason', { house: author })}
            quiet
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            {reasons.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </Select>
          <StatusRegion role="alert" tone="danger">
            {notice?.kind === 'alert' && notice.text}
          </StatusRegion>
        </form>
      </Sheet>
    </div>
  );
}
