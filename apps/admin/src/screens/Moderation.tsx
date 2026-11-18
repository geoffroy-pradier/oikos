import { SANCTION_REASON_MAX_CHARS, type AdminReports } from '@oikos/contracts';
import { Button, Field } from '@oikos/ui';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { adminCommand } from '../api';
import { ignoreHeldEnter } from '../keyboard';
import { LoadError } from '../LoadError';
import { hoursSince, STALE_REPORT_HOURS, staleReportHours } from '../moderation-age';
import { useAdmin } from '../useAdmin';

type Entry = AdminReports['queue'][number];
type Appeal = AdminReports['appeals'][number];
type Notice = { kind: 'status' | 'alert'; text: string } | null;
/** Geste en cours de confirmation : sur un signalement, sur une exclusion proposée, sur un appel. */
export type Gesture =
  | 'hide'
  | 'dismissed'
  | 'upheld'
  | 'warning'
  | 'silence'
  | 'suspension'
  | 'ban'
  | 'confirmExclusion'
  | 'granted'
  | 'rejected';
const SANCTIONS: readonly Gesture[] = ['warning', 'silence', 'suspension', 'ban'];

/** Alerte « signalements en attente depuis plus de 24 h » (15.5), partagée par ce module et la Vigie. */
export function StaleReportsAlert({ hours }: { hours: number | null }) {
  const { t } = useTranslation();
  if (hours === null) return null;
  return (
    <p role="alert" className="rounded-md border border-danger p-3 font-semibold text-danger">
      {t('moderation.stale', { hours, limit: STALE_REPORT_HOURS })}
    </p>
  );
}

/**
 * Module Modération (15.1) : file des signalements, du plus ancien au plus signalé, avec le contexte de la
 * conversation ; masquer, sanctionner, proposer une exclusion, retenir ou classer. Chaque geste passe par une
 * confirmation qui nomme la maison visée ; les règles (durées offertes, seconde personne) sont celles de l'API.
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
  const [hours, setHours] = useState('');
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState<{ hours?: boolean; reason?: boolean }>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  // Intention en attente de réponse : le même geste renvoyé après une panne réutilise sa clé.
  const pending = useRef<{ intent: string; key: string } | null>(null);

  async function run(name: string, input: unknown, done: string) {
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
              text: i18n.exists(`moderation.errors.${reply.code}`)
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
    setHours('');
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
      // Contrôlé à la confirmation : durée entière positive, motif non vide ; l'API reste juge des durées offertes.
      const length = [...reason.trim()].length;
      const duration = Number(hours);
      const hoursInvalid = gesture !== 'ban' && !(Number.isInteger(duration) && duration > 0);
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
          : { ...base, kind: gesture, hours: duration },
        t(`moderation.done.${gesture}`, { house }),
      );
    }
    if (ok) {
      setOpen(null);
      title.current?.focus();
    } else if (!SANCTIONS.includes(gesture)) {
      // Refus d'un geste simple : le foyer revient à son bouton. Une sanction refusée garde ses champs à corriger.
      setOpen(null);
      setReturnTo(`${open?.scope}:${gesture}`);
    }
  }

  /** Validation d'une exclusion et décision d'un appel : une sanction désignée par son identifiant. */
  async function confirmSanction(sanctionId: string, gesture: Gesture) {
    const ok =
      gesture === 'confirmExclusion'
        ? await run('admin.confirmExclusion', { sanctionId }, t('moderation.done.confirmExclusion'))
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
  const sanctionGesture = (sanctionId: string, userId: string, gesture: Gesture) =>
    open?.scope === sanctionId && open.gesture === gesture ? (
      <Confirmation
        key={gesture}
        id={`confirm-${sanctionId}`}
        sentence={t(`moderation.confirm.${gesture}`, { userId })}
        confirmLabel={t(`moderation.confirmLabel.${gesture}`)}
        busy={busy}
        fields={false}
        onConfirm={() => void confirmSanction(sanctionId, gesture)}
        onCancel={cancel}
      />
    ) : (
      <Button
        key={gesture}
        variant="secondary"
        autoFocus={returnTo === `${sanctionId}:${gesture}`}
        disabled={busy}
        onClick={() => begin(sanctionId, gesture)}
      >
        {t(`moderation.act.${gesture}`, { account: userId.slice(0, 8) })}
      </Button>
    );

  const stale = staleReportHours(data);
  const queue = data?.queue ?? [];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 ref={title} tabIndex={-1} className="text-2xl">
          {t('moderation.title')}
        </h1>
        <Button variant="secondary" disabled={busy} onClick={() => void reload()}>
          {t('app.refresh')}
        </Button>
      </div>
      {error && (
        <LoadError code={error} onRetry={() => void reload().then(() => title.current?.focus())} />
      )}
      {!data && !error && <p>{t('app.loading')}</p>}
      <StaleReportsAlert hours={stale} />
      {/* Toujours présent : un lecteur d'écran annonce le résultat dès qu'il apparaît. */}
      <div
        role={notice?.kind ?? 'status'}
        className={notice?.kind === 'alert' ? 'font-semibold text-danger' : ''}
      >
        {notice?.text}
      </div>
      {data && (
        <>
          <h2 id="moderation-queue" className="text-xl">
            {t('moderation.queue')}
          </h2>
          {queue.length === 0 ? (
            <p className="text-muted-foreground">{t('moderation.queueEmpty')}</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {t('moderation.queueCaption', { count: queue.length })}
              </p>
              <ol aria-labelledby="moderation-queue" className="flex flex-col gap-4">
                {queue.map((entry) => {
                  const scope = entry.reports[0]?.id ?? '';
                  const oldest = entry.reports.reduce(
                    (min, report) => (report.createdAt < min ? report.createdAt : min),
                    entry.reports[0]?.createdAt ?? data.now,
                  );
                  const house = entry.reportedHouse.name;
                  const asked = open?.scope === scope ? open.gesture : null;
                  const ask = (gesture: Gesture, label: string, variant?: 'secondary') => (
                    <Button
                      variant={variant ?? 'secondary'}
                      autoFocus={returnTo === `${scope}:${gesture}`}
                      disabled={busy}
                      onClick={() => begin(scope, gesture)}
                    >
                      {label}
                    </Button>
                  );
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
                      ? t('moderation.channelCity', { city: entry.channel.city })
                      : t('moderation.channelDirect')
                    : null;
                  return (
                    <li
                      key={scope}
                      aria-labelledby={`entry-${scope}`}
                      className="flex flex-col gap-2 rounded-md border border-border p-3"
                    >
                      <h3 id={`entry-${scope}`} className="text-lg font-semibold wrap-anywhere">
                        {t('moderation.entry', { house, count: entry.reports.length })}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {channel ? t('moderation.sinceChannel', { since, channel }) : since}
                      </p>
                      <ul className="list-disc pl-5 text-sm">
                        {entry.reports.map((report) => (
                          <li key={report.id} className="wrap-anywhere">
                            {t('moderation.reportLine', {
                              reason: t(`moderation.reasons.${report.reason}`, {
                                defaultValue: report.reason,
                              }),
                              date: date.format(new Date(report.createdAt)),
                            })}
                          </li>
                        ))}
                      </ul>
                      {entry.message ? (
                        <ol
                          aria-label={t('moderation.conversation')}
                          className="flex flex-col gap-1 rounded-md bg-surface p-2 text-sm"
                        >
                          {thread.map((m) => (
                            <li
                              key={m.id}
                              className={
                                m.id === entry.message?.id
                                  ? 'border-l-4 border-danger pl-2 font-semibold wrap-anywhere'
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
                      {asked ? (
                        <Confirmation
                          id={`confirm-${scope}`}
                          sentence={t(`moderation.confirm.${asked}`, { house })}
                          confirmLabel={t(`moderation.confirmLabel.${asked}`)}
                          busy={busy}
                          fields={SANCTIONS.includes(asked)}
                          onConfirm={() => void confirm(entry, asked)}
                          onCancel={cancel}
                        >
                          {asked !== 'ban' && (
                            <Field
                              id="moderation-hours"
                              label={t('moderation.hours')}
                              hint={t('moderation.hoursHint')}
                              error={invalid.hours ? t('moderation.hoursInvalid') : undefined}
                              type="number"
                              inputMode="numeric"
                              min={1}
                              step={1}
                              autoFocus
                              value={hours}
                              onChange={(event) => setHours(event.target.value)}
                            />
                          )}
                          <label htmlFor="moderation-reason" className="font-medium">
                            {t('moderation.reason')}
                          </label>
                          <textarea
                            id="moderation-reason"
                            className="min-h-24 w-full rounded-md border border-border bg-surface p-2"
                            maxLength={SANCTION_REASON_MAX_CHARS}
                            autoFocus={asked === 'ban'}
                            aria-invalid={invalid.reason ? true : undefined}
                            aria-describedby="moderation-reason-hint"
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                          />
                          <p id="moderation-reason-hint" className="text-sm text-muted-foreground">
                            {t('moderation.reasonHint')}
                          </p>
                          {invalid.reason && (
                            <p role="alert" className="text-sm font-semibold text-danger">
                              {t('moderation.reasonInvalid')}
                            </p>
                          )}
                        </Confirmation>
                      ) : (
                        <div
                          role="group"
                          aria-label={t('moderation.actions', { house })}
                          className="flex flex-wrap gap-2"
                          onKeyDown={ignoreHeldEnter}
                        >
                          {entry.message &&
                            !entry.message.hiddenAt &&
                            ask('hide', t('moderation.act.hide'))}
                          {ask('warning', t('moderation.act.warning'))}
                          {ask('silence', t('moderation.act.silence'))}
                          {ask('suspension', t('moderation.act.suspension'))}
                          {ask('ban', t('moderation.act.ban'))}
                          {ask('upheld', t('moderation.act.upheld'))}
                          {ask('dismissed', t('moderation.act.dismissed'))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </>
          )}
          <h2 id="moderation-exclusions" className="text-xl">
            {t('moderation.exclusions')}
          </h2>
          {data.pendingExclusions.length === 0 ? (
            <p className="text-muted-foreground">{t('moderation.exclusionsEmpty')}</p>
          ) : (
            <ul aria-labelledby="moderation-exclusions" className="flex flex-col gap-3">
              {data.pendingExclusions.map((item) => (
                <li
                  key={item.sanctionId}
                  className="flex flex-col gap-2 rounded-md border border-border p-3"
                >
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
                  </div>
                </li>
              ))}
            </ul>
          )}
          <h2 id="moderation-appeals" className="text-xl">
            {t('moderation.appeals')}
          </h2>
          {data.appeals.length === 0 ? (
            <p className="text-muted-foreground">{t('moderation.appealsEmpty')}</p>
          ) : (
            <ul aria-labelledby="moderation-appeals" className="flex flex-col gap-3">
              {data.appeals.map((item) => (
                <li
                  key={item.sanctionId}
                  className="flex flex-col gap-2 rounded-md border border-border p-3"
                >
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
  children,
}: {
  id: string;
  sentence: string;
  confirmLabel: string;
  busy: boolean;
  fields: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-labelledby={id}
      className="flex flex-col gap-2 rounded-md border border-danger p-3"
      onKeyDown={ignoreHeldEnter}
    >
      <p id={id} className="font-semibold wrap-anywhere">
        {sentence}
      </p>
      {children}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} aria-describedby={id} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button
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
