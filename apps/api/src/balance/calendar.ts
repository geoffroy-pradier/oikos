import { sql } from 'kysely';
import type { City } from './city';

/* Vie civique du banc (#282) : dates des citoyennetés, élections, charges et décrets ramenées à l'heure de jeu, comme `dates.ts`. */
/** Métèques d'une cité arrivés à `at` (jour 0 du banc) : la clôture les promeut après `politics.meticDays` jours de jeu. */
export const dateMetics = (city: City, at: Date) =>
  city.owner.transaction().execute(async (trx) => {
    await sql`alter table game.citizenships disable trigger citizenships_guard`.execute(trx);
    await sql`update game.citizenships set since = ${at} where city_id = ${city.cityId} and status = 'metic'`.execute(
      trx,
    );
    await sql`alter table game.citizenships enable trigger citizenships_guard`.execute(trx);
  });
/**
 * Citoyens promus par la clôture du jour de jeu `at` : la base date la promotion de l'instant réel, or les
 * décrets comptent l'électorat des citoyens devenus tels avant la fin de leur vote (instant de jeu).
 */
export const dateCitizens = (city: City, at: Date) =>
  city.owner.transaction().execute(async (trx) => {
    await sql`alter table game.citizenships disable trigger citizenships_guard`.execute(trx);
    await sql`update game.citizenships set since = ${at} where status = 'citizen' and since > ${at}
      and city_id in (select id from game.cities where world_id = ${city.worldId})`.execute(trx);
    await sql`alter table game.citizenships enable trigger citizenships_guard`.execute(trx);
  });

/**
 * Le temps des élections et des charges ramené à l'instant réel, le temps de `body` : les commandes jugent le
 * dépôt des candidatures, le vote et la charge de l'archonte à l'heure de la base, alors que la clôture ouvre
 * et dépouille les élections à l'heure de jeu `now`. Le calendrier des élections non dépouillées et les charges
 * sont décalés de l'écart entre les deux (millisecondes entières, donc rendus exactement), puis rétablis.
 */
export async function atRealTime<T>(world: City, now: Date, body: () => Promise<T>) {
  const gap = Date.now() - now.getTime();
  const shift = (sign: 1 | -1) =>
    world.owner.transaction().execute(async (trx) => {
      const by = sql`${sign * gap}::float8 * interval '1 millisecond'`;
      await sql`alter table game.elections disable trigger elections_guard`.execute(trx);
      await sql`alter table game.offices disable trigger offices_guard`.execute(trx);
      await sql`update game.elections set candidacy_opens_at = candidacy_opens_at + ${by},
        voting_opens_at = voting_opens_at + ${by}, voting_closes_at = voting_closes_at + ${by},
        term_ends_at = term_ends_at + ${by} where world_id = ${world.worldId} and tallied_at is null`.execute(
        trx,
      );
      await sql`update game.offices set starts_at = starts_at + ${by}, ends_at = ends_at + ${by}
        where world_id = ${world.worldId}`.execute(trx);
      await sql`alter table game.offices enable trigger offices_guard`.execute(trx);
      await sql`alter table game.elections enable trigger elections_guard`.execute(trx);
    });
  await shift(1);
  try {
    return await body();
  } finally {
    await shift(-1);
  }
}

/** Décret proposé, voté puis daté à l'heure de jeu : proposition à `at`, fin du vote à la clôture que la règle donne. */
export const dateDecree = (city: City, decreeId: string, at: Date, closesAt: Date) =>
  city.owner.transaction().execute(async (trx) => {
    await sql`alter table game.decrees disable trigger decrees_guard`.execute(trx);
    await sql`update game.decrees set proposed_at = ${at}, voting_closes_at = ${closesAt} where id = ${decreeId}`.execute(
      trx,
    );
    await sql`alter table game.decrees enable trigger decrees_guard`.execute(trx);
  });
