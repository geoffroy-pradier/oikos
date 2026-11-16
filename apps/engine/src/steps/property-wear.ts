import { wornCondition } from '@oikos/sim';
import { sql } from 'kysely';
import type { CloseStep } from '../close';

/**
 * Vétusté des biens immobiliers (docs/specs/04-systemes-gestion.md, 4.5), juste avant l'entretien :
 * chaque bien du monde, à la cité comme à une maison, perd la vétusté du jour de sa taille, sans passer
 * sous zéro (`wornCondition`). Une vétusté nulle, une taille retirée de la configuration ou un bien déjà
 * à zéro ne changent rien. La base n'accepte qu'une usure par bien et par jour de jeu, dans la transaction
 * qui enregistre la clôture de ce jour : une clôture rejouée n'use pas deux fois.
 */
export const propertyWear: CloseStep = {
  name: 'propertyWear',
  async run({ trx, worldId, gameDay, config }) {
    const wearOf = new Map(config.properties.sizes.map((size) => [size.id, size.dailyWear]));
    const wearing = [...wearOf].filter(([, wear]) => wear > 0).map(([sizeId]) => sizeId);
    if (wearing.length === 0) return { worn: 0 };
    // Le verrou des appariements du monde d'abord, comme l'entretien qui suit et comme l'achat et la
    // rénovation d'un bien : les biens sont verrouillés ici sous lui, jamais avant lui.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${worldId}`}, 0))`.execute(
      trx,
    );
    const properties = await trx
      .selectFrom('game.properties')
      .select(['id', 'size_id', 'condition'])
      .where('world_id', '=', worldId)
      .where('size_id', 'in', wearing)
      .where('condition', '>', 0)
      .orderBy('id')
      .forUpdate()
      .execute();
    const worn = properties.map((property) => ({
      id: property.id,
      condition: wornCondition(property.condition, wearOf.get(property.size_id) ?? 0),
    }));
    if (worn.length > 0)
      await sql`update game.properties p set condition = w.condition, worn_day = ${gameDay}
        from unnest(${worn.map((row) => row.id)}::uuid[], ${worn.map((row) => row.condition)}::integer[])
          as w (id, condition)
        where p.id = w.id`.execute(trx);
    return { worn: worn.length };
  },
};
