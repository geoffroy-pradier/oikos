import { liturgyLeviedSchema } from '@oikos/contracts';
import { recordHonorChange } from '@oikos/db';
import { honorChange, levyLiturgies } from '@oikos/sim';
import { sql } from 'kysely';
import type { CloseStep } from '../close';

/**
 * Dérobade aux liturgies (docs/specs/06-cites-politique-communaute.md, 6.4 ; #720), première des deux étapes du
 * prélèvement d'office : chaque liturgie échue à l'instant de la clôture et encore désignée coûte à sa maison la perte
 * de Timè `liturgies.evasionHonorLoss`, rognée aux bornes de la Timè, une fois (motif `liturgy_evaded`). Placée avant
 * le déclin de la Charis et l'agora : elle prend les Timè de ces maisons (ordre des identifiants), puis verrouille les
 * liturgies échues jusqu'à la validation de la clôture, dans l'ordre où `liturgy.perform` prend les siens (Timè,
 * liturgie, Charis, agora). Une liturgie accomplie entre-temps, avant son échéance, n'est plus désignée : relue sous
 * verrou, elle est écartée. Sans perte (configuration, ou version sans section `honor`), elle ne fait que verrouiller.
 */
export const liturgyEvasion: CloseStep = {
  name: 'liturgyEvasion',
  async run({ trx, worldId, gameDay, closeAt, config, at }) {
    const summary = { evaded: 0, honorLost: 0 };
    const overdue = () =>
      trx
        .selectFrom('game.liturgies')
        .select(['id', 'house_id'])
        .where('world_id', '=', worldId)
        .where('status', '=', 'assigned')
        .where('due_at', '<=', closeAt);
    const seen = await overdue().execute();
    if (seen.length === 0) return summary;
    const honor = config.honor;
    const loss = config.liturgies?.evasionHonorLoss ?? 0;
    const charged = honor !== undefined && loss > 0;
    if (charged)
      for (const houseId of [...new Set(seen.map((row) => row.house_id))].sort())
        await sql`select pg_advisory_xact_lock(hashtextextended(${`honor:${houseId}`}, 0))`.execute(
          trx,
        );
    const locked = await overdue().orderBy('id').forUpdate().execute();
    if (!charged) return summary;
    const byHouse = [...locked].sort(
      (a, b) =>
        (a.house_id < b.house_id ? -1 : a.house_id > b.house_id ? 1 : 0) || (a.id < b.id ? -1 : 1),
    );
    for (const liturgy of byHouse) {
      at?.(`liturgy ${liturgy.id}`);
      const written = await recordHonorChange(
        trx,
        {
          worldId,
          houseId: liturgy.house_id,
          reason: 'liturgy_evaded',
          reference: liturgy.id,
          gameDay,
        },
        (balance) =>
          honorChange(balance, 'liturgy_evaded', {
            min: honor.min,
            max: honor.max,
            changes: { liturgy_evaded: -loss },
          }),
      );
      if (!written) continue;
      summary.evaded += 1;
      summary.honorLost -= written.amount;
    }
    return summary;
  },
};

/**
 * Prélèvement d'office des liturgies (6.4, #720), après les loyers et avant l'entretien : chaque liturgie échue à
 * l'instant de la clôture et encore désignée, dans l'ordre de leurs échéances, prend son dû sur la trésorerie de sa
 * maison, hors séquestre, en entier ou pour ce qu'elle couvre (`levyLiturgies`), sans gain ni dette, par une écriture
 * `liturgy.levy` vers le puits `sink_liturgies` (aucune s'il n'y a rien à prendre). Elle passe à `levied` et émet
 * `LiturgyLevied` avec la Timè perdue à l'étape `liturgyEvasion`. Verrous : l'agora, puis les trésoreries par
 * identifiant, puis le puits ; la base n'admet qu'un règlement par liturgie, dans la transaction qui enregistre la
 * clôture de son jour : rejouée, la clôture ne prélève rien deux fois.
 */
export const liturgyLevy: CloseStep = {
  name: 'liturgyLevy',
  async run({ trx, worldId, gameDay, closeAt, at }) {
    const summary = { levied: 0, leviedOboles: 0, partial: 0 };
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${worldId}`}, 0))`.execute(
      trx,
    );
    const due = await trx
      .selectFrom('game.liturgies')
      .select(['id', 'house_id', 'city_id', 'season', 'due'])
      .where('world_id', '=', worldId)
      .where('status', '=', 'assigned')
      .where('due_at', '<=', closeAt)
      .orderBy('due_at')
      .orderBy('id')
      .forUpdate()
      .execute();
    if (due.length === 0) return summary;
    const treasuries = await trx
      .selectFrom('game.accounts')
      .select(['id', 'house_id', 'balance'])
      .where('kind', '=', 'house')
      .where('house_id', 'in', [...new Set(due.map((liturgy) => liturgy.house_id))])
      .orderBy('id')
      .forUpdate()
      .execute();
    const accountOf = new Map(treasuries.map((account) => [account.house_id, account.id]));
    const sink = await trx
      .selectFrom('game.accounts')
      .select('id')
      .where('world_id', '=', worldId)
      .where('system_key', '=', 'sink_liturgies')
      .executeTakeFirstOrThrow(() => new Error(`World ${worldId} has no sink_liturgies`));
    const levies = levyLiturgies(
      new Map(treasuries.map((account) => [account.house_id ?? '', BigInt(account.balance)])),
      due.map((liturgy) => ({ ...liturgy, houseId: liturgy.house_id, due: BigInt(liturgy.due) })),
    );
    for (const liturgy of levies) {
      at?.(`liturgy ${liturgy.id}`);
      const levied = Number(liturgy.levied);
      let entryId: string | null = null;
      if (levied > 0) {
        const entry = await trx
          .insertInto('game.ledger_entries')
          .values({
            world_id: worldId,
            kind: 'liturgy.levy',
            meta: JSON.stringify({ liturgyId: liturgy.id, houseId: liturgy.houseId, gameDay }),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        entryId = entry.id;
        await trx
          .insertInto('game.ledger_lines')
          .values([
            {
              entry_id: entry.id,
              account_id: accountOf.get(liturgy.houseId) ?? '',
              amount: -levied,
            },
            { entry_id: entry.id, account_id: sink.id, amount: levied },
          ])
          .execute();
      }
      await trx
        .updateTable('game.liturgies')
        .set({
          status: 'levied',
          splendor: 0,
          paid: levied,
          settled_day: gameDay,
          ledger_entry_id: entryId,
        })
        .where('id', '=', liturgy.id)
        .execute();
      const lost = await trx
        .selectFrom('game.honor_ledger')
        .select('amount')
        .where('reason', '=', 'liturgy_evaded')
        .where('reference', '=', liturgy.id)
        .executeTakeFirst();
      const event = liturgyLeviedSchema.parse({
        type: 'LiturgyLevied',
        payload: {
          liturgyId: liturgy.id,
          houseId: liturgy.houseId,
          cityId: liturgy.city_id,
          season: liturgy.season,
          due: Number(liturgy.due),
          levied,
          honorLost: -Number(lost?.amount ?? 0),
          gameDay,
        },
      });
      await trx
        .insertInto('game.domain_events')
        .values({ command_id: null, type: event.type, payload: JSON.stringify(event.payload) })
        .execute();
      summary.levied += 1;
      summary.leviedOboles += levied;
      if (liturgy.levied < liturgy.due) summary.partial += 1;
    }
    return summary;
  },
};
