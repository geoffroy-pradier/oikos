import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface EmptyStateProps {
  /** Icône décorative, au trait. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Action qui sort de l'état vide (un bouton ou un lien). */
  action?: ReactNode;
  /** Niveau du titre dans la page. */
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

/** Rien à montrer : dire pourquoi, et proposer l'action qui y remédie. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  headingLevel = 3,
  className,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      className={cn(
        'flex animate-rise flex-col items-center gap-3 rounded-xl border border-dashed',
        'border-border-subtle px-6 py-10 text-center',
        className,
      )}
    >
      {icon && (
        <div
          aria-hidden="true"
          className="grid size-14 place-items-center rounded-full bg-primary-subtle text-primary ring-8 ring-primary-subtle/40 [&_svg]:size-7"
        >
          {icon}
        </div>
      )}
      <Heading className="text-lg">{title}</Heading>
      {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
