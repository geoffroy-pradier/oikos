import { cn } from '../cn';

export interface FriezeProps {
  /** Méandre (clé grecque) ou vague courante. */
  pattern?: 'meander' | 'wave';
  tone?: 'primary' | 'accent' | 'aegean' | 'foreground';
  className?: string;
}

/** Frise géométrique de céramique : ornement seul, cachée aux lecteurs d'écran. */
export function Frieze({ pattern = 'meander', tone = 'primary', className }: FriezeProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(pattern === 'meander' ? 'meander' : 'frieze-wave', 'w-full', className)}
      style={{ color: `var(--${tone})` }}
    />
  );
}
