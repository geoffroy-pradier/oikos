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
 * privée) les garde en mémoire seulement : elles survivent au changement d'onglet (mémoire du module,
 * par maison), pas au rechargement de la page.
 */
const memories = new Map<string, Map<string, string>>();
/** Maisons prévenues d'une acquisition abandonnée, sans stockage de session (voir `warning`). */
const warnedInMemory = new Set<string>();

/**
 * Clé en attente et entrée envoyée sous elle (`undefined` : aucune, ou rangée sans entrée).
 * `answered` : la commande a abouti, mais l'écran ne l'a pas encore relue (`sendUnderKey`).
 */
export interface PendingEntry<T> {
  key: string;
  input?: T;
  answered?: true;
}
/** Valeur rangée : `{ key, input }` en JSON, ou une clé seule (version antérieure de l'écran). */
function parseEntry<T>(stored: string): PendingEntry<T> {
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (typeof parsed === 'object' && parsed !== null && 'key' in parsed) {
      const { key, input, answered } = parsed as { key: unknown; input?: T; answered?: unknown };
      if (typeof key === 'string') {
        const entry: PendingEntry<T> = input === undefined ? { key } : { key, input };
        return answered === true ? { ...entry, answered } : entry;
      }
    }
  } catch {
    // Pas du JSON : une clé seule.
  }
  return { key: stored };
}
export function pendingKeys(scope: string, storage: () => KeyStorage | undefined) {
  const prefix = `oikos.pending.${scope}.`;
  const memory = memories.get(scope) ?? new Map<string, string>();
  memories.set(scope, memory);
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
  /**
   * Clé de l'intention et entrée envoyée sous elle : celles d'un essai resté sans réponse, sinon une
   * clé neuve et `input`, retenues ensemble. Une clé rangée seule (sans entrée, version antérieure de
   * l'écran) rend une entrée absente : l'appelant renvoie alors l'entrée de cette version.
   */
  const read = (intent: string) =>
    memory.get(intent) ?? safe((store) => store.getItem(prefix + intent)) ?? undefined;
  const keep = (intent: string, entry: PendingEntry<unknown>) => {
    const value = JSON.stringify(entry);
    memory.set(intent, value);
    safe((store) => store.setItem(prefix + intent, value));
  };
  function entryFor<T>(intent: string, fresh: () => string, input: T): PendingEntry<T> {
    const stored = read(intent);
    const entry: PendingEntry<T> =
      stored === undefined ? { key: fresh(), input } : parseEntry<T>(stored);
    keep(intent, entry);
    return entry;
  }
  const flag = `oikos.unanswered.${scope}`;
  return {
    /** Clé de l'intention : celle d'un essai resté sans réponse, sinon une neuve, retenue. */
    keyFor: (intent: string, fresh: () => string): string =>
      entryFor<undefined>(intent, fresh, undefined).key,
    entryFor,
    settle,
    /**
     * La commande a abouti, mais la clé reste en attente jusqu'à la relecture qui montre son effet
     * (`settleWhere`) : un écran qui n'a pas encore relu renvoie la même intention, donc la même clé.
     */
    answered(intent: string): void {
      const stored = read(intent);
      if (stored !== undefined) keep(intent, { ...parseEntry(stored), answered: true });
    },
    /**
     * Rend les clés des intentions de cette maison que `obsolete` désigne. Compte celles dont l'issue
     * restait inconnue (pas `answered`) : abandonnées sans réponse, elles ont pu payer.
     */
    settleWhere(obsolete: (intent: string) => boolean): number {
      const names =
        safe((store) => Array.from({ length: store.length }, (_, index) => store.key(index))) ?? [];
      const stored = names.flatMap((name) =>
        name?.startsWith(prefix) ? [name.slice(prefix.length)] : [],
      );
      const settled = [...new Set([...memory.keys(), ...stored])].filter(obsolete);
      const unknown = settled.filter((intent) => !parseEntry(read(intent) ?? '').answered);
      settled.forEach(settle);
      return unknown.length;
    },
    /**
     * Avertissement d'une acquisition abandonnée sans réponse, rappelé à chaque ouverture de l'écran
     * tant que le joueur n'a pas dit avoir vérifié la liste. Même stockage que les clés.
     */
    warning: {
      get: (): boolean =>
        warnedInMemory.has(scope) || (safe((store) => store.getItem(flag) !== null) ?? false),
      set(on: boolean): void {
        if (on) warnedInMemory.add(scope);
        else warnedInMemory.delete(scope);
        safe((store) => (on ? store.setItem(flag, '1') : store.removeItem(flag)));
      },
    },
  };
}

/**
 * Refus qui ne disent rien de l'issue d'une commande : restée sans réponse (`INTERNAL`), ou écartée par
 * l'API avant son registre d'idempotence. La clé reste en attente ; tout autre refus est attaché à la
 * sienne, et l'essai suivant en prend une neuve. Une clé absente ou mal formée
 * (`IDEMPOTENCY_KEY_REQUIRED`) n'a jamais pu être consommée : la rendre ne paie rien deux fois.
 */
const UNKNOWN = ['INTERNAL', 'UNAUTHENTICATED', 'RATE_LIMITED'];
export const outcomeKnown = (result: { ok: true } | { ok: false; error: { code: string } }) =>
  result.ok || !UNKNOWN.includes(result.error.code);

/**
 * Envoie une commande sous la clé de son intention, avec l'entrée de l'essai resté sans réponse s'il y
 * en a un : renvoyer la même clé avec une autre entrée serait refusé, et une clé neuve pourrait payer
 * une seconde fois une commande déjà aboutie. Le prix d'origine repart donc tel quel, même relu
 * différent entre-temps : si le premier envoi a abouti, l'API rejoue sa réponse ; sinon, elle refuse
 * le prix (« le prix a changé »), l'intention est réglée, et le joueur confirme le nouveau prix d'un
 * nouvel essai. Dès que l'issue est connue (succès ou refus), l'essai suivant prend une clé neuve ;
 * sans réponse (`INTERNAL`, refus d'avant le registre), la clé et l'entrée restent en attente.
 * `untilRead` : un succès ne rend pas la clé, il la marque `answered` ; elle est rendue à la relecture
 * qui montre son effet (`settleWhere`), car un autre écran, qui ne l'a pas encore vu, renverrait sinon
 * la même intention sous une clé neuve.
 */
export async function sendUnderKey<
  T,
  R extends { ok: true } | { ok: false; error: { code: string } },
>(
  keys: Pick<ReturnType<typeof pendingKeys>, 'entryFor' | 'settle' | 'answered'>,
  intent: string,
  fresh: () => string,
  input: T,
  send: (key: string, input: T | undefined) => Promise<R>,
  untilRead = false,
): Promise<R> {
  const entry = keys.entryFor(intent, fresh, input);
  const result = await send(entry.key, entry.input);
  if (result.ok && untilRead) keys.answered(intent);
  else if (outcomeKnown(result)) keys.settle(intent);
  return result;
}

/**
 * Intention d'une relance : le site et l'instant de son arrêt. Un site arrêté de nouveau est une autre
 * demande : elle ne rejoue pas la réponse d'une relance précédente restée sans réponse. Le prix n'en
 * fait pas partie : il est retenu avec la clé en attente (`sendUnderKey`).
 */
export const restartIntent = (siteId: string, haltedAt: string) => `restart:${siteId}:${haltedAt}`;

/**
 * Intention d'une acquisition : la production voulue et le nombre de sites que la maison avait en la
 * demandant ; le prix, comme pour la relance, est retenu avec la clé en attente. Un achat abouti sans réponse ajoute un site : vouloir ensuite la même production est une
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

/**
 * Intention comptée : une demande sur `subject` (classe de navire achetée, navire qui part) faite quand la
 * maison en comptait `count` (navires de la maison, voyages de ce navire). Comme pour l'acquisition d'un
 * site, une demande aboutie sans réponse ajoute un navire ou un voyage, vu à la relecture : la même demande
 * devient alors une nouvelle intention, pas le rejeu de la première. `null` tant que le compte n'est pas lu.
 */
export const countedIntent = (kind: string, subject: string, count: number | null) =>
  count === null ? null : `${kind}:${subject}:${count}`;

/**
 * Intentions de ce genre devenues caduques : faites avec moins que le compte lu maintenant pour leur sujet
 * (`countOf` rend `undefined` pour un sujet qu'il ne connaît pas : l'intention reste en attente).
 */
export const countedIntentBelow =
  (kind: string, countOf: (subject: string) => number | undefined) => (intent: string) => {
    const match = new RegExp(`^${kind}:(.*):(\\d+)$`).exec(intent);
    if (!match?.[1] || match[2] === undefined) return false;
    const count = countOf(match[1]);
    return count !== undefined && Number(match[2]) < count;
  };
