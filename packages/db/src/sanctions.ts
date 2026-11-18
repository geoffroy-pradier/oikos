import { sql, type RawBuilder } from 'kysely';

/**
 * Le compte n'est ni suspendu ni exclu (exclusion validée) à l'heure de la base : la même sanction que le registre de
 * l'API relit à chaque commande (docs/specs/15-back-office-olympe.md, 15.4). `userId` : l'expression qui porte le
 * compte (une colonne, une sous-requête), ou sa valeur. L'heure est celle de l'instruction, pas du début de la
 * transaction : relue sous le verrou d'agora, après une attente, la condition voit une exclusion validée pendant
 * cette attente, qui commence à sa validation (#528).
 */
export const notSanctioned = (userId: RawBuilder<unknown> | string) =>
  sql<boolean>`not exists (select 1 from admin.sanctions x where x.user_id = ${userId}
    and x.kind in ('suspension', 'ban') and x.starts_at <= statement_timestamp()
    and (x.ends_at is null or x.ends_at > statement_timestamp())
    and (x.kind <> 'ban' or x.validated_by is not null))`;
