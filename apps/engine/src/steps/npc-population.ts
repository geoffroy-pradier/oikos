import { nextPopulation, vitalCoverageBps } from '@oikos/sim';
import type { CloseStep } from '../close';

/**
 * Population des PNJ (docs/specs/05-economie.md, 5.2). La clôture qui ouvre un jour de jeu fait évoluer
 * chaque classe de chaque cité d'après la mesure de la veille, cumulée par les ticks de demande : unités
 * de ses biens vitaux servies sur unités demandées. Une classe sans mesure ce jour-là (moteur arrêté,
 * classe ou cité sans état) ne bouge pas, pas plus qu'une classe retirée de la configuration, qui n'a
 * plus de bornes. La base refuse une seconde évolution pour le même jour, et toute évolution hors d'une
 * clôture enregistrée. Le résumé garde, par classe, la couverture retenue et la population avant et après.
 */
export const npcPopulation: CloseStep = {
  name: 'npcPopulation',
  async run({ trx, worldId, gameDay, config }) {
    const cities = await trx
      .selectFrom('game.cities')
      .select(['id', 'slug'])
      .where('world_id', '=', worldId)
      .orderBy('slug')
      .execute();
    const classes: Record<string, unknown>[] = [];
    for (const city of cities) {
      const initial = config.cities.find((entry) => entry.id === city.slug)?.population;
      if (!initial) continue;
      const measured = await trx
        .selectFrom('game.npc_population as p')
        .innerJoin('game.npc_vital_coverage as m', (join) =>
          join.onRef('m.city_id', '=', 'p.city_id').onRef('m.class_id', '=', 'p.class_id'),
        )
        .select(['p.class_id', 'p.population', 'm.served', 'm.demanded'])
        .where('p.city_id', '=', city.id)
        .where('m.game_day', '=', gameDay - 1)
        .orderBy('p.class_id')
        .execute();
      for (const { class_id: classId, population: before, served, demanded } of measured) {
        const start = initial[classId];
        if (start === undefined) continue;
        const coverageBps = vitalCoverageBps(served, demanded);
        const after = nextPopulation(before, start, coverageBps, config.populationDynamics);
        await trx
          .updateTable('game.npc_population')
          .set({ population: after, closed_day: gameDay, coverage_bps: coverageBps })
          .where('city_id', '=', city.id)
          .where('class_id', '=', classId)
          .execute();
        classes.push({ city: city.slug, classId, coverageBps, before, after });
      }
    }
    return { classes };
  },
};
