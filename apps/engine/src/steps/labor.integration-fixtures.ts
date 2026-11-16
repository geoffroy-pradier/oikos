import { randomUUID } from 'node:crypto';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';

/**
 * Monde d'essai du marché du travail (#258), posé par le propriétaire de la base, gardes levées le temps
 * d'antidater : des cités, des maisons dotées de leurs oboles, leurs sites créés il y a dix jours dans
 * l'ordre donné (toutes maisons confondues), leurs biens achetés il y a dix jours, les baux en cours et la
 * population des classes nommées. Les baux sont signés à l'instant de l'essai.
 */
export interface LaborWorldSpec {
  cities?: string[];
  houses: {
    oboles: number;
    sites: { city: string; recipe: string }[];
    properties?: { city: string; size: string; condition?: number; unpaid?: boolean }[];
  }[];
  /** Bien `property` de la maison `landlord`, loué à la maison `tenant` (indices). */
  leases?: { landlord: number; property: number; tenant: number; rent?: number }[];
  population?: Record<string, Record<string, number>>;
  /** Identifiants des maisons, dans l'ordre de `houses` (aléatoires par défaut) : l'ordre de la clôture. */
  houseIds?: string[];
}

export async function laborWorld(owner: Db, spec: LaborWorldSpec) {
  const worldId = randomUUID();
  const slugs = spec.cities ?? ['kalliste'];
  const cityIds = Object.fromEntries(slugs.map((slug) => [slug, randomUUID()]));
  const houses = spec.houses.map((_, index) => ({
    houseId: spec.houseIds?.[index] ?? randomUUID(),
    siteIds: [] as string[],
    propertyIds: [] as string[],
  }));
  let rank = 0;
  let lot = 0;
  await owner.transaction().execute(async (trx) => {
    await sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`t-${worldId.slice(0, 12)}`}, 'Test')`.execute(
      trx,
    );
    for (const slug of slugs)
      await sql`insert into game.cities (id, world_id, slug, name) values (${cityIds[slug]}, ${worldId}, ${slug}, ${slug})`.execute(
        trx,
      );
    for (const [slug, classes] of Object.entries(spec.population ?? {}))
      for (const [classId, population] of Object.entries(classes))
        await sql`insert into game.npc_population (world_id, city_id, class_id, population)
          values (${worldId}, ${cityIds[slug]}, ${classId}, ${population})`.execute(trx);
    for (const { houseId } of houses)
      await sql`with player as (insert into auth.users (id, email) values (${houseId}, ${`${houseId}@example.test`})),
        house as (insert into game.houses (id, world_id, user_id, name, blazon)
          values (${houseId}, ${worldId}, ${houseId}, ${`Maison ${houseId.replace(/[^a-f]/g, '').slice(0, 10)}`}, '{}'))
        insert into game.accounts (world_id, kind, house_id) values (${worldId}, 'house', ${houseId})`.execute(
        trx,
      );
  });
  // Les biens naissent à la cité, gardes en place ; une transaction à part les donne à leur maison, garde
  // levée : une table dont un contrôle différé attend la validation ne se modifie pas.
  const owned: { houseId: string; id: string; condition: number; unpaid: boolean }[] = [];
  await owner.transaction().execute(async (trx) => {
    for (const [index, house] of spec.houses.entries())
      for (const property of house.properties ?? []) {
        lot += 1;
        const { rows } = await sql<{
          id: string;
        }>`insert into game.properties (world_id, city_id, size_id, lot)
          values (${worldId}, ${cityIds[property.city]}, ${property.size}, ${lot}) returning id`.execute(
          trx,
        );
        const target = houses[index];
        const id = rows[0]?.id ?? '';
        target?.propertyIds.push(id);
        owned.push({
          houseId: target?.houseId ?? '',
          id,
          condition: property.condition ?? 10_000,
          unpaid: property.unpaid ?? false,
        });
      }
  });
  await owner.transaction().execute(async (trx) => {
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`alter table game.properties disable trigger properties_guard`.execute(trx);
    for (const [index, house] of spec.houses.entries())
      for (const site of house.sites) {
        rank += 1;
        const { rows } = await sql<{ id: string }>`insert into game.sites
            (world_id, house_id, city_id, recipe_id, created_at, cycle_started_at)
          values (${worldId}, ${houses[index]?.houseId}, ${cityIds[site.city]}, ${site.recipe},
            now() - interval '10 days' + ${rank} * interval '1 minute', now() - interval '9 days')
          returning id`.execute(trx);
        houses[index]?.siteIds.push(rows[0]?.id ?? '');
      }
    for (const [rank, property] of owned.entries())
      await sql`update game.properties set owner_house_id = ${property.houseId},
          acquired_at = now() - interval '10 days' + ${rank} * interval '1 minute', condition = ${property.condition},
          upkeep_unpaid_since = case when ${property.unpaid} then now() - interval '1 day' end
        where id = ${property.id}`.execute(trx);
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
    await sql`alter table game.properties enable trigger properties_guard`.execute(trx);
  });
  // Les baux, signés maintenant par le chemin des commandes : une offre de location, le bail, l'offre close.
  await owner.transaction().execute(async (trx) => {
    for (const lease of spec.leases ?? []) {
      const landlord = houses[lease.landlord]?.houseId;
      const propertyId = houses[lease.landlord]?.propertyIds[lease.property];
      const rent = lease.rent ?? 1;
      const { rows } = await sql<{
        id: string;
      }>`insert into game.property_listings (world_id, property_id, house_id, kind, price_oboles)
        values (${worldId}, ${propertyId}, ${landlord}, 'lease', ${rent}) returning id`.execute(
        trx,
      );
      const listingId = rows[0]?.id ?? '';
      await sql`insert into game.leases (world_id, property_id, listing_id, landlord_house_id, tenant_house_id, rent_oboles)
        values (${worldId}, ${propertyId}, ${listingId}, ${landlord}, ${houses[lease.tenant]?.houseId}, ${rent})`.execute(
        trx,
      );
      await sql`update game.property_listings set outcome = 'leased' where id = ${listingId}`.execute(
        trx,
      );
    }
  });
  for (const [index, house] of spec.houses.entries())
    if (house.oboles > 0)
      await sql`with entry as (insert into game.ledger_entries (world_id, kind) values (${worldId}, 'test.seed') returning id)
        insert into game.ledger_lines (entry_id, account_id, amount)
        select entry.id, a.id, case when a.kind = 'house' then ${house.oboles}::bigint else -${house.oboles}::bigint end
        from entry, game.accounts a
        where a.world_id = ${worldId}
          and ((a.kind = 'house' and a.house_id = ${houses[index]?.houseId}) or a.system_key = 'faucet_starting_grant')`.execute(
        owner,
      );
  return { worldId, cityIds, houses };
}
export type LaborWorld = Awaited<ReturnType<typeof laborWorld>>;

/** Marché du travail enregistré pour une cité du monde, par jour de jeu croissant. */
export async function laborMarketOf(db: Db, cityId: string) {
  const rows = await db
    .selectFrom('game.labor_market')
    .select(['game_day', 'supply', 'employed', 'unhoused', 'wage_oboles', 'lodging_oboles'])
    .where('city_id', '=', cityId)
    .orderBy('game_day')
    .execute();
  return rows.map((row) => ({
    gameDay: row.game_day,
    supply: row.supply === null ? null : Number(row.supply),
    employed: Number(row.employed),
    unhoused: Number(row.unhoused),
    wage: Number(row.wage_oboles),
    lodging: Number(row.lodging_oboles),
  }));
}
