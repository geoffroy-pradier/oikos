import { randomUUID } from 'node:crypto';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { createRateLimiter, createSharedRateLimiter } from './rate-limit';

// Limite de débit tenue en base, contre Supabase local. Chaque test compte sous une clé qui lui est propre.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const MINUTE = { limit: 5, windowMs: 60_000 };
const key = () => `${randomUUID()}:house.rename`;
const allowedOf = async (hits: ReturnType<ReturnType<typeof createSharedRateLimiter>['hit']>[]) =>
  (await Promise.all(hits)).filter((quota) => quota.allowed).length;

/** Les fenêtres d'une minute sont alignées sur l'horloge : on ne commence pas un test à cheval sur deux. */
async function awayFromMinuteEdge() {
  const left = 60_000 - (Date.now() % 60_000);
  if (left < 3000) await new Promise((resolve) => setTimeout(resolve, left + 50));
}

describe('limite de débit partagée', () => {
  it(
    'deux répliques comptent ensemble : le quota n’est pas doublé',
    { timeout: 15_000 },
    async () => {
      await awayFromMinuteEdge();
      // Deux répliques : deux compteurs, deux pools de connexions, la même base.
      const other = createDb(serviceRoleUrl(DATABASE_URL));
      try {
        const [first, second] = [
          createSharedRateLimiter(db, MINUTE),
          createSharedRateLimiter(other, MINUTE),
        ];
        const k = key();
        const outcomes = [];
        for (let n = 0; n < 12; n += 1) outcomes.push(await (n % 2 ? first : second).hit(k));
        expect(outcomes.map((quota) => quota.allowed)).toEqual([
          ...Array.from({ length: 5 }, () => true),
          ...Array.from({ length: 7 }, () => false),
        ]);
        // En rafale simultanée sur les deux répliques : toujours cinq, ni plus ni moins.
        const burst = key();
        expect(
          await allowedOf(
            Array.from({ length: 30 }, (_, n) => (n % 2 ? first : second).hit(burst)),
          ),
        ).toBe(5);
      } finally {
        await other.destroy();
      }
    },
  );

  it('compte séparément chaque clé, et indique quand réessayer', { timeout: 15_000 }, async () => {
    await awayFromMinuteEdge();
    const limiter = createSharedRateLimiter(db, { limit: 1, windowMs: 60_000 });
    const [mine, yours] = [key(), key()];
    expect(await limiter.hit(mine)).toEqual({ allowed: true });
    expect(await limiter.hit(yours)).toEqual({ allowed: true });
    const refused = await limiter.hit(mine);
    expect(refused.allowed).toBe(false);
    const wait = refused.allowed ? 0 : refused.retryAfterSeconds;
    // Le délai annoncé est ce qui reste de la minute en cours, à une seconde près.
    const left = Math.ceil((60_000 - (Date.now() % 60_000)) / 1000);
    expect(Math.abs(wait - left)).toBeLessThanOrEqual(1);
    // Insister ne coûte plus rien à la base : le refus suivant vient de la mémoire de la réplique.
    const countOf = async () =>
      Number(
        (
          await owner
            .selectFrom('telemetry.rate_windows')
            .select('count')
            .where('key', '=', mine)
            .executeTakeFirstOrThrow()
        ).count,
      );
    const counted = await countOf();
    for (let n = 0; n < 5; n += 1) expect((await limiter.hit(mine)).allowed).toBe(false);
    expect(await countOf()).toBe(counted);
    // Une autre réplique, elle, interroge la base : même refus.
    expect(
      (await createSharedRateLimiter(db, { limit: 1, windowMs: 60_000 }).hit(mine)).allowed,
    ).toBe(false);
    expect(await countOf()).toBe(counted + 1);
  });

  it('rouvre à la fenêtre suivante', async () => {
    const limiter = createSharedRateLimiter(db, { limit: 2, windowMs: 1000 });
    const k = key();
    // Départ au début d'une fenêtre, pour que les trois tentatives tombent dans la même.
    await new Promise((resolve) => setTimeout(resolve, 1000 - (Date.now() % 1000) + 30));
    expect(await allowedOf([limiter.hit(k), limiter.hit(k), limiter.hit(k)])).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(await limiter.hit(k)).toEqual({ allowed: true });
  });

  it('base injoignable : la réplique compte en mémoire, la limite tient toujours', async () => {
    const down = createDb('postgresql://postgres:postgres@127.0.0.1:1/absente');
    try {
      const limiter = createSharedRateLimiter(
        down,
        { limit: 2, windowMs: 60_000 },
        createRateLimiter({ limit: 2, windowMs: 60_000 }),
      );
      const k = key();
      const outcomes = [await limiter.hit(k), await limiter.hit(k), await limiter.hit(k)];
      expect(outcomes.map((quota) => quota.allowed)).toEqual([true, true, false]);
    } finally {
      await down.destroy();
    }
  });

  it('la purge retire les fenêtres closes depuis plus d’une heure, et elles seules', async () => {
    const [old, recent] = [key(), key()];
    await sql`insert into telemetry.rate_windows (key, window_start, count) values
      (${old}, now() - interval '2 hours', 3), (${recent}, now() - interval '10 minutes', 3)`.execute(
      owner,
    );
    const limiter = createSharedRateLimiter(db, MINUTE);
    await limiter.prune();
    const left = await owner
      .selectFrom('telemetry.rate_windows')
      .select('key')
      .where('key', 'in', [old, recent])
      .execute();
    expect(left).toEqual([{ key: recent }]);
    // Le service ne supprime pas lui-même : il n'a que la fonction de purge.
    await expect(sql`delete from telemetry.rate_windows`.execute(db)).rejects.toMatchObject({
      code: '42501',
    });
  });
});
