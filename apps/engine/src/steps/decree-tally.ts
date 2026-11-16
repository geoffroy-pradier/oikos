import { decreeAdoptedSchema, decreeRejectedSchema, type DecreeModel } from '@oikos/contracts';
import { decreeOutcome } from '@oikos/sim';
import { sql } from 'kysely';
import type { CloseStep } from '../close';

/**
 * Dépouillement des décrets (docs/specs/06-cites-politique-communaute.md, 6.3) : chaque décret du monde dont
 * le vote est clos à l'instant de jeu de la clôture. Le décret est d'abord verrouillé : un vote en cours, qui
 * le tient en partage, est attendu puis compté ; un vote plus tardif est refusé par la base. Il est adopté si
 * les votes exprimés atteignent le quorum fixé à sa proposition, en part des citoyens de la cité devenus
 * citoyens avant la fin du vote, et que les votes pour l'emportent strictement ; rejeté sinon. La base
 * recompte et n'admet que cette issue, une seule fois : rejouée, l'étape ne le retrouve plus. Les décrets au
 * vote sont dépouillés à leurs dates, quelle que soit la configuration. Rien n'est appliqué ici (#262, #263).
 */
export const decreeTally: CloseStep = {
  name: 'decreeTally',
  async run({ trx, worldId, closeAt, at }) {
    const summary = { tallied: 0, adopted: 0, rejected: 0 };
    const due = await trx
      .selectFrom('game.decrees')
      .select(['id', 'city_id', 'model'])
      .where('world_id', '=', worldId)
      .where('status', '=', 'proposed')
      .where('voting_closes_at', '<=', closeAt)
      .orderBy('voting_closes_at')
      .orderBy('id')
      .execute();
    for (const decree of due) {
      at?.(`decree ${decree.id}`);
      // Encore au vote sous le verrou : un décret déjà dépouillé (étape jouée hors du verrou de la clôture du
      // monde) est sauté au lieu de faire échouer la clôture entière.
      const locked = await trx
        .selectFrom('game.decrees')
        .select('id')
        .where('id', '=', decree.id)
        .where('status', '=', 'proposed')
        .forUpdate()
        .executeTakeFirst();
      if (!locked) continue;
      // Relu après le verrou : READ COMMITTED, chaque instruction voit les votes validés avant elle.
      const count = (
        await sql<{
          votes_for: number;
          votes_against: number;
          electorate: number;
          quorum_bps: number;
        }>`
          select d.quorum_bps,
            (select count(*) filter (where v.approve) from game.decree_votes v where v.decree_id = d.id)::int as votes_for,
            (select count(*) filter (where not v.approve) from game.decree_votes v where v.decree_id = d.id)::int as votes_against,
            (select count(*) from game.citizenships c
             where c.city_id = d.city_id and c.status = 'citizen' and c.since < d.voting_closes_at)::int as electorate
          from game.decrees d where d.id = ${decree.id}`.execute(trx)
      ).rows[0];
      if (!count) throw new Error(`Decree ${decree.id} vanished during its tally`);
      const counted = {
        votesFor: count.votes_for,
        votesAgainst: count.votes_against,
        electorate: count.electorate,
        quorumBps: count.quorum_bps,
      };
      const { adopted, quorumReached } = decreeOutcome(counted);
      await trx
        .updateTable('game.decrees')
        .set({
          status: adopted ? 'adopted' : 'rejected',
          tallied_at: sql<Date>`now()`,
          electorate: counted.electorate,
          votes_for: counted.votesFor,
          votes_against: counted.votesAgainst,
        })
        .where('id', '=', decree.id)
        .execute();
      const payload = {
        decreeId: decree.id,
        cityId: decree.city_id,
        model: decree.model satisfies DecreeModel,
        votesFor: counted.votesFor,
        votesAgainst: counted.votesAgainst,
        electorate: counted.electorate,
        quorumReached,
      };
      const event = adopted
        ? decreeAdoptedSchema.parse({ type: 'DecreeAdopted', payload })
        : decreeRejectedSchema.parse({ type: 'DecreeRejected', payload });
      await trx
        .insertInto('game.domain_events')
        .values({ command_id: null, type: event.type, payload: JSON.stringify(event.payload) })
        .execute();
      summary.tallied += 1;
      summary[adopted ? 'adopted' : 'rejected'] += 1;
    }
    return summary;
  },
};
