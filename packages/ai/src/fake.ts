import type {
  AiCallRecord,
  AiCallStore,
  AiProvider,
  ProviderRequest,
  ProviderResponse,
} from './gateway';

/**
 * Fournisseur factice et déterministe, pour les tests et pour jouer en local sans clé (ADR 0005). Il rend,
 * dans l'ordre, les réponses qu'on lui donne ; une fonction reçoit la requête, une erreur est levée, et
 * `'hang'` ne répond jamais (seul l'abandon par le délai y met fin).
 */
export type FakeReply =
  ProviderResponse | Error | 'hang' | ((request: ProviderRequest) => ProviderResponse);

export function fakeProvider(replies: FakeReply[]): AiProvider & { requests: ProviderRequest[] } {
  const requests: ProviderRequest[] = [];
  let next = 0;
  return {
    requests,
    complete(request, signal) {
      requests.push(request);
      const reply = replies[Math.min(next++, replies.length - 1)];
      if (reply === undefined) return Promise.reject(new Error('fake provider: no reply'));
      if (reply === 'hang')
        return new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted'))),
        );
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve(typeof reply === 'function' ? reply(request) : reply);
    },
  };
}

/** Journal en mémoire. */
export function memoryStore(): AiCallStore & { calls: AiCallRecord[] } {
  const calls: AiCallRecord[] = [];
  return {
    calls,
    record(call) {
      calls.push(call);
      return Promise.resolve();
    },
  };
}
