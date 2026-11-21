/**
 * Trésor du temple, échéance et défaut (docs/specs/05-economie.md, 5.4 ; #725) : ce que la clôture prélève sur les prêts
 * échus d'une maison, et sa marque de déshonneur. En entiers ; la base vérifie le même partage et la même marque.
 */

/** Un prêt échu d'une maison : son reste dû et ce qui reste de ses intérêts, au plus le reste dû. */
export interface DueLoan {
  id: string;
  outstanding: bigint;
  interestDue: bigint;
}

/** Ce que la clôture prend à un prêt échu : intérêts, principal, et ce qui reste dû après. */
export interface LoanCollection {
  id: string;
  interest: bigint;
  principal: bigint;
  outstanding: bigint;
}

/**
 * Prélèvement de la clôture sur les prêts échus d'une maison, dans l'ordre donné, sur sa trésorerie hors séquestre de
 * `treasury` oboles : chaque prêt prend ce qu'elle couvre encore de son reste dû, intérêts d'abord, sans rien ajouter
 * à ce qui reste dû. Un prêt qui ne trouve rien a une part nulle. La somme prise ne dépasse jamais la trésorerie, et
 * un prêt reste dû seulement si elle est vide.
 */
export function collectDueLoans(treasury: bigint, loans: readonly DueLoan[]): LoanCollection[] {
  if (treasury < 0n) throw new RangeError('treasury must not be negative');
  let left = treasury;
  return loans.map((loan) => {
    if (loan.outstanding < 0n || loan.interestDue < 0n || loan.interestDue > loan.outstanding)
      throw new RangeError(`loan ${loan.id} owes out of range`);
    const taken = left < loan.outstanding ? left : loan.outstanding;
    left -= taken;
    const interest = taken < loan.interestDue ? taken : loan.interestDue;
    return {
      id: loan.id,
      interest,
      principal: taken - interest,
      outstanding: loan.outstanding - taken,
    };
  });
}

/** Ce qui compte d'un prêt pour la marque : son état, le jour de son défaut et celui de son solde. */
export interface LoanStanding {
  status: 'active' | 'repaid' | 'defaulted';
  defaultedDay: number | null;
  repaidDay: number | null;
}

/**
 * Marque de déshonneur d'une maison au jour de jeu `gameDay` (#725) : elle la porte tant qu'un de ses prêts est en
 * défaut, puis jusqu'à `dishonorDays` jours de jeu après le solde du dernier prêt qui l'a été, la marque étant levée
 * à la clôture de ce jour (`untilDay`). Zéro jour : levée au solde. Un prêt soldé sans avoir été en défaut ne marque
 * pas. `untilDay` n'est donné que pour une marque qui a une fin : aucune tant qu'un prêt reste en défaut.
 */
export function dishonorMark(
  loans: readonly LoanStanding[],
  gameDay: number,
  dishonorDays: number,
): { dishonored: boolean; untilDay: number | null } {
  if (!Number.isSafeInteger(gameDay) || !Number.isSafeInteger(dishonorDays) || dishonorDays < 0)
    throw new RangeError(
      'gameDay and dishonorDays must be safe integers, dishonorDays not negative',
    );
  if (loans.some((loan) => loan.status === 'defaulted'))
    return { dishonored: true, untilDay: null };
  let until: number | null = null;
  for (const loan of loans)
    if (loan.status === 'repaid' && loan.defaultedDay !== null && loan.repaidDay !== null) {
      const end = loan.repaidDay + dishonorDays;
      if (until === null || end > until) until = end;
    }
  return until !== null && gameDay < until
    ? { dishonored: true, untilDay: until }
    : { dishonored: false, untilDay: null };
}
