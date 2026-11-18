import { voyageArrivedSchema } from '@oikos/contracts';
import { sql } from 'kysely';
import type { TickStep } from '../tick';

/** Ordre des unités de code, celui du classement "C" de la base pour des identifiants ASCII. */
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Arrivée des voyages (4.6, #253). Chaque voyage du monde échu à l'instant du tick est déchargé, daté de cet
 * instant : sa cargaison passe de `in_transit` au stock de sa maison dans la cité d'arrivée (ouvert s'il
 * manque), son navire y est à quai, un événement `VoyageArrived` l'annonce. Échu pendant une panne, il l'est
 * par le premier tick, rattrapé ou non, qui commence à son échéance ou après. Seuls les voyages échus sont
 * lus (`voyages_due_idx`), les listes passent en tableaux (aucune limite de paramètres), ni horloge ni hasard.
 * Tous sont déchargés dans la seule transaction du tick : une erreur sur l'un d'eux fait échouer tout le tick
 * du monde, demande des PNJ comprise (échec à la télémétrie, compté par la Vigie, tick repris au passage
 * suivant).
 * Ordre des verrous, celui du départ et de la clôture : l'agora du monde, les voyages, les stocks d'arrivée
 * (par maison, cité et bien), les navires. Un voyage verrouillé ailleurs est laissé au tick suivant (`SKIP
 * LOCKED`) ; la base refuse de toute façon un second déchargement (index uniques, arrivée écrite une fois).
 * Interblocage possible avec une récolte, qui ne prend pas le verrou d'agora : la demande des PNJ, plus tôt
 * dans le tick, a pu verrouiller un stock vendu (maison H, cité C, blé) avant un stock d'arrivée (H, C,
 * farine) qu'une récolte de H à C tient en attendant le blé. PostgreSQL annule l'une des deux en entier, sans
 * double effet : un tick annulé est repris au passage suivant (aucun nouvel essai dans le moteur), une récolte
 * annulée est rejouée par le registre des commandes de l'API, sous la même clé (#333).
 */
export const voyageArrivals: TickStep = {
  name: 'voyageArrivals',
  async run({ trx, worldId, scheduledAt }) {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${worldId}`}, 0))`.execute(
      trx,
    );
    const due = await trx
      .selectFrom('game.voyages')
      .select(['id', 'house_id', 'ship_id', 'from_city_id', 'to_city_id', 'arrives_at'])
      .where('world_id', '=', worldId)
      .where('arrived_at', 'is', null)
      .where('arrives_at', '<=', scheduledAt)
      .orderBy('arrives_at')
      .orderBy('id')
      .forUpdate()
      .skipLocked()
      .execute();
    if (due.length === 0) return { voyages: 0, units: 0 };
    const ids = due.map((voyage) => voyage.id);

    // Cargaison, dans l'ordre des stocks d'arrivée (maison, cité, bien), celui d'une récolte pour une
    // maison et une cité ; le tick peut pourtant s'interbloquer avec une récolte (voir plus haut).
    const { rows } = await sql<{
      voyage_id: string;
      house_id: string;
      city_id: string;
      good_id: string;
      quantity: string;
    }>`select c.voyage_id, v.house_id, v.to_city_id as city_id, c.good_id, c.quantity
      from game.voyage_cargo c join game.voyages v on v.id = c.voyage_id
      where c.voyage_id = any(${ids}::uuid[])`.execute(trx);
    const placeOf = (line: { house_id: string; city_id: string; good_id: string }) =>
      `${line.house_id}|${line.city_id}|${line.good_id}`;
    const unload = rows
      .map((line) => ({ ...line, quantity: Number(line.quantity) }))
      .sort(
        (a, b) =>
          byCodeUnit(a.house_id, b.house_id) ||
          byCodeUnit(a.city_id, b.city_id) ||
          byCodeUnit(a.good_id, b.good_id),
      );
    const column = (key: 'house_id' | 'city_id' | 'good_id') => unload.map((line) => line[key]);
    // Stocks d'arrivée : ouverts s'ils manquent, puis verrouillés dans cet ordre.
    await sql`insert into game.inventories (world_id, house_id, city_id, good_id)
      select ${worldId}, p.house_id, p.city_id, p.good_id
      from unnest(${column('house_id')}::uuid[], ${column('city_id')}::uuid[], ${column('good_id')}::text[])
        with ordinality as p (house_id, city_id, good_id, rank)
      order by p.rank
      on conflict on constraint inventories_unique do nothing`.execute(trx);
    const { rows: stocks } = await sql<{
      id: string;
      house_id: string;
      city_id: string;
      good_id: string;
    }>`select i.id, i.house_id, i.city_id, i.good_id from game.inventories i
      where (i.house_id, i.city_id, i.good_id) in (select * from
        unnest(${column('house_id')}::uuid[], ${column('city_id')}::uuid[], ${column('good_id')}::text[]))
      order by i.house_id, i.city_id, i.good_id collate "C"
      for update`.execute(trx);
    const stockOf = new Map(stocks.map((stock) => [placeOf(stock), stock.id]));

    // L'arrivée d'abord : la base ne laisse décharger qu'un voyage arrivé, et accoster qu'un navire arrivé.
    await trx
      .updateTable('game.voyages')
      .set({ arrived_at: scheduledAt })
      .where('id', '=', sql<string>`any(${ids}::uuid[])`)
      .execute();
    await sql`update game.ships s set docked_city_id = v.to_city_id
      from game.voyages v where v.id = any(${ids}::uuid[]) and s.id = v.ship_id`.execute(trx);
    await sql`insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind, voyage_id)
      select ${worldId}, m.good_id, m.quantity, 'in_transit', m.stock, 'voyage.arrival', m.voyage
      from unnest(${column('good_id')}::text[], ${unload.map((line) => line.quantity)}::bigint[],
                  ${unload.map((line) => stockOf.get(placeOf(line)))}::uuid[], ${unload.map((line) => line.voyage_id)}::uuid[])
        as m (good_id, quantity, stock, voyage)`.execute(trx);

    const payloads = due.map(
      (voyage) =>
        voyageArrivedSchema.parse({
          type: 'VoyageArrived',
          payload: {
            voyageId: voyage.id,
            shipId: voyage.ship_id,
            houseId: voyage.house_id,
            fromCityId: voyage.from_city_id,
            toCityId: voyage.to_city_id,
            arrivesAt: voyage.arrives_at.toISOString(),
            arrivedAt: scheduledAt.toISOString(),
            cargo: unload
              .filter((line) => line.voyage_id === voyage.id)
              .map((line) => ({ goodId: line.good_id, quantity: line.quantity })),
          },
        }).payload,
    );
    await sql`insert into game.domain_events (command_id, type, payload)
      select null, 'VoyageArrived', e.payload::jsonb
      from unnest(${payloads.map((payload) => JSON.stringify(payload))}::text[]) with ordinality as e (payload, rank)
      order by e.rank`.execute(trx);
    return {
      voyages: due.length,
      units: unload.reduce((sum, line) => sum + line.quantity, 0),
    };
  },
};
