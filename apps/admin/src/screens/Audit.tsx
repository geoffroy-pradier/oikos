import { Button } from '@oikos/ui';
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
  const time = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'medium' });
  // Le jeton se renouvelle pendant la lecture : les pages déjà affichées restent, et la lecture
  // suivante part avec le jeton du moment. Seul le premier affichage lit la première page.
  const token = useRef(accessToken);
  token.current = accessToken;

  const load = useCallback(async (before?: string) => {
    const query = `audit?limit=${PAGE}${before ? `&before=${encodeURIComponent(before)}` : ''}`;
    const reply = await adminGet<{ entries: Entry[] }>(query, token.current);
    setError(reply.ok ? null : { code: reply.code, before });
    if (!reply.ok) return;
    setEntries((known) =>
      before ? [...(known ?? []), ...reply.data.entries] : reply.data.entries,
    );
    setMore(reply.data.entries.length === PAGE);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <h1 className="text-2xl">{t('audit.title')}</h1>
      {!entries && !error && <p>{t('app.loading')}</p>}
      {entries?.length === 0 && <p className="text-muted-foreground">{t('audit.empty')}</p>}
      {entries && entries.length > 0 && (
        <>
          <p id="audit-caption" className="text-sm text-muted-foreground">
            {t('audit.caption')}
          </p>
          <div className="overflow-x-auto">
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
                {entries.map((entry) => (
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
      {error && <LoadError code={error.code} onRetry={() => void load(error.before)} />}
      {more && !error && (
        <Button variant="secondary" onClick={() => void load(entries?.at(-1)?.id)}>
          {t('audit.older')}
        </Button>
      )}
    </>
  );
}
