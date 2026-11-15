import { ADMIN_ROLES, type AdminRole } from '@oikos/contracts';
import { Button, Field } from '@oikos/ui';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { adminCommand } from '../api';
import { ignoreHeldEnter } from '../keyboard';
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Notice = { kind: 'status' | 'alert'; text: string } | null;

/**
 * Module Accès : comptes qui portent un rôle (15.3) ; accorder, remplacer et retirer un rôle. Les
 * identifiants sont affichés en entier : c'est par eux qu'un rôle s'accorde ou se retire, et c'est ce
 * qu'un compte sans rôle transmet. Les règles (dernier super-administrateur, propre rôle) sont celles
 * de l'API ; l'écran ne fait que proposer.
 */
export function Access({ accessToken, userId }: { accessToken: string; userId: string }) {
  const { t, i18n } = useTranslation();
  const { data, error, reload } = useAdmin<{ roles: RoleRow[] }>('roles', accessToken);
  const title = useRef<HTMLHeadingElement>(null);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  const roles = data?.roles;
  const [account, setAccount] = useState('');
  const [role, setRole] = useState<AdminRole>('observer');
  const [invalid, setInvalid] = useState(false);
  /** Compte dont le retrait attend sa confirmation ; `returnTo` : bouton qui reprend le foyer ensuite. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  // Intention en attente de réponse : la même action renvoyée après une panne réutilise sa clé.
  const pending = useRef<{ intent: string; key: string } | null>(null);

  async function run<T>(name: string, input: unknown, done: (data: T) => string) {
    setBusy(true);
    setNotice(null);
    // Le retour de foyer d'un retrait passé ne vaut plus : la liste relue peut rendre sa ligne.
    setReturnTo(null);
    const intent = `${name}:${JSON.stringify(input)}`;
    try {
      if (pending.current?.intent !== intent)
        pending.current = { intent, key: crypto.randomUUID() };
      const reply = await adminCommand<T>(name, input, accessToken, pending.current.key);
      // Sans réponse de l'API (`INTERNAL`), l'intention reste en attente : son issue est inconnue.
      if (reply.ok || reply.code !== 'INTERNAL') pending.current = null;
      await reload();
      setNotice(
        reply.ok
          ? { kind: 'status', text: done(reply.data) }
          : { kind: 'alert', text: t([`access.errors.${reply.code}`, 'access.errors.INTERNAL']) },
      );
      return reply.ok;
    } catch {
      // Erreur inattendue : issue inconnue, comme une panne ; l'écran ne reste pas verrouillé.
      setNotice({ kind: 'alert', text: t('access.errors.INTERNAL') });
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function grant(event: FormEvent) {
    event.preventDefault();
    const target = account.trim().toLowerCase();
    // Contrôlé à l'envoi, pas à chaque frappe : le message n'est annoncé qu'une fois.
    setInvalid(!UUID.test(target));
    if (!UUID.test(target)) return document.getElementById('access-account')?.focus();
    const input = { userId: target, role };
    const granted = await run<{ previousRole: AdminRole | null }>(
      'admin.grantRole',
      input,
      (data) =>
        t(data.previousRole ? 'access.replaced' : 'access.granted', {
          role: t(`roles.${role}`),
          previous: data.previousRole && t(`roles.${data.previousRole}`),
        }),
    );
    if (granted) setRole('observer');
    if (granted) setAccount('');
  }
  async function revoke(row: RoleRow) {
    const revoked = await run('admin.revokeRole', { userId: row.userId }, () =>
      t('access.revoked', { role: t(`roles.${row.role}`) }),
    );
    setConfirming(null);
    // La ligne a disparu : le foyer va au titre. Refus : il revient au bouton de la ligne.
    if (revoked) title.current?.focus();
    else setReturnTo(row.userId);
  }

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
                  <th scope="col">{t('access.actions')}</th>
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
                    <td onKeyDown={ignoreHeldEnter}>
                      {confirming === row.userId ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span id="access-confirm">
                            {t('access.confirm', { ...row, role: t(`roles.${row.role}`) })}
                          </span>
                          <Button
                            disabled={busy}
                            aria-describedby="access-confirm"
                            onClick={() => void revoke(row)}
                          >
                            {t('access.confirmRevoke')}
                          </Button>
                          {/* Le foyer va au geste sans effet : Entrée redoublée ne retire rien. */}
                          <Button
                            autoFocus
                            variant="secondary"
                            disabled={busy}
                            aria-describedby="access-confirm"
                            onClick={() => {
                              setConfirming(null);
                              setReturnTo(row.userId);
                            }}
                          >
                            {t('access.cancel')}
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="secondary"
                          autoFocus={returnTo === row.userId}
                          disabled={busy}
                          // Une autre confirmation a pu rendre le foyer à son bouton : plus maintenant.
                          onClick={() => (setReturnTo(null), setConfirming(row.userId))}
                        >
                          {t('access.revoke', { account: row.userId.slice(0, 8) })}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {/* Toujours présent : un lecteur d'écran annonce le résultat dès qu'il apparaît. */}
      <div
        role={notice?.kind ?? 'status'}
        className={notice?.kind === 'alert' ? 'font-semibold text-danger' : ''}
      >
        {notice?.text}
      </div>
      <form onSubmit={(event) => void grant(event)} className="flex flex-col gap-3">
        <h2 className="text-xl">{t('access.grantTitle')}</h2>
        <Field
          id="access-account"
          label={t('access.accountId')}
          hint={t('access.accountHint')}
          error={invalid ? t('access.accountInvalid') : undefined}
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          value={account}
          onChange={(event) => setAccount(event.target.value)}
        />
        <label htmlFor="access-role" className="font-medium">
          {t('access.role')}
        </label>
        <select
          id="access-role"
          className="min-h-11 w-full rounded-md border border-border bg-surface px-2"
          value={role}
          onChange={(event) => setRole(event.target.value as AdminRole)}
        >
          {ADMIN_ROLES.map((id) => (
            <option key={id} value={id}>
              {t(`roles.${id}`)}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={busy}>
          {t('access.grant')}
        </Button>
      </form>
    </>
  );
}
