/** Stockage minimal attendu : `window.sessionStorage` dans le navigateur. */
export interface KeyStorage {
  readonly length: number;
  key(index: number): string | null;
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
  /** L'issue de l'intention est connue (succès ou refus) : le prochain essai prend une clé neuve. */
  const settle = (intent: string): void => {
    memory.delete(intent);
    safe((store) => store.removeItem(prefix + intent));
  };
  return {
    /** Clé de l'intention : celle d'un essai resté sans réponse, sinon une neuve, retenue. */
    keyFor(intent: string, fresh: () => string): string {
      const key = memory.get(intent) ?? safe((store) => store.getItem(prefix + intent)) ?? fresh();
      memory.set(intent, key);
      safe((store) => store.setItem(prefix + intent, key));
      return key;
    },
    settle,
    /** Rend les clés des intentions de cette maison que `obsolete` désigne, et d'elles seules. */
    settleWhere(obsolete: (intent: string) => boolean): void {
      const names =
        safe((store) => Array.from({ length: store.length }, (_, index) => store.key(index))) ?? [];
      const stored = names.flatMap((name) =>
        name?.startsWith(prefix) ? [name.slice(prefix.length)] : [],
      );
      for (const intent of new Set([...memory.keys(), ...stored]))
        if (obsolete(intent)) settle(intent);
    },
  };
}

/**
 * Intention d'une acquisition : la production voulue et le nombre de sites que la maison avait en la
 * demandant. Un achat abouti sans réponse ajoute un site : vouloir ensuite la même production est une
 * nouvelle intention, pas le rejeu du premier achat. `null` tant que les sites ne sont pas lus (`null`
 * aussi) : sans leur nombre, pas d'intention, donc rien à envoyer. Les compter pour zéro donnerait une
 * clé neuve à un achat peut-être déjà abouti, payé alors une seconde fois.
 */
export const acquireIntent = (recipeId: string, sitesCount: number | null) =>
  sitesCount === null ? null : `acquire:${recipeId}:${sitesCount}`;

/**
 * Acquisitions demandées avec moins de `sitesCount` sites. Une lecture qui montre ce nombre les rend
 * caduques : le nombre de sites ne diminue pas, leurs clés ne seraient plus jamais renvoyées.
 */
export const acquireIntentBelow = (sitesCount: number) => (intent: string) => {
  const count = /^acquire:.*:(\d+)$/.exec(intent)?.[1];
  return count !== undefined && Number(count) < sitesCount;
};
