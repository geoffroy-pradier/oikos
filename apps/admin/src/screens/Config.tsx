import { CONFIG_EDITOR_ROLES, type AdminRole } from '@oikos/contracts';
import { Button, cn } from '@oikos/ui';
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { adminCommand, adminGet } from '../api';
import { diffConfigs } from '../diff';
import { ignoreHeldEnter, SHIFT_GUARD_MS } from '../keyboard';
import { LoadError } from '../LoadError';
import { NPC_CLASSES_TABLE } from '../npc-classes-form';
import { RECIPES_TABLE } from '../recipes-form';
import { labelSchemaTarget, parseSchemaError } from '../schema-errors';
import { useAdmin } from '../useAdmin';
import { GoodsForm } from './GoodsForm';
import { NestedTableForm } from './NestedTableForm';

interface Listing {
  activeVersionId: string | null;
  versions: {
    id: string;
    number: number;
    note: string;
    createdBy: string | null;
    createdAt: string;
  }[];
  activations: { id: string; versionId: string; activateAt: string; cancelledAt?: string | null }[];
}
interface Detail {
  id: string;
  number: number;
  config: unknown;
}
/**
 * `fields` : erreurs de schéma rendues par l'API. `refused` : la configuration qu'elles visent, si l'écran
 * l'a envoyée (pas le texte du moment, qui a pu changer ; pas une version programmée, qu'il n'a pas).
 */
type Notice = {
  kind: 'status' | 'alert';
  text: string;
  fields?: string[] | undefined;
  refused?: unknown;
} | null;
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
  /** Texte tel qu'ouvert ou tel qu'enregistré en dernier : s'en écarter, c'est avoir une saisie à perdre. */
  const [saved, setSaved] = useState('');
  /** Texte refusé au dernier contrôle (sortie du champ, envoi) : jamais contrôlé à la frappe. */
  const [invalid, setInvalid] = useState(false);
  /** Version dont l'ouverture attend sa confirmation : elle remplacerait un texte modifié. */
  const [replacing, setReplacing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  /**
   * `cancelling` : programmation dont l'annulation attend sa confirmation. `returnTo` : programmation
   * ou version (par l'identifiant de son bouton) dont la confirmation vient de se refermer : ce bouton reprend le foyer.
   */
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const openedTitle = useRef<HTMLHeadingElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  // Une confirmation qui disparaît fait remonter les fiches suivantes : un bouton qui programme peut
  // venir sous le pointeur. Dans la liste, le second clic d'un double clic n'agit pas et ne prend pas le
  // foyer : compte de clics (`detail`) à la souris ; où il reste à 1 (toucher), le délai. Un clic né du
  // clavier (`detail` nul) passe toujours. L'instant est pris au retrait d'une confirmation affichée.
  const closedAt = useRef(-Infinity);
  useLayoutEffect(
    () => () => {
      if (replacing ?? cancelling) closedAt.current = performance.now();
    },
    [replacing, cancelling],
  );
  const strayClick = ({ detail }: MouseEvent) =>
    detail > 1 || (detail === 1 && performance.now() - closedAt.current < SHIFT_GUARD_MS);
  // Entrée tenue sur « Enregistrer », envoi refusé : le foyer arrive dans le champ, où la répétition de
  // la touche ne doit rien écrire. Armée par `publish`, levée à la première touche enfoncée dans le champ.
  const heldSubmit = useRef(false);
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
  // Corrigé en cours de frappe, le message s'efface ; il ne revient qu'au contrôle suivant.
  if (invalid && isObject) setInvalid(false);

  // Dernière ouverture demandée : la réponse d'une ouverture plus ancienne est ignorée, elle
  // remplacerait sans prévenir la version affichée et la saisie en cours.
  const opening = useRef(0);
  /** Saisie, dans le texte ou par le formulaire : elle l'emporte sur une ouverture encore en route. */
  const edit = (next: string) => {
    opening.current += 1;
    setText(next);
  };
  async function open(id: string) {
    const request = ++opening.current;
    setNotice(null);
    setReplacing(null);
    const detail = await adminGet<Detail>(`config/versions/${id}`, accessToken);
    if (request !== opening.current) return;
    if (!detail.ok) return setNotice({ kind: 'alert', text: t('app.loadFailed') });
    setOpened(detail.data);
    setText(JSON.stringify(detail.data.config, null, 2));
    setSaved(JSON.stringify(detail.data.config, null, 2));
    setNote('');
  }
  // Le foyer suit l'ouverture : le contenu s'affiche loin sous la liste, son titre le reçoit.
  useEffect(() => {
    if (opened) openedTitle.current?.focus();
  }, [opened]);
  /** Ouvre, ou demande confirmation si l'ouverture remplacerait un texte modifié et non enregistré. */
  const askOpen = (id: string) => {
    if (!opened || text === saved) return void open(id);
    setReturnTo(null);
    setReplacing(id);
  };
  /** Referme la confirmation et rend le foyer au bouton d'ouverture ; `replace` : ouvre la version. */
  const closeReplace = (id: string, replace: boolean) => {
    setReplacing(null);
    setReturnTo(`config-open-${id}`);
    if (replace) void open(id);
  };

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
    const refused = (input as { config?: unknown } | null)?.config;
    const next: Notice = reply.ok
      ? { kind: 'status', text: done(reply.data) }
      : reply.code === 'CONFIG_INVALID'
        ? { kind: 'alert', text: t('config.invalidConfig'), fields: reply.fields, refused }
        : { kind: 'alert', text: t([`config.errors.${reply.code}`, 'config.errors.INTERNAL']) };
    await listing.reload();
    setNotice(next);
    setBusy(false);
    return reply.ok;
  }

  async function publish() {
    // Contrôlé à l'envoi : le message est annoncé par la seule zone du champ, qui reprend le foyer.
    setInvalid(!isObject);
    if (!isObject) {
      setNotice(null);
      heldSubmit.current = true;
      return editor.current?.focus();
    }
    const sent = text;
    const published = await run<{ number: number }>(
      'admin.publishConfig',
      { config: parsed, note },
      (data) => t('config.published', { number: data.number }),
    );
    if (published) setSaved(sent);
  }
  const schedule = (version: { id: string; number: number }) =>
    run<{ activateAt: string }>('admin.scheduleConfig', { versionId: version.id }, (data) =>
      t('config.scheduledDone', {
        number: version.number,
        date: date.format(new Date(data.activateAt)),
      }),
    );

  /** Ouvre la confirmation. Le foyer à rendre d'une confirmation précédente n'a plus cours. */
  const confirmCancel = (activationId: string) => {
    setReturnTo(null);
    setCancelling(activationId);
  };
  /** Referme la confirmation : renoncement, annulation refusée ou annulation faite. */
  const closeCancel = (activationId: string) => {
    setCancelling(null);
    setReturnTo(`config-cancel-${activationId}`);
  };
  // Seul endroit qui rend le foyer après une confirmation : au bouton de la programmation s'il est
  // encore offert, sinon au titre (programmation annulée, par cette commande ou par un autre compte,
  // ou échéance passée) plutôt que de le laisser se perdre.
  useEffect(() => {
    if (returnTo) (document.getElementById(returnTo) ?? title.current)?.focus();
  }, [returnTo]);
  async function cancel(activation: { id: string; activateAt: string }, number: number) {
    await run<{ cancelled: unknown[] }>(
      'admin.cancelActivation',
      { activationId: activation.id },
      (data) =>
        t('config.cancelledDone', {
          count: data.cancelled.length,
          number,
          date: date.format(new Date(activation.activateAt)),
        }),
    );
    closeCancel(activation.id);
  }

  const activeNumber =
    listing.data?.versions.find((version) => version.id === listing.data?.activeVersionId)
      ?.number ?? 0;
  const now = Date.now();
  // Par échéance, seule la dernière version programmée l'emporte (15.4) : l'API rend les
  // programmations de la plus récente à la plus ancienne, la première vue pour une échéance gagne.
  // Une programmation annulée reste dans la lecture, marquée : elle n'entrera pas en vigueur.
  const winners = new Map<string, Listing['activations'][number]>();
  for (const entry of listing.data?.activations ?? [])
    if (!entry.cancelledAt && !winners.has(entry.activateAt)) winners.set(entry.activateAt, entry);

  return (
    <>
      <h1 ref={title} tabIndex={-1} className="text-2xl">
        {t('config.title')}
      </h1>
      {listing.error && <LoadError code={listing.error} onRetry={() => void listing.reload()} />}
      {!listing.data && !listing.error && <p>{t('app.loading')}</p>}
      {!canEdit && <p className="text-muted-foreground">{t('config.readOnly')}</p>}

      <h2 className="text-xl">{t('config.versions')}</h2>
      <ul
        className="flex flex-col gap-3"
        onKeyDown={ignoreHeldEnter}
        onMouseDownCapture={(event) => {
          if (strayClick(event)) event.preventDefault();
        }}
        onClickCapture={(event) => {
          if (strayClick(event)) event.stopPropagation();
        }}
      >
        {listing.data?.versions.map((version) => {
          const next = [...winners.values()]
            .filter((entry) => entry.versionId === version.id && Date.parse(entry.activateAt) > now)
            .sort((a, b) => a.activateAt.localeCompare(b.activateAt))[0];
          const upcoming = next?.activateAt;
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
                {/* Reste affiché pendant sa confirmation, qui s'ouvre sous la rangée sans la déplacer. */}
                <Button
                  id={`config-open-${version.id}`}
                  variant="secondary"
                  onClick={() => askOpen(version.id)}
                >
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
                {canEdit && next && cancelling !== next.id && (
                  <Button
                    id={`config-cancel-${next.id}`}
                    variant="secondary"
                    disabled={busy}
                    onClick={() => confirmCancel(next.id)}
                  >
                    {t('config.cancel', { number: version.number })}
                  </Button>
                )}
              </div>
              {replacing === version.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <p id="config-replace-warning">
                    {t('config.replaceWarning', { opened: opened?.number, number: version.number })}
                  </p>
                  <Button
                    aria-describedby="config-replace-warning"
                    onClick={() => closeReplace(version.id, true)}
                  >
                    {t('config.replaceConfirm')}
                  </Button>
                  {/* Foyer initial sur le geste sans effet, comme pour l'annulation ci-dessous. */}
                  <Button
                    autoFocus
                    variant="secondary"
                    aria-describedby="config-replace-warning"
                    onClick={() => closeReplace(version.id, false)}
                  >
                    {t('config.replaceKeep')}
                  </Button>
                </div>
              )}
              {canEdit && next && cancelling === next.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <p id="config-cancel-warning">{t('config.cancelWarning')}</p>
                  <Button
                    disabled={busy}
                    aria-describedby="config-cancel-warning"
                    onClick={() => void cancel(next, version.number)}
                  >
                    {t('config.cancelConfirm')}
                  </Button>
                  {/* Foyer initial sur le choix sans effet : une touche Entrée maintenue sur le bouton
                      d'annulation ne confirme pas par répétition. L'avertissement est lu à l'arrivée. */}
                  <Button
                    autoFocus
                    variant="secondary"
                    disabled={busy}
                    aria-describedby="config-cancel-warning"
                    onClick={() => closeCancel(next.id)}
                  >
                    {t('config.cancelKeep')}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {opened && (
        <>
          <h2 ref={openedTitle} tabIndex={-1} className="text-xl">
            {t('config.editing', { number: opened.number })}
          </h2>
          <label htmlFor="config-json">{t('config.content')}</label>
          <textarea
            ref={editor}
            id="config-json"
            className={cn(CONTROL, 'min-h-80 py-2 font-mono text-sm', invalid && 'border-danger')}
            spellCheck={false}
            readOnly={!canEdit}
            aria-invalid={invalid}
            aria-describedby={invalid ? 'config-json-error' : undefined}
            value={text}
            onChange={(event) => edit(event.target.value)}
            onKeyDown={(event) => {
              if (!event.repeat) heldSubmit.current = false;
              else if (heldSubmit.current && event.key === 'Enter') event.preventDefault();
            }}
            onBlur={() => setInvalid(!isObject)}
          />
          {/* Seule zone qui annonce un texte invalide ; hauteur réservée : rien ne bouge sous un clic. */}
          <p
            id="config-json-error"
            role="alert"
            className="min-h-5 text-sm font-semibold text-danger"
          >
            {invalid && t('config.invalidJson')}
          </p>
          <GoodsForm config={parsed} readOnly={!canEdit} onChange={edit} />
          {[RECIPES_TABLE, NPC_CLASSES_TABLE].map((spec) => (
            <NestedTableForm
              key={spec.table}
              spec={spec}
              config={parsed}
              readOnly={!canEdit}
              onChange={edit}
            />
          ))}
          <h3 className="text-lg">
            {active ? t('config.diff', { number: active.number }) : t('config.diffPending')}
          </h3>
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
          <ul className="font-normal wrap-break-word">
            {notice.fields.map((field, index) => {
              // « chemin : diagnostic » rendu par l'API : table, ligne et champ en clair, puis le chemin,
              // qui situe la valeur dans le texte JSON. Le diagnostic du schéma est une donnée
              // technique, en anglais : il est balisé comme tel, pas traduit.
              const { path, detail, target } = parseSchemaError(field, notice.refused);
              const labels = labelSchemaTarget(target, i18n.language);
              return (
                <li key={`${index}:${field}`}>
                  {labels && `${labels.join(' › ')} (`}
                  <code className="break-all">{path}</code>
                  {labels && ')'}
                  {detail && <span lang="en"> — {detail}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
