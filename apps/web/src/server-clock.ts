/**
 * Heure du serveur, déduite de l'en-tête `Date` des réponses de l'API de jeu. L'horloge du navigateur
 * peut être fausse de plusieurs heures : ce qui est récoltable, calculé à l'écran, se cale sur le
 * serveur. L'en-tête est à la seconde près (tronquée), lu entre l'envoi et la réception : il borne
 * l'écart possible dans un intervalle d'un peu plus d'une seconde. Si l'écart nul y tient, l'horloge
 * du navigateur est gardée telle quelle (elle est plus précise que l'en-tête) ; sinon, on retient la
 * borne la plus proche, la plus petite correction compatible avec la réponse.
 */
export function createServerClock(localNow: () => number = () => Date.now()) {
  // Écart entre le serveur et le navigateur, en millisecondes ; nul tant qu'aucune réponse n'est lue.
  let offset = 0;
  return {
    /** Prend en compte l'en-tête `Date` d'une réponse reçue à `receivedAt`, demandée à `sentAt`. */
    observe(dateHeader: string | null, sentAt: number, receivedAt: number = localNow()): void {
      if (!dateHeader) return;
      const server = Date.parse(dateHeader);
      if (Number.isNaN(server) || receivedAt < sentAt) return;
      const lowest = server - receivedAt;
      const highest = server + 1000 - sentAt;
      offset = Math.min(Math.max(0, lowest), highest);
    },
    /** Instant présent selon le serveur. */
    now: (): Date => new Date(localNow() + offset),
  };
}

export const serverClock = createServerClock();

/** Lit l'heure du serveur par la route de santé de l'API. Une panne laisse l'écart connu. */
export async function syncServerClock(fetchImpl: typeof fetch = fetch): Promise<void> {
  const sentAt = Date.now();
  try {
    const response = await fetchImpl('/api/health', { cache: 'no-store' });
    serverClock.observe(response.headers.get('Date'), sentAt);
  } catch {
    // Pas de réponse : l'écran garde l'écart précédent, ou l'heure du navigateur.
  }
}
