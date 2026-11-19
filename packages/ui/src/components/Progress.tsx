import { useId, type ReactNode } from 'react';
import { cn } from '../cn';

export interface ProgressProps {
  /** Nom de la barre, visible au-dessus d'elle. */
  label: ReactNode;
  value: number;
  max?: number;
  /** Valeur dite en clair et déjà formatée (« 60 % », « 3 jours sur 5 ») : affichée et lue. */
  valueText: string;
  className?: string;
}

/** Barre d'avancement : le chiffre est toujours écrit à côté, la barre ne fait que le montrer. */
export function Progress({ label, value, max = 100, valueText, className }: ProgressProps) {
  const id = useId();
  const clamped = Math.min(Math.max(value, 0), max);
  const percent = max > 0 ? (clamped / max) * 100 : 0;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span id={id}>{label}</span>
        <span aria-hidden="true" className="text-muted-foreground tabular-nums">
          {valueText}
        </span>
      </div>
      <div
        role="progressbar"
        aria-labelledby={id}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={clamped}
        aria-valuetext={valueText}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-(--motion-base) ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
