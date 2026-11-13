import {
  commandErrorSchema,
  type CommandError,
  type HouseCreateInput,
  type HouseCreateOutput,
} from '@oikos/contracts';

export type CommandResponse<T> = { ok: true; data: T } | { ok: false; error: CommandError };

/** Envoie une commande à l'API de jeu. Ne lève jamais : toute panne devient une erreur `INTERNAL`. */
export async function sendCommand<T>(
  name: string,
  input: unknown,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CommandResponse<T>> {
  try {
    const response = await fetchImpl(`/api/commands/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
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
