// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { acquireIntent, acquireIntentBelow, pendingKeys, type KeyStorage } from './pending-keys';

function memoryStorage(): KeyStorage & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get length() {
      return store.size;
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  };
}
const counter = () => {
  let n = 0;
  return () => `key-${++n}`;
};

describe('clés des commandes restées sans réponse', () => {
  it('une intention en attente garde sa clé ; réglée, elle en prend une neuve', () => {
    const fresh = counter();
    const keys = pendingKeys('house-1', memoryStorage);
    expect(keys.keyFor('a', fresh)).toBe('key-1');
    expect(keys.keyFor('a', fresh)).toBe('key-1');
    expect(keys.keyFor('b', fresh)).toBe('key-2');
    keys.settle('a');
    expect(keys.keyFor('a', fresh)).toBe('key-3');
  });

  it('la clé survit à un nouveau composant (onglet quitté puis rouvert)', () => {
    const storage = memoryStorage();
    const fresh = counter();
    pendingKeys('house-1', () => storage).keyFor('a', fresh);
    expect(pendingKeys('house-1', () => storage).keyFor('a', fresh)).toBe('key-1');
    // Une autre maison n'en hérite pas.
    expect(pendingKeys('house-2', () => storage).keyFor('a', fresh)).toBe('key-2');
    pendingKeys('house-1', () => storage).settle('a');
    expect([...storage.store.keys()]).toEqual(['oikos.pending.house-2.a']);
  });

  it('sans stockage utilisable, les clés restent en mémoire', () => {
    const fresh = counter();
    const broken = pendingKeys('house-1', () => {
      throw new Error('storage disabled');
    });
    expect(broken.keyFor('a', fresh)).toBe('key-1');
    expect(broken.keyFor('a', fresh)).toBe('key-1');
    const absent = pendingKeys('house-1', () => undefined);
    expect(absent.keyFor('a', fresh)).toBe('key-2');
  });

  it('un achat abouti sans réponse change l’intention suivante de la même production', () => {
    expect(acquireIntent('grow_wheat', 1)).toBe(acquireIntent('grow_wheat', 1));
    expect(acquireIntent('grow_wheat', 2)).not.toBe(acquireIntent('grow_wheat', 1));
  });

  it('sites non encore lus : pas d’intention, donc pas de clé ; aucun site lu en est une', () => {
    expect(acquireIntent('grow_wheat', null)).toBeNull();
    expect(acquireIntent('grow_wheat', 0)).toBe('acquire:grow_wheat:0');
  });

  it('une lecture qui montre N sites rend les clés des acquisitions demandées avec moins, et elles seules', () => {
    const storage = memoryStorage();
    const fresh = counter();
    const keys = pendingKeys('house-1', () => storage);
    const other = pendingKeys('house-2', () => storage);
    const [early, current] = ['acquire:grow_wheat:1', 'acquire:grow_wheat:2'];
    expect([acquireIntent('grow_wheat', 1), acquireIntent('grow_wheat', 2)]).toEqual([
      early,
      current,
    ]);
    for (const intent of [early, current, 'restart:site-1:null', 'restart:acquire:0'])
      keys.keyFor(intent, fresh);
    other.keyFor(early, fresh);
    // Clé rangée avant un remontage : connue du stockage seul, rendue elle aussi.
    storage.setItem('oikos.pending.house-1.acquire:a:b:0', 'stored');
    pendingKeys('house-1', () => storage).settleWhere(acquireIntentBelow(2));
    expect([...storage.store.keys()].sort()).toEqual([
      'oikos.pending.house-1.acquire:grow_wheat:2',
      'oikos.pending.house-1.restart:acquire:0',
      'oikos.pending.house-1.restart:site-1:null',
      'oikos.pending.house-2.acquire:grow_wheat:1',
    ]);
    // Solde nul et nombre égal : rien n'est rendu. Sans stockage, la mémoire est réglée de même.
    keys.settleWhere(acquireIntentBelow(0));
    expect(keys.keyFor(current, fresh)).toBe('key-2');
    const memoryOnly = pendingKeys('house-1', () => undefined);
    memoryOnly.keyFor(early, fresh);
    memoryOnly.settleWhere(acquireIntentBelow(2));
    expect(memoryOnly.keyFor(early, fresh)).toBe('key-7');
  });
});
