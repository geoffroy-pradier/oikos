import { commandErrorSchema, IDEMPOTENCY_HEADER } from '@oikos/contracts';
import { announceSessionEnded } from './session';

/** Code d'un refus de l'API ; un jeton refusé, ou un compte effacé (#565), ferme la session d'Olympe. */
function refused(code: string, accessToken: string) {
  if (code === 'UNAUTHENTICATED') announceSessionEnded(accessToken);
  return code;
}

export type AdminReply<T> = { ok: true; data: T } | { ok: false; code: string };

/**
 * Lit une route du back-office (`GET /api/admin/...`). Ne lève jamais : sans réponse, `NETWORK` ; réponse
 * illisible, `INTERNAL` ; sinon le code rendu par l'API (`RATE_LIMITED`, `FORBIDDEN`…).
 * Le back-office n'accède à aucune table : tout passe par l'API de jeu, qui contrôle rôle et second facteur.
 */
export async function adminGet<T>(
  path: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AdminReply<T>> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/admin/${path}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Aucune réponse : réseau coupé ou API injoignable. Distinct d'une réponse illisible (`INTERNAL`).
    return { ok: false, code: 'NETWORK' };
  }
  try {
    const body = (await response.json()) as {
      ok?: unknown;
      data?: unknown;
      error?: unknown;
    } | null;
    if (body?.ok === true && body.data !== undefined) return { ok: true, data: body.data as T };
    const error = body?.ok === false ? commandErrorSchema.safeParse(body.error) : null;
    if (error?.success) return { ok: false, code: refused(error.data.code, accessToken) };
  } catch {
    // Réponse illisible (page d'erreur d'un relais, par exemple).
  }
  return { ok: false, code: 'INTERNAL' };
}

export type CommandReply<T> =
  { ok: true; data: T } | { ok: false; code: string; fields?: string[] | undefined };

/**
 * Envoie une commande d'administration. `idempotencyKey` identifie une intention : la renvoyer telle
 * quelle après une panne rejoue la commande déjà exécutée au lieu de l'exécuter une seconde fois.
 */
export async function adminCommand<T>(
  name: string,
  input: unknown,
  accessToken: string,
  idempotencyKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CommandReply<T>> {
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
    if (error?.success)
      return { ok: false, code: refused(error.data.code, accessToken), fields: error.data.fields };
  } catch {
    // Réseau coupé ou réponse illisible : même traitement.
  }
  return { ok: false, code: 'INTERNAL' };
}
