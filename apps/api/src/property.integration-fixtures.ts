import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { expect } from 'vitest';
import { TEST_CONFIG } from './test-config';
import { appWithConfig, db, owner, send, type App } from './voyage.integration-fixtures';

/**
 * Jeux d'essai des tests d'intégration de l'immobilier, contre Supabase local : des maisons fondées par la
 * commande et des biens neufs du parc d'une cité, posés comme par le moteur.
 */
export { db, give, owner, send, KALLISTE, ELAIA } from './voyage.integration-fixtures';
export const GRANT = TEST_CONFIG.config.starting.grantOboles;
export const sizeOf = (id: string) => {
  const found = TEST_CONFIG.config.properties.sizes.find((size) => size.id === id);
  if (!found) throw new Error(`property size ${id} missing from the test configuration`);
  return found;
};
type Size = ReturnType<typeof sizeOf>;

/** La configuration de test, avec la taille `id` modifiée par `patch`, ou sans aucune taille. */
export const withSize = (id: string, patch: Partial<Size> | 'retired'): App =>
  appWithConfig((config) => {
    const sizes =
      patch === 'retired'
        ? []
        : config.properties.sizes.map((size) => (size.id === id ? { ...size, ...patch } : size));
    return { ...config, properties: { ...config.properties, sizes } };
  });

/** Une maison fondée par la commande dans la cité donnée : sa dotation et son premier site. */
export async function newPlayer(cityId: string) {
  const user = randomUUID();
  await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
    owner,
  );
  const name = `Bâtisseurs ${[...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('')}`;
  const blazon = { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' };
  const founded = await send(user, 'house.create', { cityId, name, blazon });
  expect(founded.status).toBe(200);
  return { user, houseId: founded.body.data.houseId as string };
}

/**
 * Un bien neuf du parc de la cité, détenu par elle, sous un numéro libre tiré au hasard : deux poses à la
 * fois, ou une base réutilisée d'un passage à l'autre, ne se disputent pas le même. Une collision est
 * reprise ; un parc plein (10 000 numéros de cette taille dans la cité) est une erreur du jeu d'essai.
 */
export async function newProperty(cityId: string, sizeId = 'townhouse') {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { rows } = await sql<{
      id: string;
    }>`insert into game.properties (world_id, city_id, size_id, lot)
      select c.world_id, c.id, ${sizeId}, free.lot from game.cities c, lateral (
        select n as lot from generate_series(1, 10000) n where not exists (select 1 from game.properties p
          where p.city_id = c.id and p.size_id = ${sizeId} and p.lot = n) order by random() limit 1) free
      where c.id = ${cityId} on conflict do nothing returning id`.execute(owner);
    if (rows[0]) return rows[0].id;
  }
  throw new Error(`No free lot for a ${sizeId} in city ${cityId}`);
}

export const buy = (user: string, id: string, price: number, key?: string, via?: App) =>
  send(user, 'property.buy', { propertyId: id, expectedPriceOboles: price }, key, via);

/** Le bien ; `acquired_with_entry` : son instant d'achat est celui de son écriture d'achat. */
export const propertyOf = async (id: string) =>
  (
    await sql<{ owner_house_id: string | null; condition: number; acquired_with_entry: boolean }>`
      select owner_house_id, condition, acquired_at = (select max(created_at) from game.ledger_entries e
        where e.kind = 'property.buy' and e.meta->>'propertyId' = p.id::text) as acquired_with_entry
      from game.properties p where p.id = ${id}`.execute(db)
  ).rows[0];

/** Solde de la trésorerie d'une maison, ou d'un compte système du monde de test. */
export const balanceOf = async (houseIdOrKey: string) =>
  Number(
    (
      await sql<{ balance: string }>`select balance from game.accounts
        where (kind = 'house' and house_id::text = ${houseIdOrKey})
           or (world_id = '01900000-0000-7000-8000-000000000001' and system_key = ${houseIdOrKey})`.execute(
        db,
      )
    ).rows[0]?.balance,
  );

export const eventsOf = async (houseId: string, type: string) =>
  (
    await sql<{ payload: Record<string, unknown> }>`select payload from game.domain_events
      where type = ${type} and payload->>'houseId' = ${houseId} order by seq`.execute(db)
  ).rows.map((event) => event.payload);

/** Lignes des écritures `kind` du bien : compte (clé système, ou `house`) et montant, du débit au crédit. */
export const linesOf = async (kind: string, propertyId: string) =>
  (
    await sql<{ key: string; amount: string }>`
      select coalesce(a.system_key, a.kind) as key, l.amount from game.ledger_lines l
      join game.ledger_entries e on e.id = l.entry_id join game.accounts a on a.id = l.account_id
      where e.kind = ${kind} and e.meta->>'propertyId' = ${propertyId} order by l.amount`.execute(
      owner,
    )
  ).rows.map((row) => ({ key: row.key, amount: Number(row.amount) }));

/** Une maison fondée par la commande, propriétaire d'un bien neuf qu'elle a acheté à la cité. */
export async function newOwner(cityId: string, sizeId = 'townhouse') {
  const player = await newPlayer(cityId);
  const propertyId = await newProperty(cityId, sizeId);
  const bought = await buy(player.user, propertyId, sizeOf(sizeId).purchasePriceOboles);
  expect(bought.status).toBe(200);
  return { ...player, propertyId };
}

/** Les offres du bien, des plus anciennes aux plus récentes. */
export const listingsOf = async (propertyId: string) =>
  (
    await sql<{ house_id: string; kind: string; price: string; outcome: string | null }>`
      select house_id, kind, price_oboles as price, outcome from game.property_listings
      where property_id = ${propertyId} order by created_at, id`.execute(db)
  ).rows.map((row) => ({ ...row, price: Number(row.price) }));
