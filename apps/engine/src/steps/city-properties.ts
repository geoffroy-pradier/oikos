import { sql } from 'kysely';
import type { TickStep } from '../tick';

/**
 * Parc de logements des cités (docs/specs/04-systemes-gestion.md, 4.5). Comme la population (5.2), le
 * parc d'une cité naît au premier tick qui la connaît : pour chaque taille, les biens numérotés de 1 au
 * nombre de la configuration (`properties.countsByCity`) qui manquent naissent neufs, détenus par la cité.
 * Un nombre relevé complète le parc au tick suivant ; un nombre baissé, une taille ou une cité retirées
 * ne retirent rien. Le numéro est unique par cité et par taille : deux moteurs ne créent pas deux fois le
 * même bien, et rejouer un tick ne crée rien de plus. Un parc complet ne coûte qu'une lecture par tick.
 */
export const cityProperties: TickStep = {
  name: 'cityProperties',
  async run({ trx, worldId, config }) {
    const sizes = new Set(config.properties.sizes.map((size) => size.id));
    const counts = config.properties.countsByCity;
    const cities = await trx
      .selectFrom('game.cities')
      .select(['id', 'slug'])
      .where('world_id', '=', worldId)
      .orderBy('slug')
      .execute();
    const wanted = cities.flatMap((city) =>
      Object.entries(Object.hasOwn(counts, city.slug) ? (counts[city.slug] ?? {}) : {})
        .filter(([sizeId, count]) => sizes.has(sizeId) && count > 0)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([sizeId, count]) => ({ city, sizeId, count })),
    );
    if (wanted.length === 0) return { built: [] };
    const held = await trx
      .selectFrom('game.properties')
      .select(['city_id', 'size_id', sql<number>`count(*)::integer`.as('properties')])
      .where('world_id', '=', worldId)
      .groupBy(['city_id', 'size_id'])
      .execute();
    const heldOf = (cityId: string, sizeId: string) =>
      held.find((row) => row.city_id === cityId && row.size_id === sizeId)?.properties ?? 0;

    const built: { city: string; sizeId: string; properties: number }[] = [];
    for (const { city, sizeId, count } of wanted) {
      if (heldOf(city.id, sizeId) >= count) continue;
      const created = await sql<{ id: string }>`
        insert into game.properties (world_id, city_id, size_id, lot)
        select ${worldId}, ${city.id}, ${sizeId}, g.lot from generate_series(1, ${count}::integer) g (lot)
        where not exists (select 1 from game.properties p
                          where p.city_id = ${city.id} and p.size_id = ${sizeId} and p.lot = g.lot)
        order by g.lot
        on conflict do nothing
        returning id`.execute(trx);
      if (created.rows.length > 0)
        built.push({ city: city.slug, sizeId, properties: created.rows.length });
    }
    return { built };
  },
};
