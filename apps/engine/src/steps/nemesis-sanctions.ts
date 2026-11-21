import type { NemesisModel, NemesisRules } from '@oikos/config';
import type { Db } from '@oikos/db';
import { nemesisMagnitudeBps, nemesisTake } from '@oikos/sim';

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
}

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

/** Ce que prend la sanction d'un présage qui frappe, selon son modèle. */
export function takeSanction(target: SanctionTarget): Promise<Sanction> {
  switch (target.omen.model) {
    case 'lawsuit':
      return lawsuit(target);
    default:
      throw new Error(`Nemesis model ${target.omen.model} is not drawn yet`);
  }
}
