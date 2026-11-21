import { sql, type Kysely, type RawBuilder } from 'kysely';

/**
 * Sanctions en vigueur (docs/specs/15-back-office-olympe.md, 15.4) : le seul endroit qui décide qu'un compte sanctionné
 * n'agit pas, partagé par le registre de l'API, `market.placeOrder` et les intendants du moteur (#563).
 */

/** Refus d'une sanction en vigueur : toute action (suspension, exclusion validée), ou la parole seule (silence). */
export type SanctionRefusal = 'SUSPENDED' | 'SILENCED';

type InForceKind = 'suspension' | 'ban' | 'silence';
/** Ce qui retire toute action au compte ; une exclusion n'agit qu'une fois validée par une seconde personne. */
const STOPS_ACTION: readonly InForceKind[] = ['suspension', 'ban'];

/**
 * Une sanction de ces natures est en vigueur pour le compte, à l'heure de l'instruction, pas du début de la
 * transaction : relue sous le verrou d'agora, après une attente, la condition voit une exclusion validée pendant
 * cette attente, qui commence à sa validation (#528). Comparée dans la base, à la microseconde : une `Date` tronquée à
 * la milliseconde manquerait une sanction posée, finie ou levée dans la même milliseconde (#611).
 */
const inForce = (userId: RawBuilder<unknown> | string, kinds: readonly InForceKind[]) =>
  sql<boolean>`exists (select 1 from admin.sanctions x where x.user_id = ${userId}
    and x.kind in (${sql.join(kinds.map((kind) => sql.lit(kind)))})
    and x.starts_at <= statement_timestamp()
    and (x.ends_at is null or x.ends_at > statement_timestamp())
    and (x.kind <> 'ban' or x.validated_by is not null))`;

/**
 * Le compte n'est ni suspendu ni exclu (exclusion validée). `userId` : l'expression qui porte le compte (une colonne,
 * une sous-requête), ou sa valeur. Filtre d'une lecture : les intendants d'un compte libre, relus sous le verrou
 * d'agora dans la transaction de leur opération, comme l'ordre que place le joueur.
 */
export const notSanctioned = (userId: RawBuilder<unknown> | string) =>
  sql<boolean>`not ${inForce(userId, STOPS_ACTION)}`;

/**
 * Le compte n'est pas exclu (exclusion validée en vigueur), suspendu ou non : les maisons qu'une liturgie peut
 * désigner (6.4, #719). Une suspension a une fin et n'écarte pas d'une charge de la saison.
 */
export const notExcluded = (userId: RawBuilder<unknown> | string) =>
  sql<boolean>`not ${inForce(userId, ['ban'])}`;

/**
 * Refus que la sanction en vigueur oppose au compte, lu dans la transaction de l'appelant : `SUSPENDED` (suspension ou
 * exclusion validée), sinon `SILENCED` si l'action est une parole (`speech`) et le compte réduit au silence, sinon
 * `null`. Même condition que `notSanctioned`.
 */
export async function sanctionRefusal<T>(
  db: Kysely<T>,
  userId: string,
  { speech }: { speech: boolean },
): Promise<SanctionRefusal | null> {
  const { rows } = await sql<{ suspended: boolean; silenced: boolean }>`
    select ${inForce(userId, STOPS_ACTION)} as suspended,
           ${speech ? inForce(userId, ['silence']) : sql<boolean>`false`} as silenced`.execute(db);
  const [row] = rows;
  if (!row) throw new Error('The database returned no sanction');
  return row.suspended ? 'SUSPENDED' : row.silenced ? 'SILENCED' : null;
}
