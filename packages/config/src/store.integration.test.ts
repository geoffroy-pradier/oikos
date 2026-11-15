import { createDb, type Db, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { INITIAL_CONFIG, type GameConfig } from './index';
import {
  ConfigError,
  createConfigLoader,
  databaseKnowsTimezone,
  ensureInitialConfig,
  publishVersion,
  scheduleActivation,
  timezoneRefused,
} from './store';

// Tests d'intégration contre Supabase local. Les tables étant en ajout seul, chaque test s'exécute dans
// une transaction annulée : rien ne subsiste en base.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// Le code testé agit sous le rôle de service, comme en production ; `owner` pose les jeux d'essai.
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

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
        code: 'CONFIG_INVALID',
        errors: [
          'clock.tickMinutes: must divide the 1440 minutes of a day',
          'clock.tickMinutes: must divide the 60 minutes of an hour',
        ],
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

  it('un fuseau valide pour Intl mais inconnu de la base est refusé, sans rien enregistrer', () =>
    inRolledBackTransaction(async (trx) => {
      // Retiré de la base des fuseaux en 2020, toujours accepté par `Intl` : un cas réel d'écart.
      expect(new Intl.DateTimeFormat('en', { timeZone: 'US/Pacific-New' })).toBeDefined();
      expect(await databaseKnowsTimezone(trx, 'US/Pacific-New')).toBe(false);
      // La casse est ignorée, comme par la base et par `Intl`.
      for (const known of ['Europe/Paris', 'UTC', 'Asia/Kolkata', 'europe/paris', 'EUROPE/PARIS']) {
        expect([known, await databaseKnowsTimezone(trx, known)]).toEqual([known, true]);
      }
      expect(
        await trx.selectNoFrom(sql<Date>`now() at time zone 'europe/paris'`.as('t')).execute(),
      ).toHaveLength(1);
      const before = await trx.selectFrom('config.versions').select('id').execute();
      const config = variant(10);
      config.clock.timezone = 'US/Pacific-New';
      // Sans version en vigueur, ou avec un autre fuseau en vigueur : refusé.
      // Comparé exactement à celui en vigueur, comme pour `CONFIG_CLOCK_CHANGED` : la casse compte.
      const metas = [null, 'Europe/Paris', 'us/pacific-new'].map((timezoneInForce) => ({
        timezoneInForce,
      }));
      for (const meta of [{}, ...metas]) {
        expect(await publishVersion(trx, config, meta)).toEqual({
          ok: false,
          code: 'CONFIG_TIMEZONE_UNKNOWN',
          errors: ['clock.timezone: unknown to the database'],
        });
      }
      expect(await trx.selectFrom('config.versions').select('id').execute()).toEqual(before);
      // Le schéma passe avant la base : un fuseau inconnu des deux est une erreur de schéma.
      config.clock.timezone = 'Mars/Olympus';
      expect(await publishVersion(trx, config)).toMatchObject({
        ok: false,
        code: 'CONFIG_INVALID',
      });
      // Un fuseau connu à la casse près est accepté, quelle que soit la version en vigueur.
      config.clock.timezone = 'europe/paris';
      expect(await publishVersion(trx, config, { timezoneInForce: 'UTC' })).toMatchObject({
        ok: true,
      });
    }));

  it('le fuseau de la version en vigueur n’est jamais refusé comme inconnu de la base', () =>
    inRolledBackTransaction(async (trx) => {
      // Monde dont le fuseau est sorti de la base des fuseaux (mise à jour de tzdata) : l'horloge ne
      // changeant pas, le refuser empêcherait toute nouvelle version.
      expect(await timezoneRefused(trx, 'US/Pacific-New', 'US/Pacific-New')).toBe(false);
      expect(await timezoneRefused(trx, 'US/Pacific-New', 'Europe/Paris')).toBe(true);
      expect(await timezoneRefused(trx, 'US/Pacific-New')).toBe(true);
      const config = variant(10);
      config.clock.timezone = 'US/Pacific-New';
      const published = await publishVersion(trx, config, { timezoneInForce: 'US/Pacific-New' });
      expect(published).toMatchObject({ ok: true });
      if (!published.ok) return;
      const stored = await trx
        .selectFrom('config.versions')
        .select(sql<string>`payload -> 'clock' ->> 'timezone'`.as('timezone'))
        .where('id', '=', published.version.id)
        .executeTakeFirstOrThrow();
      expect(stored.timezone).toBe('US/Pacific-New');
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
      await expect(loader.byId('00000000-0000-7000-8000-00000000dead')).rejects.toThrow(
        /Unknown configuration version/,
      );
    }));

  it('active immédiatement sans échéance, et refuse une échéance passée', () =>
    inRolledBackTransaction(async (trx) => {
      const v1 = await publish(trx, 30);
      await scheduleActivation(trx, v1.id);
      const active = await createConfigLoader(trx).at(new Date(Date.now() + 60_000));
      expect(active.id).toBe(v1.id);
      await expect(scheduleActivation(trx, v1.id, new Date(Date.UTC(2020, 0, 1)))).rejects.toThrow(
        /activations_not_backdated/,
      );
    }));

  it('ensureInitialConfig publie et active une seule fois', () =>
    inRolledBackTransaction(async (trx) => {
      // Dans une base déjà amorcée, l'appel est sans effet ; sinon il crée la version 1.
      const existing = await trx.selectFrom('config.versions').select('id').execute();
      const created = await ensureInitialConfig(trx, INITIAL_CONFIG);
      expect(created === null).toBe(existing.length > 0);
      expect(await ensureInitialConfig(trx, INITIAL_CONFIG)).toBeNull();
      const after = await trx.selectFrom('config.versions').select('id').execute();
      expect(after.length).toBe(Math.max(existing.length, 1));
    }));
});
