import { createConfigLoader, ensureInitialConfig, INITIAL_CONFIG } from '@oikos/config';
import { createDb } from '@oikos/db';
import { PgBoss } from 'pg-boss';
import { purgeMessages } from './chat-retention';
import { CLOSE_STEPS } from './close-steps';
import { cancelClockChangingActivations, purgeTelemetry } from './maintenance';
import { advanceAllWorlds, closeAllWorlds, databaseNow } from './scheduler';
import { npcDemand } from './steps/npc-demand';
import { observedPricesStep } from './steps/observed-prices';
import { priceCandlesStep } from './steps/price-candles';
import type { TickStep } from './tick';

const QUEUE = 'world-clock';
/** Étapes du tick, dans l'ordre : les chandeliers résument aussi les achats que les PNJ viennent de faire. */
const STEPS: readonly TickStep[] = [npcDemand, priceCandlesStep, observedPricesStep];

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('Missing environment variable DATABASE_URL');

const db = createDb(databaseUrl);
await ensureInitialConfig(db, INITIAL_CONFIG);
// Une activation programmée avant le refus des changements d'horloge (#123) n'est pas appliquée (#213).
await cancelClockChangingActivations(db);
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
  // Rétention de la télémétrie (#213) : un échec est signalé, il n'arrête ni ticks ni clôtures.
  await purgeTelemetry(db, { now, config: loader }).catch((error: unknown) =>
    console.error('Telemetry purge failed', error),
  );
  // Conservation limitée des messages (#273), tâche à part : même traitement d'un échec.
  await purgeMessages(db, { now, config: loader }).catch((error: unknown) =>
    console.error('Message purge failed', error),
  );
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
