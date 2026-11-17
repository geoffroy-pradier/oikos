import {
  TEMPLE_CONSULT_ORACLE_ERROR_CODES,
  templeConsultOracleInputSchema,
  templeConsultOracleOutputSchema,
} from '@oikos/contracts';
import { offeringCharis } from '@oikos/sim';
import { sql } from 'kysely';
import { charisOf, lockOffering, writeOffering } from '../offering';
import { defineCommand, type CommandResult } from '../registry';

const refuse = (code: string, message: string): CommandResult<never> => ({
  ok: false,
  error: { code, message },
});
const NO_FUNDS = { code: 'INSUFFICIENT_FUNDS', message: 'Not enough money.' };
const LIMIT = { code: 'CHARIS_LIMIT_REACHED', message: 'This Charis cannot grow any further.' };

/**
 * La maison consulte la Pythie (docs/specs/07-dieux-faveur-evenements.md, 7.3 ; #270) : une offrande de monnaie au
 * dieu de la Pythie, au prix de la configuration en vigueur, que le joueur a vu. Ses oboles sont détruites (puits
 * `sink_offerings`, écriture `temple.oracle`, nature 4.1 `offerings`), la Charis de ces oboles au taux du dieu
 * entre au journal, et la consultation rend les oracles des événements à venir de sa cité, tempêtes sur ses routes
 * comprises, tels qu'ils sont écrits à cet instant : le repli, ou sa réécriture par l'IA si elle a déjà eu lieu.
 * Une seule transaction ; mêmes verrous qu'une offrande. Payée même sans aucun oracle : refuser dirait gratuitement
 * qu'aucun événement ne s'annonce.
 */
export const templeConsultOracle = defineCommand({
  name: 'temple.consultOracle',
  input: templeConsultOracleInputSchema,
  output: templeConsultOracleOutputSchema,
  errors: TEMPLE_CONSULT_ORACLE_ERROR_CODES,
  // La base fait foi sous concurrence : ni découvert, ni Charis hors bornes.
  errorByConstraint: { accounts_no_overdraft: NO_FUNDS, favor_charis_range: LIMIT },
  async handler({ trx, userId, emit, config }, input) {
    const house = await trx
      .selectFrom('game.houses')
      .select(['id', 'world_id'])
      .where('user_id', '=', userId)
      .forNoKeyUpdate()
      .executeTakeFirst();
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    const rules = config.oracle;
    const god = config.gods.find((candidate) => candidate.id === rules?.godId);
    const gain =
      god && rules ? offeringCharis(god, { oboles: rules.consultationOboles, goods: [] }) : null;
    if (!rules || !god || !gain?.ok)
      return refuse('ORACLE_UNAVAILABLE', 'The Pythia gives no oracle under these rules.');
    const oboles = rules.consultationOboles;
    if (oboles !== input.expectedOboles)
      return refuse('PRICE_CHANGED', `A consultation now costs ${oboles} oboles.`);

    const { city_id: cityId } = await trx
      .selectFrom('game.citizenships')
      .select('city_id')
      .where('house_id', '=', house.id)
      .executeTakeFirstOrThrow();
    const treasury = await lockOffering(trx, house, god.id, oboles);
    if (!treasury || treasury.balance < oboles) return refuse(NO_FUNDS.code, NO_FUNDS.message);
    const offeringId = await writeOffering(trx, {
      worldId: house.world_id,
      houseId: house.id,
      cityId,
      godId: god.id,
      oboles,
      charis: gain.charis,
      treasuryId: treasury.id,
      kind: 'temple.oracle',
    });

    // Événements de la cité qui n'ont pas commencé à l'instant de la base (`now()`, celui de la garde).
    const oracles = await trx
      .selectFrom('game.oracles as o')
      .innerJoin('game.world_events as e', 'e.id', 'o.event_id')
      .select(['o.id', 'o.text_fr', 'o.text_en', 'o.source'])
      .where('e.world_id', '=', house.world_id)
      .where((eb) => eb.or([eb('e.city_id', '=', cityId), eb('e.other_city_id', '=', cityId)]))
      .where('e.starts_at', '>', sql<Date>`now()`)
      .orderBy('o.id')
      .execute();
    const oracleIds = oracles.map((oracle) => oracle.id);
    const consultation = await trx
      .insertInto('game.oracle_consultations')
      .values({
        world_id: house.world_id,
        house_id: house.id,
        city_id: cityId,
        offering_id: offeringId,
        oracle_ids: oracleIds,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const charis = await charisOf(trx, house.id, god.id);

    emit({
      type: 'OracleConsulted',
      payload: {
        consultationId: consultation.id,
        offeringId,
        houseId: house.id,
        cityId,
        godId: god.id,
        oboles,
        charisGained: gain.charis,
        oracleIds,
      },
    });
    return {
      ok: true,
      data: {
        consultationId: consultation.id,
        offeringId,
        godId: god.id,
        oboles,
        charisGained: gain.charis,
        charis,
        oracles: oracles.map((oracle) => ({
          oracleId: oracle.id,
          fr: oracle.text_fr,
          en: oracle.text_en,
          source: oracle.source,
        })),
      },
    };
  },
});
