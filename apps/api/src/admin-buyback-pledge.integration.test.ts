import { randomUUID } from 'node:crypto';
import { ensureInitialConfig, INITIAL_CONFIG } from '@oikos/config';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codeOf, heldOf, newBank, RULES, terms } from './bank-loan.integration-fixtures';
import { db, give, KALLISTE, newPlayer, owner, send } from './property.integration-fixtures';
import { appWithConfig } from './voyage.integration-fixtures';

// Rachat d'un bien dont du stock est gagé (#728), contre Supabase local. Le bien est propre à cette exécution, et le
// test le rachète à la fin : un bien détenu bloquerait toute version qui le retire.
beforeAll(() => ensureInitialConfig(db, INITIAL_CONFIG));
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const RELIC = `relic_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
const app = appWithConfig((config) => ({
  ...config,
  banks: RULES,
  goods: [
    ...config.goods,
    { id: RELIC, tier: 'finished', referencePriceOboles: 40, elasticity: 1 },
  ],
}));

describe('admin.buyBackGood sur un stock gagé', () => {
  it('refusé sans rien écrire tant que le gage court ; au solde, le bien se rachète', async () => {
    const bank = await newBank();
    const borrower = await newPlayer(KALLISTE);
    await give(borrower.houseId, RELIC, 10);
    const patch = {
      principal: 100,
      collateral: { kind: 'stock', cityId: KALLISTE, goodId: RELIC, quantity: 4 },
    };
    const offered = await send(
      bank.user,
      'bank.offerLoan',
      { borrowerHouseId: borrower.houseId, ...terms(patch) },
      undefined,
      app,
    );
    const offerId = offered.body.data.offerId as string;
    const loan = await send(
      borrower.user,
      'loan.acceptOffer',
      { offerId, ...terms(patch) },
      undefined,
      app,
    );
    expect(loan.status).toBe(200);
    const admin = randomUUID();
    await sql`insert into auth.users (id, email) values (${admin}, ${`${admin}@example.test`})`.execute(
      owner,
    );
    await sql`insert into admin.roles (user_id, role) values (${admin}, 'super_admin')`.execute(
      owner,
    );
    const expected = { houses: 1, units: 10, cancelledOrders: 0, oboles: 400 };
    const buyBack = () =>
      send(`aal2:${admin}`, 'admin.buyBackGood', { goodId: RELIC, expected }, undefined, app);
    expect(codeOf(await buyBack())).toBe('GOOD_PLEDGED');
    expect(await heldOf(borrower.houseId, RELIC)).toBe('10/4');
    // Soldé, le prêt libère le stock : le rachat passe, et rien du bien ne reste.
    const { loanId, outstanding } = loan.body.data as { loanId: string; outstanding: number };
    const repaid = await send(borrower.user, 'loan.repay', { loanId, amount: outstanding });
    expect(repaid.body.data).toMatchObject({ status: 'repaid' });
    expect((await buyBack()).status).toBe(200);
    expect(await heldOf(borrower.houseId, RELIC)).toBe('0/0');
  });
});
