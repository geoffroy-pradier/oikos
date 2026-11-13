import { createConfigLoader, ensureInitialConfig, INITIAL_CONFIG } from '@oikos/config';
import { createDb } from '@oikos/db';
import { PgBoss } from 'pg-boss';
import { advanceAllWorlds } from './scheduler';
import { npcDemand } from './steps/npc-demand';
import type { TickStep } from './tick';

const QUEUE = 'world-clock';
/** Étapes du tick, dans l'ordre. */
const STEPS: readonly TickStep[] = [npcDemand];

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('Missing environment variable DATABASE_URL');

const db = createDb(databaseUrl);
await ensureInitialConfig(db, INITIAL_CONFIG);
const loader = createConfigLoader(db);

// File de tâches dans Postgres (pg-boss) : pas de Redis. L'horloge passe chaque minute ; le moteur joue
// alors tous les ticks échus, dans l'ordre. Une tâche en échec est reprise sans double effet.
const boss = new PgBoss(databaseUrl);
boss.on('error', (error) => console.error('pg-boss error', error));
await boss.start();
await boss.createQueue(QUEUE);
await boss.schedule(QUEUE, '* * * * *');
await boss.work(QUEUE, async () => {
  const results = await advanceAllWorlds(db, {
    now: new Date(),
    config: loader,
    steps: STEPS,
  });
  for (const { worldId, played, error } of results) {
    if (played.length > 0) console.log(`World ${worldId}: played ticks ${played.join(', ')}`);
    if (error) throw new Error(`World ${worldId}: ${error}`);
  }
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
