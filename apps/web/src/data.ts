import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

/**
 * Lit les lignes d'une vue de lecture (les règles par ligne ne rendent que celles du joueur).
 * `rows` vaut `null` tant que rien n'a été lu ; `failed` signale un échec, jamais pris pour « rien ».
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
  const reload = useCallback(async () => {
    let query = supabase.from(view).select(columns);
    for (const [column, value] of Object.entries(JSON.parse(filterKey) as Record<string, string>))
      query = query.eq(column, value);
    const result = await query.order(order).then(
      (response) => response,
      () => null,
    );
    if (!result || result.error) return setFailed(true);
    setFailed(false);
    setRows((result.data as T[] | null) ?? []);
  }, [view, columns, order, filterKey]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { rows, failed, reload };
}
