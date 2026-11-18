import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

const ELEVATIONS = {
  flat: 'bg-surface',
  raised: 'bg-surface-raised shadow-md',
  sunken: 'bg-muted/60 shadow-none',
} as const;

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Plan de la fiche : posée (par défaut), surélevée (mise en avant) ou en creux (groupe secondaire). */
  elevation?: keyof typeof ELEVATIONS;
}

/** Fiche : unité d'empilement des écrans sur téléphone. */
export function Card({ className, elevation = 'flat', ...props }: CardProps) {
  return (
    <section
      className={cn(
        'rounded-xl border border-border-subtle p-4 text-foreground shadow-sm',
        ELEVATIONS[elevation],
        className,
      )}
      {...props}
    />
  );
}
