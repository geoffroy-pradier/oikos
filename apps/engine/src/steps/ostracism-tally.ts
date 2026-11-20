import { houseOstracizedSchema, ostracismTalliedSchema } from '@oikos/contracts';
import { dailyCloseAt, ostracismOutcome } from '@oikos/sim';
import { sql } from 'kysely';
import type { CloseStep } from '../close';

/**
 * Dépouillement des votes d'ostracisme (docs/specs/06-cites-politique-communaute.md, 6.4 ; #722) : chaque vote du
 * monde clos à l'instant de jeu de la clôture. Le vote est d'abord verrouillé : un bulletin en cours, qui le tient
 * en partage, est attendu puis compté ; un bulletin plus tardif est refusé par la base. Si les bulletins atteignent
 * le quorum fixé à l'ouverture, en part des citoyens devenus citoyens avant la fin du vote, la maison la plus nommée,
 * seule en tête, est ostracisée jusqu'à la clôture `ostracism_days` jours de jeu après celle-ci, datée par son jour de
 * jeu et non par l'heure où elle est jouée ; archonte en charge, elle quitte sa charge, vacante jusqu'au mandat
 * suivant, si l'ostracisme court encore. La base recompte et n'admet que cette issue, une seule fois :
 * rejouée, l'étape ne retrouve plus le vote. Placée avant le dépouillement des élections, qu'elle prive de l'ostracisé.
 */
export const ostracismTally: CloseStep = {
  name: 'ostracismTally',
  async run({ trx, worldId, gameDay, closeAt, config, at }) {
    const summary = { tallied: 0, ostracized: 0, vacated: 0 };
    const due = await trx
      .selectFrom('game.ostracisms')
      .select(['id', 'city_id', 'quorum_bps', 'ostracism_days', 'voting_closes_at'])
      .where('world_id', '=', worldId)
      .where('tallied_at', 'is', null)
      .where('voting_closes_at', '<=', closeAt)
      .orderBy('voting_closes_at')
      .orderBy('id')
      .execute();
    for (const ostracism of due) {
      at?.(`ostracism ${ostracism.id}`);
      const locked = await trx
        .selectFrom('game.ostracisms')
        .select('id')
        .where('id', '=', ostracism.id)
        .where('tallied_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!locked) continue;
      // Relu après le verrou : READ COMMITTED, chaque instruction voit les bulletins validés avant elle.
      const named = await trx
        .selectFrom('game.ostraca')
        .select(['target_house_id', (eb) => eb.fn.countAll<string>().as('votes')])
        .where('ostracism_id', '=', ostracism.id)
        .groupBy('target_house_id')
        .execute();
      const electorate = await trx
        .selectFrom('game.citizenships')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('city_id', '=', ostracism.city_id)
        .where('status', '=', 'citizen')
        .where('since', '<', ostracism.voting_closes_at)
        .executeTakeFirstOrThrow();
      const decision = ostracismOutcome({
        ostraca: Object.fromEntries(named.map((row) => [row.target_house_id, Number(row.votes)])),
        electorate: Number(electorate.count),
        quorumBps: ostracism.quorum_bps,
      });
      const endsAt =
        decision.outcome === 'ostracized'
          ? dailyCloseAt(gameDay + ostracism.ostracism_days, config.clock)
          : null;
      await trx
        .updateTable('game.ostracisms')
        .set({
          tallied_at: sql<Date>`now()`,
          electorate: Number(electorate.count),
          ballots: decision.ballots,
          outcome: decision.outcome,
          ...(decision.houseId && endsAt
            ? { ostracized_house_id: decision.houseId, ends_at: endsAt }
            : {}),
        })
        .where('id', '=', ostracism.id)
        .execute();
      const events: { type: string; payload: unknown }[] = [
        ostracismTalliedSchema.parse({
          type: 'OstracismTallied',
          payload: {
            ostracismId: ostracism.id,
            cityId: ostracism.city_id,
            outcome: decision.outcome,
            ballots: decision.ballots,
            electorate: Number(electorate.count),
            quorumReached: decision.quorumReached,
          },
        }),
      ];
      summary.tallied += 1;
      if (decision.outcome === 'ostracized' && endsAt) {
        // Charge d'archonte en cours de l'ostracisé : quittée maintenant, si l'ostracisme court encore (une clôture
        // rattrapée longtemps après peut le dater déjà fini) ; la base le vérifie.
        const vacated = await trx
          .updateTable('game.offices')
          .set({ vacated_at: sql<Date>`now()` })
          .where('city_id', '=', ostracism.city_id)
          .where('office', '=', 'archon')
          .where('house_id', '=', decision.houseId)
          .where('starts_at', '<=', sql<Date>`now()`)
          .where('ends_at', '>', sql<Date>`now()`)
          .where('vacated_at', 'is', null)
          .where(sql<boolean>`now() < ${endsAt}`)
          .returning('id')
          .executeTakeFirst();
        events.push(
          houseOstracizedSchema.parse({
            type: 'HouseOstracized',
            payload: {
              ostracismId: ostracism.id,
              cityId: ostracism.city_id,
              houseId: decision.houseId,
              ostraca: decision.votes,
              endsAt: endsAt.toISOString(),
              vacatedOfficeId: vacated?.id ?? null,
            },
          }),
        );
        summary.ostracized += 1;
        if (vacated) summary.vacated += 1;
      }
      for (const event of events)
        await trx
          .insertInto('game.domain_events')
          .values({ command_id: null, type: event.type, payload: JSON.stringify(event.payload) })
          .execute();
    }
    return summary;
  },
};
