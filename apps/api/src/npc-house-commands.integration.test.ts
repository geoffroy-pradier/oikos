import { randomUUID } from 'node:crypto';
import type { GameConfig } from '@oikos/config';
import { runStewards } from '@oikos/engine';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { codeOf, db, newWorld, openDirect, owner, rows, send } from './chat-test-world';
import { newAccount, TEST_CONFIG } from './test-config';

// Une maison PNJ de secours n'a pas de compte (ADR 0013, #715) : aucune commande de l'API n'agit pour elle, aucun
// intendant n'est mené pour elle, et aucune conversation privée ne s'ouvre avec elle (#949). Contre Supabase local.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/** Une maison PNJ fondée comme par la clôture, avec son compte et un champ dont un cycle est récoltable. */
async function npcHouse(worldId: string, cityId: string) {
  const [houseId, siteId] = [randomUUID(), randomUUID()];
  await owner.transaction().execute(async (trx) => {
    await sql`insert into game.houses (id, world_id, user_id, name, blazon, kind)
      values (${houseId}, ${worldId}, null, ${`Greniers ${houseId.replace(/[^a-f]/g, '').slice(0, 8)}`}, '{}', 'npc')`.execute(
      trx,
    );
    await sql`insert into game.citizenships (house_id, city_id) values (${houseId}, ${cityId})`.execute(
      trx,
    );
    await sql`insert into game.npc_houses (house_id, world_id, city_id, chain_id)
      values (${houseId}, ${worldId}, ${cityId}, 'bread')`.execute(trx);
    await sql`insert into game.accounts (world_id, kind, house_id) values (${worldId}, 'house', ${houseId})`.execute(
      trx,
    );
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`insert into game.sites (id, world_id, house_id, city_id, recipe_id, created_at, cycle_started_at)
      values (${siteId}, ${worldId}, ${houseId}, ${cityId}, 'grow_wheat', now() - interval '1 day',
        now() - interval '1 day')`.execute(trx);
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });
  return { houseId, siteId };
}

describe('aucune commande n’agit pour une maison PNJ (#949)', () => {
  it('ses sites sont, pour tout compte, ceux d’une autre maison ; un compte sans maison n’agit pour aucune', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const npc = await npcHouse(world.worldId, world.kalliste);
    // Toute commande désigne la maison du compte (`accountHouseId`) : le site d'une maison PNJ est inconnu d'Alice.
    expect(codeOf(await send(alice.user, 'site.collect', { siteId: npc.siteId }))).toEqual([
      404,
      'SITE_NOT_FOUND',
    ]);
    expect(codeOf(await send(alice.user, 'steward.hire', { siteId: npc.siteId }))).toEqual([
      404,
      'SITE_NOT_FOUND',
    ]);
    // Un compte sans maison n'est jamais rapporté à une maison sans compte : le site lui reste inconnu.
    const stranger = await newAccount(owner);
    expect(codeOf(await send(stranger, 'site.collect', { siteId: npc.siteId }))).toEqual([
      404,
      'SITE_NOT_FOUND',
    ]);
    // Rien n'a été récolté pour elle.
    expect(
      await rows(
        sql`select count(*)::int as n from game.inventories where house_id = ${npc.houseId}`,
      ),
    ).toEqual([{ n: 0 }]);
  });

  it('l’intendant ne planifie aucune maison PNJ, même avec un intendant en poste, payé et ses règles', async () => {
    const world = await newWorld();
    const npc = await npcHouse(world.worldId, world.kalliste);
    // Un intendant posé en base, hors de toute commande : actif, avec une règle de récolte qui aurait à faire.
    const stewardId = randomUUID();
    await owner.transaction().execute(async (trx) => {
      await sql`insert into game.stewards (id, world_id, house_id, site_id, name)
        values (${stewardId}, ${world.worldId}, ${npc.houseId}, ${npc.siteId}, 'Phidias')`.execute(
        trx,
      );
      await sql`update game.stewards set rules_revision = 1, unpaid_since = null where id = ${stewardId}`.execute(
        trx,
      );
      await sql`insert into game.steward_rules (steward_id, revision, position, kind)
        values (${stewardId}, 1, 0, 'collect')`.execute(trx);
    });
    const config = TEST_CONFIG.config as GameConfig;
    const tick = { worldId: world.worldId, index: 7, configVersionId: TEST_CONFIG.id, config };
    expect(await runStewards(db, tick)).toEqual({ acted: 0, refused: 0, failed: 0 });
    expect(
      await rows(
        sql`select count(*)::int as n from game.steward_operations where steward_id = ${stewardId}`,
      ),
    ).toEqual([{ n: 0 }]);
  });

  it('chat.openDirect refuse une maison PNJ, comme une maison inconnue, sans rien ouvrir', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const npc = await npcHouse(world.worldId, world.kalliste);
    expect(codeOf(await openDirect(alice.user, npc.houseId))).toEqual([404, 'RECIPIENT_NOT_FOUND']);
    expect(
      await rows(
        sql`select count(*)::int as n from game.channels where ${npc.houseId}::uuid in (house_low, house_high)`,
      ),
    ).toEqual([{ n: 0 }]);
  });
});
