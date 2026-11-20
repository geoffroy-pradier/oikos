import { appealBodySchema } from '@oikos/contracts';
import { Button, LoaderCircle, Scale, Sheet, StatusRegion } from '@oikos/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { appealSanction } from '../api';
import { STATUS_BOX } from './CommandNotice';
import { useHouse } from '../house';
import { fingerprint, pendingKeys, sendUnderKey } from '../pending-keys';

const session = () => window.sessionStorage;

/**
 * Appel d'une sanction (#275) : une feuille ouverte par son bouton (ADR 0011), foyer sur le texte. Le même texte
 * resté sans réponse repart sous la même clé ; un autre texte prend une clé neuve. Un refus se dit dans la feuille ;
 * envoyé, la feuille se ferme et le foyer passe sur le résultat, sous l'avis ; annulé, il revient au bouton.
 */
export function SanctionAppeal({
  sanctionId,
  appealed,
  onAppealed,
  describedBy,
  name,
}: {
  sanctionId: string;
  /** Appel déjà fait : ni bouton ni formulaire, mais le résultat de l'envoi reste annoncé, avec le foyer. */
  appealed: boolean;
  onAppealed: () => Promise<unknown>;
  /** Titre de la sanction, qui décrit le bouton : deux sanctions ont chacune leur « Faire appel ». */
  describedBy?: string;
  /** Nom de la sanction (« Avertissement »), qui titre la feuille. */
  name: string;
}) {
  const { t } = useTranslation();
  const house = useHouse();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'status' | 'alert'; text: string } | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const keys = pendingKeys(`appeal.${house.id}`, session);
  // La feuille fermée, son bouton a disparu : le foyer passe sur le résultat.
  useEffect(() => {
    if (notice?.kind === 'status') status.current?.focus();
  }, [notice]);

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
        await onAppealed();
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
    <>
      {!appealed && (
        <Button
          ref={opener}
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          icon={<Scale aria-hidden="true" />}
          aria-haspopup="dialog"
          aria-describedby={describedBy}
          onClick={() => setOpen(true)}
        >
          {t('sanctions.appeal')}
        </Button>
      )}
      {/* Région présente avant son texte : l'appel envoyé s'annonce sous l'avis. */}
      <p role="status" tabIndex={-1} ref={status} className={STATUS_BOX + ' text-sm'}>
        {notice?.kind === 'status' ? notice.text : ''}
      </p>
      <Sheet
        open={open && !appealed}
        onClose={close}
        title={t('sanctions.appealTitle', { kind: name })}
        closeLabel={t('shell.close')}
        closeDisabled={busy}
        footer={
          <>
            <Button type="button" variant="secondary" disabled={busy} onClick={close}>
              {t('sanctions.cancel')}
            </Button>
            {/* Inactif par `aria-disabled` pendant l'envoi : refusé, l'appel garde le foyer. */}
            <Button
              type="submit"
              form={id}
              aria-disabled={busy}
              aria-busy={busy || undefined}
              icon={busy ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : undefined}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            >
              {t('sanctions.send')}
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
          <label htmlFor={`${id}-text`} className="font-medium">
            {t('sanctions.appealLabel')}
          </label>
          <textarea
            id={`${id}-text`}
            value={text}
            rows={6}
            autoFocus
            aria-describedby={`${id}-hint`}
            className="w-full rounded-lg border border-border bg-surface-raised p-3.5 focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
            onChange={(event) => setText(event.target.value)}
          />
          <p id={`${id}-hint`} className="text-sm text-muted-foreground">
            {t('sanctions.appealHint')}
          </p>
          <StatusRegion role="alert" tone="danger">
            {notice?.kind === 'alert' && notice.text}
          </StatusRegion>
        </form>
      </Sheet>
    </>
  );
}
