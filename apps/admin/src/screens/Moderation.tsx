import { SANCTION_REASON_MAX_CHARS, type AdminReports } from '@oikos/contracts';
import {
  Archive,
  Badge,
  Ban,
  Button,
  Check,
  cn,
  EmptyState,
  EyeOff,
  Flag,
  Gavel,
  Hourglass,
  Menu,
  MessageSquareOff,
  MessagesSquare,
  PageHeader,
  RefreshCw,
  Search,
  Send,
  Sheet,
  Sparkles,
  TriangleAlert,
  Undo2,
  X,
} from '@oikos/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { adminCommand } from '../api';
import { ignoreHeldEnter } from '../keyboard';
import { LoadError } from '../LoadError';
import { hoursSince, staleReportHours } from '../moderation-age';
import { ALERT, CONTROL } from '../ui';
import { useAdmin } from '../useAdmin';
import { SectionTitle } from './SectionTitle';

type Entry = AdminReports['queue'][number];
/** Teinte de la pastille de chaque catégorie du pré-tri ; le texte de la catégorie la dit toujours aussi (pas la couleur seule). */
const TRIAGE_TONES = {
  likely_violation: 'danger',
  doubtful: 'warning',
  likely_unfounded: 'neutral',
} as const;
type Appeal = AdminReports['appeals'][number];
export type Notice = { kind: 'status' | 'alert'; text: string } | null;
/** Geste en cours de confirmation : sur un signalement, une exclusion proposée, une levée proposée, un appel. */
export type Gesture =
  | 'hide'
  | 'dismissed'
  | 'upheld'
  | 'warning'
  | 'silence'
  | 'suspension'
  | 'ban'
  | 'confirmExclusion'
  | 'liftSanction'
  | 'withdrawExclusion'
  | 'proposeLift'
  | 'granted'
  | 'rejected';
const SANCTIONS: readonly Gesture[] = ['warning', 'silence', 'suspension', 'ban'];
/** Gestes d'une entrée de la file, dans leur ordre, chacun avec son icône (décorative). */
const QUEUE_GESTURES = {
  hide: EyeOff,
  warning: TriangleAlert,
  silence: MessageSquareOff,
  suspension: Hourglass,
  ban: Ban,
  upheld: Flag,
  dismissed: Archive,
} as const;
type QueueGesture = keyof typeof QUEUE_GESTURES;
/** Gestes sur une sanction déjà prononcée ou proposée, chacun avec son icône. */
const SANCTION_GESTURES = {
  confirmExclusion: Gavel,
  withdrawExclusion: Undo2,
  proposeLift: Send,
  liftSanction: Check,
  granted: Check,
  rejected: X,
} as const;

/**
 * Durées proposées pour une sanction (#541) : celles que rend l'API, lues dans la version en vigueur. Aucune sans
 * version lisible, ou lues d'une API antérieure qui ne les rendait pas.
 */
export function offeredHours(data: AdminReports | null, gesture: Gesture): readonly number[] {
  return gesture === 'warning' || gesture === 'silence' || gesture === 'suspension'
    ? (data?.sanctionHours?.[gesture] ?? [])
    : [];
}

/** Alerte « signalements en attente depuis plus de 24 h » (15.5), partagée par ce module et la Vigie. */
export function StaleReportsAlert({ hours, limit }: { hours: number | null; limit: number }) {
  const { t } = useTranslation();
  if (hours === null) return null;
  return (
    <p role="alert" className={ALERT}>
      {t('moderation.stale', { hours, limit })}
    </p>
  );
}

/**
 * Module Modération (15.1) : file des signalements, du plus ancien au plus signalé, avec le contexte de la
 * conversation ; masquer, sanctionner, proposer une exclusion, retenir ou classer. Chaque geste passe par une
 * confirmation qui nomme la maison visée ; les durées proposées et la seconde personne sont celles de l'API.
 */
export function Moderation({ accessToken }: { accessToken: string }) {
  const { t, i18n } = useTranslation();
  const { data, error, reload } = useAdmin<AdminReports>('reports', accessToken);
  const title = useRef<HTMLHeadingElement>(null);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  /** Geste en attente de confirmation : l'entrée de la file (son premier signalement) et le geste. */
  const [open, setOpen] = useState<{ scope: string; gesture: Gesture } | null>(null);
  /** Bouton qui reprend le foyer après un geste annulé ou refusé. */
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState<{ hours?: boolean; reason?: boolean }>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  // Intention en attente de réponse : le même geste renvoyé après une panne réutilise sa clé.
  const pending = useRef<{ intent: string; key: string } | null>(null);
  /** Maison cherchée dans la file : seules les entrées dont le nom la contient restent affichées. */
  const [filter, setFilter] = useState('');
  /**
   * Geste réussi : le foyer va au titre. Posé par un effet, après la fermeture de la feuille, qui rend sinon
   * le foyer au bouton qui l'a ouverte.
   */
  const [toTitle, setToTitle] = useState(0);
  useEffect(() => {
    if (toTitle > 0) title.current?.focus();
  }, [toTitle]);
  // Geste de la file annulé ou refusé : son bouton reprend le foyer, après la fermeture de la feuille.
  useEffect(() => {
    if (returnTo) document.getElementById(`gesture-${returnTo}`)?.focus();
  }, [returnTo]);

  /** `refusals` : messages propres au geste, lus avant ceux de la modération (`moderation.errors`). */
  async function run(name: string, input: unknown, done: string, refusals?: string) {
    setBusy(true);
    setNotice(null);
    setReturnTo(null);
    const intent = `${name}:${JSON.stringify(input)}`;
    try {
      if (pending.current?.intent !== intent)
        pending.current = { intent, key: crypto.randomUUID() };
      const reply = await adminCommand<unknown>(name, input, accessToken, pending.current.key);
      // Sans réponse de l'API (`INTERNAL`), l'intention reste en attente : son issue est inconnue.
      if (reply.ok || reply.code !== 'INTERNAL') pending.current = null;
      await reload();
      setNotice(
        reply.ok
          ? { kind: 'status', text: done }
          : {
              kind: 'alert',
              text:
                refusals && i18n.exists(`${refusals}.${reply.code}`)
                  ? t(`${refusals}.${reply.code}`)
                  : i18n.exists(`moderation.errors.${reply.code}`)
                    ? t(`moderation.errors.${reply.code}`)
                    : // Refus que l'écran ne connaît pas : dit tel quel, sans le faire passer pour une panne rejouable.
                      t('moderation.errors.REFUSED', { code: reply.code }),
            },
      );
      return reply.ok;
    } catch {
      setNotice({ kind: 'alert', text: t('moderation.errors.INTERNAL') });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function begin(scope: string, gesture: Gesture) {
    setReturnTo(null);
    setNotice(null);
    // Une seule durée proposée (l'avertissement, par défaut) : elle est choisie d'office.
    const offered = offeredHours(data, gesture);
    setDuration(offered.length === 1 ? (offered[0] ?? null) : null);
    setReason('');
    setInvalid({});
    setOpen({ scope, gesture });
  }
  function cancel() {
    if (open) setReturnTo(`${open.scope}:${open.gesture}`);
    setOpen(null);
  }

  async function confirm(entry: Entry, gesture: Gesture) {
    const house = entry.reportedHouse.name;
    const first = entry.reports[0];
    if (!first) return;
    let ok: boolean;
    if (gesture === 'hide') {
      if (!entry.message) return;
      ok = await run(
        'admin.hideMessage',
        { messageId: entry.message.id },
        t('moderation.done.hide'),
      );
    } else if (gesture === 'dismissed' || gesture === 'upheld') {
      ok = await run(
        'admin.resolveReport',
        { reportId: first.id, decision: gesture },
        t(`moderation.done.${gesture}`),
      );
    } else {
      // Contrôlé à la confirmation : une durée proposée, un motif non vide. L'API reste juge, sous la version
      // en vigueur à l'instant de la commande.
      const length = [...reason.trim()].length;
      const hoursInvalid =
        gesture !== 'ban' && (duration === null || !offeredHours(data, gesture).includes(duration));
      const reasonInvalid = length === 0 || length > SANCTION_REASON_MAX_CHARS;
      setInvalid({ hours: hoursInvalid, reason: reasonInvalid });
      if (hoursInvalid || reasonInvalid)
        return document
          .getElementById(hoursInvalid ? 'moderation-hours' : 'moderation-reason')
          ?.focus();
      const base = { userId: entry.reportedHouse.userId, reason: reason.trim() };
      ok = await run(
        'admin.sanction',
        gesture === 'ban'
          ? { ...base, kind: gesture }
          : // Jamais nulle ici : contrôlée plus haut.
            { ...base, kind: gesture, hours: duration ?? 0 },
        t(`moderation.done.${gesture}`, { house }),
      );
    }
    if (ok) {
      setOpen(null);
      setToTitle((count) => count + 1);
    } else if (!SANCTIONS.includes(gesture)) {
      // Refus d'un geste simple : le foyer revient à son bouton. Une sanction refusée garde ses champs à corriger.
      setOpen(null);
      setReturnTo(`${open?.scope}:${gesture}`);
    } else {
      // Sanction refusée : la feuille reste ouverte, ses champs à corriger ; le foyer revient à « Confirmer »,
      // inactif pendant l'envoi, par l'effet qui suit le rendu.
      setReturnTo(`${open?.scope}:confirm`);
    }
  }

  /**
   * Validation d'une exclusion, retrait d'une exclusion proposée (#636), confirmation de la levée proposée d'une
   * exclusion (#616), proposition d'une levée (#636) et décision d'un appel : une sanction désignée par son identifiant.
   */
  async function confirmSanction(sanctionId: string, gesture: Gesture) {
    const ok =
      gesture === 'confirmExclusion' ||
      gesture === 'liftSanction' ||
      gesture === 'proposeLift' ||
      gesture === 'withdrawExclusion'
        ? await run(
            // Proposer la levée et la confirmer sont la même commande, à deux personnes (15.4).
            gesture === 'proposeLift' ? 'admin.liftSanction' : `admin.${gesture}`,
            { sanctionId },
            t(`moderation.done.${gesture}`),
            // Le refus de la seconde personne, ou du compte exclu, a son message propre au geste.
            gesture === 'liftSanction'
              ? 'moderation.liftErrors'
              : gesture === 'proposeLift'
                ? 'moderation.proposeErrors'
                : gesture === 'withdrawExclusion'
                  ? 'moderation.withdrawErrors'
                  : undefined,
          )
        : await run(
            'admin.decideAppeal',
            { sanctionId, decision: gesture === 'granted' ? 'granted' : 'rejected' },
            t(`moderation.done.${gesture}`),
          );
    setOpen(null);
    if (ok) title.current?.focus();
    else setReturnTo(`${sanctionId}:${gesture}`);
  }
  const sanctionKind = (kind: Appeal['kind']) => t(`moderation.kinds.${kind}`);
  const period = (item: Appeal) =>
    item.endsAt
      ? t('moderation.period', {
          from: date.format(new Date(item.startsAt)),
          to: date.format(new Date(item.endsAt)),
        })
      : t('moderation.periodOpen', { from: date.format(new Date(item.startsAt)) });
  /** Bouton d'un geste sur une sanction, ou sa confirmation si c'est lui qui est demandé. */
  const sanctionGesture = (
    sanctionId: string,
    userId: string,
    gesture: keyof typeof SANCTION_GESTURES,
  ) => {
    const SanctionIcon = SANCTION_GESTURES[gesture];
    return open?.scope === sanctionId && open.gesture === gesture ? (
      <Confirmation
        key={gesture}
        id={`confirm-${sanctionId}`}
        scope={sanctionId}
        sentence={t(`moderation.confirm.${gesture}`, { userId })}
        confirmLabel={t(`moderation.confirmLabel.${gesture}`)}
        busy={busy}
        fields={false}
        onConfirm={() => void confirmSanction(sanctionId, gesture)}
        onCancel={cancel}
      />
    ) : (
      <Button
        icon={<SanctionIcon aria-hidden="true" />}
        key={gesture}
        variant="secondary"
        autoFocus={returnTo === `${sanctionId}:${gesture}`}
        disabled={busy}
        onClick={() => begin(sanctionId, gesture)}
      >
        {t(`moderation.act.${gesture}`, { account: userId.slice(0, 8) })}
      </Button>
    );
  };

  const stale = staleReportHours(data);
  const queue = data?.queue ?? [];
  const needle = filter.trim().toLocaleLowerCase(i18n.language);
  const shown = queue.filter((entry) =>
    entry.reportedHouse.name.toLocaleLowerCase(i18n.language).includes(needle),
  );
  // Absentes d'une API antérieure à ces champs (#616, #636) : les listes sont alors vides.
  const lifts = data?.pendingLifts ?? [];
  const active = data?.activeExclusions ?? [];

  return (
    <>
      <PageHeader
        title={t('moderation.title')}
        titleRef={title}
        action={
          <Button
            variant="secondary"
            icon={<RefreshCw aria-hidden="true" />}
            disabled={busy}
            onClick={() => void reload()}
          >
            {t('app.refresh')}
          </Button>
        }
      />
      {error && (
        <LoadError code={error} onRetry={() => void reload().then(() => title.current?.focus())} />
      )}
      {!data && !error && <p>{t('app.loading')}</p>}
      <StaleReportsAlert hours={stale} limit={data?.staleAfterHours ?? 0} />
      {/* Toujours présent : un lecteur d'écran annonce le résultat dès qu'il apparaît. Feuille ouverte : il y paraît, pas ici. */}
      {/* Vide, la région ne laisse pas sa marge d'empilement : le titre de la file reste à sa place. */}
      <Notice notice={open === null ? notice : null} className="empty:-mt-6" />
      {data && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionTitle id="moderation-queue" icon={<Flag />}>
              {t('moderation.queue')}
            </SectionTitle>
            {queue.length > 0 && (
              <div className="relative w-full sm:w-64">
                <label htmlFor="moderation-filter" className="sr-only">
                  {t('moderation.filter')}
                </label>
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  id="moderation-filter"
                  type="search"
                  className={`${CONTROL} min-h-11 pl-9 text-sm`}
                  placeholder={t('moderation.filter')}
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
              </div>
            )}
          </div>
          {queue.length === 0 ? (
            <EmptyState compact illustration="noReport" title={t('moderation.queueEmpty')} />
          ) : (
            <>
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {t('moderation.queueCaption', { count: queue.length })}
                {shown.length < queue.length &&
                  ` ${t('moderation.filtered', { count: shown.length })}`}
                {queue.some((entry) => entry.triage) && ` ${t('moderation.triage.order')}`}
              </p>
              <ol aria-labelledby="moderation-queue" className="flex flex-col gap-4">
                {shown.map((entry) => {
                  const scope = entry.reports[0]?.id ?? '';
                  const oldest = entry.reports.reduce(
                    (min, report) => (report.createdAt < min ? report.createdAt : min),
                    entry.reports[0]?.createdAt ?? data.now,
                  );
                  const house = entry.reportedHouse.name;
                  const asked = open?.scope === scope ? open.gesture : null;
                  // Masquer le message, s'il est encore lu, est l'action principale ; sinon, retenir le signalement.
                  // Les autres gestes vont dans le menu, où le foyer revient après une feuille annulée ou refusée.
                  const main: QueueGesture =
                    entry.message && !entry.message.hiddenAt ? 'hide' : 'upheld';
                  const MainIcon = QUEUE_GESTURES[main];
                  const others = (Object.keys(QUEUE_GESTURES) as QueueGesture[]).filter(
                    (gesture) => gesture !== 'hide' && gesture !== main,
                  );
                  const firstResolution = others.find((gesture) => !SANCTIONS.includes(gesture));
                  const returning = returnTo?.startsWith(`${scope}:`)
                    ? `gesture-${returnTo}`
                    : null;
                  // Le message, remis à sa place dans la conversation.
                  const thread = [
                    ...entry.context.filter((m) => m.id !== entry.message?.id),
                    ...(entry.message ? [entry.message] : []),
                  ].sort((a, b) =>
                    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
                  );
                  const since = t('moderation.since', {
                    date: date.format(new Date(oldest)),
                    hours: hoursSince(oldest, data.now),
                  });
                  const channel = entry.channel
                    ? entry.channel.kind === 'city'
                      ? t('moderation.channelCity', {
                          city: t(`cities.${entry.channel.city}`, {
                            defaultValue: entry.channel.city,
                          }),
                        })
                      : t('moderation.channelDirect')
                    : null;
                  return (
                    <li key={scope} aria-labelledby={`entry-${scope}`} className={CARD}>
                      <h3 id={`entry-${scope}`} className="text-base font-semibold wrap-anywhere">
                        {t('moderation.entry', { house, count: entry.reports.length })}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {channel ? t('moderation.sinceChannel', { since, channel }) : since}
                      </p>
                      <ul aria-label={t('moderation.reports')} className="flex flex-wrap gap-1.5">
                        {entry.reports.map((report) => (
                          <li key={report.id} className="max-w-full">
                            <Badge icon={<Flag aria-hidden="true" />}>
                              <span className="wrap-anywhere">
                                {t('moderation.reportLine', {
                                  reason: t(`moderation.reasons.${report.reason}`, {
                                    defaultValue: report.reason,
                                  }),
                                  date: date.format(new Date(report.createdAt)),
                                })}
                              </span>
                            </Badge>
                          </li>
                        ))}
                      </ul>
                      {entry.triage && (
                        <section
                          aria-label={t('moderation.triage.title')}
                          className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface-raised p-3 text-sm"
                        >
                          <p className="flex flex-wrap items-center gap-2">
                            <Badge
                              tone={TRIAGE_TONES[entry.triage.category]}
                              icon={<Sparkles aria-hidden="true" />}
                            >
                              {t(`moderation.triage.categories.${entry.triage.category}`)}
                            </Badge>
                            <span className="text-muted-foreground">
                              {t('moderation.triage.source')}
                            </span>
                          </p>
                          <p className="wrap-anywhere">{entry.triage.summary}</p>
                        </section>
                      )}
                      {entry.message ? (
                        <ol
                          aria-label={t('moderation.conversation')}
                          className="flex flex-col gap-1 rounded-lg bg-surface-raised p-3 text-sm"
                        >
                          {thread.map((m) => (
                            <li
                              key={m.id}
                              className={
                                m.id === entry.message?.id
                                  ? 'rounded-r-md border-l-4 border-danger bg-danger-subtle py-1 pl-2 font-semibold wrap-anywhere'
                                  : 'pl-3 wrap-anywhere'
                              }
                            >
                              <span className="text-muted-foreground">
                                {t('moderation.line', {
                                  date: date.format(new Date(m.createdAt)),
                                  house: m.houseName,
                                })}{' '}
                              </span>
                              {m.body}
                              {m.hiddenAt && ` ${t('moderation.hiddenTag')}`}
                              {m.id === entry.message?.id && ` ${t('moderation.reportedTag')}`}
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="text-sm text-muted-foreground">{t('moderation.purged')}</p>
                      )}
                      <Sheet
                        open={asked !== null}
                        // Commande en vol : ni Échap ni le voile ne referment la feuille (doc de `Sheet`).
                        onClose={() => !busy && cancel()}
                        closeDisabled={busy}
                        closeLabel={t('moderation.close')}
                        title={asked && t(`moderation.act.${asked}`)}
                        description={t('moderation.entry', { house, count: entry.reports.length })}
                      >
                        {entry.message && (
                          <blockquote className="mb-4 rounded-lg border-l-4 border-danger bg-danger-subtle px-3 py-2 text-sm wrap-anywhere">
                            {entry.message.body}
                          </blockquote>
                        )}
                        {asked && <Notice notice={notice} />}
                        {asked && (
                          <Confirmation
                            id={`confirm-${scope}`}
                            scope={scope}
                            sentence={t(`moderation.confirm.${asked}`, { house })}
                            confirmLabel={t(`moderation.confirmLabel.${asked}`)}
                            busy={busy}
                            fields={SANCTIONS.includes(asked)}
                            onConfirm={() => void confirm(entry, asked)}
                            onCancel={cancel}
                          >
                            {SANCTIONS.includes(asked) && asked !== 'ban' && (
                              <Durations
                                hours={offeredHours(data, asked)}
                                value={duration}
                                invalid={invalid.hours === true}
                                onChange={setDuration}
                              />
                            )}
                            {SANCTIONS.includes(asked) && (
                              <>
                                <label htmlFor="moderation-reason" className="font-medium">
                                  {t('moderation.reason')}
                                </label>
                                <textarea
                                  id="moderation-reason"
                                  className={`${CONTROL} min-h-28 py-2.5`}
                                  maxLength={SANCTION_REASON_MAX_CHARS}
                                  autoFocus={asked === 'ban'}
                                  aria-invalid={invalid.reason ? true : undefined}
                                  aria-describedby="moderation-reason-hint"
                                  value={reason}
                                  onChange={(event) => setReason(event.target.value)}
                                />
                                <p
                                  id="moderation-reason-hint"
                                  className="text-sm text-muted-foreground"
                                >
                                  {t('moderation.reasonHint')}
                                </p>
                                {invalid.reason && (
                                  <p role="alert" className="text-sm font-semibold text-danger">
                                    {t('moderation.reasonInvalid')}
                                  </p>
                                )}
                              </>
                            )}
                          </Confirmation>
                        )}
                      </Sheet>
                      <div
                        role="group"
                        aria-label={t('moderation.actions', { house })}
                        className="flex flex-wrap gap-2"
                        onKeyDown={ignoreHeldEnter}
                      >
                        <Button
                          id={`gesture-${scope}:${main}`}
                          icon={<MainIcon aria-hidden="true" />}
                          aria-haspopup="dialog"
                          disabled={busy}
                          onClick={() => begin(scope, main)}
                        >
                          {t(`moderation.act.${main}`)}
                        </Button>
                        <Menu
                          id={`gesture-${scope}:more`}
                          label={t('moderation.more')}
                          disabled={busy}
                          reopenOn={returning}
                          items={others.map((gesture) => {
                            const GestureIcon = QUEUE_GESTURES[gesture];
                            return {
                              id: `gesture-${scope}:${gesture}`,
                              label: t(`moderation.act.${gesture}`),
                              icon: <GestureIcon />,
                              danger: gesture === 'ban',
                              separated: gesture === firstResolution,
                              onSelect: () => begin(scope, gesture),
                            };
                          })}
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
          <SectionTitle id="moderation-exclusions" icon={<Gavel />}>
            {t('moderation.exclusions')}
          </SectionTitle>
          {data.pendingExclusions.length === 0 ? (
            <EmptyState compact illustration="noReport" title={t('moderation.exclusionsEmpty')} />
          ) : (
            <ul aria-labelledby="moderation-exclusions" className="flex flex-col gap-3">
              {data.pendingExclusions.map((item) => (
                <li key={item.sanctionId} className={CARD}>
                  <p className="font-semibold wrap-anywhere">
                    {t('moderation.exclusionOf')} <code className="break-all">{item.userId}</code>
                  </p>
                  <p className="text-sm wrap-anywhere">
                    {t('moderation.proposed', {
                      date: date.format(new Date(item.proposedAt)),
                      author: item.authorId,
                    })}
                  </p>
                  <p className="wrap-anywhere">
                    {t('moderation.sanctionReason', { reason: item.reason })}
                  </p>
                  <div className="flex flex-wrap gap-2" onKeyDown={ignoreHeldEnter}>
                    {sanctionGesture(item.sanctionId, item.userId, 'confirmExclusion')}
                    {sanctionGesture(item.sanctionId, item.userId, 'withdrawExclusion')}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <SectionTitle id="moderation-active" icon={<Gavel />}>
            {t('moderation.active')}
          </SectionTitle>
          {active.length === 0 ? (
            <EmptyState compact illustration="noReport" title={t('moderation.activeEmpty')} />
          ) : (
            <ul aria-labelledby="moderation-active" className="flex flex-col gap-3">
              {active.map((item) => (
                <li key={item.sanctionId} className={CARD}>
                  <p className="font-semibold wrap-anywhere">
                    {t('moderation.activeOf')} <code className="break-all">{item.userId}</code>
                  </p>
                  <p className="text-sm wrap-anywhere">
                    {t('moderation.liftExclusion', {
                      date: date.format(new Date(item.startsAt)),
                      author: item.authorId,
                      confirmedBy: item.confirmedBy,
                    })}
                  </p>
                  <p className="wrap-anywhere">
                    {t('moderation.sanctionReason', { reason: item.reason })}
                  </p>
                  <div className="flex flex-wrap gap-2" onKeyDown={ignoreHeldEnter}>
                    {sanctionGesture(item.sanctionId, item.userId, 'proposeLift')}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <SectionTitle id="moderation-lifts" icon={<Undo2 />}>
            {t('moderation.lifts')}
          </SectionTitle>
          {lifts.length === 0 ? (
            <EmptyState compact illustration="noReport" title={t('moderation.liftsEmpty')} />
          ) : (
            <ul aria-labelledby="moderation-lifts" className="flex flex-col gap-3">
              {lifts.map((item) => (
                <li key={item.sanctionId} className={CARD}>
                  <p className="font-semibold wrap-anywhere">
                    {t('moderation.liftOf')} <code className="break-all">{item.userId}</code>
                  </p>
                  <p className="text-sm wrap-anywhere">
                    {t('moderation.liftProposed', {
                      date: date.format(new Date(item.proposedAt)),
                      proposer: item.proposedBy,
                    })}
                  </p>
                  <p className="text-sm wrap-anywhere">
                    {t('moderation.liftExclusion', {
                      date: date.format(new Date(item.startsAt)),
                      author: item.authorId,
                      confirmedBy: item.confirmedBy,
                    })}
                  </p>
                  <p className="wrap-anywhere">
                    {t('moderation.sanctionReason', { reason: item.reason })}
                  </p>
                  <div className="flex flex-wrap gap-2" onKeyDown={ignoreHeldEnter}>
                    {sanctionGesture(item.sanctionId, item.userId, 'liftSanction')}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <SectionTitle id="moderation-appeals" icon={<MessagesSquare />}>
            {t('moderation.appeals')}
          </SectionTitle>
          {data.appeals.length === 0 ? (
            <EmptyState compact illustration="noReport" title={t('moderation.appealsEmpty')} />
          ) : (
            <ul aria-labelledby="moderation-appeals" className="flex flex-col gap-3">
              {data.appeals.map((item) => (
                <li key={item.sanctionId} className={CARD}>
                  <p className="font-semibold wrap-anywhere">
                    {t('moderation.appealOf', { kind: sanctionKind(item.kind) })}{' '}
                    <code className="break-all">{item.userId}</code>
                  </p>
                  <p className="text-sm wrap-anywhere">
                    {period(item)} {t('moderation.pronouncedBy', { author: item.authorId })}
                  </p>
                  <p className="wrap-anywhere">
                    {t('moderation.sanctionReason', { reason: item.reason })}
                  </p>
                  <p className="wrap-anywhere">
                    {t('moderation.appealBody', {
                      date: date.format(new Date(item.appealedAt)),
                      body: item.appealBody,
                    })}
                  </p>
                  <div className="flex flex-wrap gap-2" onKeyDown={ignoreHeldEnter}>
                    {sanctionGesture(item.sanctionId, item.userId, 'granted')}
                    {sanctionGesture(item.sanctionId, item.userId, 'rejected')}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

/** Fiche d'une entrée de la file ou d'une sanction. */
const CARD = 'flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface p-4 shadow-sm';

/**
 * Résultat du dernier geste. Toujours présent : un lecteur d'écran l'annonce dès qu'il paraît. La feuille d'un
 * geste en porte une copie, seule lue tant qu'elle est ouverte (le reste de la page est alors inerte).
 */
export function Notice({ notice, className }: { notice: Notice; className?: string }) {
  return (
    <div
      role={notice?.kind ?? 'status'}
      className={cn(
        className,
        notice?.text && 'rounded-lg px-4 py-3 text-sm font-medium',
        notice?.kind === 'alert'
          ? 'bg-danger-subtle text-danger'
          : 'bg-success-subtle text-success',
      )}
    >
      {notice?.text}
    </div>
  );
}

/**
 * Choix de la durée d'une sanction parmi celles que l'API propose (#541), au clavier comme un groupe de boutons
 * radio. Sans durée lisible, le groupe le dit et la sanction ne part pas.
 */
function Durations({
  hours,
  value,
  invalid,
  onChange,
}: {
  hours: readonly number[];
  value: number | null;
  invalid: boolean;
  onChange: (hours: number) => void;
}) {
  const { t } = useTranslation();
  const label = (count: number) =>
    count % 24 === 0
      ? t('moderation.durationDays', { count: count / 24, hours: count })
      : t('moderation.durationHours', { count });
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby="moderation-hours-hint">
      <legend className="font-medium">{t('moderation.hours')}</legend>
      {hours.length === 0 ? (
        <p id="moderation-hours" tabIndex={-1} className="text-sm font-semibold text-danger">
          {t('moderation.hoursUnavailable')}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {hours.map((count, index) => (
            <label
              key={count}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border px-4 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-subtle has-[:checked]:font-semibold"
            >
              <input
                type="radio"
                name="moderation-hours"
                id={index === 0 ? 'moderation-hours' : undefined}
                className="size-5 shrink-0"
                value={count}
                checked={value === count}
                autoFocus={index === 0}
                aria-invalid={invalid ? true : undefined}
                onChange={() => onChange(count)}
              />
              {label(count)}
            </label>
          ))}
        </div>
      )}
      <p id="moderation-hours-hint" className="text-sm text-muted-foreground">
        {t('moderation.hoursHint')}
      </p>
      {invalid && hours.length > 0 && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {t('moderation.hoursInvalid')}
        </p>
      )}
    </fieldset>
  );
}

/**
 * Confirmation d'un geste : elle nomme ce qui va se produire et la maison visée. Sans champ à remplir, le foyer
 * va au geste sans effet (« Annuler ») : Entrée redoublée ne confirme rien. Avec des champs, il va au premier, et
 * la confirmation reste un bouton, pas la touche Entrée d'un champ.
 */
export function Confirmation({
  id,
  sentence,
  confirmLabel,
  busy,
  fields,
  onConfirm,
  onCancel,
  scope,
  children,
}: {
  id: string;
  sentence: string;
  confirmLabel: string;
  busy: boolean;
  fields: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Entrée de la file ou sanction visée : nomme le bouton de confirmation, qui peut reprendre le foyer. */
  scope: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3"
      onKeyDown={ignoreHeldEnter}
    >
      <p id={id} className="font-semibold wrap-anywhere">
        {sentence}
      </p>
      {children}
      <div className="flex flex-wrap gap-2">
        <Button
          icon={<Check aria-hidden="true" />}
          id={`gesture-${scope}:confirm`}
          disabled={busy}
          aria-describedby={id}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
        <Button
          icon={<X aria-hidden="true" />}
          variant="secondary"
          autoFocus={!fields}
          disabled={busy}
          aria-describedby={id}
          onClick={onCancel}
        >
          {t('moderation.cancel')}
        </Button>
      </div>
    </div>
  );
}
