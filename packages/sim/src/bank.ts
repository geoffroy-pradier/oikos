/**
 * Banques de joueurs (trapeza, docs/specs/05-economie.md, 5.4 ; #726, #727) : réserve exigée d'une banque, capital que
 * la maison peut retirer de son coffre et intérêt du jour d'un dépôt, en entiers. La base rend la même réserve
 * (`public.my_bank`) et vérifie le même intérêt (`game.bank_deposit_movements`).
 */

/** Points de base d'un ratio entier, jours d'une année : conversions d'unités, pas d'équilibrage. */
const BPS = 10_000n;
const DAYS_PER_YEAR = 365n;
/** Plus grand solde d'un dépôt : les entiers sûrs des clients, que la base garde aussi. */
const MAX_BALANCE = BigInt(Number.MAX_SAFE_INTEGER);
/** Plus grand taux annuel qu'une banque affiche, en points de base, comme la base le borne. */
const MAX_RATE_BPS = 1_000_000;

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
 * Réserve exigée d'une banque dont les déposants détiennent `deposits` oboles (#727) : le plus grand du
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

/**
 * Intérêt du jour d'un dépôt de `balance` oboles au taux annuel affiché `rateBps` (#727) : solde × taux ÷ (10 000 × 365),
 * arrondi à l'obole inférieure, si bien qu'un petit dépôt ou un taux nul ne rapporte rien. L'intérêt s'ajoute à la
 * créance du déposant, sans monnaie nouvelle ; ajouté chaque jour, il se compose. Rogné pour que le solde reste dans
 * les entiers sûrs.
 */
export function bankDepositInterest(balance: bigint, rateBps: number): bigint {
  if (balance < 0n || balance > MAX_BALANCE) throw new RangeError('balance is out of range');
  check(rateBps, 'rateBps', MAX_RATE_BPS);
  const interest = (balance * BigInt(rateBps)) / (BPS * DAYS_PER_YEAR);
  return interest < MAX_BALANCE - balance ? interest : MAX_BALANCE - balance;
}

/**
 * Principal qu'une banque peut encore prêter (#728) : ce que son coffre de `vault` oboles excède la réserve exigée de
 * `reserve` oboles, comme pour un retrait de capital. Un prêt qui passerait le coffre sous la réserve est refusé ; un
 * coffre à la réserve, ou sous elle après une réserve relevée, ne prête rien.
 */
export function bankLendable(vault: bigint, reserve: bigint): bigint {
  return bankWithdrawableCapital(vault, reserve);
}
