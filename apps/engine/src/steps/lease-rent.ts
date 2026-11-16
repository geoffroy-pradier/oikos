import { leaseEndedSchema } from '@oikos/contracts';
import { settleRents } from '@oikos/sim';
import { sql } from 'kysely';
import type { CloseStep } from '../close';
import { lockUpkeepSinks } from './site-upkeep';

/**
 * Loyers des baux (docs/specs/04-systemes-gestion.md, 4.5 ; #257), première étape de la clôture qui touche
 * la monnaie, avant la vétusté et l'entretien. Un bail dont la fin est demandée prend fin, sans loyer. Les
 * autres baux, signés avant l'instant de la clôture, paient chacun le loyer d'un jour (`settleRents`) dans
 * une écriture `lease.rent`, de la trésorerie du locataire à celle du propriétaire, dans l'ordre de leur
 * signature : en entier si la trésorerie du locataire le couvre, sinon le bail prend fin, impayé. La
 * monnaie sous séquestre ne paie pas. La base n'admet qu'un loyer par bail et par jour de jeu, et ne met
 * fin à un bail que dans la transaction qui enregistre la clôture de son jour : une clôture rejouée ne
 * prélève ni ne termine rien deux fois. Chaque bail terminé a son événement `LeaseEnded`.
 */
export const leaseRent: CloseStep = {
  name: 'leaseRent',
  async run({ trx, worldId, gameDay, closeAt, at }) {
    const summary = { paid: 0, rentOboles: 0, unpaid: 0, requested: 0 };
    // Ordre des verrous de la clôture : l'agora du monde, les puits de l'entretien (que l'étape ne
    // mouvemente pas, et que l'entretien prend ensuite de toute façon), puis les trésoreries par
    // identifiant. Les baux ne changent que sous l'agora (les
    // commandes de l'immobilier la prennent d'abord) : lus sous elle, ils ne bougent plus.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${worldId}`}, 0))`.execute(
      trx,
    );
    await lockUpkeepSinks(trx, worldId);
    const leases = await trx
      .selectFrom('game.leases')
      .select([
        'id',
        'property_id',
        'landlord_house_id',
        'tenant_house_id',
        'rent_oboles',
        'started_at',
        'end_requested_by',
      ])
      .where('world_id', '=', worldId)
      .where('ended_at', 'is', null)
      .orderBy('started_at')
      .orderBy('id')
      .execute();
    const requested = leases.filter((lease) => lease.end_requested_by !== null);
    const due = leases
      .filter((lease) => lease.end_requested_by === null && lease.started_at < closeAt)
      .map((lease) => ({
        ...lease,
        leaseId: lease.id,
        tenantHouseId: lease.tenant_house_id,
        landlordHouseId: lease.landlord_house_id,
        rentOboles: Number(lease.rent_oboles),
      }));
    const houseIds = [
      ...new Set(due.flatMap((lease) => [lease.tenantHouseId, lease.landlordHouseId])),
    ];
    const treasuries =
      houseIds.length === 0
        ? []
        : await trx
            .selectFrom('game.accounts')
            .select(['id', 'house_id', 'balance'])
            .where('kind', '=', 'house')
            .where('house_id', 'in', houseIds)
            .orderBy('id')
            .forUpdate()
            .execute();
    const accountOf = new Map(treasuries.map((account) => [account.house_id, account.id]));
    const { paid, unpaid } = settleRents(
      new Map(treasuries.map((account) => [account.house_id ?? '', Number(account.balance)])),
      due,
    );

    for (const lease of paid) {
      at?.(`lease ${lease.leaseId}`);
      const entry = await trx
        .insertInto('game.ledger_entries')
        .values({
          world_id: worldId,
          kind: 'lease.rent',
          meta: JSON.stringify({
            leaseId: lease.leaseId,
            gameDay,
            propertyId: lease.property_id,
            tenantHouseId: lease.tenantHouseId,
            landlordHouseId: lease.landlordHouseId,
          }),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('game.ledger_lines')
        .values([
          {
            entry_id: entry.id,
            account_id: accountOf.get(lease.tenantHouseId) ?? '',
            amount: -lease.rentOboles,
          },
          {
            entry_id: entry.id,
            account_id: accountOf.get(lease.landlordHouseId) ?? '',
            amount: lease.rentOboles,
          },
        ])
        .execute();
      summary.paid += 1;
      summary.rentOboles += lease.rentOboles;
    }

    const ended = [
      ...requested.map((lease) => ({ lease, reason: 'requested' as const })),
      ...unpaid.map((lease) => ({ lease, reason: 'unpaid' as const })),
    ];
    for (const { lease, reason } of ended) {
      at?.(`lease ${lease.id}`);
      await trx
        .updateTable('game.leases')
        .set({ ended_day: gameDay, end_reason: reason })
        .where('id', '=', lease.id)
        .execute();
      summary[reason] += 1;
    }
    if (ended.length > 0)
      await trx
        .insertInto('game.domain_events')
        .values(
          ended.map(({ lease, reason }) => {
            const event = leaseEndedSchema.parse({
              type: 'LeaseEnded',
              payload: {
                leaseId: lease.id,
                propertyId: lease.property_id,
                landlordHouseId: lease.landlord_house_id,
                tenantHouseId: lease.tenant_house_id,
                reason,
                gameDay,
              },
            });
            return { command_id: null, type: event.type, payload: JSON.stringify(event.payload) };
          }),
        )
        .execute();
    return summary;
  },
};
