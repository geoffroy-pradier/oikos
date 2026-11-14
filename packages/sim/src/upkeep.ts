import { shareRoundedUp } from './tax';

/**
 * Entretien quotidien des sites (docs/specs/05-economie.md, 5.5) : calcul pur, en oboles entières.
 * La clôture quotidienne s'en sert pour savoir ce qu'une maison doit et ce qu'elle peut payer.
 */
/**
 * Entretien dû par un site pour un jour de jeu : ⌈base × coefficient ÷ 10 000⌉. Arrondi à l'obole
 * supérieure, jamais en faveur de la monnaie en circulation ; une base ou un coefficient nuls ne
 * doivent rien.
 */
export function dailyUpkeep(baseOboles: number, coefficientBps: number): number {
  if (!Number.isSafeInteger(baseOboles) || baseOboles < 0)
    throw new RangeError('baseOboles must be a non-negative integer');
  // La borne de jeu du coefficient appartient au schéma de configuration, seule source ; au-delà des
  // entiers sûrs, `shareRoundedUp` refuse le calcul.
  if (!Number.isSafeInteger(coefficientBps) || coefficientBps < 0)
    throw new RangeError('coefficientBps must be a non-negative integer');
  return shareRoundedUp(baseOboles, coefficientBps);
}

export interface UpkeepDue {
  siteId: string;
  oboles: number;
}

export interface UpkeepSettlement {
  /** Sites dont l'entretien est payé, dans l'ordre reçu. */
  paid: UpkeepDue[];
  /** Sites que la trésorerie ne pouvait pas payer en entier : ils sont à l'arrêt. */
  unpaid: UpkeepDue[];
  /** Somme prélevée : celle des sites payés, jamais plus que la trésorerie. */
  total: number;
}

/**
 * Règle d'une maison qui ne peut pas tout payer. Les sites sont examinés dans l'ordre reçu (date de
 * création puis identifiant) : chacun est payé en entier si ce qui reste de la trésorerie le permet, sinon il
 * n'est pas payé du tout et l'examen continue, si bien qu'un site moins cher peut encore l'être. La
 * trésorerie ne passe jamais sous zéro et aucun entretien n'est payé en partie.
 */
export function settleUpkeep(balance: number, dues: readonly UpkeepDue[]): UpkeepSettlement {
  if (!Number.isSafeInteger(balance) || balance < 0)
    throw new RangeError('balance must be a non-negative integer');
  // Un site en double serait prélevé deux fois : c'est une erreur de l'appelant, pas un cas à régler.
  if (new Set(dues.map((due) => due.siteId)).size !== dues.length)
    throw new RangeError('each site is settled once');
  const settlement: UpkeepSettlement = { paid: [], unpaid: [], total: 0 };
  for (const due of dues) {
    if (!Number.isSafeInteger(due.oboles) || due.oboles < 0)
      throw new RangeError('oboles must be a non-negative integer');
    if (due.oboles <= balance - settlement.total) {
      settlement.paid.push(due);
      settlement.total += due.oboles;
    } else settlement.unpaid.push(due);
  }
  return settlement;
}
