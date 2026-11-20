import { cn } from '@oikos/ui';
import type { ComponentProps, ReactNode } from 'react';

/**
 * Titre d'une section d'écran (#869) : un seul style partout, et une icône au trait, décorative, que les titres
 * d'un même écran portent tous ou qu'aucun ne porte.
 */
export function SectionTitle({
  icon,
  className,
  children,
  ...props
}: ComponentProps<'h2'> & { icon?: ReactNode }) {
  return (
    <h2
      {...props}
      className={cn(
        'flex items-center gap-2 text-lg font-semibold [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-accent',
        className,
      )}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      {children}
    </h2>
  );
}
