/**
 * Niveau d'assurance porté par un jeton de session (revendication `aal` de Supabase Auth).
 * Lu dans le jeton lui-même : le niveau ne peut pas être attribué à un autre jeton que celui qui le porte.
 * Sert à choisir l'écran ; l'API vérifie la signature et recontrôle le niveau à chaque requête.
 */
export function assuranceLevel(token: string): 'aal1' | 'aal2' {
  try {
    const payload = (token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(payload)) as { aal?: unknown } | null;
    return claims?.aal === 'aal2' ? 'aal2' : 'aal1';
  } catch {
    return 'aal1';
  }
}
