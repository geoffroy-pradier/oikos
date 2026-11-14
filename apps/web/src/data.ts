import { useCallback, useEffect, useRef, useState } from 'react';
import { parseSiteRules, type SiteRules } from './site-rules';
import { supabase } from './supabase';

/**
 * Lit les lignes d'une vue de lecture (les règles par ligne ne rendent que celles du joueur).
 * `rows` vaut `null` tant que rien n'a été lu ; `failed` signale un échec, jamais pris pour « rien ».
 * Quand la vue ou le filtre change, les lignes de l'ancien filtre disparaissent aussitôt, et seule la
 * réponse de la lecture la plus récente est retenue : une réponse tardive ne s'affiche jamais sous un
 * autre filtre.
 */
export function useRows<T>(
  view: string,
  columns: string,
  order: string,
  filters: Record<string, string> = {},
) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [failed, setFailed] = useState(false);
  const filterKey = JSON.stringify(filters);
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const request = ++latest.current;
    let query = supabase.from(view).select(columns);
    for (const [column, value] of Object.entries(JSON.parse(filterKey) as Record<string, string>))
      query = query.eq(column, value);
    const result = await query.order(order).then(
      (response) => response,
      () => null,
    );
    if (request !== latest.current) return;
    if (!result || result.error) return setFailed(true);
    setFailed(false);
    setRows((result.data as T[] | null) ?? []);
  }, [view, columns, order, filterKey]);
  useEffect(() => {
    setRows(null);
    setFailed(false);
    void reload();
  }, [reload]);
  return { rows, failed, reload };
}

/**
 * Règles des sites de la configuration en vigueur (vue `site_rules`, une ligne). `rules` vaut `null`
 * tant que rien n'a été lu ; seule la réponse de la lecture la plus récente est retenue.
 */
export function useSiteRules() {
  const [rules, setRules] = useState<SiteRules | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const request = ++latest.current;
    const result = await supabase
      .from('site_rules')
      .select('recipes, sites')
      .limit(1)
      .then(
        (response) => response,
        () => null,
      );
    if (request !== latest.current) return;
    // Aucune ligne : aucune configuration en vigueur, donc rien à proposer.
    const next = result && !result.error ? parseSiteRules(result.data?.[0] ?? null) : null;
    setFailed(next === null);
    if (next) setRules(next);
  }, []);
  useEffect(() => void reload(), [reload]);
  return { rules, failed, reload };
}
