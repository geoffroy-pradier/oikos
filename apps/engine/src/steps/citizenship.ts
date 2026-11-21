import { citizenshipGrantedSchema } from '@oikos/contracts';
import { dailyCloseAt } from '@oikos/sim';
import { sql } from 'kysely';
import type { CloseStep } from '../close';

/**
 * Citoyenneté (docs/specs/03-boucles-progression.md, progression ; 6.2). Une maison fondée le jour de jeu
 * g devient citoyenne à la clôture qui ouvre le jour g + `politics.meticDays` : cette clôture promeut donc
 * les métèques arrivés avant la clôture du jour `gameDay − meticDays + 1`. Une maison arrivée après
 * l'instant de jeu de la clôture, jouée en retard, n'est jamais promue par elle. La base date la promotion
 * de la transaction et refuse tout autre changement de statut (garde des citoyennetés). Rejouée sur un jour
 * ultérieur, l'étape ne trouve plus ces maisons, déjà citoyennes. Une maison PNJ de secours n'est jamais promue
 * (#715). Sans section `politics` (version publiée
 * avant la citoyenneté), personne n'est promu. Chaque maison promue reçoit `CitizenshipGranted`.
 */
export const citizenship: CloseStep = {
  name: 'citizenship',
  async run({ trx, worldId, gameDay, config }) {
    const politics = config.politics;
    if (!politics) return { granted: 0 };
    const arrivedBefore = dailyCloseAt(gameDay - politics.meticDays + 1, config.clock);
    const granted = await trx
      .updateTable('game.citizenships')
      .set({ status: 'citizen', since: sql<Date>`now()` })
      .where('status', '=', 'metic')
      .where('since', '<', arrivedBefore)
      .where('city_id', 'in', (eb) =>
        eb.selectFrom('game.cities').select('id').where('world_id', '=', worldId),
      )
      // Une maison PNJ de secours reste métèque (#715) : la base refuse sa promotion.
      .where('house_id', 'in', (eb) =>
        eb
          .selectFrom('game.houses')
          .select('id')
          .where('world_id', '=', worldId)
          .where('kind', '=', 'player'),
      )
      .returning(['house_id', 'city_id'])
      .execute();
    if (granted.length > 0) {
      const events = granted
        .sort((a, b) => (a.house_id < b.house_id ? -1 : 1))
        .map(({ house_id: houseId, city_id: cityId }) =>
          citizenshipGrantedSchema.parse({
            type: 'CitizenshipGranted',
            payload: { houseId, cityId, gameDay },
          }),
        );
      await trx
        .insertInto('game.domain_events')
        .values(
          events.map((event) => ({
            command_id: null,
            type: event.type,
            payload: JSON.stringify(event.payload),
          })),
        )
        .execute();
    }
    return { granted: granted.length };
  },
};
