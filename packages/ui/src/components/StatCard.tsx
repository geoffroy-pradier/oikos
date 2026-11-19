import type { ReactNode } from 'react';
import { cn } from '../cn';
import { Card } from './Card';

const GLYPHS = { up: '▲', down: '▼', flat: '–' } as const;
const TONES = {
  positive: 'text-success',
  negative: 'text-danger',
  neutral: 'text-muted-foreground',
} as const;

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  /** Icône décorative, à droite du libellé. */
  icon?: ReactNode;
  /**
   * Variation, déjà formatée et signée (« +4,2 % »). Le triangle double le sens par la forme, jamais
   * la couleur seule ; le ton dit si elle est bonne (une charge qui monte est `negative`).
   */
  delta?: { value: ReactNode; trend: keyof typeof GLYPHS; tone?: keyof typeof TONES };
  /** Précision après la variation (« depuis hier »). */
  hint?: ReactNode;
  className?: string;
}

/** Chiffre clé en carte : libellé atténué et icône, valeur en chiffres tabulaires, variation. */
export function StatCard({ label, value, icon, delta, hint, className }: StatCardProps) {
  const tone =
    delta?.tone ??
    (delta?.trend === 'up' ? 'positive' : delta?.trend === 'down' ? 'negative' : 'neutral');
  return (
    <Card className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between gap-2 text-[0.8125rem] text-muted-foreground">
        <span>{label}</span>
        {icon && (
          <span aria-hidden="true" className="[&_svg]:size-4">
            {icon}
          </span>
        )}
      </div>
      <p className="text-[1.75rem] leading-tight font-bold tabular-nums [overflow-wrap:anywhere]">
        {value}
      </p>
      {(delta || hint) && (
        <p className="flex flex-wrap items-center gap-x-1.5 text-[0.8125rem] text-muted-foreground">
          {delta && (
            <span
              data-trend={delta.trend}
              className={cn('font-semibold tabular-nums', TONES[tone])}
            >
              <span aria-hidden="true">{GLYPHS[delta.trend]} </span>
              {delta.value}
            </span>
          )}
          {hint}
        </p>
      )}
    </Card>
  );
}
