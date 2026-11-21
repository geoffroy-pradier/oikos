import { createDb, type GameDatabase } from '@oikos/db';
import { sql, type Transaction } from 'kysely';

// Première publication de configuration des tests de bout en bout : les autres jeux d'essai posent des lignes, aucun
// n'ajoute de version de configuration (en ajout seul, elle reste dans la base).
// Le défaut posé plus bas est un état impossible en production : la clôture ne passe en défaut qu'un prêt échu et non
// couvert, alors qu'ici le prêt est neuf, d'échéance lointaine.
/**
 * Jeu d'essai des prêts du Trésor du temple (#732). La configuration initiale ne prête rien (plafonds nuls) : la mise en
 * place publie une version qui ouvre le temple, à chaque mise en place, avec ses propres valeurs (une version de plus, les versions sont en ajout seul), et le défaut
 * d'un prêt se pose sous les gardes levées le temps d'une transaction.
 */
const CAP = 12_000;
const TERMS = [3, 7];
type Trx = Transaction<GameDatabase>;

let current: ReturnType<typeof createDb> | undefined;
export const closeLoanDb = async () => {
  const closing = current;
  current = undefined;
  await closing?.destroy();
};
const inTransaction = <T>(run: (trx: Trx) => Promise<T>) =>
  (current ??= createDb(process.env['DATABASE_URL'] ?? '')).transaction().execute(run);

/**
 * Ouvre le temple : une version copiée de celle en vigueur, plafond de 12 000 oboles (2 000 drachmes) dès la Timè nulle,
 * durées de 3 et 7 jours, activée aussitôt.
 */
export const openTempleTreasury = () =>
  inTransaction(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext('e2e:temple-treasury'))`.execute(trx);
    const caps = JSON.stringify([{ minHonor: 0, maxPrincipal: CAP }]);
    const version = await sql<{ id: string }>`insert into config.versions (payload, note)
      select jsonb_set(jsonb_set(v.payload, '{templeTreasury,principalCaps}', ${caps}::jsonb),
               '{templeTreasury,termDays}', ${JSON.stringify(TERMS)}::jsonb), 'e2e : le temple prête'
      from config.versions v where v.id = config.active_version_at(now()) returning id`.execute(
      trx,
    );
    const id = version.rows[0]?.id;
    if (!id) throw new Error('Aucune configuration en vigueur');
    await sql`insert into config.activations (version_id) values (${id})`.execute(trx);
  });

/** Passe en défaut le prêt non soldé de la maison, sans rien prélever (état impossible en production, voir l'en-tête). */
export const defaultLoan = (houseName: string) =>
  inTransaction(async (trx) => {
    const lifted = ['loans_guard', 'loans_default_on_close'];
    for (const trigger of lifted)
      await sql.raw(`alter table game.loans disable trigger ${trigger}`).execute(trx);
    try {
      const done = await sql`update game.loans set status = 'defaulted', defaulted_day = due_day
        where status = 'active' and borrower_house_id = (select id from game.houses where name = ${houseName})`.execute(
        trx,
      );
      if (done.numAffectedRows !== 1n) throw new Error(`Prêt de ${houseName} introuvable`);
    } finally {
      for (const trigger of lifted)
        await sql.raw(`alter table game.loans enable trigger ${trigger}`).execute(trx);
    }
  });
