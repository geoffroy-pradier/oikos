import { DEFAULT_MAX_SPLENDOR_BPS } from '@oikos/config';
import {
  LITURGY_PERFORM_ERROR_CODES,
  liturgyPerformInputSchema,
  liturgyPerformOutputSchema,
} from '@oikos/contracts';
import { recordHonorChange } from '@oikos/db';
import { accountHouseId } from '@oikos/operations';
import { gameDayAt, honorChange, liturgyGain, maxSplendor } from '@oikos/sim';
import { sql } from 'kysely';
import { defineCommand, type CommandResult } from '../registry';

const refuse = (code: string, message: string): CommandResult<never> => ({
  ok: false,
  error: { code, message },
});
const NO_FUNDS = { code: 'INSUFFICIENT_FUNDS', message: 'Not enough money.' };
const LIMIT = { code: 'CHARIS_LIMIT_REACHED', message: 'This Charis cannot grow any further.' };

/**
 * La maison accomplit sa liturgie (docs/specs/06-cites-politique-communaute.md, 6.4 ; #720) avant l'échéance : son
 * dû et son faste, borné par la configuration (`maxSplendor`), passent de sa trésorerie au puits `sink_liturgies` en
 * une écriture `liturgy.perform` (nature 4.1 `liturgies`) ; elle gagne la Timè et la Charis envers le dieu protecteur
 * de la cité de la liturgie que la configuration en vigueur fixe, d'autant plus que le faste est grand
 * (`liturgyGain`) ; le tout dans une transaction, une fois. Un autre dû que celui vu est refusé (`PRICE_CHANGED`).
 */
export const liturgyPerform = defineCommand({
  name: 'liturgy.perform',
  input: liturgyPerformInputSchema,
  output: liturgyPerformOutputSchema,
  errors: LITURGY_PERFORM_ERROR_CODES,
  // La base fait foi sous concurrence : ni découvert, ni Charis hors des entiers sûrs.
  errorByConstraint: { accounts_no_overdraft: NO_FUNDS, favor_charis_range: LIMIT },
  async handler({ trx, userId, emit, config, now }, input) {
    // Ordre des verrous : la maison, sa Timè (`honor:<maison>`), la liturgie, la Charis envers le dieu, l'agora du
    // monde, puis la trésorerie. La clôture prend les Timè (mandats d'archonte, dérobades), puis les liturgies échues,
    // puis les Charis (déclin) avant l'agora et les trésoreries (prélèvement d'office) : dans cet ordre, aucune des
    // deux n'attend l'autre en tenant ce que l'autre attend. La maison fait se suivre ses offrandes et ses liturgies.
    const house = await trx
      .selectFrom('game.houses')
      .select(['id', 'world_id'])
      .where('id', '=', accountHouseId(userId))
      .forNoKeyUpdate()
      .executeTakeFirst();
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    await sql`select pg_advisory_xact_lock(hashtextextended(${`honor:${house.id}`}, 0))`.execute(
      trx,
    );
    const liturgy = await trx
      .selectFrom('game.liturgies as l')
      .innerJoin('game.cities as c', 'c.id', 'l.city_id')
      .select(['l.id', 'l.city_id', 'l.season', 'l.genre', 'l.due', 'l.status', 'c.slug'])
      .select(sql<boolean>`l.due_at > now()`.as('open'))
      .where('l.id', '=', input.liturgyId)
      .where('l.house_id', '=', house.id)
      .forUpdate('l')
      .executeTakeFirst();
    if (!liturgy) return refuse('LITURGY_NOT_FOUND', 'This house has no such liturgy.');
    if (liturgy.status !== 'assigned')
      return refuse('LITURGY_SETTLED', 'This liturgy is already settled.');
    if (!liturgy.open)
      return refuse('LITURGY_OVERDUE', 'This liturgy is overdue: it is levied at its close.');
    const due = BigInt(liturgy.due);
    if (BigInt(input.expectedDue) !== due)
      return refuse('PRICE_CHANGED', `This liturgy is due ${due} oboles.`);
    const rules = config.liturgies;
    const bound = maxSplendor(due, rules?.maxSplendorBps ?? DEFAULT_MAX_SPLENDOR_BPS);
    const splendor = BigInt(input.splendor);
    if (splendor > bound)
      return refuse('SPLENDOR_OUT_OF_BOUNDS', `The splendor is at most ${bound} oboles.`);

    // Charis envers le dieu protecteur de la cité, s'il est au catalogue de la configuration en vigueur.
    const patron = config.cities.find((city) => city.id === liturgy.slug)?.patronGodId;
    const god = config.gods.some((entry) => entry.id === patron) ? (patron ?? null) : null;
    const charisGained = god ? liturgyGain(rules?.charisGain ?? 0, due, splendor) : 0;
    if (god && charisGained > 0)
      await trx
        .selectFrom('game.favor')
        .select('charis')
        .where('house_id', '=', house.id)
        .where('god_id', '=', god)
        .forUpdate()
        .execute();
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${house.world_id}`}, 0))`.execute(
      trx,
    );
    const treasury = await trx
      .selectFrom('game.accounts')
      .select(['id', 'balance'])
      .where('house_id', '=', house.id)
      .where('kind', '=', 'house')
      .forUpdate()
      .executeTakeFirstOrThrow();
    const paid = due + splendor;
    if (BigInt(treasury.balance) < paid) return refuse(NO_FUNDS.code, NO_FUNDS.message);
    const sink = await trx
      .selectFrom('game.accounts')
      .select('id')
      .where('world_id', '=', house.world_id)
      .where('system_key', '=', 'sink_liturgies')
      .executeTakeFirstOrThrow(() => new Error(`World ${house.world_id} has no sink_liturgies`));

    const entry = await trx
      .insertInto('game.ledger_entries')
      .values({
        world_id: house.world_id,
        kind: 'liturgy.perform',
        meta: JSON.stringify({ liturgyId: liturgy.id, houseId: house.id }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('game.ledger_lines')
      .values([
        { entry_id: entry.id, account_id: treasury.id, amount: -Number(paid) },
        { entry_id: entry.id, account_id: sink.id, amount: Number(paid) },
      ])
      .execute();
    const gameDay = gameDayAt(now, config.clock);
    await trx
      .updateTable('game.liturgies')
      .set({
        status: 'performed',
        splendor: input.splendor,
        paid: Number(paid),
        god_id: charisGained > 0 ? god : null,
        charis_gained: charisGained > 0 ? charisGained : null,
        settled_day: gameDay,
        ledger_entry_id: entry.id,
      })
      .where('id', '=', liturgy.id)
      .execute();
    if (god && charisGained > 0)
      await trx
        .insertInto('game.favor_ledger')
        .values({
          world_id: house.world_id,
          house_id: house.id,
          god_id: god,
          amount: charisGained,
          kind: 'liturgy',
          liturgy_id: liturgy.id,
        })
        .execute();
    // Timè : le gain de la configuration, grandi par le faste, rogné aux bornes ; sans section `honor`, aucun.
    const honor = config.honor;
    const honorGain = liturgyGain(rules?.honorGain ?? 0, due, splendor);
    const honored =
      honor && honorGain > 0
        ? await recordHonorChange(
            trx,
            {
              worldId: house.world_id,
              houseId: house.id,
              reason: 'liturgy_performed',
              reference: liturgy.id,
              gameDay,
              emit,
            },
            (balance) =>
              honorChange(balance, 'liturgy_performed', {
                min: honor.min,
                max: honor.max,
                changes: { liturgy_performed: honorGain },
              }),
          )
        : null;

    const performed = {
      liturgyId: liturgy.id,
      cityId: liturgy.city_id,
      season: liturgy.season,
      genre: liturgy.genre,
      due: Number(due),
      splendor: input.splendor,
      honorGained: honored?.amount ?? 0,
      charisGained,
      godId: charisGained > 0 ? god : null,
    };
    emit({ type: 'LiturgyPerformed', payload: { ...performed, houseId: house.id } });
    return { ok: true, data: performed };
  },
});
