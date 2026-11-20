import { houseNameSchema } from '@oikos/contracts';
import { Button, LoaderCircle, MessagesSquare, Plus, Sheet, TextField } from '@oikos/ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { openDirect } from '../api';
import { useHouse } from '../house';
import { supabase } from '../supabase';

type Notice = { kind: 'status' | 'alert'; text: string } | null;

/** Maison du monde nommée ainsi, sans tenir compte de la casse (les noms y sont uniques) ; `null` : aucune. */
async function findHouse(worldId: string, name: string) {
  const result = await supabase
    .from('houses')
    .select('id, name')
    .eq('world_id', worldId)
    .ilike('name', name)
    .limit(1)
    .then(
      (response) => response,
      () => null,
    );
  if (!result || result.error) return undefined;
  const [row] = (result.data as { id: string; name: string }[] | null) ?? [];
  return row ?? null;
}

/**
 * Nouvelle conversation privée avec une maison nommée, du monde de la maison (6.6) : son nom, puis
 * `chat.openDirect`, qui ouvre la conversation ou rend celle qui existe. `onOpened` la sélectionne. Le nom se saisit
 * dans une feuille (ADR 0011), refus dits sous le champ ; ouverte, la feuille se ferme et l'écran l'annonce.
 */
export function NewConversation({
  worldId,
  onOpened,
}: {
  worldId: string;
  /** La conversation ouverte, et le nom de la maison, pour l'annonce que l'écran en fait. */
  onOpened: (channelId: string, house: string) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const house = useHouse();
  const [shown, setShown] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const keys = useRef(new Map<string, string>());

  async function open() {
    if (busy) return;
    const wanted = houseNameSchema.safeParse(name.trim());
    if (!wanted.success) {
      setNotice({ kind: 'alert', text: t('messages.noSuchHouse') });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const found = await findHouse(worldId, wanted.data);
      if (found === undefined) {
        setNotice({ kind: 'alert', text: t('errors.INTERNAL') });
        return;
      }
      if (found === null) {
        setNotice({ kind: 'alert', text: t('messages.noSuchHouse') });
        return;
      }
      const key = keys.current.get(found.id) ?? crypto.randomUUID();
      keys.current.set(found.id, key);
      const result = await openDirect(found.id, house.accessToken, key);
      if (result.ok || result.error.code !== 'INTERNAL') keys.current.delete(found.id);
      if (result.ok) {
        setName('');
        setShown(false);
        await onOpened(result.data.channelId, found.name);
      } else
        setNotice({ kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        icon={<Plus aria-hidden="true" />}
        aria-haspopup="dialog"
        onClick={() => {
          setNotice(null);
          setShown(true);
        }}
      >
        {t('messages.newConversationOpen')}
      </Button>
      <Sheet
        open={shown}
        onClose={() => {
          // Recherche en vol : la feuille reste ouverte, pour que son issue y soit dite.
          if (busy) return;
          setShown(false);
          setNotice(null);
        }}
        title={t('messages.newConversationOpen')}
        description={t('messages.newConversationHint')}
        closeLabel={t('shell.close')}
        closeDisabled={busy}
        footer={
          // Inactif par `aria-disabled` pendant la recherche : refusée, le bouton garde le foyer.
          <Button
            type="submit"
            form="new-conversation"
            aria-disabled={busy}
            aria-busy={busy || undefined}
            icon={
              busy ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <MessagesSquare aria-hidden="true" />
              )
            }
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          >
            {t('messages.open')}
          </Button>
        }
      >
        <form
          id="new-conversation"
          onSubmit={(event) => {
            event.preventDefault();
            void open();
          }}
        >
          <TextField
            label={t('messages.newConversation')}
            value={name}
            autoFocus
            autoComplete="off"
            error={notice?.kind === 'alert' ? notice.text : undefined}
            onChange={(event) => setName(event.target.value)}
          />
        </form>
      </Sheet>
    </>
  );
}
