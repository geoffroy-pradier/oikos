import { detectLanguage, type Language } from './i18n';
import en from './locales/en.json';
import fr from './locales/fr.json';

/** Ligne d'une liste : son rang dans le chemin (à partir de 0) et son identifiant, s'il a pu être lu. */
export interface Row {
  index: number;
  id: string | null;
}
/** Ce qu'une erreur de schéma désigne. `table: null` : la configuration entière (`(root)`). */
export interface SchemaTarget {
  table: string | null;
  /** Ligne de la table, quand la table est une liste et que l'erreur porte sur l'une de ses lignes. */
  row: Row | null;
  /** Du plus large au plus précis : clés, et lignes des listes imbriquées (intrants, panier). */
  field: (string | Row)[];
}
export interface SchemaError {
  /** Chemin tel que l'API le rend : il situe la valeur dans le texte JSON. */
  path: string;
  /** Diagnostic du schéma : une donnée technique, en anglais. Vide si l'API n'en donne pas. */
  detail: string;
  /** `null` : chemin que cet écran ne sait pas découper, à rendre tel quel. */
  target: SchemaTarget | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Valeur sous une clé ou un rang, propriétés propres seulement (`constructor` n'est pas une donnée). */
function child(node: unknown, step: string | number): unknown {
  if (typeof step === 'number') return Array.isArray(node) ? node[step] : undefined;
  return isRecord(node) && Object.hasOwn(node, step) ? node[step] : undefined;
}

/** Identifiant d'une ligne : son `id`, sinon son `goodId` (intrants, extrants, panier), comme `diff.ts`. */
function rowId(item: unknown): string | null {
  const ids = [child(item, 'id'), child(item, 'goodId')];
  return ids.find((id): id is string => typeof id === 'string' && id.trim() !== '') ?? null;
}

// Écriture de `formatPath` (packages/config/src/validate.ts) : `clé`, `.clé`, `[rang]`.
const STEP = /(^|\.)[^.[\]]+|\[\d+\]/g;

function targetOf(path: string, config: unknown): SchemaTarget | null {
  if (path === '(root)') return { table: null, row: null, field: [] };
  const tokens = path.match(STEP) ?? [];
  const [table, ...rest] = tokens;
  if (tokens.join('') !== path || table === undefined || /^[.[]/.test(table)) return null;
  let node = child(config, table);
  const steps: (string | Row)[] = [];
  for (const token of rest) {
    const step = token.startsWith('[') ? Number(token.slice(1, -1)) : token.slice(1);
    if (typeof step === 'number' && !Number.isSafeInteger(step)) return null;
    node = child(node, step);
    steps.push(typeof step === 'number' ? { index: step, id: rowId(node) } : step);
  }
  const row = typeof steps[0] === 'object' ? steps[0] : null;
  return { table, row, field: row ? steps.slice(1) : steps };
}

/**
 * Découpe une erreur de schéma rendue par l'API (`goods[2].elasticity: …`) en table, ligne et champ.
 * `config` est la configuration que l'API a refusée : une ligne y est désignée par son identifiant quand
 * il s'y lit, sinon par son rang (configuration inconnue, rang hors de la liste, identifiant absent).
 * Ne contrôle rien : l'API fait foi, cette fonction ne fait que situer ce qu'elle a refusé.
 */
export function parseSchemaError(error: string, config: unknown): SchemaError {
  const cut = error.indexOf(': ');
  const path = cut < 0 ? error : error.slice(0, cut);
  return { path, detail: cut < 0 ? '' : error.slice(cut + 2), target: targetOf(path, config) };
}

interface Labels {
  root: string;
  position: string;
  tables: Record<string, string>;
  fields: Record<string, Record<string, string>>;
}
const LABELS: Record<Language, Labels> = { fr: fr.config.schemaPath, en: en.config.schemaPath };
const own = <T>(labels: Record<string, T> | undefined, key: string): T | undefined =>
  labels && Object.hasOwn(labels, key) ? labels[key] : undefined;

/**
 * Nomme la table, la ligne et le champ d'une erreur dans la langue de l'écran. Une table sans libellé
 * rend `null` (chemin à afficher tel quel) ; un champ sans libellé garde sa clé (une classe de PNJ dans
 * `population`, un champ plus récent que cet écran). Les libellés d'une table ne valent que pour elle.
 */
export function labelSchemaTarget(target: SchemaTarget | null, language: string): string[] | null {
  if (!target) return null;
  const labels = LABELS[detectLanguage([language])];
  if (target.table === null) return [labels.root];
  const table = own(labels.tables, target.table);
  if (table === undefined) return null;
  const fields = own(labels.fields, target.table);
  const name = (step: string | Row) =>
    typeof step === 'string'
      ? (own(fields, step) ?? step)
      : (step.id ?? labels.position.replace('{{rank}}', String(step.index + 1)));
  return [table, ...(target.row ? [name(target.row)] : []), ...target.field.map(name)];
}
