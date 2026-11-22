import { randomUUID } from 'node:crypto';
import type { GameConfig } from '@oikos/config';
import type { LoanCollateral } from '@oikos/contracts';
import { sql } from 'kysely';
import { fund, KALLISTE, newPlayer, owner, send } from './property.integration-fixtures';
import { appWithConfig, type App } from './voyage.integration-fixtures';

// Prêts gagés des banques (#728), contre Supabase local : capital minimal de 1 500, réserve de 20 % des dépôts, taux
// de prêt de 3 à 50 % l'an ; le temple prête 1 000 oboles au plus, pour qu'un défaut marque une maison.
type Banks = NonNullable<GameConfig['banks']>;
export const RULES: Banks = {
  charterFeeOboles: 0,
  minCapitalOboles: 1_500,
  reserveRatioBps: 2_000,
  depositRateBps: { min: 100, max: 1_000 },
  loanRateBps: { min: 300, max: 5_000 },
};
export const withBanks = (rules: Banks | null): App =>
  appWithConfig((config) => {
    const next: GameConfig = {
      ...config,
      templeTreasury: {
        policyRateBps: 1_000,
        termDays: [7],
        principalCaps: [{ minHonor: 0, maxPrincipal: 1_000 }],
      },
    };
    if (rules) next.banks = rules;
    else delete next.banks;
    return next;
  });
export const app = withBanks(RULES);
export const codeOf = (reply: { body: { error?: { code: string } } }) => reply.body.error?.code;
const freshName = () => `Trapeza ${[...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('')}`;

/** Une banque fondée par une maison nouvelle de Kallistè, avec `capital` oboles au coffre. */
export async function newBank(capital = 5_000) {
  const banker = await newPlayer(KALLISTE);
  await fund(banker.houseId, capital);
  const founded = await send(
    banker.user,
    'bank.found',
    { name: freshName(), capital, expectedCharterFee: 0 },
    undefined,
    app,
  );
  return { ...banker, bankId: founded.body.data.bankId as string };
}
/** Conditions d'une offre : 2 000 oboles à 12 % sur 30 jours (intérêt 20), gagés sur 20 blés de Kallistè. */
export const terms = (patch: Record<string, unknown> = {}) => ({
  principal: 2_000,
  rateBps: 1_200,
  termDays: 30,
  collateral: { kind: 'stock', cityId: KALLISTE, goodId: 'wheat', quantity: 20 } as LoanCollateral,
  ...patch,
});
export const offer = (
  bankUser: string,
  borrowerHouseId: string,
  patch: Record<string, unknown> = {},
  via = app,
) => send(bankUser, 'bank.offerLoan', { borrowerHouseId, ...terms(patch) }, undefined, via);
/** Offre faite et rendue par son identifiant. */
export const offered = async (bankUser: string, borrowerHouseId: string, patch = {}) =>
  (await offer(bankUser, borrowerHouseId, patch)).body.data.offerId as string;
/** Coffre d'une banque, lu par le propriétaire : le service ne voit pas les coffres. */
export const vaultOf = async (bankId: string) =>
  Number(
    (
      await sql<{
        balance: string;
      }>`select balance from game.accounts where bank_id = ${bankId}`.execute(owner)
    ).rows[0]?.balance,
  );
export const statusOf = async (offerId: string) =>
  (
    await sql<{
      status: string;
    }>`select status from game.bank_loan_offers where id = ${offerId}`.execute(owner)
  ).rows[0]?.status;
