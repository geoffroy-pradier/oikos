import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { TEST_CONFIG } from './test-config';
import { owner, send, type App, type Reply } from './voyage.integration-fixtures';

/**
 * Jeux d'essai des tests d'intégration des décrets, contre Supabase local : chaque test a son monde, avec
 * Kallistè et Elaia, et l'archonte de Kallistè en charge.
 */
export { appWithConfig, db, owner } from './voyage.integration-fixtures';
export const DECREES = (() => {
  const decrees = TEST_CONFIG.config.decrees;
  if (!decrees) throw new Error('decrees expected in the test configuration');
  return decrees;
})();
const letters = () => [...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('');
export const code = (reply: Reply) => reply.body.error?.code ?? 'ok';
export const rows = async <T>(query: ReturnType<typeof sql<T>>) =>
  (await query.execute(owner)).rows;
export const TAX = { model: 'market_tax_rate', params: { rateBps: 600 } };
export const works = (amountOboles: number) => ({
  model: 'public_works',
  params: { amountOboles },
});

/** Un monde à deux cités ; l'archonte de Kallistè est en charge (élection et charge posées, gardes levées). */
export async function newWorld() {
  const [worldId, kalliste, elaia] = [randomUUID(), randomUUID(), randomUUID()];
  await sql`with world as (insert into game.worlds (id, slug, name) values (${worldId}, ${`d-${worldId.slice(0, 12)}`}, 'Test'))
    insert into game.cities (id, world_id, slug, name) values (${kalliste}, ${worldId}, 'kalliste', 'K'), (${elaia}, ${worldId}, 'elaia', 'E')`.execute(
    owner,
  );
  const player = async (cityId = kalliste, citizen = true) => {
    const user = randomUUID();
    await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
      owner,
    );
    const founded = await send(user, 'house.create', {
      cityId,
      name: `Nomothetai ${letters()}`,
      blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
    });
    const houseId = founded.body.data.houseId as string;
    if (citizen)
      await sql`update game.citizenships set status = 'citizen', since = now() where house_id = ${houseId}`.execute(
        owner,
      );
    return { user, houseId };
  };
  /** Charge d'archonte de Kallistè pour la maison, en cours ou finie depuis un jour. */
  const archon = (houseId: string, ended = false) =>
    owner.transaction().execute(async (trx) => {
      await sql`alter table game.elections disable trigger elections_guard`.execute(trx);
      await sql`alter table game.offices disable trigger offices_guard`.execute(trx);
      const end = ended ? sql`now() - interval '1 day'` : sql`now() + interval '27 days'`;
      await sql`with e as (insert into game.elections (world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at, tallied_at)
          values (${worldId}, ${kalliste}, 'archon', now() - interval '40 days', now() - interval '35 days', now() - interval '30 days', ${end}, now())
          returning *)
        insert into game.offices (world_id, city_id, office, house_id, election_id, starts_at, ends_at)
        select world_id, city_id, office, ${houseId}, id, voting_closes_at, term_ends_at from e`.execute(
        trx,
      );
      await sql`alter table game.elections enable trigger elections_guard`.execute(trx);
      await sql`alter table game.offices enable trigger offices_guard`.execute(trx);
    });
  /** Crédite le trésor de Kallistè, depuis un robinet. */
  const fund = (oboles: number) =>
    owner.transaction().execute(async (trx) => {
      const [entry] = (
        await sql<{
          id: string;
        }>`insert into game.ledger_entries (world_id, kind) values (${worldId}, 'test.fund') returning id`.execute(
          trx,
        )
      ).rows;
      await sql`insert into game.ledger_lines (entry_id, account_id, amount)
        select ${entry?.id}, id, case when kind = 'treasury' then ${oboles}::bigint else -${oboles}::bigint end
        from game.accounts where world_id = ${worldId}
          and (system_key = 'faucet_npc_purchases' or (kind = 'treasury' and not npc_purse and bank_id is null and city_id = ${kalliste}))`.execute(
        trx,
      );
    });
  const alice = await player();
  await archon(alice.houseId);
  return { worldId, kalliste, elaia, player, archon, fund, alice };
}
export const propose = (user: string, decree: unknown, key?: string, on?: App) =>
  send(user, 'city.proposeDecree', decree, key, on);
export const eventsOf = (type: string, decreeId: string) =>
  rows(sql<{ payload: Record<string, unknown> }>`select payload from game.domain_events
    where type = ${type} and payload->>'decreeId' = ${decreeId} order by seq`).then((found) =>
    found.map((row) => row.payload),
  );
