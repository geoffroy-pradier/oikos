import type { ReactNode, Ref } from 'react';
import { CircleAlert, Check, Info } from 'lucide-react';
import { cn } from '../cn';

const TONES = {
  info: ['bg-info-subtle text-info', Info],
  success: ['bg-success-subtle text-success', Check],
  danger: ['bg-danger-subtle text-danger', CircleAlert],
} as const;

export interface StatusRegionProps {
  /** Résultat à annoncer ; vide avant lui, la région restant présente pour être lue quand il paraît. */
  children?: ReactNode;
  tone?: keyof typeof TONES;
  /** `alert` pour une erreur qui interrompt, `status` (poli) pour tout le reste. Fixé au montage. */
  role?: 'status' | 'alert';
  /** Pour y porter le foyer quand le contrôle qui a lancé l'action disparaît ou devient inactif. */
  ref?: Ref<HTMLDivElement>;
  className?: string;
}

/** Région vivante placée près de l'action, rendue avant son résultat (spécification 10, Exigences). */
export function StatusRegion({
  children,
  tone = 'info',
  role = 'status',
  ref,
  className,
}: StatusRegionProps) {
  const [colours, Icon] = TONES[tone];
  const filled =
    children !== undefined && children !== null && children !== false && children !== '';
  return (
    <div ref={ref} role={role} tabIndex={-1} className={className}>
      {filled && (
        <p
          data-tone={tone}
          className={cn(
            'flex animate-rise items-start gap-2 rounded-lg px-3 py-2 text-sm font-medium',
            colours,
          )}
        >
          <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{children}</span>
        </p>
      )}
    </div>
  );
}
