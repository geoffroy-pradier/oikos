import { dbCallStore, fakeProvider } from '@oikos/ai';
import { createConfigLoader, ensureInitialConfig, INITIAL_CONFIG } from '@oikos/config';
import { createDb } from '@oikos/db';
import { PgBoss } from 'pg-boss';
import { purgeMessages, purgeStewardInstructions } from './chat-retention';
import { writeAllChronicles } from './chronicle/task';
import { CLOSE_STEPS } from './close-steps';
import { cancelClockChangingActivations, purgeTelemetry } from './maintenance';
import { rewriteAllOracles } from './oracle/task';
import { advanceAllWorlds, closeAllWorlds, databaseNow } from './scheduler';
import { answerAllStewardInstructions } from './steward-instruction/task';
import { purgeStewardOperations } from './steward-retention';
import { runAllStewards } from './stewards';
import { TICK_STEPS } from './tick-steps';

const QUEUE = 'world-clock';
const CHRONICLE_QUEUE = 'city-chronicle';
const ORACLE_QUEUE = 'pythia-oracles';
const STEWARD_INSTRUCTION_QUEUE = 'steward-instructions';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('Missing environment variable DATABASE_URL');

const db = createDb(databaseUrl);
await ensureInitialConfig(db, INITIAL_CONFIG);
// Une activation programmée avant le refus des changements d'horloge (#123) n'est pas appliquée (#213).
await cancelClockChangingActivations(db);
const loader = createConfigLoader(db);
// Passerelle IA (ADR 0005) : le fournisseur réel est le ticket #269. D'ici là, `AI_PROVIDER=fake` : le fournisseur
// factice, sans réponse, ne sert qu'à un usage activé par erreur ; la passerelle rend alors le repli.
if ((process.env['AI_PROVIDER'] ?? 'fake') !== 'fake')
  console.warn('AI_PROVIDER: only the fake provider exists yet (#269); every AI usage falls back');
const ai = { provider: fakeProvider([]), store: dbCallStore(db) };

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
  const ticks = await advanceAllWorlds(db, { now, config: loader, steps: TICK_STEPS });
  // Les clôtures quotidiennes ont leur propre échéancier, par jour de jeu : un tick en échec ne les retient pas.
  const closes = await closeAllWorlds(db, { now, config: loader, steps: CLOSE_STEPS });
  for (const { worldId, played } of ticks)
    if (played.length > 0) console.log(`World ${worldId}: played ticks ${played.join(', ')}`);
  for (const { worldId, played } of closes)
    if (played.length > 0) console.log(`World ${worldId}: closed game days ${played.join(', ')}`);
  // Opérations des intendants (#279) pour le dernier tick de chaque monde, après la clôture qui paie leur salaire :
  // chacune dans sa transaction, hors de celle du tick. Un monde en échec est signalé, il ne retient pas les autres.
  // Comme les purges : un échec est signalé, il n'arrête pas le passage.
  const stewards = await runAllStewards(db, { config: loader }).catch((error: unknown) => {
    console.error('Stewards failed', error);
    return [];
  });
  for (const { worldId, run, error } of stewards) {
    if (error) console.error(`World ${worldId}: stewards failed: ${error}`);
    else if (run && run.acted + run.refused + run.failed > 0)
      console.log(
        `World ${worldId}: stewards acted ${run.acted}, refused ${run.refused}, failed ${run.failed}`,
      );
  }
  // Rétention de la télémétrie (#213) : un échec est signalé, il n'arrête ni ticks ni clôtures.
  await purgeTelemetry(db, { now, config: loader }).catch((error: unknown) =>
    console.error('Telemetry purge failed', error),
  );
  // Conservation limitée des messages (#273), tâche à part : même traitement d'un échec.
  await purgeMessages(db, { now, config: loader }).catch((error: unknown) =>
    console.error('Message purge failed', error),
  );
  // Texte des consignes d'intendant (#280), à la même conservation : même traitement d'un échec.
  await purgeStewardInstructions(db, { now, config: loader }).catch((error: unknown) =>
    console.error('Steward instruction purge failed', error),
  );
  // Opérations des intendants (#561), à leur propre conservation : même traitement d'un échec.
  await purgeStewardOperations(db, { now, config: loader }).catch((error: unknown) =>
    console.error('Steward operation purge failed', error),
  );
  for (const { worldId, error } of [...ticks, ...closes])
    if (error) throw new Error(`World ${worldId}: ${error}`);
});
// Chronique des cités (#271), dans sa propre file : les appels à l'IA, longs, ne retardent ni ticks ni clôtures,
// et son échec ne les retient pas. Elle suit la clôture d'au moins `chronicle.settleSeconds`.
await boss.createQueue(CHRONICLE_QUEUE);
await boss.schedule(CHRONICLE_QUEUE, '* * * * *');
await boss.work(CHRONICLE_QUEUE, async () => {
  const now = await databaseNow(db);
  for (const { worldId, written } of await writeAllChronicles(db, { now, config: loader, ...ai }))
    if (written > 0) console.log(`World ${worldId}: wrote ${written} chronicles`);
});
// Oracles de la Pythie (#270), dans leur propre file, pour la même raison : chaque oracle de repli d'un événement à
// venir est essayé une fois par l'IA, après la clôture qui l'a planifié. IA coupée, la tâche ne fait rien.
await boss.createQueue(ORACLE_QUEUE);
await boss.schedule(ORACLE_QUEUE, '* * * * *');
await boss.work(ORACLE_QUEUE, async () => {
  const now = await databaseNow(db);
  for (const { worldId, attempted, rewritten } of await rewriteAllOracles(db, {
    now,
    config: loader,
    ...ai,
  }))
    if (attempted > 0)
      console.log(`World ${worldId}: rewrote ${rewritten} of ${attempted} oracles`);
});
// Consignes d'intendant (#280), dans leur propre file : chaque consigne en attente est traduite une fois par l'IA et ses
// règles simulées à blanc ; IA coupée, elle reçoit aussitôt son refus et le joueur garde le formulaire.
await boss.createQueue(STEWARD_INSTRUCTION_QUEUE);
await boss.schedule(STEWARD_INSTRUCTION_QUEUE, '* * * * *');
await boss.work(STEWARD_INSTRUCTION_QUEUE, async () => {
  const now = await databaseNow(db);
  for (const { worldId, answered, proposed } of await answerAllStewardInstructions(db, {
    now,
    config: loader,
    ...ai,
  }))
    if (answered > 0)
      console.log(
        `World ${worldId}: answered ${answered} steward instructions, ${proposed} with rules`,
      );
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
