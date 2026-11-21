import type { NemesisModel, NemesisRules } from '@oikos/config';
import type { Db } from '@oikos/db';
import { nemesisMagnitudeBps, nemesisTake } from '@oikos/sim';
import { sql } from 'kysely';

/**
 * Ce qu'une sanction a pris, tel que l'écrit son présage : l'ampleur (incendie, procès), l'amende et son écriture, le
 * stock brûlé, son bien et sa quantité, l'atelier arrêté et l'instant de sa reprise, le voyage perdu ; nul s'il n'y a
 * rien à prendre. `apply` écrit ce qui suit l'issue du présage, que la base exige frappé.
 */
export interface Sanction {
  magnitudeBps: number | null;
  oboles: bigint | null;
  entryId: string | null;
  inventoryId: string | null;
  goodId: string | null;
  quantity: bigint | null;
  siteId: string | null;
  resumesAt: Date | null;
  voyageId: string | null;
  apply?: () => Promise<void>;
}
const NOTHING: Sanction = {
  magnitudeBps: null,
  oboles: null,
  entryId: null,
  inventoryId: null,
  goodId: null,
  quantity: null,
  siteId: null,
  resumesAt: null,
  voyageId: null,
};

export interface SanctionTarget {
  trx: Db;
  worldId: string;
  omen: { id: string; house_id: string; model: NemesisModel };
  /** Excès de la jauge au-delà du seuil, non nul. */
  excess: number;
  rules: NemesisRules;
  /** Compte du puits `sink_nemesis` du monde, verrouillé. */
  sinkId: string;
  /** Instant de jeu de la clôture, et celui de la clôture suivante, où un atelier déserté peut repartir. */
  closeAt: Date;
  nextCloseAt: Date;
}

/**
 * Un site que Némésis n'a pas fait déserter à la clôture du jour `gameDay` : l'entretien de cette clôture ne lui demande
 * rien et ne le relance pas, le marché du travail ne compte pas ses travailleurs (7.2, #735). Pour une requête sur
 * `game.sites`, sans alias.
 */
export const notDeserted = (gameDay: number) =>
  sql<boolean>`not exists (select 1 from game.nemesis_omens o where o.site_id = game.sites.id
    and o.outcome = 'struck' and o.settled_day = ${gameDay})`;

/**
 * Procès (7.2, #735) : une amende, part de la trésorerie de la maison (hors séquestre) d'une ampleur comprise entre les
 * bornes du modèle, versée au puits `sink_nemesis` par sa propre écriture `nemesis.fine`, qui nomme son présage. Une
 * amende nulle, trésorerie vide ou part arrondie à zéro, n'a pas d'écriture.
 */
async function lawsuit({ trx, worldId, omen, excess, rules, sinkId }: SanctionTarget) {
  if (!rules.models.lawsuit) return NOTHING;
  const magnitudeBps = nemesisMagnitudeBps(excess, rules.models.lawsuit, rules.fullExcess);
  const treasury = await trx
    .selectFrom('game.accounts')
    .select(['id', 'balance'])
    .where('house_id', '=', omen.house_id)
    .where('kind', '=', 'house')
    .forUpdate()
    .executeTakeFirst();
  const oboles = nemesisTake(BigInt(treasury?.balance ?? 0), magnitudeBps);
  if (!treasury || oboles === 0n) return { ...NOTHING, magnitudeBps, oboles: 0n };
  const entry = await trx
    .insertInto('game.ledger_entries')
    .values({
      world_id: worldId,
      kind: 'nemesis.fine',
      meta: JSON.stringify({ nemesisId: omen.id }),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('game.ledger_lines')
    .values([
      { entry_id: entry.id, account_id: treasury.id, amount: -Number(oboles) },
      { entry_id: entry.id, account_id: sinkId, amount: Number(oboles) },
    ])
    .execute();
  return { ...NOTHING, magnitudeBps, oboles, entryId: entry.id };
}

/**
 * Incendie d'entrepôt (7.2, #735) : une part, d'une ampleur comprise entre les bornes du modèle, du stock libre (hors
 * réservations des ventes ouvertes) le plus fourni de la maison, toutes cités confondues, part vers l'extrémité
 * `nemesis` du journal des stocks. Rien sans stock libre, ni pour une part arrondie à zéro.
 */
async function warehouseFire({ trx, worldId, omen, excess, rules }: SanctionTarget) {
  if (!rules.models.warehouse_fire) return NOTHING;
  const magnitudeBps = nemesisMagnitudeBps(excess, rules.models.warehouse_fire, rules.fullExcess);
  // Les sites de la maison d'abord, dans l'ordre de l'entretien : une récolte, qui verrouille son site puis ses stocks,
  // attendrait sinon le stock que tient la clôture pendant que l'entretien attend son site.
  await sql`select id from game.sites where house_id = ${omen.house_id} and closed_at is null
    order by created_at, id for update`.execute(trx);
  const { rows } = await sql<{ id: string; good_id: string; free: string }>`
    select id, good_id, (quantity - reserved)::text as free from game.inventories
    where house_id = ${omen.house_id} and quantity > reserved
    order by quantity - reserved desc, id limit 1 for update`.execute(trx);
  const stock = rows[0];
  const quantity = stock ? nemesisTake(BigInt(stock.free), magnitudeBps) : 0n;
  if (!stock || quantity === 0n) return { ...NOTHING, magnitudeBps, quantity: 0n };
  const apply = async () => {
    await trx
      .insertInto('game.stock_ledger')
      .values({
        world_id: worldId,
        good_id: stock.good_id,
        quantity: Number(quantity),
        from_inventory_id: stock.id,
        to_system: 'nemesis',
        kind: 'nemesis.fire',
        nemesis_id: omen.id,
      })
      .execute();
  };
  return {
    ...NOTHING,
    magnitudeBps,
    inventoryId: stock.id,
    goodId: stock.good_id,
    quantity,
    apply,
  };
}

/**
 * Artisan qui déserte (7.2, #735) : le plus ancien atelier en marche de la maison, ouvert avant l'instant de la clôture,
 * s'arrête ; il ne doit rien à l'entretien de cette clôture et ne repart pas avant l'instant de la suivante (garde de la
 * base), qui le relance s'il est payé. Rien sans atelier en marche.
 */
async function artisanDesertion({ trx, omen, closeAt, nextCloseAt }: SanctionTarget) {
  const site = await trx
    .selectFrom('game.sites')
    .select('id')
    .where('house_id', '=', omen.house_id)
    .where('created_at', '<', closeAt)
    .where('closed_at', 'is', null)
    .where('halted_at', 'is', null)
    .orderBy('created_at')
    .orderBy('id')
    .limit(1)
    .forUpdate()
    .executeTakeFirst();
  if (!site) return NOTHING;
  // Daté comme un arrêt de l'entretien : une récolte validée pendant la clôture a pu avancer le cycle au-delà de lui.
  const apply = async () => {
    await trx
      .updateTable('game.sites')
      .set({ halted_at: sql<Date>`greatest(now(), cycle_started_at)` })
      .where('id', '=', site.id)
      .execute();
  };
  return { ...NOTHING, siteId: site.id, resumesAt: nextCloseAt, apply };
}

/** Ce que prend la sanction d'un présage qui frappe, selon son modèle. */
export function takeSanction(target: SanctionTarget): Promise<Sanction> {
  switch (target.omen.model) {
    case 'lawsuit':
      return lawsuit(target);
    case 'warehouse_fire':
      return warehouseFire(target);
    case 'artisan_desertion':
      return artisanDesertion(target);
    default:
      throw new Error(`Nemesis model ${target.omen.model} is not drawn yet`);
  }
}
