import { useMemo, type ReactNode } from 'react';
import { useRows } from './data';
import { GoodTiersContext, parseGoodTiers } from './good-tiers';

/** Lit les niveaux des biens une fois pour la coquille ; lecture en cours ou en échec : aucun niveau, la caisse. */
export function GoodTiersProvider({ children }: { children: ReactNode }) {
  const { rows } = useRows<unknown>('good_tiers', 'good_id, tier', 'good_id');
  const tiers = useMemo(() => parseGoodTiers(rows), [rows]);
  return <GoodTiersContext.Provider value={tiers}>{children}</GoodTiersContext.Provider>;
}
