import {
  type ChatOpenDirectOutput,
  type ChatPostOutput,
  type ChatReportOutput,
  commandErrorSchema,
  IDEMPOTENCY_HEADER,
  type CityCastOstraconInput,
  type CityCastVoteInput,
  type CityProposeDecreeInput,
  type CityStandForElectionInput,
  type CityVoteDecreeInput,
  type CityWithdrawCandidacyInput,
  type CommandError,
  type HouseCreateInput,
  type HouseCreateOutput,
  type LiturgyPerformInput,
  type LiturgyPerformOutput,
  type LoanRepayInput,
  type LoanRepayOutput,
  type MarketCancelOrderOutput,
  type MarketPlaceOrderInput,
  type MarketPlaceOrderOutput,
  type ModerationAppealOutput,
  type PropertyBuyInput,
  type PropertyBuyListedInput,
  type PropertyEndLeaseInput,
  type PropertyLeaseInput,
  type PropertyListForSaleInput,
  type PropertyOfferLeaseInput,
  type PropertyRenovateInput,
  type PropertyWithdrawOfferInput,
  type SiteAcquireOutput,
  type SiteCollectOutput,
  type SiteRestartOutput,
  type SiteSetRecipeOutput,
  type ShipAcquireOutput,
  type StewardDismissInput,
  type StewardHireInput,
  type StewardSetRulesInput,
  type StewardSubmitInstructionInput,
  type TempleConsultOracleOutput,
  type TempleInvokeGraceOutput,
  type TempleMakeOfferingInput,
  type TempleMakeOfferingOutput,
  type VoyageDepartInput,
  type VoyageDepartOutput,
} from '@oikos/contracts';
import { SANCTIONED_EVENT } from './moderation';
import { serverClock } from './server-clock';
import { announceSessionEnded } from './session';

/** Émis sur la fenêtre après toute commande réussie : l'argent ou les stocks ont pu bouger (#898). */
export const COMMAND_SUCCEEDED_EVENT = 'oikos:command-succeeded';

/** `replayed` : l'API a rejoué une commande déjà exécutée sous cette clé, sans nouvel effet. */
export type CommandResponse<T> =
  { ok: true; data: T; replayed: boolean } | { ok: false; error: CommandError };

/**
 * Envoie une commande à l'API de jeu. Ne lève jamais : toute panne devient une erreur `INTERNAL`.
 * `idempotencyKey` identifie une intention du joueur : la renvoyer telle quelle rejoue sans second effet.
 */
export async function sendCommand<T>(
  name: string,
  input: unknown,
  accessToken: string,
  idempotencyKey: string = crypto.randomUUID(),
  fetchImpl: typeof fetch = fetch,
): Promise<CommandResponse<T>> {
  try {
    const sentAt = Date.now();
    const response = await fetchImpl(`/api/commands/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
        [IDEMPOTENCY_HEADER]: idempotencyKey,
      },
      body: JSON.stringify(input),
    });
    // Toute réponse de l'API donne l'heure du serveur, même un refus.
    serverClock.observe(response.headers.get('Date'), sentAt);
    const body = (await response.json()) as {
      ok?: unknown;
      data?: unknown;
      error?: unknown;
    } | null;
    if (body?.ok === true && body.data !== undefined) {
      const replayed = response.headers.get('Idempotent-Replay') === 'true';
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(COMMAND_SUCCEEDED_EVENT));
      return { ok: true, data: body.data as T, replayed };
    }
    const error = body?.ok === false ? commandErrorSchema.safeParse(body.error) : null;
    if (error?.success) {
      // Refus pour une sanction (#275) : l'annonce des sanctions se relit.
      const sanctioned = error.data.code === 'SUSPENDED' || error.data.code === 'SILENCED';
      if (sanctioned && typeof window !== 'undefined')
        window.dispatchEvent(new Event(SANCTIONED_EVENT));
      // Jeton refusé, ou compte effacé (#565) : l'application ferme la session et revient à la connexion.
      if (error.data.code === 'UNAUTHENTICATED') announceSessionEnded(accessToken);
      return { ok: false, error: error.data };
    }
  } catch {
    // Réseau coupé ou réponse illisible : même traitement.
  }
  return { ok: false, error: { code: 'INTERNAL', message: 'Unreachable or malformed response.' } };
}

export const createHouse = (input: HouseCreateInput, accessToken: string) =>
  sendCommand<HouseCreateOutput>('house.create', input, accessToken);

export const collectSite = (siteId: string, accessToken: string) =>
  sendCommand<SiteCollectOutput>('site.collect', { siteId }, accessToken);

/**
 * `idempotencyKey` : la même clé tant que cette acquisition n'a pas reçu de réponse. `expectedCostOboles` :
 * le prix envoyé sous cette clé ; l'API refuse (`PRICE_CHANGED`) plutôt que de prélever un autre tarif.
 * Absent (clé rangée par une version antérieure de l'écran) : la commande part sans prix, comme alors.
 */
export const acquireSite = (
  recipeId: string,
  expectedCostOboles: number | undefined,
  accessToken: string,
  idempotencyKey: string,
) =>
  sendCommand<SiteAcquireOutput>(
    'site.acquire',
    { recipeId, expectedCostOboles },
    accessToken,
    idempotencyKey,
  );

export const setSiteRecipe = (siteId: string, recipeId: string, accessToken: string) =>
  sendCommand<SiteSetRecipeOutput>('site.setRecipe', { siteId, recipeId }, accessToken);

/**
 * `idempotencyKey` : la même clé tant que cette relance n'a pas reçu de réponse ; une clé neuve après un
 * refus. `expectedUpkeepOboles` : le prix affiché de la relance (entretien et salaires d'un jour), que
 * l'API refuse de dépasser comme de baisser.
 */
export const restartSite = (
  siteId: string,
  expectedUpkeepOboles: number | undefined,
  accessToken: string,
  idempotencyKey: string,
) =>
  sendCommand<SiteRestartOutput>(
    'site.restart',
    { siteId, expectedUpkeepOboles },
    accessToken,
    idempotencyKey,
  );

/** `idempotencyKey` : la même clé tant que la même intention n'a pas reçu de réponse (voir `Agora.tsx`). */
export const placeOrder = (
  input: MarketPlaceOrderInput,
  accessToken: string,
  idempotencyKey: string,
) => sendCommand<MarketPlaceOrderOutput>('market.placeOrder', input, accessToken, idempotencyKey);

/** `idempotencyKey` : la même clé tant que l'annulation de cet ordre n'a pas reçu de réponse. */
export const cancelOrder = (orderId: string, accessToken: string, idempotencyKey: string) =>
  sendCommand<MarketCancelOrderOutput>(
    'market.cancelOrder',
    { orderId },
    accessToken,
    idempotencyKey,
  );

/**
 * `idempotencyKey` : la même clé tant que cet achat n'a pas reçu de réponse. `expectedCostOboles` : le prix
 * affiché, que l'API refuse (`PRICE_CHANGED`) plutôt que de prélever un autre tarif.
 */
export const acquireShip = (
  classId: string,
  expectedCostOboles: number,
  accessToken: string,
  idempotencyKey: string,
) =>
  sendCommand<ShipAcquireOutput>(
    'ship.acquire',
    { classId, expectedCostOboles },
    accessToken,
    idempotencyKey,
  );

/** `idempotencyKey` : la même clé tant que ce départ n'a pas reçu de réponse ; coût vu dans `input`. */
export const departVoyage = (
  input: VoyageDepartInput,
  accessToken: string,
  idempotencyKey: string,
) => sendCommand<VoyageDepartOutput>('voyage.depart', input, accessToken, idempotencyKey);

/** Entrée de chaque commande de l'immobilier (4.5), d'après les contrats. */
export interface PropertyCommandInputs {
  'property.buy': PropertyBuyInput;
  'property.buyListed': PropertyBuyListedInput;
  'property.lease': PropertyLeaseInput;
  'property.renovate': PropertyRenovateInput;
  'property.listForSale': PropertyListForSaleInput;
  'property.offerLease': PropertyOfferLeaseInput;
  'property.withdrawOffer': PropertyWithdrawOfferInput;
  'property.endLease': PropertyEndLeaseInput;
}

/**
 * Commandes de l'immobilier (4.5). Chaque prix envoyé est celui que le joueur a vu : un autre prix en
 * vigueur est refusé (`PRICE_CHANGED`), rien n'est payé. `idempotencyKey` : la même clé tant que la
 * commande n'a pas reçu de réponse.
 */
export const propertyCommand = <N extends keyof PropertyCommandInputs>(
  name: N,
  input: PropertyCommandInputs[N],
  accessToken: string,
  idempotencyKey: string,
) => sendCommand<Record<string, unknown>>(name, input, accessToken, idempotencyKey);

/** Entrée de chaque commande des intendants (4.4, #278, #280), d'après les contrats. */
export interface StewardCommandInputs {
  'steward.hire': StewardHireInput;
  'steward.setRules': StewardSetRulesInput;
  'steward.dismiss': StewardDismissInput;
  'steward.submitInstruction': StewardSubmitInstructionInput;
}

/** Commandes des intendants. `idempotencyKey` : la même clé tant que la commande n'a pas reçu de réponse. */
export const stewardCommand = <N extends keyof StewardCommandInputs>(
  name: N,
  input: StewardCommandInputs[N],
  accessToken: string,
  idempotencyKey: string,
) => sendCommand<Record<string, unknown>>(name, input, accessToken, idempotencyKey);

/** Entrée de chaque commande de la cité (6.2, 6.3), d'après les contrats. */
export interface CityCommandInputs {
  'city.standForElection': CityStandForElectionInput;
  'city.withdrawCandidacy': CityWithdrawCandidacyInput;
  'city.castVote': CityCastVoteInput;
  'city.proposeDecree': CityProposeDecreeInput;
  'city.voteDecree': CityVoteDecreeInput;
  'city.castOstracon': CityCastOstraconInput;
}

/**
 * Commandes de la cité : candidature, vote, proposition et vote d'un décret. `idempotencyKey` : la même clé
 * tant que la commande n'a pas reçu de réponse.
 */
export const cityCommand = <N extends keyof CityCommandInputs>(
  name: N,
  input: CityCommandInputs[N],
  accessToken: string,
  idempotencyKey: string,
) => sendCommand<Record<string, unknown>>(name, input, accessToken, idempotencyKey);

/**
 * Accomplit la liturgie de la maison (6.4, #720). `input.expectedDue` : le dû vu, que l'API refuse (`PRICE_CHANGED`)
 * plutôt que de prélever un autre. `idempotencyKey` : la même clé tant que cette intention n'a pas reçu de réponse.
 */
export const performLiturgy = (
  input: LiturgyPerformInput,
  accessToken: string,
  idempotencyKey: string,
) => sendCommand<LiturgyPerformOutput>('liturgy.perform', input, accessToken, idempotencyKey);

/**
 * Rembourse une part d'un prêt de la maison (5.4, #724), intérêts d'abord. `idempotencyKey` : la même clé tant que
 * cette intention n'a pas reçu de réponse.
 */
export const repayLoan = (input: LoanRepayInput, accessToken: string, idempotencyKey: string) =>
  sendCommand<LoanRepayOutput>('loan.repay', input, accessToken, idempotencyKey);

/** `idempotencyKey` : la même clé tant que ce message (canal et texte) n'a pas reçu de réponse. */
export const postMessage = (
  channelId: string,
  body: string,
  accessToken: string,
  idempotencyKey: string,
) => sendCommand<ChatPostOutput>('chat.post', { channelId, body }, accessToken, idempotencyKey);

/** Ouvre la conversation privée avec la maison, ou rend celle qui existe. */
export const openDirect = (houseId: string, accessToken: string, idempotencyKey: string) =>
  sendCommand<ChatOpenDirectOutput>('chat.openDirect', { houseId }, accessToken, idempotencyKey);

/** Offrande à un dieu (7.1), à la Charis vue dans `input` ; `idempotencyKey` : la même tant qu'elle reste sans réponse. */
export const makeOffering = (
  input: TempleMakeOfferingInput,
  accessToken: string,
  idempotencyKey: string,
) =>
  sendCommand<TempleMakeOfferingOutput>('temple.makeOffering', input, accessToken, idempotencyKey);

/** Invocation d'une grâce (7.1), à la Charis dépensée vue ; `idempotencyKey` : la même tant qu'elle reste sans réponse. */
export const invokeGrace = (
  graceId: string,
  expectedCharisSpent: number,
  accessToken: string,
  idempotencyKey: string,
) =>
  sendCommand<TempleInvokeGraceOutput>(
    'temple.invokeGrace',
    { graceId, expectedCharisSpent },
    accessToken,
    idempotencyKey,
  );

/** Consultation de la Pythie (7.3), au prix vu ; `idempotencyKey` : la même tant qu'elle reste sans réponse. */
export const consultOracle = (
  expectedOboles: number,
  accessToken: string,
  idempotencyKey: string,
) =>
  sendCommand<TempleConsultOracleOutput>(
    'temple.consultOracle',
    { expectedOboles },
    accessToken,
    idempotencyKey,
  );

/** Appel d'une sanction (#275). `idempotencyKey` : la même clé tant que ce texte n'a pas reçu de réponse. */
export const appealSanction = (
  sanctionId: string,
  body: string,
  accessToken: string,
  idempotencyKey: string,
) =>
  sendCommand<ModerationAppealOutput>(
    'moderation.appeal',
    { sanctionId, body },
    accessToken,
    idempotencyKey,
  );

/** Signalement d'un message (#275). `idempotencyKey` : la même clé tant que ce signalement n'a pas reçu de réponse. */
export const reportMessage = (
  messageId: string,
  reason: string,
  accessToken: string,
  idempotencyKey: string,
) =>
  sendCommand<ChatReportOutput>('chat.report', { messageId, reason }, accessToken, idempotencyKey);
