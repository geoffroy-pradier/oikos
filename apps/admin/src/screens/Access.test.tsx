// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { held } from '../test/fakes';
import { Access } from './Access';

const api = vi.hoisted(() => ({ adminGet: vi.fn(), adminCommand: vi.fn() }));
vi.mock('../api', () => api);
const { adminGet, adminCommand } = api;

const ROOT = 'aaaaaaaa-0000-4000-8000-00000000000a';
const ME = 'bbbbbbbb-0000-4000-8000-00000000000b';
const OTHER = 'cccccccc-0000-4000-8000-00000000000c';
// Forme rendue par `GET /api/admin/roles` : du plus ancien au plus récent, identifiants seuls.
const ROLES = [
  { userId: ROOT, role: 'super_admin', grantedBy: null, grantedAt: '2026-11-01T09:00:00Z' },
  { userId: ME, role: 'super_admin', grantedBy: ROOT, grantedAt: '2026-11-02T09:00:00Z' },
  { userId: OTHER, role: 'moderator', grantedBy: ME, grantedAt: '2026-11-03T09:00:00Z' },
];
const cells = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => Array.from(row.children, (cell) => cell.textContent).slice(0, 3));

let i18n: Awaited<ReturnType<typeof initI18n>>;
beforeAll(async () => {
  i18n = await initI18n('fr');
});
beforeEach(() => {
  adminGet.mockReset();
  adminCommand.mockReset();
});
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('fr');
});

it('liste chaque compte avec son identifiant entier, son rôle et qui l’a accordé ; le compte courant est signalé', async () => {
  adminGet.mockResolvedValue({ ok: true, data: { roles: ROLES } });
  render(<Access accessToken="token" userId={ME} />);
  const table = await screen.findByRole('table', {
    name: '3 comptes portent un rôle, du plus ancien au plus récent',
  });
  expect(adminGet.mock.calls).toEqual([['roles', 'token']]);
  expect(cells()).toEqual([
    [ROOT, 'Super-administrateur', 'Inscrit en base'],
    [`${ME} (vous)`, 'Super-administrateur', ROOT],
    [OTHER, 'Modérateur', `${ME} (vous)`],
  ]);
  // Le compte nomme sa ligne ; la date suit la langue.
  const row = within(table).getByRole('row', { name: new RegExp(`^${OTHER} Modérateur`) });
  expect(within(row).getByRole('rowheader').textContent).toBe(OTHER);
  expect(row.children[3]?.textContent).toMatch(/^03\/11\/2026/);
});

it('la liste se filtre par rôle ; « Tous les rôles » la rend entière', async () => {
  adminGet.mockResolvedValue({ ok: true, data: { roles: ROLES } });
  render(<Access accessToken="token" userId={ME} />);
  await screen.findByRole('table');
  const filter = screen.getByLabelText('Filtrer par rôle');
  fireEvent.change(filter, { target: { value: 'moderator' } });
  expect(cells()).toEqual([[OTHER, 'Modérateur', `${ME} (vous)`]]);
  fireEvent.change(filter, { target: { value: 'observer' } });
  expect(cells()).toEqual([]);
  fireEvent.change(filter, { target: { value: 'all' } });
  expect(cells()).toHaveLength(3);
});

it('accorde le singulier, et se lit en anglais', async () => {
  adminGet.mockResolvedValue({ ok: true, data: { roles: ROLES.slice(0, 1) } });
  render(<Access accessToken="token" userId={ME} />);
  expect(await screen.findByRole('table', { name: '1 compte porte un rôle' })).toBeTruthy();
  await i18n.changeLanguage('en');
  expect(screen.getByRole('table', { name: '1 account holds a role' })).toBeTruthy();
  expect(cells()).toEqual([[ROOT, 'Super administrator', 'Set in the database']]);
});

it('chargement, puis liste vide', async () => {
  adminGet.mockResolvedValue({ ok: true, data: { roles: [] } });
  render(<Access accessToken="token" userId={ME} />);
  expect(screen.getByText('Chargement…')).toBeTruthy();
  expect(await screen.findByText('Aucun compte ne porte de rôle.')).toBeTruthy();
  expect(screen.queryByText('Chargement…')).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
});

it('une lecture en échec le dit ; « Réessayer » la relance et rend le foyer au titre', async () => {
  adminGet.mockResolvedValueOnce({ ok: false, code: 'RATE_LIMITED' });
  adminGet.mockResolvedValue({ ok: true, data: { roles: ROLES } });
  render(<Access accessToken="token" userId={ME} />);
  const failure = 'Trop de demandes en peu de temps. Patientez un instant, puis réessayez.';
  expect((await screen.findByText(failure)).getAttribute('role')).toBe('alert');
  expect(screen.queryByRole('table')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await screen.findByRole('table');
  expect(screen.queryByText(failure)).toBeNull();
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Accès', level: 1 })),
  );
});

it('un rôle qui ne donne pas accès au module : refus affiché, rien à relancer', async () => {
  adminGet.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
  render(<Access accessToken="token" userId={ME} />);
  const refusal = await screen.findByText('Votre rôle ne donne pas accès à ce module.');
  expect(refusal.getAttribute('role')).toBe('alert');
  expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
});

const NEW = 'dddddddd-0000-4000-8000-00000000000d';
/** Liste rendue par l'API, puis celle d'après la commande ; réponses successives de la commande. */
async function opened(after: typeof ROLES, ...replies: object[]) {
  adminGet.mockResolvedValueOnce({ ok: true, data: { roles: ROLES } });
  adminGet.mockResolvedValue({ ok: true, data: { roles: after } });
  for (const reply of replies) adminCommand.mockResolvedValueOnce(reply);
  render(<Access accessToken="token" userId={ME} />);
  await screen.findByRole('table');
}
/** Ouvre la feuille « Accorder un rôle » et rend son champ d'identifiant. */
const grantSheet = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Accorder un rôle' }));
  return screen.getByLabelText('Identifiant du compte') as HTMLInputElement;
};
const fill = (field: HTMLInputElement, value: string, role = 'moderator') => {
  fireEvent.change(field, { target: { value } });
  fireEvent.change(screen.getByLabelText('Rôle'), { target: { value: role } });
  fireEvent.click(screen.getByRole('button', { name: 'Accorder le rôle' }));
};
const notice = (role: 'status' | 'alert') =>
  screen.getAllByRole(role).findLast((node) => node.tagName === 'DIV')?.textContent;
const keyOf = (call: number) => adminCommand.mock.calls[call]?.[3] as string;

it('accorde un rôle par identifiant : saisie contrôlée à l’envoi, liste relue, champ vidé', async () => {
  const added = {
    userId: NEW,
    role: 'moderator',
    grantedBy: ME,
    grantedAt: '2026-11-04T09:00:00Z',
  };
  await opened(
    [...ROLES, added],
    { ok: true, data: { userId: NEW, role: 'moderator', previousRole: null } },
    { ok: true, data: { userId: OTHER, role: 'support', previousRole: 'moderator' } },
  );
  const field = grantSheet();
  expect(screen.getByLabelText<HTMLSelectElement>('Rôle').value).toBe('observer');
  // Ni la longueur ni les tirets ne suffisent : 36 caractères hors forme, ou la forme dans un texte.
  for (const bad of [`g${NEW.slice(1)}`, NEW.replaceAll('-', '0'), `${NEW}0`, `0${NEW}`]) {
    fill(field, bad);
    expect(adminCommand, bad).not.toHaveBeenCalled();
  }
  fill(field, 'alice@example.test');
  expect(field.getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByText(/^Ce n'est pas un identifiant de compte/).id).toBe(
    field.getAttribute('aria-describedby')?.split(' ').at(-1),
  );
  expect(document.activeElement).toBe(field);
  expect(adminCommand).not.toHaveBeenCalled();

  // Espaces et majuscules d'un copier-coller : l'identifiant part sous sa forme canonique.
  fill(field, ` ${NEW.toUpperCase()} `);
  await waitFor(() => expect(notice('status')).toBe('Rôle Modérateur accordé.'));
  // Le résultat paraît dans la feuille restée ouverte, une seule fois : pas aussi sous elle, dans la page.
  expect(screen.getAllByText('Rôle Modérateur accordé.')).toHaveLength(1);
  expect(adminCommand.mock.calls[0]?.slice(0, 3)).toEqual([
    'admin.grantRole',
    { userId: NEW, role: 'moderator' },
    'token',
  ]);
  expect([field.value, field.getAttribute('aria-invalid')]).toEqual(['', null]);
  expect(screen.getByLabelText<HTMLSelectElement>('Rôle').value).toBe('observer');
  expect(cells()).toHaveLength(4);
  fill(field, OTHER, 'support');
  await waitFor(() =>
    expect(notice('status')).toBe('Rôle Support accordé, à la place de Modérateur.'),
  );
});

it('un refus est expliqué, la saisie reste ; après une panne, la même demande garde sa clé', async () => {
  await opened(
    ROLES,
    { ok: false, code: 'ROLE_SELF_GRANT' },
    { ok: false, code: 'INTERNAL' },
    { ok: false, code: 'INTERNAL' },
    { ok: false, code: 'ACCOUNT_NOT_FOUND' },
  );
  const field = grantSheet();
  fill(field, ME);
  await waitFor(() => expect(notice('alert')).toMatch(/^On ne change pas son propre rôle/));
  expect(field.value).toBe(ME);
  fill(field, ME);
  await waitFor(() => expect(notice('alert')).toMatch(/elle ne sera pas exécutée deux fois\.$/));
  fill(field, NEW);
  await waitFor(() => expect(adminCommand).toHaveBeenCalledTimes(3));
  fill(field, NEW);
  await waitFor(() => expect(notice('alert')).toBe('Aucun compte ne porte cet identifiant.'));
  // Clé neuve après un refus (intention close) et pour une autre demande ; gardée après une panne.
  expect([1, 2, 3].map((call) => keyOf(call) === keyOf(call - 1))).toEqual([false, false, true]);
});

it('pendant l’envoi, Échap ne referme pas la feuille ; un refus garde la saisie et rend le foyer au bouton', async () => {
  const sent = held<unknown>();
  await opened(ROLES, sent.promise);
  const field = grantSheet();
  fill(field, NEW, 'support');
  const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Accorder le rôle' });
  await waitFor(() => expect(submit.disabled).toBe(true));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.getByRole('dialog', { name: 'Accorder un rôle' })).toBeTruthy();
  sent.release({ ok: false, code: 'ROLE_UNCHANGED' });
  await waitFor(() => expect(notice('alert')).toBe('Ce compte porte déjà ce rôle.'));
  expect([field.value, screen.getByLabelText<HTMLSelectElement>('Rôle').value]).toEqual([
    NEW,
    'support',
  ]);
  await waitFor(() => expect(document.activeElement).toBe(submit));
});

it('la feuille s’ouvre sans le résultat d’un geste précédent', async () => {
  await opened(ROLES, { ok: false, code: 'LAST_SUPER_ADMIN' });
  fireEvent.click(screen.getByRole('button', { name: 'Retirer le rôle de cccccccc' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer le retrait' }));
  await waitFor(() => expect(notice('alert')).toMatch(/^Il doit toujours rester/));
  grantSheet();
  expect(within(screen.getByRole('dialog')).queryByText(/Il doit toujours rester/)).toBeNull();
  expect(notice('alert')).toBeUndefined();
});

it('retire un rôle après confirmation ; annuler ne fait rien et rend le foyer au bouton', async () => {
  const sent = held<{ userId: string; previousRole: string }>();
  await opened(ROLES.slice(0, 2), sent.promise);
  const revoke = () => screen.getByRole('button', { name: 'Retirer le rôle de cccccccc' });
  fireEvent.click(revoke());
  // Le foyer va au geste sans effet ; les deux boutons disent ce que le retrait emporte.
  const cancel = screen.getByRole('button', { name: 'Annuler' });
  expect(document.activeElement).toBe(cancel);
  for (const button of [cancel, screen.getByRole('button', { name: 'Confirmer le retrait' })])
    expect(
      document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe(`Le compte ${OTHER} perdra aussitôt son rôle Modérateur et tout accès à Olympe.`);
  fireEvent.click(cancel);
  expect(adminCommand).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(revoke());

  fireEvent.click(revoke());
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer le retrait' }));
  // Commande partie : on n'y renonce plus, et rien d'autre ne part avant sa réponse.
  const enabled = screen.getAllByRole<HTMLButtonElement>('button').filter((b) => !b.disabled);
  expect(enabled.map((button) => button.textContent)).toEqual([]);
  sent.release({ ok: true, data: { userId: OTHER, previousRole: 'moderator' } });
  await waitFor(() => expect(notice('status')).toBe('Rôle Modérateur retiré.'));
  expect(adminCommand.mock.calls.map((call) => call.slice(0, 3))).toEqual([
    ['admin.revokeRole', { userId: OTHER }, 'token'],
  ]);
  expect(cells().map((row) => row[0])).toEqual([ROOT, `${ME} (vous)`]);
  // Le foyer est posé après l'annonce, dans un rendu suivant : il s'attend.
  const title = screen.getByRole('heading', { name: 'Accès', level: 1 });
  await waitFor(() => expect(document.activeElement).toBe(title));
});

it('un retrait refusé (dernier super-administrateur) est expliqué, le foyer revient à la ligne', async () => {
  await opened(ROLES, { ok: false, code: 'LAST_SUPER_ADMIN' });
  // Renoncer rend le foyer au bouton de sa ligne ; ce retour ne vaut plus pour la confirmation
  // suivante, sans quoi Entrée retirerait un autre compte que celui que l'on vient de choisir.
  fireEvent.click(screen.getByRole('button', { name: 'Retirer le rôle de cccccccc' }));
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  fireEvent.click(screen.getByRole('button', { name: 'Retirer le rôle de cccccccc' }));
  fireEvent.click(screen.getByRole('button', { name: 'Retirer le rôle de aaaaaaaa' }));
  const cancel = screen.getByRole('button', { name: 'Annuler' });
  expect(document.activeElement).toBe(cancel);
  expect(document.getElementById(cancel.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
    `Le compte ${ROOT} perdra aussitôt son rôle Super-administrateur et tout accès à Olympe.`,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer le retrait' }));
  await waitFor(() =>
    expect(notice('alert')).toMatch(/^Il doit toujours rester un super-administrateur/),
  );
  expect(cells()).toHaveLength(3);
  const back = () => screen.getByRole('button', { name: 'Retirer le rôle de aaaaaaaa' });
  await waitFor(() => expect(document.activeElement).toBe(back()));
});

/** Entrée comme un navigateur la traite : elle active l'élément qui a le foyer, sauf défaut annulé. */
const enter = (repeat = false) => {
  const target = document.activeElement as HTMLElement;
  if (fireEvent.keyDown(target, { key: 'Enter', repeat })) fireEvent.click(target);
};

it('Entrée tenue ou redoublée sur « Retirer le rôle » ne retire rien, même sur sa propre ligne', async () => {
  await opened(ROLES, { ok: true, data: { userId: ME, previousRole: 'super_admin' } });
  const revoke = () => screen.getByRole('button', { name: 'Retirer le rôle de bbbbbbbb' });
  revoke().focus();
  // Seule Entrée tenue est ignorée : Tab tenue continue de parcourir les boutons.
  expect(fireEvent.keyDown(revoke(), { key: 'Tab', repeat: true })).toBe(true);
  // Touche tenue : le premier appui ouvre la confirmation, la répétition du clavier n'active rien.
  enter();
  for (let held = 0; held < 3; held += 1) enter(true);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Annuler' }));
  // Second appui distinct : il renonce. Un troisième rouvre, tenu ou non : jamais de retrait.
  enter();
  expect(document.activeElement).toBe(revoke());
  enter(true);
  expect(screen.queryByRole('button', { name: 'Confirmer le retrait' })).toBeNull();
  enter();
  const confirm = screen.getByRole('button', { name: 'Confirmer le retrait' });
  expect(adminCommand).not.toHaveBeenCalled();
  // Le retrait reste un geste voulu : aller au bouton, puis un appui franc ; pas une répétition.
  confirm.focus();
  enter(true);
  expect(adminCommand).not.toHaveBeenCalled();
  enter();
  await waitFor(() => expect(notice('status')).toBe('Rôle Super-administrateur retiré.'));
  expect(adminCommand).toHaveBeenCalledTimes(1);
});

it('une commande efface l’annonce précédente ; le foyer d’un retrait refusé ne saute pas sur la ligne revenue', async () => {
  const sent = held<{ previousRole: null }>();
  await opened(ROLES, { ok: false, code: 'ROLE_NOT_FOUND' }, sent.promise);
  // Le compte a perdu son rôle entre-temps : la liste relue n'a plus sa ligne.
  adminGet.mockResolvedValueOnce({ ok: true, data: { roles: ROLES.slice(0, 2) } });
  fireEvent.click(screen.getByRole('button', { name: 'Retirer le rôle de cccccccc' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer le retrait' }));
  await waitFor(() => expect(notice('alert')).toBe('Ce compte ne porte plus aucun rôle.'));
  expect(cells()).toHaveLength(2);

  const field = grantSheet();
  field.focus();
  fill(field, OTHER);
  expect([notice('alert'), notice('status')]).toEqual([undefined, '']);
  sent.release({ ok: true, data: { previousRole: null } });
  await waitFor(() => expect(notice('status')).toBe('Rôle Modérateur accordé.'));
  expect(screen.getByRole('button', { name: 'Retirer le rôle de cccccccc' })).toBeTruthy();
  expect(document.activeElement).toBe(field);
});

it('code de refus hors liste ou erreur inattendue : message de panne, et l’écran n’est pas verrouillé', async () => {
  await opened(ROLES, { ok: false, code: 'CODE_HORS_LISTE' });
  const field = grantSheet();
  adminCommand.mockRejectedValueOnce(new Error('inattendue'));
  const failure = "L'action n'a pas abouti. Réessayez : elle ne sera pas exécutée deux fois.";
  const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Accorder le rôle' });
  for (const calls of [1, 2]) {
    fill(field, NEW);
    expect([submit.disabled, notice('alert')]).toEqual([true, undefined]);
    await waitFor(() => expect([submit.disabled, notice('alert')]).toEqual([false, failure]));
    expect(adminCommand).toHaveBeenCalledTimes(calls);
  }
});
