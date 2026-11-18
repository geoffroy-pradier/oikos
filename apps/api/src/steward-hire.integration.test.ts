import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import {
  STEWARDS,
  appWithConfig,
  balanceOf,
  code,
  db,
  eventsOf,
  hire,
  narrow,
  newPlayer,
  owner,
  send,
  stewardsOf,
} from './steward.integration-fixtures';

// Embauche et renvoi des intendants (#278), contre Supabase local. Chaque test fonde sa maison.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

describe('steward.hire', () => {
  it('embauche un intendant nommé, impayé jusqu’à la clôture, sans rien prélever ; rejouée, rien de plus', async () => {
    const player = await newPlayer();
    const before = await balanceOf({ houseId: player.houseId });
    const key = randomUUID();
    const hired = await send(player.user, 'steward.hire', { siteId: player.mill }, key);
    expect(hired.status).toBe(200);
    expect(STEWARDS.names).toContain(hired.body.data.name);
    const [steward] = await stewardsOf(player.houseId);
    expect(steward).toEqual({
      id: hired.body.data.stewardId,
      site_id: player.mill,
      name: hired.body.data.name,
      hired_at: new Date(hired.body.data.hiredAt),
      unpaid_since: new Date(hired.body.data.hiredAt),
      dismissed_at: null,
      rules_revision: 0,
    });
    expect(await send(player.user, 'steward.hire', { siteId: player.mill }, key)).toEqual(hired);
    expect(await stewardsOf(player.houseId)).toHaveLength(1);
    expect(await balanceOf({ houseId: player.houseId })).toBe(before);
    expect(await eventsOf(player.houseId)).toEqual([
      {
        type: 'StewardHired',
        payload: {
          stewardId: steward?.id,
          houseId: player.houseId,
          siteId: player.mill,
          name: steward?.name,
        },
      },
    ]);
  });

  it('un intendant par site, au plus les postes du siège ; deux noms différents quand la liste le permet', async () => {
    const player = await newPlayer();
    await hire(player.user, player.mill);
    const again = (siteId: string, via = narrow) =>
      send(player.user, 'steward.hire', { siteId }, randomUUID(), via).then(code);
    expect(await again(player.mill)).toBe('SITE_HAS_STEWARD');
    expect(await again(player.field)).toBe('STEWARD_LIMIT_REACHED');
    expect(await again(player.field, appWithConfig())).toBe('ok');
    const [first, second] = await stewardsOf(player.houseId);
    expect(first?.name).not.toBe(second?.name);
    // Une version publiée avant les intendants n'ouvre aucun poste.
    const older = appWithConfig(({ stewards: _, ...config }) => config);
    const other = await newPlayer();
    expect(
      code(await send(other.user, 'steward.hire', { siteId: other.mill }, randomUUID(), older)),
    ).toBe('STEWARD_LIMIT_REACHED');
  });

  it('le site d’une autre maison est inconnu', async () => {
    const [alice, bob] = [await newPlayer(), await newPlayer()];
    expect(code(await send(alice.user, 'steward.hire', { siteId: bob.mill }))).toBe(
      'SITE_NOT_FOUND',
    );
    expect(code(await send(alice.user, 'steward.hire', { siteId: randomUUID() }))).toBe(
      'SITE_NOT_FOUND',
    );
    expect(await stewardsOf(bob.houseId)).toEqual([]);
  });

  it('sous concurrence : un seul poste pour deux sites, un seul intendant pour un site', async () => {
    const player = await newPlayer();
    const raced = await Promise.all(
      [player.mill, player.field].map((siteId) =>
        send(player.user, 'steward.hire', { siteId }, randomUUID(), narrow),
      ),
    );
    expect(raced.map(code).sort()).toEqual(['STEWARD_LIMIT_REACHED', 'ok']);
    const other = await newPlayer();
    const same = await Promise.all(
      [1, 2, 3].map(() => send(other.user, 'steward.hire', { siteId: other.mill })),
    );
    expect(same.map(code).sort()).toEqual(['SITE_HAS_STEWARD', 'SITE_HAS_STEWARD', 'ok']);
    expect(await stewardsOf(other.houseId)).toHaveLength(1);
  });
});

describe('steward.hire et site.collect simultanés', () => {
  it('une embauche et une récolte du même site se suivent sans interblocage', async () => {
    for (let round = 0; round < 5; round += 1) {
      const player = await newPlayer();
      // Le champ a deux jours : une récolte écrit au stock, sous la clé étrangère de la maison.
      await owner.transaction().execute(async (trx) => {
        await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
        await sql`update game.sites set created_at = created_at - interval '2 days',
          cycle_started_at = cycle_started_at - interval '2 days' where id = ${player.field}`.execute(
          trx,
        );
        await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
      });
      const raced = await Promise.all([
        send(player.user, 'steward.hire', { siteId: player.field }),
        send(player.user, 'site.collect', { siteId: player.field }),
      ]);
      expect(raced.map(code)).toEqual(['ok', 'ok']);
    }
  });
});

describe('steward.dismiss', () => {
  it('renvoie l’intendant : son poste et son site se libèrent ; rejoué, rien de plus', async () => {
    const player = await newPlayer();
    const stewardId = await hire(player.user, player.mill, narrow);
    const key = randomUUID();
    const dismissed = await send(player.user, 'steward.dismiss', { stewardId }, key);
    expect(dismissed.body.data).toEqual({
      stewardId,
      siteId: player.mill,
      dismissedAt: expect.any(String),
    });
    expect(await send(player.user, 'steward.dismiss', { stewardId }, key)).toEqual(dismissed);
    expect(code(await send(player.user, 'steward.dismiss', { stewardId }))).toBe(
      'STEWARD_NOT_FOUND',
    );
    const [steward] = await stewardsOf(player.houseId);
    expect(steward?.dismissed_at).toEqual(new Date(dismissed.body.data.dismissedAt));
    // Le poste libéré, la maison réembauche, même sous la limite d'un seul intendant.
    const again = await send(
      player.user,
      'steward.hire',
      { siteId: player.mill },
      randomUUID(),
      narrow,
    );
    expect(code(again)).toBe('ok');
    expect((await eventsOf(player.houseId)).map((event) => event.type)).toEqual([
      'StewardHired',
      'StewardDismissed',
      'StewardHired',
    ]);
  });

  it('l’intendant d’une autre maison est inconnu ; deux renvois simultanés, un seul passe', async () => {
    const [alice, bob] = [await newPlayer(), await newPlayer()];
    const stewardId = await hire(bob.user, bob.mill);
    expect(code(await send(alice.user, 'steward.dismiss', { stewardId }))).toBe(
      'STEWARD_NOT_FOUND',
    );
    expect((await stewardsOf(bob.houseId))[0]?.dismissed_at).toBeNull();
    const raced = await Promise.all(
      [1, 2].map(() => send(bob.user, 'steward.dismiss', { stewardId })),
    );
    expect(raced.map(code).sort()).toEqual(['STEWARD_NOT_FOUND', 'ok']);
  });
});
