import { ensureInitialConfig, INITIAL_CONFIG } from '@oikos/config';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accept, codeOf, heldOf, newBank, offered } from './bank-loan.integration-fixtures';
import {
  db,
  ELAIA,
  fund,
  give,
  KALLISTE,
  newOwner,
  owner,
  send,
  sizeOf,
} from './property.integration-fixtures';
import { TEST_CONFIG } from './test-config';
import { depart, newShipowner } from './voyage.integration-fixtures';

// Une garantie bloquée ne sort par aucun chemin (#728), contre Supabase local : un chemin de sortie par test, chacun
// refusé pour la part gagée seule. La base le garantit pour tous (`inventories_reserved_within_quantity`,
// `properties_pledged`) ; chaque commande répond par son code.
beforeAll(() => ensureInitialConfig(db, INITIAL_CONFIG));
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const MILL = TEST_CONFIG.config.recipes.find((recipe) => recipe.id === 'mill_flour');
const WHEAT_PER_FLOUR = MILL?.inputs.find((stack) => stack.goodId === 'wheat')?.quantity ?? 0;
/**
 * Un armateur de Kallistè, son caboteur et ses 100 blés, dont `100 - free` sont gagés par un prêt de 100 oboles :
 * il ne lui en reste que `free` de libres.
 */
async function pledged(free = 5) {
  const bank = await newBank();
  const player = await newShipowner(KALLISTE);
  const patch = {
    principal: 100,
    collateral: { kind: 'stock', cityId: KALLISTE, goodId: 'wheat', quantity: 100 - free },
  };
  const loan = await accept(player.user, await offered(bank.user, player.houseId, patch), patch);
  expect(loan.status).toBe(200);
  expect(await heldOf(player.houseId)).toBe(`100/${100 - free}`);
  return { ...player, loanId: loan.body.data.loanId as string };
}

describe('un stock gagé ne sort par aucun chemin', () => {
  it('il ne se vend pas', async () => {
    const player = await pledged();
    const sale = { cityId: KALLISTE, goodId: 'wheat', side: 'sell', price: 999, quantity: 6 };
    expect(codeOf(await send(player.user, 'market.placeOrder', sale))).toBe('INSUFFICIENT_STOCK');
    expect(await heldOf(player.houseId)).toBe('100/95');
  });

  it('il ne s’embarque pas', async () => {
    const player = await pledged();
    const cargo = [{ goodId: 'wheat', quantity: 6 }];
    expect(codeOf(await depart(player, { cargo, toCityId: ELAIA }))).toBe('INSUFFICIENT_STOCK');
    expect(await heldOf(player.houseId)).toBe('100/95');
  });

  it('il ne s’offre pas', async () => {
    const player = await pledged();
    const offering = {
      godId: 'demeter',
      oboles: 0,
      goods: [{ goodId: 'wheat', quantity: 6 }],
      expectedCharis: 36,
    };
    expect(codeOf(await send(player.user, 'temple.makeOffering', offering))).toBe(
      'INSUFFICIENT_STOCK',
    );
    expect(await heldOf(player.houseId)).toBe('100/95');
  });

  it('il ne se consomme pas : un atelier ne mout que le stock libre', async () => {
    const player = await pledged(WHEAT_PER_FLOUR);
    // L'armateur a payé son navire : le moulin se paie d'un versement du jeu d'essai.
    await fund(player.houseId, 50_000);
    const mill = (await send(player.user, 'site.acquire', { recipeId: 'mill_flour' })).body.data
      .siteId as string;
    // Trois cycles écoulés, gardes levées : un seul a de quoi tourner sur le stock libre.
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
      await sql`update game.sites set created_at = created_at - ${`${3 * (MILL?.durationMinutes ?? 0)} minutes`}::interval,
        cycle_started_at = cycle_started_at - ${`${3 * (MILL?.durationMinutes ?? 0)} minutes`}::interval
        where id = ${mill}`.execute(trx);
      await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
    });
    expect((await send(player.user, 'site.collect', { siteId: mill })).body.data).toMatchObject({
      cycles: 1,
    });
    const left = 100 - WHEAT_PER_FLOUR;
    expect(await heldOf(player.houseId)).toBe(`${left}/${left}`);
  });
});

describe('un stock gagé ne se consomme pas non plus en travaux', () => {
  it('la rénovation d’un logement ne prend pas l’unité gagée de ses biens', async () => {
    const bank = await newBank();
    const player = await newOwner(KALLISTE);
    const works = sizeOf('townhouse').renovation;
    const [first] = works.goods;
    if (!first) throw new Error('the townhouse works need goods');
    for (const { goodId, quantity } of works.goods) await give(player.houseId, goodId, quantity);
    await fund(player.houseId, works.oboles);
    // Logement usé, garde levée : seule une clôture use un bien.
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.properties disable trigger properties_guard`.execute(trx);
      await sql`update game.properties set condition = 0 where id = ${player.propertyId}`.execute(
        trx,
      );
      await sql`alter table game.properties enable trigger properties_guard`.execute(trx);
    });
    const patch = {
      principal: 100,
      collateral: { kind: 'stock', cityId: KALLISTE, goodId: first.goodId, quantity: 1 },
    };
    expect(
      (await accept(player.user, await offered(bank.user, player.houseId, patch), patch)).status,
    ).toBe(200);
    const input = {
      propertyId: player.propertyId,
      expectedCostOboles: works.oboles,
      expectedGoods: works.goods,
    };
    expect(codeOf(await send(player.user, 'property.renovate', input))).toBe('INSUFFICIENT_STOCK');
    expect(await heldOf(player.houseId, first.goodId)).toBe(`${first.quantity}/1`);
  });
});

describe('un logement gagé ne se revend ni ne se loue de nouveau', () => {
  it('ni offert à la vente, ni à la location, tant que le prêt n’est pas remboursé', async () => {
    const bank = await newBank();
    const player = await newOwner(KALLISTE);
    const patch = {
      principal: 100,
      collateral: { kind: 'property', propertyId: player.propertyId },
    };
    const loan = await accept(player.user, await offered(bank.user, player.houseId, patch), patch);
    const { propertyId } = player;
    expect(
      codeOf(await send(player.user, 'property.listForSale', { propertyId, priceOboles: 500 })),
    ).toBe('PROPERTY_PLEDGED');
    expect(
      codeOf(await send(player.user, 'property.offerLease', { propertyId, rentOboles: 5 })),
    ).toBe('PROPERTY_PLEDGED');
    // Soldé, le prêt libère le logement : il s'offre de nouveau (l'offre est retirée aussitôt).
    const { loanId, outstanding } = loan.body.data as { loanId: string; outstanding: number };
    await fund(player.houseId, outstanding);
    expect(
      (await send(player.user, 'loan.repay', { loanId, amount: outstanding })).body.data,
    ).toMatchObject({ status: 'repaid' });
    expect(
      (await send(player.user, 'property.offerLease', { propertyId, rentOboles: 5 })).status,
    ).toBe(200);
    expect((await send(player.user, 'property.withdrawOffer', { propertyId })).status).toBe(200);
  });
});
