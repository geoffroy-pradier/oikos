import { commandErrorSchema } from '@oikos/contracts';

export type AdminReply<T> = { ok: true; data: T } | { ok: false; code: string };

/**
 * Lit une route du back-office (`GET /api/admin/...`). Ne lève jamais : une panne devient `INTERNAL`.
 * Le back-office n'accède à aucune table : tout passe par l'API de jeu, qui contrôle rôle et second facteur.
 */
export async function adminGet<T>(
  path: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AdminReply<T>> {
  try {
    const response = await fetchImpl(`/api/admin/${path}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const body = (await response.json()) as {
      ok?: unknown;
      data?: unknown;
      error?: unknown;
    } | null;
    if (body?.ok === true && body.data !== undefined) return { ok: true, data: body.data as T };
    const error = body?.ok === false ? commandErrorSchema.safeParse(body.error) : null;
    if (error?.success) return { ok: false, code: error.data.code };
  } catch {
    // Réseau coupé ou réponse illisible : même traitement.
  }
  return { ok: false, code: 'INTERNAL' };
}
