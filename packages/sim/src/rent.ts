/**
 * Loyers des baux à une clôture (docs/specs/04-systemes-gestion.md, 4.5 ; #257) : calcul pur, en oboles
 * entières. Chaque bail est examiné dans l'ordre reçu ; il est payé en entier si ce qui reste de la
 * trésorerie de son locataire le couvre, sinon pas du tout, et l'examen continue. Un loyer payé passe de
 * la trésorerie du locataire à celle du propriétaire : il peut payer, plus loin dans l'ordre, un loyer que
 * doit le propriétaire. Aucune monnaie n'est créée ni détruite, et aucun solde ne devient négatif.
 */
export interface RentDue {
  leaseId: string;
  tenantHouseId: string;
  landlordHouseId: string;
  rentOboles: number;
}

export interface RentSettlement<T extends RentDue> {
  paid: T[];
  unpaid: T[];
  /** Trésoreries après les loyers payés, pour chaque maison des soldes reçus. */
  balances: Map<string, number>;
}

export function settleRents<T extends RentDue>(
  balances: ReadonlyMap<string, number>,
  dues: readonly T[],
): RentSettlement<T> {
  const after = new Map(balances);
  for (const [houseId, balance] of after)
    if (!Number.isSafeInteger(balance) || balance < 0)
      throw new RangeError(`balance of ${houseId} must be a non-negative integer`);
  const paid: T[] = [];
  const unpaid: T[] = [];
  for (const due of dues) {
    if (!Number.isSafeInteger(due.rentOboles) || due.rentOboles <= 0)
      throw new RangeError(`rent of ${due.leaseId} must be a positive integer`);
    if (due.tenantHouseId === due.landlordHouseId)
      throw new RangeError(`lease ${due.leaseId} has the same tenant and landlord`);
    const tenant = after.get(due.tenantHouseId);
    const landlord = after.get(due.landlordHouseId);
    if (tenant === undefined || landlord === undefined)
      throw new RangeError(`lease ${due.leaseId} names a house without a balance`);
    if (tenant >= due.rentOboles) {
      after.set(due.tenantHouseId, tenant - due.rentOboles);
      after.set(due.landlordHouseId, landlord + due.rentOboles);
      paid.push(due);
    } else unpaid.push(due);
  }
  return { paid, unpaid, balances: after };
}
