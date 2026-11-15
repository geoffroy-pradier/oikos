/** Stockage minimal attendu : `window.sessionStorage` dans le navigateur. */
export interface KeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Clés d'idempotence des commandes restées sans réponse, par intention. Une intention en attente
 * renvoie la même clé : l'API rejoue la commande au lieu de la jouer deux fois. Les clés survivent au
 * changement d'onglet et au rechargement (stockage de session) ; un stockage indisponible (navigation
 * privée) les garde en mémoire seulement.
 */
export function pendingKeys(scope: string, storage: () => KeyStorage | undefined) {
  const prefix = `oikos.pending.${scope}.`;
  const memory = new Map<string, string>();
  const safe = <T>(action: (store: KeyStorage) => T): T | undefined => {
    try {
      const store = storage();
      return store ? action(store) : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    /** Clé de l'intention : celle d'un essai resté sans réponse, sinon une neuve, retenue. */
    keyFor(intent: string, fresh: () => string): string {
      const key = memory.get(intent) ?? safe((store) => store.getItem(prefix + intent)) ?? fresh();
      memory.set(intent, key);
      safe((store) => store.setItem(prefix + intent, key));
      return key;
    },
    /** L'issue de l'intention est connue (succès ou refus) : le prochain essai prend une clé neuve. */
    settle(intent: string): void {
      memory.delete(intent);
      safe((store) => store.removeItem(prefix + intent));
    },
  };
}

/**
 * Intention d'une acquisition : la production voulue et le nombre de sites que la maison avait en la
 * demandant. Un achat abouti sans réponse ajoute un site : vouloir ensuite la même production est une
 * nouvelle intention, pas le rejeu du premier achat.
 */
export const acquireIntent = (recipeId: string, sitesCount: number) =>
  `acquire:${recipeId}:${sitesCount}`;
