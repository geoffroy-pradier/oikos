import { sql } from 'kysely';
import type { City } from './city';

/*
 * Dates du banc ramenées à l'heure de jeu (#282). Une commande date ses écritures de l'instant réel de la
 * base, que le banc ne peut pas avancer : la clôture, elle, juge de ces dates à l'instant de jeu. Chaque
 * fonction ne réécrit donc que la date d'une ligne qu'une commande vient de créer, garde de la base coupée
 * puis rétablie dans la même transaction, comme `backdate` pour les sites (`balance/city.ts`).
 */
const recalled = (city: City, table: string, guard: string, column: string, id: string, at: Date) =>
  city.owner.transaction().execute(async (trx) => {
    await sql`alter table ${sql.raw(table)} disable trigger ${sql.raw(guard)}`.execute(trx);
    await sql`update ${sql.raw(table)} set ${sql.raw(column)} = ${at} where id = ${id}`.execute(
      trx,
    );
    await sql`alter table ${sql.raw(table)} enable trigger ${sql.raw(guard)}`.execute(trx);
  });

/** Date d'achat d'un bien : l'entretien est dû dès la clôture suivante. */
export const datePurchase = (city: City, propertyId: string, at: Date) =>
  recalled(city, 'game.properties', 'properties_guard', 'acquired_at', propertyId, at);
/** Date de signature d'un bail : le premier loyer est celui de la clôture suivante. */
export const dateLease = (city: City, leaseId: string, at: Date) =>
  recalled(city, 'game.leases', 'leases_guard', 'started_at', leaseId, at);
