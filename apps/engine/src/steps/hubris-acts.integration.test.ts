import { describe, expect, it } from 'vitest';
import {
  acts,
  at,
  close,
  DAY,
  gaugesOf,
  hour,
  linesOf,
  newWorld,
} from './hubris.integration-fixtures';

// Jauge d'Hybris (#734) : ce que fait la maison (liturgies, offrandes), compté une fois, une clôture plus tard.
describe('actes et Hybris à la clôture (#734)', () => {
  it('actes : prélèvement, offrandes, liturgies et faste comptés une fois, une clôture plus tard ; déclin ; rognée à zéro', async () => {
    const world = await newWorld([20_000, 5_000]);
    const [a = ''] = world.ids;
    const before = (day: number, hours: number) => new Date(at(day).getTime() - hours * hour);
    await acts(world, a, [
      { leviedDay: DAY - 2 },
      { offering: 1_000, when: before(DAY - 2, 1) },
      { performed: 400, splendor: 300, when: before(DAY - 2, 2) },
      { offering: 2_000, when: before(DAY - 1, 1) },
      { offering: 5_000, when: new Date(at(DAY - 1).getTime() + hour) },
    ]);
    // Première clôture : aucune clôture enregistrée avant elle, aucun acte compté ; jauge vide, rien ne décline.
    await close(world.worldId, DAY - 2);
    // Ensuite : le prélèvement de la clôture d'avant (+500), puis tout ce qui précède son instant : 1 000 oboles
    // (−100), une liturgie (−40) et son faste de 300 (−30), et le déclin (−10).
    await close(world.worldId, DAY - 1);
    // Puis ce qui va de l'avant-dernière clôture à la dernière : 2 000 oboles (−200), et le déclin.
    await close(world.worldId, DAY);
    // Enfin 5 000 oboles (−500), rognées à ce qui reste (110) ; une jauge vide ne décline plus.
    await close(world.worldId, DAY + 1);
    // Une clôture de plus ne recompte rien.
    await close(world.worldId, DAY + 2);
    expect(await linesOf(world)).toEqual([
      '0:liturgy_levied:500@-1',
      '0:offering:-100@-1',
      '0:liturgy_performed:-70@-1',
      '0:decay:-10@-1',
      '0:offering:-200@0',
      '0:decay:-10@0',
      '0:offering:-110@1',
    ]);
    expect(await gaugesOf(world)).toEqual({ '0': 0 });
  });

  it('une clôture manquée ne perd aucun acte : la période suit les clôtures enregistrées', async () => {
    const world = await newWorld([20_000]);
    const [a = ''] = world.ids;
    await acts(world, a, [
      { leviedDay: DAY - 1 },
      { offering: 300, when: new Date(at(DAY).getTime() + hour) },
      { offering: 700, when: new Date(at(DAY + 1).getTime() + hour) },
    ]);
    await close(world.worldId, DAY - 1);
    await close(world.worldId, DAY);
    // La clôture DAY + 1 n'est pas jouée : DAY + 2 compte ce qui précède DAY, puis DAY + 3 tout jusqu'à DAY + 2.
    await close(world.worldId, DAY + 2);
    await close(world.worldId, DAY + 3);
    expect(await linesOf(world)).toEqual([
      '0:liturgy_levied:500@0',
      '0:decay:-10@0',
      '0:decay:-10@2',
      '0:offering:-100@3',
      '0:decay:-10@3',
    ]);
  });
});
