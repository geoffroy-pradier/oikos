import {
  boundedDecreeParamsSchemas,
  CITY_PROPOSE_DECREE_ERROR_CODES,
  cityProposeDecreeInputSchema,
  cityProposeDecreeOutputSchema,
  decreeSpendingOboles,
} from '@oikos/contracts';
import { decreeSpendingCapOboles, decreeVotingClosesAt } from '@oikos/sim';
import { sql } from 'kysely';
import { defineCommand } from '../registry';
import { houseOf, refuse } from './city-election';

/**
 * Décrets de la cité (docs/specs/06-cites-politique-communaute.md, 6.3). L'archonte en charge propose un
 * décret du catalogue fermé, aux paramètres bornés par la configuration en vigueur ; les citoyens votent ;
 * la clôture dépouille. Aucune monnaie ne bouge ici. Sous concurrence, la base fait foi pour la charge, le
 * vote unique et sa période (gardes des décrets et des votes) : ses refus reviennent sous le même code.
 */

const NOT_ARCHON = { code: 'NOT_ARCHON', message: 'Only the archon in office proposes decrees.' };

export const cityProposeDecree = defineCommand({
  name: 'city.proposeDecree',
  input: cityProposeDecreeInputSchema,
  output: cityProposeDecreeOutputSchema,
  errors: CITY_PROPOSE_DECREE_ERROR_CODES,
  errorByConstraint: { decrees_archon_only: NOT_ARCHON },
  async handler({ trx, userId, emit, config, now }, input) {
    const house = await houseOf(trx, userId);
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    const office = await trx
      .selectFrom('game.offices')
      .select('id')
      .where('city_id', '=', house.city_id)
      .where('office', '=', 'archon')
      .where('house_id', '=', house.id)
      .where('starts_at', '<=', now)
      .where('ends_at', '>', now)
      .executeTakeFirst();
    if (!office) return { ok: false, error: NOT_ARCHON };
    // Une version publiée avant les décrets n'ouvre aucun modèle.
    const decrees = config.decrees;
    const schema = decrees && boundedDecreeParamsSchemas(decrees.models)[input.model];
    if (!decrees || !schema) return refuse('DECREE_MODEL_CLOSED', 'This decree is not open.');
    const params = schema.safeParse(input.params);
    if (!params.success)
      return {
        ok: false,
        error: {
          code: 'DECREE_PARAMS_OUT_OF_BOUNDS',
          message: 'A parameter is out of bounds.',
          fields: [
            ...new Set(params.error.issues.map((issue) => ['params', ...issue.path].join('.'))),
          ],
        },
      };
    // Plafond d'une dépense : part du trésor de la cité à la proposition ; la dépense elle-même se
    // contrôle de nouveau à son application (#263). Le trésor est lu sans verrou : rien n'en sort ici.
    const spending = decreeSpendingOboles(input);
    if (spending > 0) {
      const treasury = await trx
        .selectFrom('game.accounts')
        .select('balance')
        .where('kind', '=', 'treasury')
        .where('city_id', '=', house.city_id)
        .executeTakeFirst();
      const cap = decreeSpendingCapOboles(
        BigInt(treasury?.balance ?? 0),
        decrees.spendingCapShareBps,
      );
      if (BigInt(spending) > cap)
        return refuse('SPENDING_CAP_EXCEEDED', `At most ${cap} oboles from the treasury.`);
    }
    // Les propositions d'une cité se suivent : le décompte des décrets au vote est relu sous ce verrou.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`decrees:${house.city_id}`}, 0))`.execute(
      trx,
    );
    const open = await trx
      .selectFrom('game.decrees')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('city_id', '=', house.city_id)
      .where('status', '=', 'proposed')
      .executeTakeFirstOrThrow();
    if (Number(open.count) >= decrees.maxOpenPerCity)
      return refuse(
        'TOO_MANY_OPEN_DECREES',
        `At most ${decrees.maxOpenPerCity} decrees at a time.`,
      );
    const decree = { model: input.model, params: params.data } as typeof input;
    const created = await trx
      .insertInto('game.decrees')
      .values({
        world_id: house.world_id,
        city_id: house.city_id,
        model: decree.model,
        params: JSON.stringify(decree.params),
        office_id: office.id,
        proposed_by: house.id,
        voting_closes_at: decreeVotingClosesAt(now, decrees.votingDays, config.clock),
        quorum_bps: decrees.quorumBps,
      })
      .returning(['id', 'voting_closes_at'])
      .executeTakeFirstOrThrow();
    const votingClosesAt = created.voting_closes_at.toISOString();
    emit({
      type: 'DecreeProposed',
      payload: {
        decreeId: created.id,
        cityId: house.city_id,
        houseId: house.id,
        decree,
        votingClosesAt,
      },
    });
    return {
      ok: true,
      data: { decreeId: created.id, cityId: house.city_id, model: decree.model, votingClosesAt },
    };
  },
});
