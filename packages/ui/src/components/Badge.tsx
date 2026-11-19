import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

const TONES = {
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary-subtle text-primary',
  accent: 'bg-accent-subtle text-accent',
  aegean: 'bg-aegean-subtle text-aegean',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
  info: 'bg-info-subtle text-info',
} as const;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: keyof typeof TONES;
  /** Icône décorative avant le texte : l'état se lit toujours dans le texte, jamais à la seule couleur. */
  icon?: ReactNode;
}

/** Pastille d'état ou de catégorie. */
export function Badge({ tone = 'neutral', icon, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ' +
          'ring-1 ring-current/15 ring-inset [&_svg]:size-3.5',
        TONES[tone],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}
