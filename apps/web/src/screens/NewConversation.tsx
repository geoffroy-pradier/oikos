import { houseNameSchema } from '@oikos/contracts';
import { Button } from '@oikos/ui';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { openDirect } from '../api';
import { ALERT_BOX, STATUS_BOX } from './CommandNotice';
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
 * `chat.openDirect`, qui ouvre la conversation ou rend celle qui existe. `onOpened` la sélectionne.
 */
export function NewConversation({
  worldId,
  onOpened,
}: {
  worldId: string;
  onOpened: (channelId: string) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const house = useHouse();
  const id = useId();
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
        setNotice({ kind: 'status', text: t('messages.opened', { house: found.name }) });
        await onOpened(result.data.channelId);
      } else
        setNotice({ kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-2 border-t border-border-subtle pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        void open();
      }}
    >
      <label htmlFor={id} className="font-semibold">
        {t('messages.newConversation')}
      </label>
      <input
        id={id}
        value={name}
        autoComplete="off"
        className="min-h-11 w-full rounded-lg border border-border bg-surface px-2"
        onChange={(event) => setName(event.target.value)}
      />
      <Button
        type="submit"
        aria-disabled={busy}
        className="self-start aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
      >
        {t('messages.open')}
      </Button>
      <p role="status" className={STATUS_BOX}>
        {notice?.kind === 'status' ? notice.text : ''}
      </p>
      <p role="alert" className={ALERT_BOX}>
        {notice?.kind === 'alert' ? notice.text : ''}
      </p>
    </form>
  );
}
