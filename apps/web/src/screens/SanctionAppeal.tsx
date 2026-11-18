import { appealBodySchema } from '@oikos/contracts';
import { Button } from '@oikos/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { appealSanction } from '../api';
import { ALERT_BOX, STATUS_BOX } from './CommandNotice';
import { useHouse } from '../house';
import { fingerprint, pendingKeys, sendUnderKey } from '../pending-keys';

const session = () => window.sessionStorage;

/**
 * Appel d'une sanction (#275) : un formulaire ouvert par son bouton, au clavier. Le même texte resté sans réponse
 * repart sous la même clé ; un autre texte prend une clé neuve. Envoyé, le formulaire disparaît et le foyer passe
 * sur le résultat ; annulé, il revient au bouton.
 */
export function SanctionAppeal({
  sanctionId,
  appealed,
  onAppealed,
}: {
  sanctionId: string;
  /** Appel déjà fait : ni bouton ni formulaire, mais le résultat de l'envoi reste annoncé, avec le foyer. */
  appealed: boolean;
  onAppealed: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const house = useHouse();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'status' | 'alert'; text: string } | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const keys = pendingKeys(`appeal.${house.id}`, session);
  useEffect(() => {
    if (open) box.current?.focus();
  }, [open]);

  async function send() {
    if (busy) return;
    const body = appealBodySchema.safeParse(text);
    if (!body.success) return setNotice({ kind: 'alert', text: t('sanctions.invalid') });
    setBusy(true);
    setNotice(null);
    try {
      const result = await sendUnderKey(
        keys,
        `appeal:${sanctionId}:${fingerprint(body.data)}`,
        () => crypto.randomUUID(),
        { body: body.data },
        (key) => appealSanction(sanctionId, body.data, house.accessToken, key),
      );
      if (result.ok) {
        setOpen(false);
        setText('');
        setNotice({ kind: 'status', text: t('sanctions.appealSent') });
        // Le formulaire disparaît : le foyer passe sur le résultat.
        status.current?.focus();
        await onAppealed();
      } else
        setNotice({ kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {appealed ? null : open ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label htmlFor={id} className="font-semibold">
            {t('sanctions.appealLabel')}
          </label>
          <textarea
            id={id}
            ref={box}
            value={text}
            rows={4}
            aria-describedby={`${id}-hint`}
            className="w-full rounded-lg border border-border bg-surface p-3"
            onChange={(event) => setText(event.target.value)}
          />
          <p id={`${id}-hint`} className="text-sm text-muted-foreground">
            {t('sanctions.appealHint')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              aria-disabled={busy}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            >
              {t('sanctions.send')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setNotice(null);
                // Le bouton revient au prochain rendu : le foyer le suit alors.
                setTimeout(() => opener.current?.focus());
              }}
            >
              {t('sanctions.cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button ref={opener} type="button" variant="secondary" onClick={() => setOpen(true)}>
            {t('sanctions.appeal')}
          </Button>
        </div>
      )}
      {/* Régions présentes avant leur texte : le résultat est annoncé près de l'action. */}
      <p role="status" tabIndex={-1} ref={status} className={STATUS_BOX}>
        {notice?.kind === 'status' ? notice.text : ''}
      </p>
      <p role="alert" className={ALERT_BOX}>
        {notice?.kind === 'alert' ? notice.text : ''}
      </p>
    </>
  );
}
