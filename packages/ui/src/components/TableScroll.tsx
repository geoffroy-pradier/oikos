import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { cn } from '../cn';
import { useScrollRow } from './scroll-row';

/**
 * Cadre d'un tableau plus large que son conteneur (#865) : il défile à l'horizontale, ses bords où il reste des
 * colonnes cachées portent un fondu (`scroll-fade`, comme les pastilles), et, tant qu'il défile, il prend le foyer
 * au clavier (flèches) sous le nom du tableau. Sans débordement, rien n'est masqué et il n'ajoute aucun arrêt de
 * tabulation. Le défilement est immédiat : rien n'est animé.
 */
export function TableScroll(props: { label: string; className?: string; children: ReactNode }) {
  const { label, className, children } = props;
  const setRow = useScrollRow<HTMLDivElement>(null);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [scrolls, setScrolls] = useState(false);
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      setNode(element);
      setRow(element);
    },
    [setRow],
  );
  useEffect(() => {
    if (!node) return;
    const check = () => setScrolls(node.scrollWidth > node.clientWidth + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const sizes = new ResizeObserver(check);
    for (const watched of [node, ...node.children]) sizes.observe(watched);
    return () => sizes.disconnect();
  }, [node]);
  return (
    <div
      ref={ref}
      className={cn('scroll-fade overflow-x-auto focus-visible:-outline-offset-3', className)}
      {...(scrolls && { role: 'region', 'aria-label': label, tabIndex: 0 })}
    >
      {children}
    </div>
  );
}
