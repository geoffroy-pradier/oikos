import type { AdminRole } from '@oikos/contracts';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../LoadError';
import { TABLE } from '../table';
import { useAdmin } from '../useAdmin';

export interface RoleRow {
  userId: string;
  role: AdminRole;
  /** `null` : premier super-administrateur, inscrit en base par un humain. */
  grantedBy: string | null;
  grantedAt: string;
}

/**
 * Module Accès : comptes qui portent un rôle (15.3). Les identifiants sont affichés en entier : c'est par
 * eux qu'un rôle s'accorde ou se retire, et c'est ce qu'un compte sans rôle transmet.
 */
export function Access({ accessToken, userId }: { accessToken: string; userId: string }) {
  const { t, i18n } = useTranslation();
  const { data, error, reload } = useAdmin<{ roles: RoleRow[] }>('roles', accessToken);
  const title = useRef<HTMLHeadingElement>(null);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  const roles = data?.roles;

  return (
    <>
      <h1 ref={title} tabIndex={-1} className="text-2xl">
        {t('access.title')}
      </h1>
      {/* « Réessayer » disparaît quand la lecture aboutit : le foyer clavier va au titre. */}
      {error && (
        <LoadError code={error} onRetry={() => void reload().then(() => title.current?.focus())} />
      )}
      {!roles && !error && <p>{t('app.loading')}</p>}
      {roles?.length === 0 && <p className="text-muted-foreground">{t('access.empty')}</p>}
      {roles && roles.length > 0 && (
        <>
          <p id="access-caption" className="text-sm text-muted-foreground">
            {t('access.caption', { count: roles.length })}
          </p>
          <div className="overflow-x-auto">
            <table aria-labelledby="access-caption" className={TABLE}>
              <thead>
                <tr>
                  <th scope="col">{t('access.account')}</th>
                  <th scope="col">{t('access.role')}</th>
                  <th scope="col">{t('access.grantedBy')}</th>
                  <th scope="col">{t('access.grantedAt')}</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((row) => (
                  <tr key={row.userId}>
                    <th scope="row" className="font-normal">
                      <code className="break-all">{row.userId}</code>
                      {row.userId === userId && ` ${t('access.you')}`}
                    </th>
                    <td>{t(`roles.${row.role}`)}</td>
                    <td>
                      {row.grantedBy === null ? (
                        t('access.byHand')
                      ) : (
                        <>
                          <code className="break-all">{row.grantedBy}</code>
                          {row.grantedBy === userId && ` ${t('access.you')}`}
                        </>
                      )}
                    </td>
                    <td>{date.format(new Date(row.grantedAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
