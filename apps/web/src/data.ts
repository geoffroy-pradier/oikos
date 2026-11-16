import { useCallback, useEffect, useRef, useState } from 'react';
import { parseShipRules } from './ship-rules';
import { parseSiteRules } from './site-rules';
import { supabase } from './supabase';

/**
 * Lit les lignes d'une vue de lecture (les règles par ligne ne rendent que celles du joueur).
 * `rows` vaut `null` tant que rien n'a été lu ; `failed` signale un échec, jamais pris pour « rien ».
 * Quand la vue ou le filtre change, les lignes de l'ancien filtre disparaissent aussitôt, et seule la
 * réponse de la lecture la plus récente est retenue : une réponse tardive ne s'affiche jamais sous un
 * autre filtre. `reload` rend les lignes qu'elle vient de lire, `null` en cas d'échec ou si une lecture
 * plus récente l'a remplacée.
 */
export function useRows<T>(
  view: string,
  columns: string,
  order: string,
  /** Égalité par colonne ; une liste : une valeur parmi celles-ci ; `{ gt }` : strictement après. */
  /** `null` : rien n'est lu tant que le filtre n'est pas connu (`rows` reste `null`, sans échec). */
  filters: Record<string, string | readonly string[] | { gt: string }> | null = {},
  /** Les `limit` dernières lignes selon `order`, rendues de la plus récente à la plus ancienne. */
  latestOnly?: { limit: number },
) {
  const filterKey = JSON.stringify(filters);
  const limit = latestOnly?.limit;
  // Lignes et échec sont rangés sous la lecture qui les a produits : dès le rendu où le filtre change, ceux
  // de l'ancien filtre ne sont plus rendus, et un écran ne lance pas une lecture d'après eux (#441).
  const key = JSON.stringify([view, columns, order, filterKey, limit]);
  const [read, setRead] = useState<{ key: string; rows: T[] | null; failed: boolean } | null>(null);
  const rows = read?.key === key ? read.rows : null;
  const failed = read?.key === key && read.failed;
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const request = ++latest.current;
    const parsed = JSON.parse(filterKey) as Record<
      string,
      string | string[] | { gt: string }
    > | null;
    if (parsed === null) return null;
    let query = supabase.from(view).select(columns);
    for (const [column, value] of Object.entries(parsed)) {
      if (value === null) throw new TypeError(`Null filter on ${column}`);
      query = Array.isArray(value)
        ? query.in(column, value)
        : typeof value === 'object'
          ? query.gt(column, value.gt)
          : query.eq(column, value);
    }
    let ordered = query.order(order, { ascending: limit === undefined });
    if (limit !== undefined) ordered = ordered.limit(limit);
    const result = await ordered.then(
      (response) => response,
      () => null,
    );
    if (request !== latest.current) return null;
    const fresh = result && !result.error ? ((result.data as T[] | null) ?? []) : null;
    // Un échec garde les lignes déjà lues sous ce filtre.
    setRead((before) => ({
      key,
      rows: fresh ?? (before?.key === key ? before.rows : null),
      failed: fresh === null,
    }));
    return fresh;
  }, [key, view, columns, order, filterKey, limit]);
  useEffect(() => void reload(), [reload]);
  return { rows, failed, reload };
}

/**
 * Une ligne de règles de la configuration en vigueur (vue `site_rules` ou `ship_rules`), lue par `parse`.
 * `rules` vaut `null` tant que rien n'a été lu ; seule la réponse de la lecture la plus récente est
 * retenue. Aucune ligne (aucune configuration en vigueur) se lit comme une ligne vide : rien à proposer.
 */
function useRulesRow<T>(view: string, columns: string, parse: (row: unknown) => T | null) {
  const [rules, setRules] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const request = ++latest.current;
    const result = await supabase
      .from(view)
      .select(columns)
      .limit(1)
      .then(
        (response) => response,
        () => null,
      );
    if (request !== latest.current) return;
    const next = result && !result.error ? parse(result.data?.[0] ?? null) : null;
    setFailed(next === null);
    if (next) setRules(next);
  }, [view, columns, parse]);
  useEffect(() => void reload(), [reload]);
  return { rules, failed, reload };
}

/** Règles des sites de la configuration en vigueur (vue `site_rules`, une ligne). */
export const useSiteRules = () => useRulesRow('site_rules', 'recipes, sites', parseSiteRules);

/** Règles du transport de la configuration en vigueur (vue `ship_rules`, une ligne). */
export const useShipRules = () => useRulesRow('ship_rules', 'ships', parseShipRules);
