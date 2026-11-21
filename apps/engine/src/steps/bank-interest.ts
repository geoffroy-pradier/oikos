import { bankInterestCreditedSchema } from '@oikos/contracts';
import { bankDepositInterest } from '@oikos/sim';
import { sql } from 'kysely';
import type { CloseStep } from '../close';

/**
 * Intérêt des dépôts (5.4, #727), après l'échéance des prêts et avant l'entretien : chaque dépôt non vide du monde gagne
 * l'intérêt du jour de son solde, au taux affiché par sa banque à l'instant de la clôture, arrondi à l'obole inférieure
 * (`bankDepositInterest`) ; un intérêt nul ne s'écrit pas. L'intérêt s'ajoute à la créance du déposant sans écriture au
 * grand livre : la masse monétaire ne change pas, la dette de la banque grossit, et le lendemain l'intérêt rapporte à son
 * tour. Verrous : l'agora, que dépôts, retraits et changements de taux prennent avant de lire un solde ou un taux, puis
 * les dépôts par identifiant. La base vérifie le montant sur le solde verrouillé et n'admet qu'un intérêt par dépôt et
 * par jour, dans la transaction qui enregistre la clôture de ce jour : rejouée, la clôture ne crédite rien deux fois.
 */
export const bankInterest: CloseStep = {
  name: 'bankInterest',
  async run({ trx, worldId, gameDay, at }) {
    const summary = { credited: 0, interestOboles: 0 };
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${worldId}`}, 0))`.execute(
      trx,
    );
    // Taux affichés : ils ne changent que sous l'agora, que la clôture tient désormais.
    const rates = new Map(
      (
        await trx
          .selectFrom('game.banks')
          .select(['id', 'deposit_rate_bps'])
          .where('world_id', '=', worldId)
          .execute()
      ).map((bank) => [bank.id, bank.deposit_rate_bps]),
    );
    const deposits = await trx
      .selectFrom('game.bank_deposits')
      .select(['id', 'bank_id', 'house_id', 'balance'])
      .where('world_id', '=', worldId)
      .where('balance', '>', '0')
      .orderBy('id')
      .forUpdate()
      .execute();
    for (const deposit of deposits) {
      const rateBps = rates.get(deposit.bank_id) ?? 0;
      const interest = bankDepositInterest(BigInt(deposit.balance), rateBps);
      if (interest === 0n) continue;
      at?.(`deposit ${deposit.id}`);
      await trx
        .insertInto('game.bank_deposit_movements')
        .values({
          world_id: worldId,
          deposit_id: deposit.id,
          bank_id: deposit.bank_id,
          house_id: deposit.house_id,
          kind: 'interest',
          amount: Number(interest),
          game_day: gameDay,
        })
        .execute();
      const event = bankInterestCreditedSchema.parse({
        type: 'BankInterestCredited',
        payload: {
          bankId: deposit.bank_id,
          depositId: deposit.id,
          houseId: deposit.house_id,
          interest: Number(interest),
          rateBps,
          balance: Number(BigInt(deposit.balance) + interest),
          gameDay,
        },
      });
      await trx
        .insertInto('game.domain_events')
        .values({ command_id: null, type: event.type, payload: JSON.stringify(event.payload) })
        .execute();
      summary.credited += 1;
      summary.interestOboles += Number(interest);
    }
    return summary;
  },
};
