import { Button, EmptyState, PageHeader, SegmentedControl } from '@oikos/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminGet } from '../api';
import { LoadError } from '../LoadError';
import { TABLE } from '../table';

interface Entry {
  id: string;
  userId: string;
  command: string;
  status: 'ok' | 'rejected' | 'failed';
  errorCode: string | null;
  result: unknown;
  createdAt: string;
}
const PAGE = 50;

/** Journal d'audit : commandes d'administration, réussies ou refusées, non modifiable (15.1). */
export function Audit({ accessToken }: { accessToken: string }) {
  const { t, i18n } = useTranslation();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  /** Lecture en échec : son code, et la page demandée, pour la relancer telle quelle. */
  const [error, setError] = useState<{ code: string; before?: string | undefined } | null>(null);
  const [more, setMore] = useState(false);
  /** Issue montrée (`all` : toutes), parmi les entrées déjà lues. */
  const [shown, setShown] = useState<'all' | Entry['status']>('all');
  const time = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'medium' });
  const visible = entries?.filter((entry) => shown === 'all' || entry.status === shown) ?? [];
  // Le jeton se renouvelle pendant la lecture : les pages déjà affichées restent, et la lecture
  // suivante part avec le jeton du moment. Seul le premier affichage lit la première page.
  const token = useRef(accessToken);
  token.current = accessToken;

  // Une lecture à la fois : un double clic ne demande pas deux fois la même page.
  const reading = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  const load = useCallback(async (before?: string, retried = false) => {
    if (reading.current) return;
    reading.current = true;
    const query = `audit?limit=${PAGE}${before ? `&before=${encodeURIComponent(before)}` : ''}`;
    const reply = await adminGet<{ entries: Entry[] }>(query, token.current);
    reading.current = false;
    setError(reply.ok ? null : { code: reply.code, before });
    if (!reply.ok) return;
    // Par sûreté, une entrée déjà affichée n'est jamais ajoutée une seconde fois.
    setEntries((known) => {
      const seen = new Set(before ? known?.map((entry) => entry.id) : []);
      const fresh = reply.data.entries.filter((entry) => !seen.has(entry.id));
      return before ? [...(known ?? []), ...fresh] : fresh;
    });
    // Le bouton « Réessayer » disparaît : le foyer clavier va au titre plutôt que de se perdre.
    if (retried) title.current?.focus();
    setMore(reply.data.entries.length === PAGE);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader title={t('audit.title')} titleRef={title} />
      {!entries && !error && <p>{t('app.loading')}</p>}
      {entries?.length === 0 && <p className="text-muted-foreground">{t('audit.empty')}</p>}
      {entries && entries.length > 0 && (
        <>
          <SegmentedControl
            label={t('audit.filter')}
            className="self-start"
            value={shown}
            onValueChange={(value) => setShown(value as typeof shown)}
            options={(['all', 'ok', 'rejected', 'failed'] as const).map((value) => ({
              value,
              label: t(`audit.filters.${value}`),
            }))}
          />
          {/* Le filtre ne porte que sur les pages déjà lues : il le dit, avec le compte. */}
          <p aria-live="polite" className="-mt-3 text-sm text-muted-foreground">
            {shown !== 'all' &&
              t('audit.filtered', { count: entries.length, shown: visible.length })}
          </p>
          <p id="audit-caption" className="text-sm text-muted-foreground">
            {t('audit.caption')}
          </p>
          {visible.length === 0 && <EmptyState title={t('audit.filteredEmpty')} />}
          <div
            hidden={visible.length === 0}
            className="overflow-x-auto rounded-xl border border-border-subtle bg-surface shadow-sm"
          >
            <table aria-labelledby="audit-caption" className={TABLE}>
              <thead>
                <tr>
                  <th scope="col">{t('audit.time')}</th>
                  <th scope="col">{t('audit.account')}</th>
                  <th scope="col">{t('audit.command')}</th>
                  <th scope="col">{t('audit.outcome')}</th>
                  <th scope="col">{t('audit.result')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((entry) => (
                  <tr key={entry.id}>
                    <td>{time.format(new Date(entry.createdAt))}</td>
                    <td>
                      <code className="whitespace-nowrap">{entry.userId.slice(0, 8)}</code>
                    </td>
                    <td>
                      <code>{entry.command}</code>
                    </td>
                    <td>
                      {entry.status === 'rejected' && !entry.errorCode
                        ? t('audit.rejectedNoCode')
                        : t(`audit.status.${entry.status}`, { code: entry.errorCode ?? '' })}
                    </td>
                    <td>
                      <code className="break-all">
                        {entry.result === null ? '' : JSON.stringify(entry.result)}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {/* Sous le tableau : l'échec d'une page plus ancienne laisse les pages déjà lues à l'écran. */}
      {error && <LoadError code={error.code} onRetry={() => void load(error.before, true)} />}
      {more && !error && (
        <Button variant="secondary" onClick={() => void load(entries?.at(-1)?.id)}>
          {t('audit.older')}
        </Button>
      )}
    </>
  );
}
