import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '../cn';

const TRENDS = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const;
const TONES = {
  positive: 'bg-success-subtle text-success',
  negative: 'bg-danger-subtle text-danger',
  neutral: 'bg-muted text-muted-foreground',
} as const;

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  /**
   * Variation, déjà formatée et signée (« +12 % »). La flèche en double le sens par la forme ;
   * le ton dit si elle est bonne (une dépense qui monte est `negative`). Par défaut, la hausse est bonne.
   */
  delta?: { value: ReactNode; trend: keyof typeof TRENDS; tone?: keyof typeof TONES };
  /** Précision sous le chiffre (« depuis hier »). */
  hint?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/** Chiffre clé d'un tableau de bord : libellé, valeur, variation. */
export function Stat({ label, value, delta, hint, icon, className }: StatProps) {
  const Arrow = delta && TRENDS[delta.trend];
  const tone =
    delta?.tone ??
    (delta?.trend === 'up' ? 'positive' : delta?.trend === 'down' ? 'negative' : 'neutral');
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center gap-2">
        {icon && (
          <span aria-hidden="true" className="text-accent [&_svg]:size-4">
            {icon}
          </span>
        )}
        <span className="eyebrow">{label}</span>
      </div>
      <p className="font-display text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      {(delta || hint) && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {delta && Arrow && (
            <span
              data-trend={delta.trend}
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums',
                TONES[tone],
              )}
            >
              <Arrow aria-hidden="true" className="size-3.5" />
              {delta.value}
            </span>
          )}
          {hint}
        </p>
      )}
    </div>
  );
}
