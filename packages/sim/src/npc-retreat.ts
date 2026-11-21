/**
 * Retrait des maisons PNJ de secours devant les joueurs (docs/specs/08-ia.md, 8.3 ; #717), sans entrée-sortie.
 * À chaque clôture, la part des maisons de joueurs dans les ventes du bien d'une filière, sur une fenêtre de clôtures, se
 * compare à deux seuils : au-dessus du seuil haut depuis assez de clôtures, la maison PNJ ferme un site ; sous le seuil
 * bas, elle en rouvre un, dans la limite de sa filière. Entre les deux, elle ne bouge pas.
 */

/** Réglages du retrait (`npcRetreat` de la configuration) : seuils en points de base, fenêtre et durée en clôtures. */
export interface NpcRetreatSettings {
  highShareBps: number;
  lowShareBps: number;
  windowDays: number;
  days: number;
}

/** Unités du bien de la filière vendues à l'agora de la cité entre deux clôtures : par les joueurs, et en tout. */
export interface NpcSales {
  playerUnits: number;
  totalUnits: number;
}

/** Mémoire du retrait d'une maison PNJ : les ventes des dernières clôtures (la plus récente en dernier), et la série. */
export interface NpcRetreatState {
  window: NpcSales[];
  /** Clôtures de suite où la part des joueurs a dépassé le seuil haut. */
  aboveDays: number;
}

export const NPC_RETREAT_START: NpcRetreatState = { window: [], aboveDays: 0 };

/** `retreat` : fermer un site ; `return` : en rouvrir un ; `hold` : rien. */
export type NpcRetreatMove = 'retreat' | 'return' | 'hold';

/**
 * Part des joueurs dans des ventes, en points de base, arrondie à l'inférieur ; 0 sans aucune vente (personne ne tient
 * le marché, la maison PNJ doit le tenir). Calcul exact en entiers, quelles que soient les quantités.
 */
export function playerShareBps(sales: readonly NpcSales[]): number {
  let player = 0n;
  let total = 0n;
  for (const day of sales) {
    const dayTotal = BigInt(Math.max(0, Math.trunc(day.totalUnits)));
    player += BigInt(Math.min(Math.max(0, Math.trunc(day.playerUnits)), Number(dayTotal)));
    total += dayTotal;
  }
  return total === 0n ? 0 : Number((player * 10_000n) / total);
}

/**
 * Une clôture du retrait : ajoute ses ventes à la fenêtre (gardée à `windowDays` clôtures), calcule la part des joueurs
 * et décide d'au plus un site. Fermer demande une part au-dessus du seuil haut (strictement) depuis `days` clôtures de
 * suite, comptée celle-ci, et un site ouvert ; rouvrir, une part sous le seuil bas (strictement) et moins de sites
 * ouverts que la filière n'en donne. Chaque clôture où la part reste au-dessus du seuil haut, au-delà de `days`, ferme
 * un site de plus. Les réglages viennent d'une configuration validée : seuil bas sous le seuil haut, durées d'au moins
 * une clôture.
 */
export function npcHouseRetreat(
  settings: NpcRetreatSettings,
  state: NpcRetreatState,
  today: NpcSales,
  sites: { open: number; max: number },
): { state: NpcRetreatState; move: NpcRetreatMove; shareBps: number } {
  const window = [...state.window, today].slice(-Math.max(1, settings.windowDays));
  const shareBps = playerShareBps(window);
  const aboveDays = shareBps > settings.highShareBps ? state.aboveDays + 1 : 0;
  const move: NpcRetreatMove =
    aboveDays >= settings.days && sites.open > 0
      ? 'retreat'
      : shareBps < settings.lowShareBps && sites.open < sites.max
        ? 'return'
        : 'hold';
  return { state: { window, aboveDays }, move, shareBps };
}
