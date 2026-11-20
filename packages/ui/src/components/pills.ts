import { cn } from '../cn';
import { TOUCH_TARGET } from './field-parts';

/** Gélule qui porte des pastilles (`SegmentedControl`). */
export const PILL_LIST =
  'flex max-w-full gap-1 overflow-x-auto rounded-full border border-border-subtle bg-surface-raised p-1';

/**
 * Gélule d'une rangée qui défile (`PillTabs`, rubriques de la maison) : le cadre porte la bordure et le fond,
 * la rangée `PILL_ROW` qu'il contient défile avec un fondu sur ses bords (`useScrollRow`).
 */
export const PILL_FRAME =
  'flex max-w-full self-start rounded-full border border-border-subtle bg-surface-raised';
export const PILL_ROW = 'flex min-w-0 gap-1 overflow-x-auto p-1 scroll-fade';

/** Pastille de 36 px (44 px de cible) ; l'active est pleine, au contraste le plus fort. */
export function pillClass(active: boolean) {
  return cn(
    TOUCH_TARGET,
    'inline-flex min-h-9 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium',
    'whitespace-nowrap transition-[background-color,color] duration-(--motion-base) ease-out',
    'focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:size-4',
    active
      ? 'bg-foreground text-background shadow-sm'
      : 'text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground',
  );
}

/**
 * Index visé par une touche dans une rangée, en boucle : flèches gauche et droite (et haut et bas si
 * `vertical`), Début, Fin ; `undefined` : touche sans effet.
 */
export function moveTo(key: string, index: number, count: number, vertical = false) {
  if (key === 'ArrowRight' || (vertical && key === 'ArrowDown')) return (index + 1) % count;
  if (key === 'ArrowLeft' || (vertical && key === 'ArrowUp')) return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return undefined;
}
