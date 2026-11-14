import {
  commandErrorSchema,
  IDEMPOTENCY_HEADER,
  type CommandError,
  type HouseCreateInput,
  type HouseCreateOutput,
  type MarketCancelOrderOutput,
  type MarketPlaceOrderInput,
  type MarketPlaceOrderOutput,
  type SiteCollectOutput,
} from '@oikos/contracts';

export type CommandResponse<T> = { ok: true; data: T } | { ok: false; error: CommandError };

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
    const response = await fetchImpl(`/api/commands/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
        [IDEMPOTENCY_HEADER]: idempotencyKey,
      },
      body: JSON.stringify(input),
    });
    const body = (await response.json()) as {
      ok?: unknown;
      data?: unknown;
      error?: unknown;
    } | null;
    if (body?.ok === true && body.data !== undefined) return { ok: true, data: body.data as T };
    const error = body?.ok === false ? commandErrorSchema.safeParse(body.error) : null;
    if (error?.success) return { ok: false, error: error.data };
  } catch {
    // Réseau coupé ou réponse illisible : même traitement.
  }
  return { ok: false, error: { code: 'INTERNAL', message: 'Unreachable or malformed response.' } };
}

export const createHouse = (input: HouseCreateInput, accessToken: string) =>
  sendCommand<HouseCreateOutput>('house.create', input, accessToken);

export const collectSite = (siteId: string, accessToken: string) =>
  sendCommand<SiteCollectOutput>('site.collect', { siteId }, accessToken);

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
