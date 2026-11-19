import { writeFile } from 'node:fs/promises';
import { openBench } from './city';
import { indicatorsOf } from './report';
import { recipeMargins } from './measures';
import { playWorld } from './run';
import { SLUGS, WINDOW, worldConfig } from './world';

/*
 * Une partie du simulateur (#284), dans son propre processus : `config` (`city.ts`) est lue au chargement, d'où
 * `BALANCE_CONFIG_FILE` pour la candidate. Lancé par `simulate.ts`, jamais à la main :
 * `play <fichier de sortie> <jours mesurés> <graine>` écrit les indicateurs de la partie en JSON.
 */
const [output, days, seed] = process.argv.slice(2);
if (!output || !days || !seed) throw new Error('Usage: play <output> <days> <seed>');
const bench = openBench({ config: worldConfig });
try {
  await bench.start();
  const run = await playWorld(bench, { measured: Number(days), seed });
  const margins = recipeMargins(run.days.slice(-WINDOW));
  await writeFile(output, JSON.stringify(indicatorsOf(run.days, margins, SLUGS, WINDOW)));
} finally {
  await bench.stop();
}
