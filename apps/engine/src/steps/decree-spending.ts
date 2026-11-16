import { decreeAppliedSchema, decreeLapsedSchema, decreeProposalSchema } from '@oikos/contracts';
import { decreeSpendingDecision, type SystemAccountKey } from '@oikos/sim';
import { sql } from 'kysely';
import type { CloseStep } from '../close';
import { lockUpkeepSinks } from './site-upkeep';

/** Puits de chaque modèle de dépense (docs/specs/05-economie.md, 5.5), verrouillés dans cet ordre. */
const SINKS = {
  festival: 'sink_festivals',
  public_works: 'sink_public_works',
} as const satisfies Record<string, SystemAccountKey>;

/**
 * Règlement des décrets de dépense (5.5, 5.6, 6.3, 7.5 ; #263), juste après l'application des décrets de taux.
 * Chaque décret adopté de grands travaux ou de fête du monde est réglé une fois, dans l'ordre de la fin de leur
 * vote : sous le verrou du trésor de sa cité, `decreeSpendingDecision` le paie s'il tient dans la part du
 * trésor du moment (après les dépenses déjà réglées par cette clôture), sinon il devient caduc. Payé : une
 * écriture `city.public_works` ou `city.festival` du trésor au puits du modèle, l'état `applied` et l'événement
 * `DecreeApplied` avec le montant payé ; caduc : l'état `lapsed` et l'événement `DecreeLapsed`, qui dit
 * pourquoi. Les deux portent le jour de jeu de la clôture : la base les lie à la clôture qu'elle enregistre, si
 * bien qu'une clôture rejouée ne règle rien deux fois. Une fête relève la demande des PNJ à partir de ce jour.
 * Un décret adopté il y a longtemps est réglé de même, contre le trésor et la configuration de la clôture.
 * Ordre des verrous : l'agora du monde, les puits de l'entretien (que l'étape ne mouvemente pas), ceux des
 * dépenses, puis les trésors par identifiant ; un décret aux paramètres illisibles reste adopté, compté.
 */
export const decreeSpending: CloseStep = {
  name: 'decreeSpending',
  async run({ trx, worldId, gameDay, config, at }) {
    const summary = { applied: 0, spentOboles: 0, bounded: 0, lapsed: 0, unreadable: 0 };
    const due = await trx
      .selectFrom('game.decrees')
      .select(['id', 'city_id', 'model', 'params'])
      .where('world_id', '=', worldId)
      .where('status', '=', 'adopted')
      .where('model', 'in', ['public_works', 'festival'])
      .orderBy('voting_closes_at')
      .orderBy('id')
      .execute();
    if (due.length === 0) return summary;
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${worldId}`}, 0))`.execute(
      trx,
    );
    await lockUpkeepSinks(trx, worldId);
    const sinks = await trx
      .selectFrom('game.accounts')
      .select(['id', 'system_key'])
      .where('world_id', '=', worldId)
      .where('system_key', 'in', Object.values(SINKS))
      .orderBy('system_key')
      .forUpdate()
      .execute();
    const sinkOf = new Map(sinks.map((sink) => [sink.system_key, sink.id]));
    const treasuries = await trx
      .selectFrom('game.accounts')
      .select(['id', 'city_id', 'balance'])
      .where('kind', '=', 'treasury')
      .where('city_id', 'in', [...new Set(due.map((row) => row.city_id))])
      .orderBy('id')
      .forUpdate()
      .execute();
    const treasuryOf = new Map(
      treasuries.map((row) => [row.city_id, { id: row.id, balance: BigInt(row.balance) }]),
    );

    for (const row of due) {
      at?.(`decree ${row.id}`);
      // Encore adopté sous le verrou : un décret déjà réglé est sauté, sans faire échouer la clôture.
      const locked = await trx
        .selectFrom('game.decrees')
        .select('id')
        .where('id', '=', row.id)
        .where('status', '=', 'adopted')
        .forUpdate()
        .executeTakeFirst();
      if (!locked) continue;
      const parsed = decreeProposalSchema.safeParse({ model: row.model, params: row.params });
      const decree = parsed.success ? parsed.data : null;
      if (decree?.model !== 'public_works' && decree?.model !== 'festival') {
        console.error(`Decree ${row.id} has unreadable parameters: left adopted`);
        summary.unreadable += 1;
        continue;
      }
      const treasury = treasuryOf.get(row.city_id);
      const sink = sinkOf.get(SINKS[decree.model]);
      if (!treasury || !sink) throw new Error(`World ${worldId} lacks a spending account`);
      const decision = decreeSpendingDecision({
        treasury: treasury.balance,
        amountOboles: decree.params.amountOboles,
        maxOboles: config.decrees?.models[decree.model]?.maxOboles,
        spendingCapShareBps: config.decrees?.spendingCapShareBps,
      });
      const base = { decreeId: row.id, cityId: row.city_id, decree };
      if (decision.applied) {
        const entry = await trx
          .insertInto('game.ledger_entries')
          .values({
            world_id: worldId,
            kind: `city.${decree.model}`,
            meta: JSON.stringify({ decreeId: row.id, cityId: row.city_id, gameDay }),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('game.ledger_lines')
          .values([
            { entry_id: entry.id, account_id: sink, amount: decision.spentOboles },
            { entry_id: entry.id, account_id: treasury.id, amount: -decision.spentOboles },
          ])
          .execute();
        treasury.balance -= BigInt(decision.spentOboles);
        summary.applied += 1;
        summary.spentOboles += decision.spentOboles;
        if (decision.bounded) summary.bounded += 1;
      } else summary.lapsed += 1;
      await trx
        .updateTable('game.decrees')
        .set(
          decision.applied
            ? { status: 'applied', applied_at: sql<Date>`now()`, settled_day: gameDay }
            : { status: 'lapsed', settled_day: gameDay },
        )
        .where('id', '=', row.id)
        .execute();
      const event = decision.applied
        ? decreeAppliedSchema.parse({
            type: 'DecreeApplied',
            payload: { ...base, spentOboles: decision.spentOboles },
          })
        : decreeLapsedSchema.parse({
            type: 'DecreeLapsed',
            payload: {
              ...base,
              reason: decision.reason,
              ...(decision.reason === 'uncovered' ? { capOboles: decision.capOboles } : {}),
            },
          });
      await trx
        .insertInto('game.domain_events')
        .values({ command_id: null, type: event.type, payload: JSON.stringify(event.payload) })
        .execute();
    }
    return summary;
  },
};
