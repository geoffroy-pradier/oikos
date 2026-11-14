import { CONFIG_EDITOR_ROLES, type AdminRole } from '@oikos/contracts';
import { Button } from '@oikos/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminCommand, adminGet } from '../api';
import { diffConfigs } from '../diff';
import { LoadError } from '../LoadError';
import { useAdmin } from '../useAdmin';

interface Listing {
  activeVersionId: string | null;
  versions: {
    id: string;
    number: number;
    note: string;
    createdBy: string | null;
    createdAt: string;
  }[];
  activations: { versionId: string; activateAt: string; cancelledAt?: string | null }[];
}
interface Detail {
  id: string;
  number: number;
  config: unknown;
}
type Notice = { kind: 'status' | 'alert'; text: string; fields?: string[] | undefined } | null;
const CONTROL = 'w-full rounded-md border border-border bg-surface px-3';

/**
 * Module Paramètres (15.1, 15.2) : versions de configuration, comparaison avec la version en vigueur,
 * enregistrement d'une nouvelle version, programmation à la prochaine clôture, retour arrière.
 * Le schéma et les droits sont contrôlés par l'API ; l'écran ne fait que proposer.
 */
export function Config({ accessToken, role }: { accessToken: string; role: AdminRole }) {
  const { t, i18n } = useTranslation();
  const listing = useAdmin<Listing>('config/versions', accessToken);
  const [opened, setOpened] = useState<Detail | null>(null);
  const [active, setActive] = useState<Detail | null>(null);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  // Intention en attente de réponse : la même action renvoyée après une panne réutilise sa clé.
  const pending = useRef<{ intent: string; key: string } | null>(null);
  const canEdit = CONFIG_EDITOR_ROLES.some((editor) => editor === role);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  // Rendu JSON : un changement de type reste visible (`"600" → 600`).
  const show = (value: unknown) => JSON.stringify(value);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    parsed = undefined;
  }
  const isObject = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  const changes = isObject && active ? diffConfigs(active.config, parsed) : null;

  // Dernière ouverture demandée : la réponse d'une ouverture plus ancienne est ignorée, elle
  // remplacerait sans prévenir la version affichée et la saisie en cours.
  const opening = useRef(0);
  async function open(id: string) {
    const request = ++opening.current;
    setNotice(null);
    const detail = await adminGet<Detail>(`config/versions/${id}`, accessToken);
    if (request !== opening.current) return;
    if (!detail.ok) return setNotice({ kind: 'alert', text: t('app.loadFailed') });
    setOpened(detail.data);
    setText(JSON.stringify(detail.data.config, null, 2));
    setNote('');
  }

  // La comparaison porte toujours sur la version en vigueur du moment : elle est relue dès que la
  // liste en désigne une autre (après une clôture, par exemple).
  const activeId = listing.data?.activeVersionId ?? null;
  useEffect(() => {
    if (!activeId) return setActive(null);
    let cancelled = false;
    setActive(null);
    void adminGet<Detail>(`config/versions/${activeId}`, accessToken).then((reply) => {
      if (!cancelled) setActive(reply.ok ? reply.data : null);
    });
    return () => {
      cancelled = true;
    };
  }, [activeId, accessToken]);

  async function run<T>(name: string, input: unknown, done: (data: T) => string) {
    setBusy(true);
    setNotice(null);
    const intent = `${name}:${JSON.stringify(input)}`;
    if (pending.current?.intent !== intent) pending.current = { intent, key: crypto.randomUUID() };
    const reply = await adminCommand<T>(name, input, accessToken, pending.current.key);
    // Sans réponse de l'API (`INTERNAL`), l'intention reste en attente : son issue est inconnue.
    if (reply.ok || reply.code !== 'INTERNAL') pending.current = null;
    const next: Notice = reply.ok
      ? { kind: 'status', text: done(reply.data) }
      : reply.code === 'CONFIG_INVALID'
        ? { kind: 'alert', text: t('config.invalidConfig'), fields: reply.fields }
        : { kind: 'alert', text: t([`config.errors.${reply.code}`, 'config.errors.INTERNAL']) };
    await listing.reload();
    setNotice(next);
    setBusy(false);
  }

  const publish = () =>
    isObject
      ? run<{ number: number }>('admin.publishConfig', { config: parsed, note }, (data) =>
          t('config.published', { number: data.number }),
        )
      : setNotice({ kind: 'alert', text: t('config.invalidJson') });
  const schedule = (version: { id: string; number: number }) =>
    run<{ activateAt: string }>('admin.scheduleConfig', { versionId: version.id }, (data) =>
      t('config.scheduledDone', {
        number: version.number,
        date: date.format(new Date(data.activateAt)),
      }),
    );

  const activeNumber =
    listing.data?.versions.find((version) => version.id === listing.data?.activeVersionId)
      ?.number ?? 0;
  const now = Date.now();
  // Par échéance, seule la dernière version programmée l'emporte (15.4) : l'API rend les
  // programmations de la plus récente à la plus ancienne, la première vue pour une échéance gagne.
  // Une programmation annulée reste dans la lecture, marquée : elle n'entrera pas en vigueur.
  const winners = new Map<string, string>();
  for (const entry of listing.data?.activations ?? [])
    if (!entry.cancelledAt && !winners.has(entry.activateAt))
      winners.set(entry.activateAt, entry.versionId);

  return (
    <>
      <h1 className="text-2xl">{t('config.title')}</h1>
      {listing.error && <LoadError code={listing.error} onRetry={() => void listing.reload()} />}
      {!listing.data && !listing.error && <p>{t('app.loading')}</p>}
      {!canEdit && <p className="text-muted-foreground">{t('config.readOnly')}</p>}

      <h2 className="text-xl">{t('config.versions')}</h2>
      <ul className="flex flex-col gap-3">
        {listing.data?.versions.map((version) => {
          const upcoming = [...winners]
            .filter(([activateAt, winner]) => winner === version.id && Date.parse(activateAt) > now)
            .map(([activateAt]) => activateAt)
            .sort()[0];
          return (
            <li key={version.id} className="rounded-md border border-border p-3">
              <h3 className="text-lg">
                {t('config.version', { number: version.number })}
                {version.id === listing.data?.activeVersionId && (
                  <strong className="ml-2 text-primary">{t('config.active')}</strong>
                )}
              </h3>
              <p>{version.note || t('config.noNote')}</p>
              <p className="text-sm text-muted-foreground">
                {t('config.by', {
                  account: version.createdBy?.slice(0, 8) ?? '—',
                  date: date.format(new Date(version.createdAt)),
                })}
                {upcoming &&
                  ` · ${t('config.scheduled', { date: date.format(new Date(upcoming)) })}`}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void open(version.id)}>
                  {t('config.open', { number: version.number })}
                </Button>
                {canEdit && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void schedule(version)}
                  >
                    {t(version.number < activeNumber ? 'config.rollback' : 'config.schedule', {
                      number: version.number,
                    })}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {opened && (
        <>
          <h2 className="text-xl">{t('config.editing', { number: opened.number })}</h2>
          <label htmlFor="config-json">{t('config.content')}</label>
          <textarea
            id="config-json"
            className={`${CONTROL} min-h-80 py-2 font-mono text-sm`}
            spellCheck={false}
            readOnly={!canEdit}
            aria-invalid={!isObject}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <h3 className="text-lg">
            {active ? t('config.diff', { number: active.number }) : t('config.diffPending')}
          </h3>
          {!isObject && <p role="alert">{t('config.invalidJson')}</p>}
          {changes?.length === 0 && (
            <p className="text-muted-foreground">
              {t('config.noDiff', { number: active?.number })}
            </p>
          )}
          <ul className="text-sm break-all">
            {changes?.map((change) => (
              <li key={change.path}>
                <code className="break-all">{change.path}</code> :{' '}
                {change.before === undefined ? t('config.added') : show(change.before)} →{' '}
                {change.after === undefined ? t('config.removed') : show(change.after)}
              </li>
            ))}
          </ul>
          {canEdit && (
            <>
              <label htmlFor="config-note">{t('config.note')}</label>
              <input
                id="config-note"
                className={`${CONTROL} min-h-11`}
                maxLength={200}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <Button disabled={busy} onClick={() => void publish()}>
                {t('config.publish')}
              </Button>
            </>
          )}
        </>
      )}
      {/* Toujours présent : un lecteur d'écran annonce le résultat dès qu'il apparaît. */}
      <div
        role={notice?.kind ?? 'status'}
        className={notice?.kind === 'alert' ? 'font-semibold text-danger' : ''}
      >
        {notice?.text}
        {notice?.fields && (
          <ul className="font-normal">
            {notice.fields.map((field) => {
              // « chemin : diagnostic » rendu par l'API. Le diagnostic du schéma est une donnée
              // technique, en anglais : il est balisé comme tel, pas traduit.
              const [path, ...detail] = field.split(': ');
              return (
                <li key={field}>
                  <code className="break-all">{path}</code>
                  {detail.length > 0 && <span lang="en"> — {detail.join(': ')}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
