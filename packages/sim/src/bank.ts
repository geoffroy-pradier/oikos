/**
 * Banques de joueurs (trapeza, docs/specs/05-economie.md, 5.4 ; #726) : réserve exigée d'une banque et capital que la
 * maison peut retirer de son coffre, en entiers. La base rend la même réserve (`public.my_bank`).
 */

/** Points de base d'un ratio entier : conversion d'unités, pas d'équilibrage. */
const BPS = 10_000n;

/** Règles de la réserve, telles que la configuration les tient (`banks`). */
export interface BankReserveRules {
  /** Capital minimal de la banque, en oboles : plancher de la réserve exigée. */
  minCapitalOboles: number;
  /** Réserve exigée en part des dépôts, en points de base. */
  reserveRatioBps: number;
}

const check = (value: number, name: string, max: number) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > max)
    throw new RangeError(`${name} is out of range`);
};

/**
 * Réserve exigée d'une banque dont les déposants détiennent `deposits` oboles (#727 ; nulles avant) : le plus grand du
 * capital minimal et de la part `reserveRatioBps` des dépôts, arrondie à l'obole supérieure. L'arrondi ne joue jamais
 * contre les déposants ; une banque sans dépôt garde au moins son capital minimal.
 */
export function bankRequiredReserve(deposits: bigint, rules: BankReserveRules): bigint {
  if (deposits < 0n) throw new RangeError('deposits must not be negative');
  check(rules.minCapitalOboles, 'minCapitalOboles', Number.MAX_SAFE_INTEGER);
  check(rules.reserveRatioBps, 'reserveRatioBps', 10_000);
  const share = (deposits * BigInt(rules.reserveRatioBps) + BPS - 1n) / BPS;
  const floor = BigInt(rules.minCapitalOboles);
  return share > floor ? share : floor;
}

/**
 * Capital que la maison peut retirer d'un coffre de `vault` oboles sous une réserve exigée de `reserve` oboles : ce qui
 * l'excède, rien si le coffre est à la réserve ou en dessous (une réserve relevée par une version nouvelle de la
 * configuration ne vide pas un coffre, elle en bloque les retraits).
 */
export function bankWithdrawableCapital(vault: bigint, reserve: bigint): bigint {
  if (vault < 0n) throw new RangeError('a vault is never overdrawn');
  if (reserve < 0n) throw new RangeError('reserve must not be negative');
  return vault > reserve ? vault - reserve : 0n;
}
