/** Une différence entre deux configurations : chemin de la valeur, avant, après (`undefined` : absente). */
export interface Change {
  path: string;
  before: unknown;
  after: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Clé d'un élément de liste : son `id` ou son `goodId` s'il en a un, sinon son rang. */
function keyed(list: unknown[]): Map<string, unknown> | null {
  const keys = list.map((item) => (isRecord(item) ? (item['id'] ?? item['goodId']) : undefined));
  if (keys.some((key) => typeof key !== 'string') || new Set(keys).size !== keys.length)
    return null;
  return new Map(list.map((item, index) => [`[${String(keys[index])}]`, item]));
}

/**
 * Compare deux configurations et rend les valeurs qui diffèrent, par chemin, dans l'ordre des chemins.
 * Les listes d'objets identifiés (biens, recettes, classes, cités, paniers) sont comparées par
 * identifiant : réordonner une liste n'est pas une différence, ajouter un bien en est une seule.
 */
export function diffConfigs(before: unknown, after: unknown, path = ''): Change[] {
  if (Array.isArray(before) && Array.isArray(after)) {
    const [left, right] = [keyed(before), keyed(after)];
    if (left && right) return diffEntries(left, right, path, '');
    return diffEntries(
      new Map(before.map((item, index) => [`[${index}]`, item])),
      new Map(after.map((item, index) => [`[${index}]`, item])),
      path,
      '',
    );
  }
  if (isRecord(before) && isRecord(after)) {
    return diffEntries(
      new Map(Object.entries(before)),
      new Map(Object.entries(after)),
      path,
      path ? '.' : '',
    );
  }
  return Object.is(before, after) ? [] : [{ path, before, after }];
}

function diffEntries(
  before: Map<string, unknown>,
  after: Map<string, unknown>,
  path: string,
  separator: string,
): Change[] {
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  return keys.flatMap((key) => {
    const child = `${path}${separator}${key}`;
    if (!before.has(key)) return [{ path: child, before: undefined, after: after.get(key) }];
    if (!after.has(key)) return [{ path: child, before: before.get(key), after: undefined }];
    return diffConfigs(before.get(key), after.get(key), child);
  });
}
