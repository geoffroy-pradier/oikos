import type { NpcHouses } from '@oikos/config';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLOSE_STEPS } from '../close-steps';
import { npcHouseSurplus, npcHouseSurplusStep } from './npc-house-surplus';
import {
  close,
  credit,
  DAY,
  newWorld,
  npcHouseOf,
  owner,
  setUp,
  startAfterClose,
  tearDown,
} from './npc-houses.integration-fixtures';

// Surplus des maisons PNJ de secours à la clôture (#716), contre Supabase local. Chaque test a son monde.
beforeAll(setUp);
afterAll(tearDown);

/** Kallistè : un champ, 8 000 oboles de dotation, plafond `cap` ; Elaia : un champ, sans dotation ni plafond. */
const secours = (cap: number): NpcHouses => ({
  kalliste: {
    treasuryCapOboles: cap,
    chains: [{ id: 'bread', name: 'Greniers', sites: { grow_wheat: 1 }, grantOboles: 8_000 }],
  },
  elaia: {
    treasuryCapOboles: 0,
    chains: [{ id: 'bread', name: 'Moissons', sites: { grow_wheat: 1 }, grantOboles: 0 }],
  },
});

/** Puits du surplus, somme des comptes du monde, écritures du surplus et des robinets vers une maison PNJ. */
async function ledgerOf(worldId: string) {
  const { rows } = await sql<Record<'sink' | 'total' | 'surplus' | 'faucets', string>>`select
      (select balance from game.accounts where world_id = ${worldId} and system_key = 'sink_npc_house_surplus') as sink,
      (select sum(balance) from game.accounts where world_id = ${worldId}) as total,
      (select count(*) from game.ledger_entries where world_id = ${worldId} and kind = 'npc_house.surplus') as surplus,
      (select count(*) from game.ledger_lines l join game.accounts f on f.id = l.account_id
         and f.system_key like 'faucet\\_%' and f.world_id = ${worldId}
       where l.entry_id in (select l2.entry_id from game.ledger_lines l2 join game.accounts a on a.id = l2.account_id
         join game.npc_houses n on n.house_id = a.house_id where a.world_id = ${worldId})) as faucets`.execute(
    owner,
  );
  return Object.fromEntries(
    Object.entries(rows[0] ?? {}).map(([key, value]) => [key, Number(value)]),
  );
}

describe('surplus des maisons PNJ de secours (#716)', () => {
  it('ce qui dépasse le plafond, rien en dessous ni au plafond même', () => {
    expect(npcHouseSurplus(30_000, 20_000)).toBe(10_000);
    expect(npcHouseSurplus(20_001, 20_000)).toBe(1);
    expect(npcHouseSurplus(20_000, 20_000)).toBe(0);
    expect(npcHouseSurplus(0, 20_000)).toBe(0);
    expect(npcHouseSurplus(7, 0)).toBe(7);
    expect(npcHouseSurplus(0, 0)).toBe(0);
  });

  it('la trésorerie au-delà du plafond va au puits, une seule fois même rejouée, la masse conservée', async () => {
    // Quatre clôtures, la dernière avant le jour en cours.
    const D = DAY - 2;
    const { worldId, cityIds } = await newWorld(['kalliste', 'elaia']);
    expect(await close(worldId, D, secours(20_000))).toEqual([D]);
    const house = await npcHouseOf(worldId, cityIds['kalliste'] ?? '');
    // Ce qu'elle aurait gagné à l'agora : 12 345 oboles, qui la portent à 20 345.
    await credit(worldId, house.accountId, 12_345);
    const steps = [npcHouseSurplusStep];
    expect(await close(worldId, D + 1, secours(20_000), steps)).toEqual([D + 1]);
    expect((await npcHouseOf(worldId, cityIds['kalliste'] ?? '')).balance).toBe(20_000);
    // Elaia, sans trésorerie, au plafond nul : rien à verser, aucune écriture.
    expect((await npcHouseOf(worldId, cityIds['elaia'] ?? '')).balance).toBe(0);
    const once = { sink: 345, total: 0, surplus: 1, faucets: 2 };
    expect(await ledgerOf(worldId)).toEqual(once);
    const { rows } = await sql<{
      meta: Record<string, unknown>;
    }>`select meta from game.ledger_entries
      where world_id = ${worldId} and kind = 'npc_house.surplus'`.execute(owner);
    expect(rows.map((row) => row.meta)).toEqual([
      { houseId: house.houseId, cityId: cityIds['kalliste'], capOboles: 20_000, gameDay: D + 1 },
    ]);
    // Rejouée : la clôture du jour ne se rejoue pas ; la suivante n'a plus rien au-delà du plafond.
    expect(await close(worldId, D + 1, secours(20_000), steps)).toEqual([]);
    expect(await close(worldId, D + 2, secours(20_000), steps)).toEqual([D + 2]);
    expect(await ledgerOf(worldId)).toEqual(once);
    // Un plafond abaissé par une version nouvelle prend effet à la clôture suivante ; une cité que la configuration
    // ne nomme plus n'a pas de plafond, et sa maison ne verse rien.
    const lowered = { kalliste: { ...secours(15_000).kalliste, chains: [] } } as NpcHouses;
    expect(await close(worldId, D + 3, lowered, steps)).toEqual([D + 3]);
    expect((await npcHouseOf(worldId, cityIds['kalliste'] ?? '')).balance).toBe(15_000);
    expect(await ledgerOf(worldId)).toEqual({ ...once, sink: 5_345, surplus: 2 });
  });

  it('faute d’entretien, elle s’arrête comme une autre, et aucun robinet ne la renfloue', async () => {
    const D = DAY - 1;
    const { worldId, cityIds } = await newWorld(['kalliste', 'elaia']);
    expect(await close(worldId, D, secours(20_000), CLOSE_STEPS)).toEqual([D]);
    await startAfterClose(worldId, D);
    // Le lendemain, la clôture complète : Elaia, sans dotation, ne paie pas l'entretien de son champ, qui s'arrête ;
    // Kallistè le paie de sa dotation, qui reste sous le plafond.
    expect(await close(worldId, D + 1, secours(20_000), CLOSE_STEPS)).toEqual([D + 1]);
    const halted = async () =>
      (
        await sql<{
          slug: string;
          halted: boolean;
        }>`select c.slug, s.halted_at is not null as halted
          from game.sites s join game.cities c on c.id = s.city_id
          where s.world_id = ${worldId} order by c.slug`.execute(owner)
      ).rows;
    expect(await halted()).toEqual([
      { slug: 'elaia', halted: true },
      { slug: 'kalliste', halted: false },
    ]);
    expect((await npcHouseOf(worldId, cityIds['elaia'] ?? '')).balance).toBe(0);
    expect((await npcHouseOf(worldId, cityIds['kalliste'] ?? '')).balance).toBeLessThan(8_000);
    // Deux clôtures plus tard, toujours à l'arrêt : un seul robinet a jamais payé une maison PNJ, la dotation de
    // Kallistè ; la masse du monde reste nulle, rien ne va au puits du surplus.
    expect(await close(worldId, D + 2, secours(20_000), CLOSE_STEPS)).toEqual([D + 2]);
    expect((await halted())[0]).toEqual({ slug: 'elaia', halted: true });
    expect(await ledgerOf(worldId)).toEqual({ sink: 0, total: 0, surplus: 0, faucets: 1 });
  });
});
