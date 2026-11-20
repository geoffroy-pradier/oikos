import { ostracismOpenedSchema } from '@oikos/contracts';
import { dailyCloseAt } from '@oikos/sim';
import type { CloseStep } from '../close';

/**
 * Ouverture des votes d'ostracisme (docs/specs/06-cites-politique-communaute.md, 6.4 ; #722) : chaque décret
 * d'ostracisme adopté du monde sans vote ouvre le sien, avec les règles de la configuration de la clôture,
 * fixées dès lors : il se clôt à la clôture `votingDays` jours de jeu plus tard. La base n'admet qu'un vote par
 * décret et un vote non dépouillé par cité : rejouée, l'étape n'ouvre rien de plus. Tant que la configuration
 * ne règle pas le modèle, le décret attend, adopté, sans effet. Ni monnaie ni stock, aucun verrou de plus.
 */
export const ostracismOpening: CloseStep = {
  name: 'ostracismOpening',
  async run({ trx, worldId, gameDay, config, at }) {
    const summary = { opened: 0, waiting: 0 };
    const due = await trx
      .selectFrom('game.decrees as d')
      .leftJoin('game.ostracisms as o', 'o.decree_id', 'd.id')
      .select(['d.id', 'd.city_id'])
      .where('d.world_id', '=', worldId)
      .where('d.model', '=', 'ostracism')
      .where('d.status', '=', 'adopted')
      .where('o.id', 'is', null)
      .orderBy('d.voting_closes_at')
      .orderBy('d.id')
      .execute();
    const rules = config.decrees?.models.ostracism;
    if (!rules) return { ...summary, waiting: due.length };
    const votingClosesAt = dailyCloseAt(gameDay + rules.votingDays, config.clock);
    for (const decree of due) {
      at?.(`decree ${decree.id}`);
      // Un vote déjà ouvert pour ce décret, ou encore au vote dans sa cité : rien n'est ouvert.
      const opened = await trx
        .insertInto('game.ostracisms')
        .values({
          world_id: worldId,
          city_id: decree.city_id,
          decree_id: decree.id,
          voting_closes_at: votingClosesAt,
          quorum_bps: rules.quorumBps,
          ostracism_days: rules.ostracismDays,
        })
        .onConflict((conflict) => conflict.doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!opened) {
        summary.waiting += 1;
        continue;
      }
      const event = ostracismOpenedSchema.parse({
        type: 'OstracismOpened',
        payload: {
          ostracismId: opened.id,
          decreeId: decree.id,
          cityId: decree.city_id,
          votingClosesAt: votingClosesAt.toISOString(),
          quorumBps: rules.quorumBps,
          ostracismDays: rules.ostracismDays,
        },
      });
      await trx
        .insertInto('game.domain_events')
        .values({ command_id: null, type: event.type, payload: JSON.stringify(event.payload) })
        .execute();
      summary.opened += 1;
    }
    return summary;
  },
};
