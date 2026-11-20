import type { ReactNode, Ref } from 'react';
import { cn } from '../cn';

export interface PageHeaderProps {
  /** Titre de l'écran, seul `h1` de la page. */
  title: ReactNode;
  /** Ligne atténuée sous le titre : heure de jeu et prochaine clôture, dans le jeu. */
  subtitle?: ReactNode;
  /** Recherche de l'écran, s'il en a une. */
  search?: ReactNode;
  /**
   * Action principale (un bouton), à droite du titre, alignée sur sa ligne ; sous le titre quand la place
   * manque (téléphone), sans le couper.
   */
  action?: ReactNode;
  /** Ce qui suit le titre dans l'en-tête (un statut, des pastilles). */
  children?: ReactNode;
  /** Titre focalisable (`tabIndex=-1`) : le foyer y revient après une relecture. */
  titleRef?: Ref<HTMLHeadingElement>;
  className?: string;
}

/** En-tête de page commun (ADR 0011) : titre de 26 px, sous-titre atténué, recherche et action principale. */
export function PageHeader({
  title,
  subtitle,
  search,
  action,
  children,
  titleRef,
  className,
}: PageHeaderProps) {
  return (
    // Le titre reste en haut quelle que soit la hauteur de l'action : il est à la même place sur chaque écran.
    <div
      data-slot="page-header"
      className={cn('flex flex-wrap items-start gap-x-6 gap-y-3', className)}
    >
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1 [overflow-wrap:anywhere]">
        <h1
          ref={titleRef}
          tabIndex={titleRef ? -1 : undefined}
          className="text-[1.625rem] leading-tight font-bold"
        >
          {title}
        </h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        {children}
      </div>
      {(search ?? action) && (
        // Bouton de 40 px centré sur la ligne du titre (26 px, interligne serré) quand il est à sa droite.
        <div data-slot="page-header-action" className="flex flex-wrap items-center gap-2 sm:-mt-1">
          {search}
          {action}
        </div>
      )}
    </div>
  );
}
