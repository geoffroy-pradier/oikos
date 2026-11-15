import { randomUUID } from 'node:crypto';
import {
  type ConfigLoader,
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  publishVersion,
  scheduleActivation,
  validateConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cancelClockChangingActivations, purgeTelemetry } from './maintenance';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// Le code testé agit sous le rôle de service, comme en production ; `owner` pose les jeux d'essai.
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const DAY_MS = 86_400_000;
/** Activations que ce fichier programme : annulées à la fin, pour ne pas changer la base partagée. */
const scheduled: string[] = [];

beforeAll(() => ensureInitialConfig(db, INITIAL_CONFIG));
afterAll(async () => {
  for (const id of scheduled) {
    await sql`insert into config.activation_cancellations (activation_id, cancelled_by)
      select ${id}, ${randomUUID()} where not exists
        (select 1 from config.activation_cancellations where activation_id = ${id})`.execute(owner);
  }
  await Promise.all([db.destroy(), owner.destroy()]);
});

/** Configuration réduite à la rétention : la purge n'en lit rien d'autre. */
const retention = (retentionDays: number) =>
  ({
    at: async () => ({ config: { telemetry: { retentionDays } } }),
  }) as unknown as Pick<ConfigLoader, 'at'>;

describe('rétention de la télémétrie', () => {
  /** Un passage de tick et un de clôture d'un monde fictif, enregistrés il y a `ageDays` jours. */
  async function runs(worldId: string, ageDays: number) {
    const createdAt = new Date(Date.now() - ageDays * DAY_MS);
    await sql`insert into telemetry.tick_runs (world_id, tick_index, status, duration_ms, created_at)
      values (${worldId}, 1, 'done', 1, ${createdAt})`.execute(owner);
    await sql`insert into telemetry.close_runs (world_id, game_day, status, duration_ms, created_at)
      values (${worldId}, 1, 'done', 1, ${createdAt})`.execute(owner);
  }
  const count = async (worldId: string) => {
    const { rows } = await sql<{ ticks: string; closes: string }>`
      select (select count(*) from telemetry.tick_runs where world_id = ${worldId}) as ticks,
             (select count(*) from telemetry.close_runs where world_id = ${worldId}) as closes`.execute(
      owner,
    );
    return [Number(rows[0]?.ticks), Number(rows[0]?.closes)];
  };

  it('supprime, sous le rôle de service, les passages plus anciens que la rétention, et eux seuls', async () => {
    const worldId = randomUUID();
    await runs(worldId, 31);
    await runs(worldId, 29);
    const purged = await purgeTelemetry(db, { now: new Date(), config: retention(30) });
    expect(purged.tickRuns).toBeGreaterThanOrEqual(1);
    expect(purged.closeRuns).toBeGreaterThanOrEqual(1);
    expect(await count(worldId)).toEqual([1, 1]);
    // Rétention de la configuration réelle, lue par le chargeur : 90 jours. Ceux de 89 jours restent,
    // ceux de 91 jours partent.
    const real = randomUUID();
    await runs(real, 89);
    await runs(real, 91);
    await purgeTelemetry(db, { now: new Date(), config: createConfigLoader(db) });
    expect(await count(real)).toEqual([1, 1]);
    expect(await count(worldId)).toEqual([1, 1]);
  });

  it('le journal des appels d’IA garde au moins 32 jours, même sous une rétention de 30 jours', async () => {
    const model = `purge-${randomUUID()}`;
    for (const ageDays of [40, 31])
      await sql`insert into telemetry.ai_calls
          (usage, model, input_tokens, output_tokens, cost_micro_euros, outcome, duration_ms, called_at)
        values ('oracle', ${model}, 0, 0, 0, 'ok', 0, ${new Date(Date.now() - ageDays * DAY_MS)})`.execute(
        owner,
      );
    const purged = await purgeTelemetry(db, { now: new Date(), config: retention(30) });
    expect(purged.aiCalls).toBeGreaterThanOrEqual(1);
    const { rows } = await sql<{ n: string }>`
      select count(*) as n from telemetry.ai_calls where model = ${model}`.execute(owner);
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('close_runs reste en ajout seul : ni le service ni le propriétaire ne suppriment hors purge', async () => {
    const worldId = randomUUID();
    await runs(worldId, 40);
    await expect(
      db.transaction().execute(async (trx) => {
        // Le réglage de la purge ne donne aucun droit : le service n'a pas DELETE.
        await sql`select set_config('oikos.telemetry_purge', 'on', true)`.execute(trx);
        await sql`delete from telemetry.close_runs where world_id = ${worldId}`.execute(trx);
      }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      sql`delete from telemetry.close_runs where world_id = ${worldId}`.execute(owner),
    ).rejects.toThrow(/append-only/);
    await expect(
      sql`update telemetry.close_runs set duration_ms = 2 where world_id = ${worldId}`.execute(
        owner,
      ),
    ).rejects.toThrow(/append-only/);
    expect(await count(worldId)).toEqual([1, 1]);
  });

  it('garde toujours le dernier jour, quelle que soit la demande', async () => {
    const worldId = randomUUID();
    await runs(worldId, 0.5);
    await expect(
      sql`select * from telemetry.purge_runs(now() - interval '23 hours')`.execute(db),
    ).rejects.toThrow(/younger than one day/);
    await expect(sql`select * from telemetry.purge_runs(null)`.execute(db)).rejects.toThrow(
      /younger than one day/,
    );
    expect(await count(worldId)).toEqual([1, 1]);
  });
});

describe('activation programmée avant le refus des changements d’horloge (#123)', () => {
  /** Version publiée et programmée sans passer par l'API, comme avant #123, loin dans le futur. */
  async function pending(patch: Record<string, unknown>) {
    const base = validateConfig(INITIAL_CONFIG);
    if (!base.ok) throw new Error(base.errors.join('; '));
    const published = await publishVersion(db, {
      ...base.config,
      clock: { ...base.config.clock, ...patch },
    });
    if (!published.ok) throw new Error(published.errors.join('; '));
    const activateAt = new Date(Date.now() + 3650 * DAY_MS + Math.floor(Math.random() * DAY_MS));
    await scheduleActivation(db, published.version.id, activateAt);
    const { rows } = await sql<{ id: string }>`select id from config.activations
      where version_id = ${published.version.id}`.execute(owner);
    const id = rows[0]?.id ?? '';
    scheduled.push(id);
    return { id, number: published.version.number, activateAt };
  }

  it('est annulée et signalée au démarrage du moteur ; une activation à la même horloge ne l’est pas', async () => {
    const { clock } = (await createConfigLoader(db).at(new Date())).config;
    const sameClock = await pending({ seasonDays: clock.seasonDays === 7 ? 14 : 7 });
    const otherZone = await pending({
      timezone: clock.timezone === 'Europe/London' ? 'Europe/Paris' : 'Europe/London',
    });
    const otherHour = await pending({ dailyCloseHour: (clock.dailyCloseHour + 1) % 24 });
    const otherTick = await pending({ tickMinutes: clock.tickMinutes === 10 ? 15 : 10 });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const found = await cancelClockChangingActivations(db);
      const ids = found.map((activation) => activation.activationId);
      expect(ids).toEqual(expect.arrayContaining([otherZone.id, otherHour.id, otherTick.id]));
      expect(ids).not.toContain(sameClock.id);
      expect(found.find((activation) => activation.activationId === otherZone.id)).toEqual({
        activationId: otherZone.id,
        versionNumber: otherZone.number,
        activateAt: otherZone.activateAt,
        cancelled: true,
      });
      expect(errors).toHaveBeenCalledWith(expect.stringContaining(`#${otherTick.number}`));
    } finally {
      errors.mockRestore();
    }
    const { rows } = await sql<{ activation_id: string; cancelled_by: string }>`
      select activation_id, cancelled_by from config.activation_cancellations
      where activation_id = any(${[sameClock.id, otherZone.id, otherHour.id, otherTick.id]}::uuid[])`.execute(
      owner,
    );
    expect(rows.map((row) => row.activation_id).sort()).toEqual(
      [otherZone.id, otherHour.id, otherTick.id].sort(),
    );
    expect(new Set(rows.map((row) => row.cancelled_by))).toEqual(
      new Set(['00000000-0000-0000-0000-000000000000']),
    );
    // Une activation annulée ne s'applique jamais ; un second démarrage ne la signale plus.
    const at = await sql<{
      id: string;
    }>`select config.active_version_at(${otherZone.activateAt}) as id`.execute(owner);
    expect(at.rows[0]?.id).not.toBe(otherZone.id);
    expect(
      (await cancelClockChangingActivations(db)).map((activation) => activation.activationId),
    ).not.toContain(otherZone.id);
  });
});
