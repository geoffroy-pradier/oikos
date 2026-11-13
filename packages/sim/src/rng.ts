/**
 * Aléa déterministe (docs/specs/13-moteur-anti-triche.md) : un générateur initialisé par une graine
 * enregistrée rend toujours la même suite, ce qui permet de rejouer et d'auditer un tick contesté.
 * Ne jamais utiliser `Math.random` dans la simulation.
 */
export interface Rng {
  /** Nombre uniforme dans [0, 1). */
  next(): number;
  /** Entier uniforme dans [min, max], bornes comprises. */
  int(min: number, max: number): number;
  /** Élément tiré uniformément d'une liste non vide. */
  pick<T>(items: readonly T[]): T;
}

/** Hachage cyrb128 d'une chaîne en quatre mots de 32 bits : étale la graine sur tout l'état. */
function hashSeed(seed: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** Générateur sfc32 : rapide, 128 bits d'état, identique sur toutes les plateformes (entiers 32 bits). */
export function createRng(seed: string): Rng {
  let [a, b, c, d] = hashSeed(seed);
  const next = () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // Quelques tirages à blanc : les premiers résultats de sfc32 dépendent trop directement de la graine.
  for (let i = 0; i < 12; i++) next();

  const int = (min: number, max: number) => {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
      throw new RangeError(`Invalid integer range [${min}, ${max}]`);
    }
    return min + Math.floor(next() * (max - min + 1));
  };
  return {
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError('Cannot pick from an empty list');
      return items[int(0, items.length - 1)] as T;
    },
  };
}
