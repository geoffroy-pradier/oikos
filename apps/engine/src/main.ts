import { createConfigLoader, ensureInitialConfig, INITIAL_CONFIG } from '@oikos/config';
import { createDb } from '@oikos/db';
import { PgBoss } from 'pg-boss';
import type { CloseStep } from './close';
import { advanceAllWorlds, closeAllWorlds, databaseNow } from './scheduler';
import { npcDemand } from './steps/npc-demand';
import { observedPricesStep } from './steps/observed-prices';
import { priceCandlesStep } from './steps/price-candles';
import { siteUpkeep } from './steps/site-upkeep';
import type { TickStep } from './tick';

const QUEUE = 'world-clock';
/** Étapes du tick, dans l'ordre : les chandeliers résument aussi les achats que les PNJ viennent de faire. */
const STEPS: readonly TickStep[] = [npcDemand, priceCandlesStep, observedPricesStep];

/**
 * Étapes de la clôture quotidienne, dans l'ordre. L'entretien reste la DERNIÈRE : il tient le verrou des
 * appariements du monde, le puits et les trésoreries jusqu'à la validation de la clôture, et tout ce
 * qui s'exécuterait après lui allongerait l'attente des ordres, des récoltes et des relances.
 */
const CLOSE_STEPS: readonly CloseStep[] = [siteUpkeep];

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('Missing environment variable DATABASE_URL');

const db = createDb(databaseUrl);
await ensureInitialConfig(db, INITIAL_CONFIG);
const loader = createConfigLoader(db);

// File de tâches dans Postgres (pg-boss) : pas de Redis. L'horloge passe chaque minute ; le moteur joue
// alors tous les ticks échus, dans l'ordre. Une tâche en échec est reprise sans double effet.
// Le schéma `pgboss` est créé par les migrations et appartient au rôle de service : le moteur y installe
// ses tables, sans droit de création dans la base.
const boss = new PgBoss({ connectionString: databaseUrl, createSchema: false });
boss.on('error', (error) => console.error('pg-boss error', error));
await boss.start();
await boss.createQueue(QUEUE);
await boss.schedule(QUEUE, '* * * * *');
await boss.work(QUEUE, async () => {
  // Un seul instant présent pour tout le passage, lu à l'horloge de la base, pas à celle de ce processus.
  const now = await databaseNow(db);
  const ticks = await advanceAllWorlds(db, { now, config: loader, steps: STEPS });
  // Les clôtures quotidiennes ont leur propre échéancier, par jour de jeu : un tick en échec ne les retient pas.
  const closes = await closeAllWorlds(db, { now, config: loader, steps: CLOSE_STEPS });
  for (const { worldId, played } of ticks)
    if (played.length > 0) console.log(`World ${worldId}: played ticks ${played.join(', ')}`);
  for (const { worldId, played } of closes)
    if (played.length > 0) console.log(`World ${worldId}: closed game days ${played.join(', ')}`);
  for (const { worldId, error } of [...ticks, ...closes])
    if (error) throw new Error(`World ${worldId}: ${error}`);
});
console.log('OIKOS engine started');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void boss
      .stop()
      .then(() => db.destroy())
      .then(() => process.exit(0));
  });
}
