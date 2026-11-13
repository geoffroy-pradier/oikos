import { createDb, type Db } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { INITIAL_CONFIG, type GameConfig } from './index';
import {
  ConfigError,
  createConfigLoader,
  ensureInitialConfig,
  publishVersion,
  scheduleActivation,
} from './store';

// Tests d'intégration contre Supabase local. Les tables étant en ajout seul, chaque test s'exécute dans
// une transaction annulée : rien ne subsiste en base.
const db = createDb(
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
);
afterAll(() => db.destroy());

class Rollback extends Error {}
async function inRolledBackTransaction(body: (trx: Db) => Promise<void>): Promise<void> {
  await db
    .transaction()
    .execute(async (trx) => {
      await body(trx);
      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
}

const variant = (tickMinutes: number): GameConfig => {
  const config = structuredClone(INITIAL_CONFIG) as GameConfig;
  config.clock.tickMinutes = tickMinutes;
  return config;
};
const day = (n: number, hour = 4) => new Date(Date.UTC(2031, 0, n, hour));

async function publish(trx: Db, tickMinutes: number) {
  const result = await publishVersion(trx, variant(tickMinutes));
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.version;
}

describe('stockage versionné de la configuration', () => {
  it('une configuration invalide est refusée et n’est pas enregistrée', () =>
    inRolledBackTransaction(async (trx) => {
      const before = await trx.selectFrom('config.versions').select('id').execute();
      const result = await publishVersion(trx, variant(7));
      expect(result).toEqual({
        ok: false,
        errors: ['clock.tickMinutes: must divide the 1440 minutes of a day'],
      });
      expect(await trx.selectFrom('config.versions').select('id').execute()).toEqual(before);
    }));

  it('charge la version active, figée, et bascule à l’heure programmée', () =>
    inRolledBackTransaction(async (trx) => {
      const [v1, v2] = [await publish(trx, 10), await publish(trx, 20)];
      expect(v2.number).toBeGreaterThan(v1.number);
      await scheduleActivation(trx, v1.id, day(1));
      await scheduleActivation(trx, v2.id, day(2));
      const loader = createConfigLoader(trx);

      const first = await loader.at(day(1, 12));
      expect(first).toMatchObject({ id: v1.id, number: v1.number });
      expect(first.config.clock.tickMinutes).toBe(10);
      expect(first.config).toEqual(variant(10));
      expect(Object.isFrozen(first.config.goods)).toBe(true);

      expect((await loader.at(new Date(day(2).getTime() - 1))).id).toBe(v1.id);
      expect((await loader.at(day(2))).config.clock.tickMinutes).toBe(20);
    }));

  it('retour arrière : réactiver une version antérieure, sans rien réécrire', () =>
    inRolledBackTransaction(async (trx) => {
      const [v1, v2] = [await publish(trx, 10), await publish(trx, 20)];
      await scheduleActivation(trx, v1.id, day(1));
      await scheduleActivation(trx, v2.id, day(2));
      await scheduleActivation(trx, v1.id, day(3));
      const loader = createConfigLoader(trx);
      expect((await loader.at(day(2, 12))).id).toBe(v2.id);
      expect((await loader.at(day(3, 12))).id).toBe(v1.id);
    }));

  it('met les versions en cache : un tick relit la même instance figée', () =>
    inRolledBackTransaction(async (trx) => {
      const v1 = await publish(trx, 10);
      await scheduleActivation(trx, v1.id, day(1));
      const loader = createConfigLoader(trx);
      const [a, b] = [await loader.at(day(1)), await loader.at(day(1, 23))];
      expect(a).toBe(b);
      expect(loader.cachedVersions()).toBe(1);
    }));

  it('échoue clairement sans version active, ou si une version stockée est invalide', () =>
    inRolledBackTransaction(async (trx) => {
      const loader = createConfigLoader(trx);
      await expect(loader.at(new Date(Date.UTC(1990, 0, 1)))).rejects.toThrow(ConfigError);

      const bad = await sql<{ id: string }>`
        insert into config.versions (payload) values ('{"goods": []}') returning id
      `.execute(trx);
      await scheduleActivation(trx, bad.rows[0]?.id ?? '', day(5));
      await expect(loader.at(day(5))).rejects.toThrow(/is invalid: /);
    }));

  it('ensureInitialConfig publie et active une seule fois', () =>
    inRolledBackTransaction(async (trx) => {
      // Dans une base déjà amorcée, l'appel est sans effet ; sinon il crée la version 1.
      const existing = await trx.selectFrom('config.versions').select('id').execute();
      const created = await ensureInitialConfig(trx, INITIAL_CONFIG, day(1));
      expect(created === null).toBe(existing.length > 0);
      expect(await ensureInitialConfig(trx, INITIAL_CONFIG, day(1))).toBeNull();
      const after = await trx.selectFrom('config.versions').select('id').execute();
      expect(after.length).toBe(Math.max(existing.length, 1));
    }));
});
