import { shareRoundedUp } from './tax';

/**
 * Dû quotidien des sites (docs/specs/05-economie.md, 5.5) : entretien et salaires (4.4), calcul pur, en
 * oboles entières. La clôture quotidienne et la relance d'un site s'en servent pour savoir ce qu'une
 * maison doit et ce qu'elle peut payer.
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

/**
 * Salaires d'un jour d'un site : travailleurs de sa recette × salaire du jour de sa cité, exact (deux
 * entiers, sans arrondi). Aucun travailleur ou un salaire nul ne doivent rien.
 */
export function dailyWages(workers: number, wageOboles: number): number {
  if (!Number.isSafeInteger(workers) || workers < 0)
    throw new RangeError('workers must be a non-negative integer');
  if (!Number.isSafeInteger(wageOboles) || wageOboles < 0)
    throw new RangeError('wageOboles must be a non-negative integer');
  const wages = workers * wageOboles;
  if (!Number.isSafeInteger(wages)) throw new RangeError('workers × wage is too large');
  return wages;
}

/** Ce qu'un site doit pour un jour, par nature : chaque part a sa ligne au grand livre (4.1). */
export interface SiteDailyDue {
  upkeepOboles: number;
  wagesOboles: number;
  /** Hébergement chez les PNJ de ses travailleurs sans logement (4.5, #258). */
  lodgingOboles: number;
  /** Le tout, payé en entier ou pas du tout : entretien, salaires et hébergement. */
  oboles: number;
}

/**
 * Dû d'un site pour un jour de jeu : son entretien (`dailyUpkeep`), les salaires de ses travailleurs
 * (`dailyWages`) et l'hébergement de ceux qui n'ont pas de logement (non logés × prix du jour), calculés
 * chacun à part puis additionnés, si bien que les parts font toujours le tout. Sans non logés indiqués,
 * l'hébergement est nul.
 */
export function siteDailyDue(site: {
  upkeepBaseOboles: number;
  coefficientBps: number;
  workers: number;
  wageOboles: number;
  unhoused?: number;
  lodgingPriceOboles?: number;
}): SiteDailyDue {
  const unhoused = site.unhoused ?? 0;
  if (!Number.isSafeInteger(unhoused) || unhoused < 0 || unhoused > site.workers)
    throw new RangeError('unhoused must be an integer from 0 to workers');
  const upkeepOboles = dailyUpkeep(site.upkeepBaseOboles, site.coefficientBps);
  const wagesOboles = dailyWages(site.workers, site.wageOboles);
  const lodgingOboles = dailyWages(unhoused, site.lodgingPriceOboles ?? 0);
  const oboles = upkeepOboles + wagesOboles + lodgingOboles;
  if (!Number.isSafeInteger(oboles)) throw new RangeError('upkeep + wages + lodging is too large');
  return { upkeepOboles, wagesOboles, lodgingOboles, oboles };
}

/** Somme, par nature, de ce que doivent des sites : les montants des lignes d'une écriture. */
export function sumDailyDues(
  dues: readonly (Omit<SiteDailyDue, 'oboles' | 'lodgingOboles'> & { lodgingOboles?: number })[],
): SiteDailyDue {
  const total = { upkeepOboles: 0, wagesOboles: 0, lodgingOboles: 0, oboles: 0 };
  for (const due of dues) {
    const lodging = due.lodgingOboles ?? 0;
    for (const part of [due.upkeepOboles, due.wagesOboles, lodging])
      if (!Number.isSafeInteger(part) || part < 0)
        throw new RangeError('each part must be a non-negative integer');
    total.upkeepOboles += due.upkeepOboles;
    total.wagesOboles += due.wagesOboles;
    total.lodgingOboles += lodging;
  }
  total.oboles = total.upkeepOboles + total.wagesOboles + total.lodgingOboles;
  if (!Number.isSafeInteger(total.oboles)) throw new RangeError('total due is too large');
  return total;
}

export interface UpkeepDue {
  siteId: string;
  oboles: number;
}

/** Entretien d'un jour d'un navire (#252) : celui de sa classe, payé en entier ou pas du tout. */
export interface ShipUpkeepDue {
  shipId: string;
  oboles: number;
}

/** Entretien d'un jour d'un bien immobilier (#256) : celui de sa taille, payé en entier ou pas du tout. */
export interface PropertyUpkeepDue {
  propertyId: string;
  oboles: number;
}

/** Salaire d'un jour d'un intendant (#278) : celui de la configuration, payé en entier ou pas du tout. */
export interface StewardWageDue {
  stewardId: string;
  oboles: number;
}

/** `T` : le dû de chaque site ou navire tel que reçu, rendu tel quel (ses parts par nature comprises). */
export interface UpkeepSettlement<T extends { oboles: number } = UpkeepDue> {
  /** Dus payés, dans l'ordre reçu. */
  paid: T[];
  /**
   * Dus que la trésorerie ne pouvait pas payer en entier : leur site est à l'arrêt, leur navire désarmé,
   * leur bien ne loge personne.
   */
  unpaid: T[];
  /** Somme prélevée : celle des dus payés, jamais plus que la trésorerie. */
  total: number;
}

/**
 * Règle d'une maison qui ne peut pas tout payer. Les dus sont examinés dans l'ordre reçu (date de
 * création puis identifiant) : chacun est payé en entier si ce qui reste de la trésorerie le permet, sinon
 * il n'est pas payé du tout et l'examen continue, si bien qu'un dû moins cher peut encore l'être. La
 * trésorerie ne passe jamais sous zéro et aucun dû n'est payé en partie.
 */
function settleInOrder<T extends { oboles: number }>(
  balance: number,
  dues: readonly T[],
  idOf: (due: T) => string,
): UpkeepSettlement<T> {
  if (!Number.isSafeInteger(balance) || balance < 0)
    throw new RangeError('balance must be a non-negative integer');
  // Un dû en double serait prélevé deux fois : c'est une erreur de l'appelant, pas un cas à régler.
  if (new Set(dues.map(idOf)).size !== dues.length)
    throw new RangeError('each due is settled once');
  const settlement: UpkeepSettlement<T> = { paid: [], unpaid: [], total: 0 };
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

/** Les sites d'une maison à une clôture, examinés dans l'ordre reçu (`settleInOrder`). */
export function settleUpkeep<T extends UpkeepDue>(
  balance: number,
  dues: readonly T[],
): UpkeepSettlement<T> {
  return settleInOrder(balance, dues, (due) => due.siteId);
}

/**
 * Les navires d'une maison à une clôture (#252), examinés après ses sites, avec ce qui reste de la
 * trésorerie, dans l'ordre reçu (`settleInOrder`).
 */
export function settleShipUpkeep<T extends ShipUpkeepDue>(
  balance: number,
  dues: readonly T[],
): UpkeepSettlement<T> {
  return settleInOrder(balance, dues, (due) => due.shipId);
}

/**
 * Les biens immobiliers d'une maison à une clôture (#256), examinés après ses sites et ses navires, avec
 * ce qui reste de la trésorerie, dans l'ordre reçu (`settleInOrder`).
 */
export function settlePropertyUpkeep<T extends PropertyUpkeepDue>(
  balance: number,
  dues: readonly T[],
): UpkeepSettlement<T> {
  return settleInOrder(balance, dues, (due) => due.propertyId);
}

/**
 * Les intendants d'une maison à une clôture (#278), examinés après ses sites, ses navires et ses biens, avec ce
 * qui reste de la trésorerie, dans l'ordre reçu (`settleInOrder`). Un intendant impayé n'agit pas.
 */
export function settleStewardWages<T extends StewardWageDue>(
  balance: number,
  dues: readonly T[],
): UpkeepSettlement<T> {
  return settleInOrder(balance, dues, (due) => due.stewardId);
}
