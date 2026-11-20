import { messageBodySchema } from '@oikos/contracts';
import { Button, Send } from '@oikos/ui';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { postMessage } from '../api';
import { ALERT_BOX, STATUS_BOX } from './CommandNotice';
import { useHouse } from '../house';
import { fingerprint, pendingKeys, sendUnderKey } from '../pending-keys';

type Notice = { kind: 'status' | 'alert'; text: string } | null;
const session = () => window.sessionStorage;

/**
 * Brouillon d'un canal, gardé en stockage de session : il survit au changement de canal, d'onglet et au
 * rechargement. Sans stockage de session (navigation privée, stockage refusé), il est gardé en mémoire : il
 * survit au changement de canal et d'onglet, pas au rechargement.
 */
const draftKey = (houseId: string, channelId: string) => `oikos.chat.draft.${houseId}.${channelId}`;
const drafts = new Map<string, string>();
const readDraft = (key: string) => {
  try {
    return session().getItem(key) ?? '';
  } catch {
    return drafts.get(key) ?? '';
  }
};
const keepDraft = (key: string, text: string) => {
  try {
    if (text) session().setItem(key, text);
    else session().removeItem(key);
    drafts.delete(key);
  } catch {
    if (text) drafts.set(key, text);
    else drafts.delete(key);
  }
};

/**
 * Saisie d'un message dans le canal ouvert (6.6). Une saisie n'est jamais perdue : brouillon par canal, gardé
 * après un refus ou une réponse perdue, et seulement effacé si le texte envoyé est encore celui de la saisie.
 * Le même message resté sans réponse repart sous la même clé ; un autre texte prend une clé neuve. Ctrl+Entrée
 * (Cmd+Entrée sur Mac) envoie. Le résultat s'annonce sous la saisie, sans déplacer le foyer.
 */
export function MessageComposer({
  channelId,
  label,
  onPosted,
}: {
  channelId: string;
  label: string;
  onPosted: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const house = useHouse();
  const id = useId();
  const key = draftKey(house.id, channelId);
  const [text, setText] = useState(() => readDraft(key));
  const current = useRef(text);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const keys = pendingKeys(`chat.${house.id}`, session);

  const change = (next: string) => {
    current.current = next;
    setText(next);
    keepDraft(key, next);
  };
  async function send() {
    if (busy) return;
    const body = messageBodySchema.safeParse(text);
    if (!body.success) {
      setNotice({ kind: 'alert', text: t('messages.invalid') });
      return;
    }
    setBusy(true);
    setNotice(null);
    // L'intention est le canal et le texte : un autre texte est une autre demande, sous une clé neuve.
    const intent = `post:${channelId}:${fingerprint(body.data)}`;
    try {
      const result = await sendUnderKey(
        keys,
        intent,
        () => crypto.randomUUID(),
        { body: body.data },
        // Toujours le texte de la saisie : sous une clé d'un autre texte (empreintes égales), l'API refuse
        // la clé plutôt que de rejouer un autre message.
        (idempotencyKey) => postMessage(channelId, body.data, house.accessToken, idempotencyKey),
      );
      if (result.ok) {
        if (messageBodySchema.safeParse(current.current).data === body.data) change('');
        setNotice({ kind: 'status', text: t('messages.posted') });
        await onPosted();
      } else
        setNotice({ kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) });
    } finally {
      setBusy(false);
    }
  }

  return (
    // Fixée en bas : au-dessus de la barre d'onglets sur téléphone, au pied du fil sur ordinateur.
    <form
      className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-[1] flex flex-col gap-1.5 rounded-b-xl border-t border-border-subtle bg-surface p-3 lg:static lg:px-5 lg:pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id={id}
          value={text}
          rows={1}
          placeholder={t('messages.placeholder')}
          aria-describedby={`${id}-hint`}
          className="max-h-40 min-h-11 w-full resize-none rounded-xl border border-border bg-surface-raised px-3.5 py-2.5 [field-sizing:content] placeholder:text-muted-foreground focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
          onChange={(event) => change(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <Button
          type="submit"
          icon={<Send aria-hidden="true" />}
          aria-disabled={busy}
          className="min-h-11 shrink-0 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        >
          <span className="max-sm:sr-only">{t('messages.send')}</span>
        </Button>
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground max-lg:sr-only">
        {t('messages.sendHint')}
      </p>
      {/* Régions présentes avant leur texte : le résultat est annoncé là où l'action a été faite. */}
      <p role="status" className={STATUS_BOX + ' text-sm'}>
        {notice?.kind === 'status' ? notice.text : ''}
      </p>
      <p role="alert" className={ALERT_BOX + ' text-sm'}>
        {notice?.kind === 'alert' ? notice.text : ''}
      </p>
    </form>
  );
}
