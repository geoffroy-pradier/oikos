import { useEffect, useState } from 'react';

/** Mise en page d'ordinateur (ADR 0011) : barre latérale et panneaux côte à côte, à partir de 1 024 px. */
const WIDE = '(min-width: 64rem)';

/** Vrai en mise en page d'ordinateur ; sans `matchMedia` (tests), aussi : rien n'y est caché. */
export function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia?.(WIDE).matches ?? true);
  useEffect(() => {
    const query = window.matchMedia?.(WIDE);
    if (!query) return;
    const change = () => setWide(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return wide;
}
