import { dbCallStore, isCapped } from '@oikos/ai';
import {
  STEWARD_SUBMIT_INSTRUCTION_ERROR_CODES,
  stewardSubmitInstructionInputSchema,
  stewardSubmitInstructionOutputSchema,
} from '@oikos/contracts';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { sql } from 'kysely';
import { defineCommand, type CommandResult } from '../registry';
import { lockSteward } from './steward';

const refuse = (code: string, message: string): CommandResult<never> => ({
  ok: false,
  error: { code, message },
});
const PENDING = { code: 'INSTRUCTION_PENDING', message: 'An instruction is still pending.' };

/**
 * Consigne en langage naturel à un intendant de la maison (docs/specs/04-systemes-gestion.md, 4.4 ; 8.4 ; #280) :
 * mise en file pour le moteur, qui la fait traduire en règles par la passerelle IA et les simule. L'API n'appelle
 * jamais l'IA (11) et ne donne aucune règle : le joueur valide la proposition par `steward.setRules`.
 * Refusée (`AI_UNAVAILABLE`) quand l'usage `steward` est coupé, quand son plafond du mois est atteint selon la règle
 * de la passerelle (`isCapped`), ou quand la maison a donné toutes ses consignes du jour de jeu
 * (`ai.stewardDailyQuotaPerHouse`, intendants renvoyés compris) : le formulaire des règles reste la voie du jeu.
 * Une seule consigne en attente par intendant. Le texte n'entre pas au journal des commandes (ADR 0002).
 */
export const stewardSubmitInstruction = defineCommand({
  name: 'steward.submitInstruction',
  input: stewardSubmitInstructionInputSchema,
  output: stewardSubmitInstructionOutputSchema,
  errors: STEWARD_SUBMIT_INSTRUCTION_ERROR_CODES,
  redactInput: true,
  // La base fait foi sous concurrence : une seule consigne en attente par intendant.
  errorByConstraint: { steward_instructions_one_pending_idx: PENDING },
  async handler({ trx, userId, emit, config, now }, input) {
    const steward = await lockSteward(trx, userId, input.stewardId);
    if (!steward) return refuse('STEWARD_NOT_FOUND', 'Unknown steward.');
    const { ai } = config;
    const unavailable = refuse('AI_UNAVAILABLE', 'Instructions are unavailable: use the form.');
    if (!ai.usages.steward.enabled || ai.stewardDailyQuotaPerHouse === 0) return unavailable;
    if (isCapped(ai, 'steward', await dbCallStore(trx).spentThisMonth('steward', now)))
      return unavailable;
    // Les consignes de la maison se suivent : chacune compte, verrou pris, celles que les précédentes ont validées.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`steward.instruction:${steward.house_id}`}, 0))`.execute(
      trx,
    );
    const dayStart = dailyCloseAt(gameDayAt(now, config.clock), config.clock);
    const given = await trx
      .selectFrom('game.steward_instructions as i')
      .innerJoin('game.stewards as s', 's.id', 'i.steward_id')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('s.house_id', '=', steward.house_id)
      .where('i.created_at', '>=', dayStart)
      .executeTakeFirstOrThrow();
    if (Number(given.count) >= ai.stewardDailyQuotaPerHouse) return unavailable;
    const pending = await trx
      .selectFrom('game.steward_instructions')
      .select('id')
      .where('steward_id', '=', steward.id)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    if (pending) return { ok: false, error: PENDING };
    const instruction = await trx
      .insertInto('game.steward_instructions')
      .values({ steward_id: steward.id, rules_revision: steward.rules_revision, text: input.text })
      .returning(['id', 'created_at'])
      .executeTakeFirstOrThrow();
    emit({
      type: 'StewardInstructionSubmitted',
      payload: {
        stewardId: steward.id,
        houseId: steward.house_id,
        siteId: steward.site_id,
        instructionId: instruction.id,
      },
    });
    return {
      ok: true,
      data: {
        instructionId: instruction.id,
        stewardId: steward.id,
        submittedAt: instruction.created_at.toISOString(),
      },
    };
  },
});
