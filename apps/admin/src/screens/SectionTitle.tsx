import { cn } from '@oikos/ui';
import type { ComponentProps, ReactNode } from 'react';

/**
 * Titre d'une section d'écran d'Olympe, du même style que celui du jeu (#869) : une icône au trait, décorative,
 * que le texte double toujours.
 */
export function SectionTitle({
  icon,
  as: Heading = 'h2',
  className,
  children,
  ...props
}: ComponentProps<'h2'> & { icon: ReactNode; as?: 'h2' | 'h3' }) {
  return (
    <Heading
      {...props}
      className={cn(
        'flex items-center gap-2 text-lg font-semibold [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-accent',
        className,
      )}
    >
      <span aria-hidden="true">{icon}</span>
      {children}
    </Heading>
  );
}
