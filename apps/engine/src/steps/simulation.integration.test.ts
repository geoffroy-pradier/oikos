import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
  type LoadedConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { createRng, marketTax, tickIndexAt, tickStart } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runTick } from '../tick';
import { npcDemand } from './npc-demand';

// Simulation de 30 jours de jeu contre Supabase local (ticket 9) : des maisons produisent du blé et le
// vendent, les PNJ achètent à chaque tick. La masse monétaire ne doit bouger que par le robinet prévu.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// Le code testé agit sous le rôle de service, comme en production ; `owner` pose les jeux d'essai.
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const loader = createConfigLoader(db);
let active: LoadedConfig;

const DAYS = 30;
/** Configuration initiale, avec des ticks d'une heure pour garder le test court : 720 ticks. */
const config: GameConfig = {
  ...(INITIAL_CONFIG as GameConfig),
  clock: { ...(INITIAL_CONFIG as GameConfig).clock, tickMinutes: 60 },
};
const TICKS_PER_DAY = 1440 / config.clock.tickMinutes;
const HOUSES = 4;

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  active = await loader.at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

it(
  '30 jours de production, de ventes et d’achats de PNJ : la monnaie ne vient que du robinet',
  { timeout: 120_000 },
  async () => {
    const [worldId, cityId] = [randomUUID(), randomUUID()];
    await sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`s-${worldId.slice(0, 12)}`}, 'Simulation')`.execute(
      owner,
    );
    await sql`insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, 'kalliste', 'Simulation')`.execute(
      owner,
    );
    const houses: { houseId: string; inventoryId: string }[] = [];
    for (let n = 0; n < HOUSES; n++) {
      const userId = randomUUID();
      await sql`insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`})`.execute(
        owner,
      );
      const name = `Ferme ${[...userId.replace(/[^a-f]/g, '')].slice(0, 10).join('')}`;
      const house = await db
        .insertInto('game.houses')
        .values({ world_id: worldId, user_id: userId, name, blazon: '{}' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db
        .insertInto('game.accounts')
        .values({ world_id: worldId, kind: 'house', house_id: house.id, system_key: null })
        .execute();
      const inventory = await db
        .insertInto('game.inventories')
        .values({ world_id: worldId, house_id: house.id, city_id: cityId, good_id: 'wheat' })
        .returning('id')
        .executeTakeFirstOrThrow();
      houses.push({ houseId: house.id, inventoryId: inventory.id });
    }

    // Bornes de la création de monnaie pour le blé de Kallistè, calculées à la main à partir de la
    // configuration initiale (#78) et non par le code testé. Budget par tick, revenu × population ×
    // part du blé dans la dépense de référence : thètes 6 × 70 × 25,2/56,338 = 187,87 ; zeugites
    // 2,5 × 73 × 12,6/58,04 = 39,62 ; soit 227 oboles. Prix de réserve : 3 × 6.
    const [budget, reserve] = [227, 18];

    const rng = createRng('simulation-30-jours');
    // Indices pris dans l'espace des ticks de la configuration active (et non d'une heure) : le monde
    // laissé en base reste cohérent pour un moteur de développement, qui n'aura rien à rattraper.
    const first = tickIndexAt(new Date(), active.config.clock.tickMinutes) + 1;
    let [produced, spent, units, busiest] = [0, 0, 0, 0];
    for (let tick = 0; tick < DAYS * TICKS_PER_DAY; tick++) {
      // Chaque matin, chaque maison récolte et met tout en vente, à un prix tiré autour du prix de
      // référence : parfois bradé, parfois au-delà du prix de réserve des PNJ (invendable).
      if (tick % TICKS_PER_DAY === 0) {
        for (const house of houses) {
          const quantity = rng.int(100, 400);
          await db
            .insertInto('game.stock_ledger')
            .values({
              world_id: worldId,
              good_id: 'wheat',
              quantity,
              from_system: 'production',
              to_inventory_id: house.inventoryId,
              kind: 'test.harvest',
            })
            .execute();
          await db
            .insertInto('game.orders')
            .values({
              world_id: worldId,
              house_id: house.houseId,
              city_id: cityId,
              good_id: 'wheat',
              side: 'sell',
              price: rng.int(3, 20),
              quantity,
              remaining: quantity,
            })
            .execute();
          produced += quantity;
        }
      }
      const scheduledAt = tickStart(first + tick, config.clock.tickMinutes);
      const outcome = await runTick(db, {
        worldId,
        index: first + tick,
        scheduledAt,
        config: { at: async () => ({ ...active, config }), byId: loader.byId },
        steps: [npcDemand],
        now: () => new Date(scheduledAt.getTime() + 1000),
      });
      const summary = outcome.summary['npcDemand'] as { units: number; spent: number };
      // À chaque tick, les PNJ ne dépensent jamais plus que leur budget.
      expect(summary.spent).toBeLessThanOrEqual(budget);
      spent += summary.spent;
      units += summary.units;
      busiest = Math.max(busiest, summary.spent);
    }
    // La simulation a réellement fait tourner l'économie, jusqu'à buter sur le budget.
    expect(units).toBeGreaterThan(DAYS * 500);
    // Un tick au moins dépense à moins d'une unité au prix de réserve près du budget (227 est premier :
    // l'égalité exacte n'est pas atteignable). Ce n'est pas la preuve que le budget plafonne : une demande
    // non plafonnée peut aussi tomber dans cet intervalle. La borne elle-même est `spent <= budget`, à
    // chaque tick, ci-dessus.
    expect(busiest).toBeGreaterThan(budget - reserve);

    const accounts = await db
      .selectFrom('game.accounts')
      .select(['kind', 'system_key', 'balance'])
      .where('world_id', '=', worldId)
      .execute();
    const total = (kind: string) =>
      accounts
        .filter((account) => account.kind === kind)
        .reduce((sum, account) => sum + Number(account.balance), 0);
    // Taxe de marché, échange par échange : ce que chaque vente laisse au vendeur, au puits et au trésor.
    const trades = await sql<{ house_id: string; gross: string }>`
      select o.house_id, t.price * t.quantity as gross
      from game.trades t join game.orders o on o.id = t.sell_order_id where t.world_id = ${worldId}`.execute(
      db,
    );
    const taxes = trades.rows.map((trade) => ({
      houseId: trade.house_id,
      ...marketTax(Number(trade.gross), config.marketTax),
    }));
    const sumOf = (part: 'net' | 'burned' | 'treasury', houseId?: string) =>
      taxes
        .filter((tax) => houseId === undefined || tax.houseId === houseId)
        .reduce((sum, tax) => sum + tax[part], 0);
    expect(sumOf('burned')).toBeGreaterThan(0);
    expect(sumOf('treasury')).toBeGreaterThan(0);
    // Ce que le robinet des achats de PNJ a créé est chez les maisons, au trésor de la cité, ou détruit.
    expect(total('house') + total('treasury') + sumOf('burned')).toBe(spent);
    expect(total('treasury')).toBe(sumOf('treasury'));
    // Seuls ce robinet et le puits de la taxe ont bougé : les autres comptes système sont restés à zéro.
    expect(
      accounts
        .filter((account) => account.kind === 'system' && Number(account.balance) !== 0)
        .map((account) => [account.system_key, Number(account.balance)])
        .sort(),
    ).toEqual([
      ['faucet_npc_purchases', -spent],
      ['sink_market_tax', sumOf('burned')],
    ]);
    // Aucune écriture d'une autre nature, et les soldes égalent la somme de leurs lignes.
    const kinds = await sql<{ kind: string; n: string }>`
      select kind, count(*) as n from game.ledger_entries where world_id = ${worldId} group by kind`.execute(
      db,
    );
    expect(kinds.rows.map((row) => row.kind)).toEqual(['npc.purchase']);
    const checks = await sql<{
      accounts: string;
      stocks: string;
      consumed: string;
      held: string;
      reserved: string;
      open: string;
      carry: number;
    }>`
      select (select count(*) from game.account_balance_check c join game.accounts a on a.id = c.account_id
               where a.world_id = ${worldId} and not c.ok) as accounts,
             (select count(*) from game.inventory_quantity_check c join game.inventories i on i.id = c.inventory_id
               where i.world_id = ${worldId} and not c.ok) as stocks,
             (select coalesce(sum(quantity), 0) from game.stock_ledger
               where world_id = ${worldId} and to_system = 'npc_consumption') as consumed,
             (select sum(quantity) from game.inventories where world_id = ${worldId}) as held,
             (select sum(reserved) from game.inventories where world_id = ${worldId}) as reserved,
             (select coalesce(sum(remaining), 0) from game.orders
               where world_id = ${worldId} and status = 'open') as open,
             (select carry from game.npc_demand_carry where city_id = ${cityId} and good_id = 'wheat') as carry`.execute(
      db,
    );
    const check = checks.rows[0];
    expect(check).toMatchObject({ accounts: '0', stocks: '0' });
    // Le blé non plus ne se crée ni ne se perd : produit = en stock + consommé ; réservé = invendu en carnet.
    expect(Number(check?.consumed)).toBe(units);
    expect(Number(check?.held) + units).toBe(produced);
    expect(check?.reserved).toBe(check?.open);
    expect(check?.carry).toBeGreaterThanOrEqual(0);
    expect(check?.carry).toBeLessThan(1);

    // Prix de réserve : rien ne s'est vendu au-dessus, et ces ordres-là sont restés entiers.
    const orders = await db
      .selectFrom('game.orders')
      .select(['house_id', 'price', 'quantity', 'remaining'])
      .where('world_id', '=', worldId)
      .execute();
    const dear = orders.filter((order) => Number(order.price) > reserve);
    expect(dear.length).toBeGreaterThan(0);
    expect(dear.every((order) => order.remaining === order.quantity)).toBe(true);
    const dearest = await sql<{ max: string }>`
      select max(price) from game.trades where world_id = ${worldId}`.execute(db);
    expect(Number(dearest.rows[0]?.max)).toBeLessThanOrEqual(reserve);
    // Chaque maison a reçu exactement le net de ce que ses propres ordres ont vendu.
    const balances = await db
      .selectFrom('game.accounts')
      .select(['house_id', 'balance'])
      .where('world_id', '=', worldId)
      .where('kind', '=', 'house')
      .execute();
    for (const { house_id: houseId, balance } of balances)
      expect(Number(balance)).toBe(sumOf('net', houseId ?? ''));
  },
);
