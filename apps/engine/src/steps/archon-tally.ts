import { archonElectedSchema } from '@oikos/contracts';
import { sql } from 'kysely';
import type { CloseStep } from '../close';

/**
 * Dépouillement de l'élection de l'archonte (docs/specs/06-cites-politique-communaute.md, 6.2) : chaque
 * élection du monde dont le vote est clos à l'instant de jeu de la clôture. L'élection est d'abord marquée
 * dépouillée, ce qui la verrouille : un bulletin en cours, qui la tient en partage, est attendu et compté,
 * et un bulletin plus tardif est refusé par la base. La charge va à la candidature maintenue qui a le plus
 * de bulletins, la plus ancienne en cas d'égalité, parmi les maisons qui ne sont pas ostracisées à cet instant
 * (#722) : la base le vérifie. Sans candidature, elle reste vacante jusqu'au mandat suivant. Une élection dépouillée ne l'est plus jamais, même si l'étape est
 * rejouée. Les élections ouvertes sont dépouillées à leurs dates, quelle que soit la configuration.
 */
export const archonTally: CloseStep = {
  name: 'archonTally',
  async run({ trx, worldId, closeAt, at }) {
    const summary = { tallied: 0, elected: 0, vacant: 0 };
    const due = await trx
      .selectFrom('game.elections')
      .select(['id', 'city_id', 'voting_closes_at', 'term_ends_at'])
      .where('world_id', '=', worldId)
      .where('tallied_at', 'is', null)
      .where('voting_closes_at', '<=', closeAt)
      .orderBy('voting_closes_at')
      .orderBy('city_id')
      .execute();
    for (const election of due) {
      at?.(`election ${election.id}`);
      await trx
        .updateTable('game.elections')
        .set({ tallied_at: sql<Date>`now()` })
        .where('id', '=', election.id)
        .execute();
      // Relu après le verrou : READ COMMITTED, chaque instruction voit les bulletins validés avant elle.
      const winner = (
        await sql<{ house_id: string; votes: number }>`
          select c.house_id, count(b.id)::int as votes
          from game.candidacies c left join game.ballots b on b.candidacy_id = c.id
          where c.election_id = ${election.id} and c.withdrawn_at is null
            and not game.house_ostracized(c.house_id, now())
          group by c.id, c.house_id, c.created_at
          order by count(b.id) desc, c.created_at, c.id
          limit 1`.execute(trx)
      ).rows[0];
      summary.tallied += 1;
      if (!winner) {
        summary.vacant += 1;
        continue;
      }
      // Dates du mandat relues en base : à la microseconde, comme la garde les compare.
      await trx
        .insertInto('game.offices')
        .columns([
          'world_id',
          'city_id',
          'office',
          'house_id',
          'election_id',
          'starts_at',
          'ends_at',
        ])
        .expression((eb) =>
          eb
            .selectFrom('game.elections')
            .select([
              'world_id',
              'city_id',
              'office',
              eb.val(winner.house_id).as('house_id'),
              'id',
              'voting_closes_at',
              'term_ends_at',
            ])
            .where('id', '=', election.id),
        )
        .execute();
      const event = archonElectedSchema.parse({
        type: 'ArchonElected',
        payload: {
          electionId: election.id,
          cityId: election.city_id,
          houseId: winner.house_id,
          votes: winner.votes,
          termStartsAt: election.voting_closes_at.toISOString(),
          termEndsAt: election.term_ends_at.toISOString(),
        },
      });
      await trx
        .insertInto('game.domain_events')
        .values({ command_id: null, type: event.type, payload: JSON.stringify(event.payload) })
        .execute();
      summary.elected += 1;
    }

    return summary;
  },
};
