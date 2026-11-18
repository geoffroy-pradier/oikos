import { cn } from '../cn';

/**
 * Forme de chargement, cachée aux lecteurs d'écran : la région qui charge s'annonce elle-même
 * (`role="status"` ou `aria-busy`). Sa taille se donne par `className` (`h-4 w-32`).
 */
export function Skeleton({ className, round = false }: { className?: string; round?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'block h-4 animate-shimmer bg-size-[200%_100%]',
        'bg-linear-to-r from-muted via-border-subtle/40 to-muted',
        round ? 'rounded-full' : 'rounded-md',
        className,
      )}
    />
  );
}
