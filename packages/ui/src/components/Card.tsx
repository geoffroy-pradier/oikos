import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

/** Fiche : unité d'empilement des écrans sur téléphone. */
export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        'rounded-lg border border-border bg-surface p-4 text-foreground shadow-sm',
        className,
      )}
      {...props}
    />
  );
}
