import type { ReactNode } from 'react';
import { cn } from '../cn';
import { EmptyIllustration, type EmptyKind } from '../illustrations/scenes';

export interface EmptyStateProps {
  /** Dessin de la famille de la liste vide (`EMPTY_ILLUSTRATION_IDS`), décoratif. */
  illustration?: EmptyKind;
  /** Icône au trait, pour un état qui n'est pas une liste vide (une lecture en échec), sans dessin. */
  icon?: ReactNode;
  /** La raison : pourquoi la liste est vide. */
  title: ReactNode;
  description?: ReactNode;
  /** L'action qui remplit la liste, quand elle existe (un bouton ou un lien). */
  action?: ReactNode;
  /** Niveau du titre dans la page. */
  headingLevel?: 2 | 3 | 4;
  /** Dans une section déjà titrée : dessin réduit à côté de la raison, sans cadre, la raison sans titre. */
  compact?: boolean;
  className?: string;
}

/** Rien à montrer : un dessin, la raison, et l'action qui remplit la liste. */
export function EmptyState({
  illustration,
  icon,
  title,
  description,
  action,
  headingLevel = 3,
  compact = false,
  className,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  // Trait neutre, aplats des jetons : le dessin suit le thème (couples dans `contrast.ts`).
  const art = illustration && (
    <div
      aria-hidden="true"
      className={cn(
        'shrink-0 text-foreground-secondary [&_svg]:h-auto [&_svg]:w-full',
        compact ? 'w-24' : 'w-40 max-w-full',
      )}
    >
      <EmptyIllustration kind={illustration} />
    </div>
  );
  if (compact) {
    return (
      // Police très agrandie : la raison passe sous le dessin plutôt que de déborder de la page.
      <div className={cn('flex animate-rise flex-wrap items-center gap-x-4 gap-y-2', className)}>
        {art}
        <div className="flex flex-1 basis-40 flex-col items-start gap-2">
          <p className="text-muted-foreground">{title}</p>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
          {action}
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'flex animate-rise flex-col items-center gap-3 rounded-xl border border-dashed',
        'border-border-subtle px-6 py-10 text-center',
        className,
      )}
    >
      {art}
      {icon && !illustration && (
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
