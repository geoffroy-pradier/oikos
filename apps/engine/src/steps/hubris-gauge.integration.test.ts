import { describe, expect, it } from 'vitest';
import { hubrisGauge } from './hubris-gauge';
import {
  close,
  DAY,
  gaugesOf,
  hour,
  linesOf,
  NEUTRAL,
  newWorld,
  sales,
  WEIGHTED,
  at,
} from './hubris.integration-fixtures';

// Jauge d'Hybris (#734) : ce qu'est la maison (part de marché, fortune), et une clôture rejouée.
describe('jauge d’Hybris à la clôture (#734)', () => {
  it('part de marché et fortune au-delà des seuils ; poids nuls : rien ; une maison PNJ n’a pas de jauge', async () => {
    // a domine le blé (80 sur 200 vendus dans la fenêtre) ; b en vend 20 ; la maison PNJ 100. Hors fenêtre : 1 000
    // ventes de a il y a huit jours, 1 000 de b après l'instant de la clôture.
    const world = await newWorld([9_000, 1_000, 1_000], [0]);
    const [a = '', b = '', , npc = ''] = world.ids;
    await sales(world, [
      [a, 80, new Date(at(DAY).getTime() - hour)],
      [b, 20, new Date(at(DAY).getTime() - 2 * hour)],
      [npc, 100, new Date(at(DAY).getTime() - 3 * hour)],
      [a, 1_000, new Date(at(DAY - 8).getTime())],
      [b, 1_000, new Date(at(DAY).getTime() + hour)],
    ]);
    // La veille, poids, baisses et déclin nuls (configuration initiale) : aucune ligne, même pour une maison qui domine.
    expect((await close(world.worldId, DAY - 1, NEUTRAL)).summary).toEqual({
      hubrisGauge: { houses: 0, lines: 0 },
    });
    expect((await close(world.worldId, DAY)).summary).toEqual({
      hubrisGauge: { houses: 1, lines: 3 },
    });
    // Part de a : 40 %, 500 points au-delà du seuil, 500 au poids de 10 000 par part entière.
    // Fortunes (trésoreries, ventes comprises, lues à la clôture) : a 10 080, b 2 020, c 1 000 ; la maison PNJ (100)
    // n'entre pas dans la médiane, 2 020. a en a 4,99 fois, 1,99 de trop : 19 900 au poids de 10 000 par médiane.
    // b (10 %) et c restent sous les seuils ; la maison PNJ, à 50 % des ventes, n'a pas de jauge. Puis le déclin.
    expect(await linesOf(world)).toEqual([
      '0:market_share:500@0',
      '0:wealth:19900@0',
      '0:decay:-10@0',
    ]);
    expect(await gaugesOf(world)).toEqual({ '0': 20_390 });
  });

  it('rejouée : une seule fois, dans la même clôture comme en deux clôtures concurrentes ; sans section, rien', async () => {
    const world = await newWorld([90_000, 1_000, 1_000]);
    const twice = await close(world.worldId, DAY, WEIGHTED, [
      hubrisGauge,
      { ...hubrisGauge, name: 'again' },
    ]);
    expect(twice.summary).toEqual({
      hubrisGauge: { houses: 1, lines: 2 },
      again: { houses: 0, lines: 0 },
    });
    const outcomes = await Promise.all([
      close(world.worldId, DAY + 1),
      close(world.worldId, DAY + 1),
    ]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['done', 'skipped']);
    expect((await close(world.worldId, DAY + 1)).status).toBe('skipped');
    // Une version publiée avant l'Hybris ne change aucune jauge.
    expect((await close(world.worldId, DAY + 2, null)).summary).toEqual({
      hubrisGauge: { houses: 0, lines: 0 },
    });
    // Fortune de a : 90 000 pour une médiane de 1 000, 87 médianes de trop ; puis le déclin.
    expect(await linesOf(world)).toEqual([
      '0:wealth:870000@0',
      '0:decay:-10@0',
      '0:wealth:870000@1',
      '0:decay:-10@1',
    ]);
  });
});
