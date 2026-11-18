import type { GameConfig } from '@oikos/config';
import { runStewards } from '@oikos/engine';
import { sql } from 'kysely';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { code, db, hire, newPlayer, owner, send, STEWARDS } from './steward.integration-fixtures';
import { TEST_CONFIG } from './test-config';
import { WORLD } from './voyage.integration-fixtures';

// Exécution des règles des intendants par le moteur (#279), contre Supabase local. Chaque test fonde ses maisons :
// un champ de blé (40 blés par cycle de 240 minutes) et un moulin, dont l'intrant est le blé.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
// Un intendant mène ses règles à chaque tick, y compris ceux des tests suivants : chaque test renvoie les siens.
const hired: { user: string; id: string }[] = [];
afterEach(async () => {
  for (const { user, id } of hired.splice(0))
    expect(code(await send(user, 'steward.dismiss', { stewardId: id }))).toBe('ok');
});

const WHEAT_CYCLE_MS = 240 * 60_000;
/** Un tick du monde de test, sous la configuration de test modifiée par `change` ; chaque appel en ouvre un neuf. */
let nextIndex = 9_000_000_000 + Math.floor(Math.random() * 1_000_000) * 100;
const tick = (change: (stewards: typeof STEWARDS) => Partial<typeof STEWARDS> = () => ({})) => {
  const stewards = { ...STEWARDS, ...change(STEWARDS) };
  const config: GameConfig = { ...TEST_CONFIG.config, stewards };
  nextIndex += 1;
  return { worldId: WORLD, index: nextIndex, configVersionId: TEST_CONFIG.id, config };
};

/** Fait vieillir le cycle en cours du site : la garde de la base interdit l'antidatage, levée le temps du test. */
async function age(siteId: string, cycles: number) {
  await owner.transaction().execute(async (trx) => {
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`update game.sites set created_at = created_at - ${`${cycles * WHEAT_CYCLE_MS} milliseconds`}::interval,
      cycle_started_at = cycle_started_at - ${`${cycles * WHEAT_CYCLE_MS} milliseconds`}::interval
      where id = ${siteId}`.execute(trx);
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });
}
/** L'intendant du site, avec ses règles, payé comme par une clôture. */
async function steward(user: string, siteId: string, rules: unknown[]) {
  const id = await hire(user, siteId);
  expect(code(await send(user, 'steward.setRules', { stewardId: id, rules }))).toBe('ok');
  await sql`update game.stewards set unpaid_since = null where id = ${id}`.execute(owner);
  hired.push({ user, id });
  return id;
}
const operationsOf = (stewardId: string) =>
  db
    .selectFrom('game.steward_operations')
    .select([
      'tick_index',
      'rank',
      'rule_position',
      'status',
      'error_code',
      'summary',
      'command_id',
    ])
    .where('steward_id', '=', stewardId)
    .orderBy('tick_index')
    .orderBy('rank')
    .execute();
const stock = async (houseId: string, goodId: string) => {
  const row = await db
    .selectFrom('game.inventories')
    .select(['quantity', 'reserved'])
    .where('house_id', '=', houseId)
    .where('good_id', '=', goodId)
    .executeTakeFirst();
  return { quantity: Number(row?.quantity ?? 0), reserved: Number(row?.reserved ?? 0) };
};
const collect = { kind: 'collect' } as const;

describe('opérations des intendants', () => {
  it('clôture pendant que l’intendant agit : il attend la clôture au lieu de s’interbloquer avec elle', async () => {
    const player = await newPlayer();
    const id = await steward(player.user, player.field, [collect]);
    await age(player.field, 1);
    const before = await stock(player.houseId, 'wheat');
    // La clôture (`siteUpkeep`) prend l'agora, la trésorerie, les sites de la maison, puis ses intendants.
    const close = await owner.startTransaction().execute();
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${WORLD}`}, 0))`.execute(
      close,
    );
    await sql`select 1 from game.accounts where house_id = ${player.houseId} and kind = 'house' for update`.execute(
      close,
    );
    await sql`select 1 from game.sites where house_id = ${player.houseId} for update`.execute(
      close,
    );
    const running = runStewards(db, tick());
    await new Promise((resolve) => setTimeout(resolve, 300));
    await sql`select 1 from game.stewards where id = ${id} for update`.execute(close);
    await close.commit().execute();
    const run = await running;
    expect(run.failed).toBe(0);
    expect((await operationsOf(id)).map((op) => op.status)).toEqual(['ok']);
    expect((await stock(player.houseId, 'wheat')).quantity).toBe(before.quantity + 40);
  });

  it('la clé d’une opération est hors de portée du joueur : l’API la refuse, l’intendant la prend', async () => {
    const player = await newPlayer();
    const id = await steward(player.user, player.field, [collect]);
    await age(player.field, 1);
    const next = tick();
    const key = `steward:${id}:${next.index}:0`;
    const reply = await send(player.user, 'site.collect', { siteId: player.field }, key);
    expect(reply.body.error?.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    await runStewards(db, next);
    const { rows } = await sql`select steward_id, status from game.command_log
      where user_id = ${player.user} and idempotency_key = ${key}`.execute(db);
    expect(rows).toEqual([{ steward_id: id, status: 'ok' }]);
  });
});
