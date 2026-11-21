import { liturgyAssignedSchema } from '@oikos/contracts';
import { notExcluded, violatedConstraint } from '@oikos/db';
import {
  dailyCloseAt,
  designateLiturgies,
  liturgyDue,
  liturgyGenre,
  seasonOfGameDay,
} from '@oikos/sim';
import { sql } from 'kysely';
import type { CloseStep } from '../close';

/**
 * Désignation des liturgies (docs/specs/06-cites-politique-communaute.md, 6.4 ; #719) : la première clôture jouée
 * d'une saison (celle de la bascule, le lundi, ou la suivante si elle a manqué) confie à chaque cité une dépense
 * publique pour ses `housesPerCity` maisons les plus riches dont la fortune (`game.house_wealth`, 4.1) atteint le
 * plancher, à égalité la plus ancienne, puis le plus petit identifiant (`designateLiturgies`). Seules comptent les
 * maisons de joueur qui ont leur foyer dans la cité et dont le compte n'est pas exclu. Le dû (`liturgyDue`) et le
 * genre (`liturgyGenre`) sont fixés à la désignation ; l'échéance est la clôture `dueDays` jours de jeu plus tard. La
 * base n'admet qu'une liturgie par maison et par saison : rejouée, l'étape n'en écrit pas de seconde. Les lignes
 * s'écrivent dans l'ordre des identifiants de maison, chacune dans un point de sauvegarde : une maison que la garde de
 * la base refuse (exclusion validée pendant la clôture) est écartée. La fortune est
 * lue à l'ouverture de la clôture, avant ses loyers et son entretien, par une seule instruction. Ni monnaie ni stock,
 * aucun verrou de plus que celui de la clôture du monde ; sans section `liturgies`, ou à zéro maison, rien.
 */
export const liturgyAssignment: CloseStep = {
  name: 'liturgyAssignment',
  async run({ trx, worldId, gameDay, config, at }) {
    const rules = config.liturgies;
    if (!rules || rules.housesPerCity === 0) return { assigned: 0 };
    const season = seasonOfGameDay(gameDay, config.clock.seasonDays);
    const previous = await trx
      .selectFrom('game.daily_closes')
      .select(sql<number | null>`max(game_day)`.as('game_day'))
      .where('world_id', '=', worldId)
      .where('game_day', '<', gameDay)
      .executeTakeFirst();
    const last = previous?.game_day ?? null;
    if (last !== null && seasonOfGameDay(last, config.clock.seasonDays) >= season)
      return { assigned: 0 };

    const { rows: candidates } = await sql<{
      house_id: string;
      city_id: string;
      wealth: string;
      seniority: number;
    }>`select w.house_id, w.city_id, w.wealth::text,
        (row_number() over (order by h.created_at, h.id) - 1)::integer as seniority
      from game.house_wealth(${worldId}) w
      join game.houses h on h.id = w.house_id
      where not w.npc and h.kind = 'player' and w.city_id is not null and ${notExcluded(sql.ref('h.user_id'))}`.execute(
      trx,
    );
    const designated = designateLiturgies(
      candidates.map((row) => ({
        houseId: row.house_id,
        cityId: row.city_id,
        wealth: BigInt(row.wealth),
        seniority: row.seniority,
      })),
      rules,
    );
    const world = await trx
      .selectFrom('game.worlds')
      .select('seed')
      .where('id', '=', worldId)
      .executeTakeFirstOrThrow();
    const dueDay = gameDay + rules.dueDays;
    const dueAt = dailyCloseAt(dueDay, config.clock);
    let assigned = 0;
    // Dans l'ordre des identifiants de maison, jamais dans celui de la fortune : ni l'ordre des lignes ni leurs
    // identifiants (`uuid_v7`, préfixés par l'instant) ne disent le classement (4.1).
    const byHouse = [...designated].sort((a, b) => (a.houseId < b.houseId ? -1 : 1));
    for (const house of byHouse) {
      at?.(`house ${house.houseId}`);
      const due = liturgyDue(house.wealth, rules);
      const genre = liturgyGenre(world.seed, season, house.houseId, rules.genres);
      // La garde de la base relit l'exclusion à l'écriture, seule juge (#945) : une exclusion validée depuis la lecture
      // des fortunes, même pendant l'instruction qui écrit, est refusée (`liturgies_house_eligible`) dans un point de
      // sauvegarde, et la maison est écartée sans faire échouer la clôture.
      await sql`savepoint liturgy_house`.execute(trx);
      let rows: { id: string }[];
      try {
        ({ rows } = await sql<{ id: string }>`insert into game.liturgies
            (world_id, city_id, house_id, season, genre, due, designated_day, due_day, due_at)
          values (${worldId}, ${house.cityId}, ${house.houseId}, ${season}, ${genre}, ${due.toString()}, ${gameDay},
                  ${dueDay}, ${dueAt})
          on conflict (house_id, season) do nothing
          returning id`.execute(trx));
      } catch (error) {
        if (violatedConstraint(error) !== 'liturgies_house_eligible') throw error;
        await sql`rollback to savepoint liturgy_house`.execute(trx);
        continue;
      }
      await sql`release savepoint liturgy_house`.execute(trx);
      const written = rows[0];
      if (!written) continue;
      const event = liturgyAssignedSchema.parse({
        type: 'LiturgyAssigned',
        payload: {
          liturgyId: written.id,
          houseId: house.houseId,
          cityId: house.cityId,
          season,
          genre,
          due: Number(due),
          dueDay,
          dueAt: dueAt.toISOString(),
        },
      });
      await trx
        .insertInto('game.domain_events')
        .values({ command_id: null, type: event.type, payload: JSON.stringify(event.payload) })
        .execute();
      assigned += 1;
    }
    return { season, assigned };
  },
};
