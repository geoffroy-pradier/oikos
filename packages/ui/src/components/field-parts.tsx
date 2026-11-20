import { useId, type ReactNode } from 'react';
import { cn } from '../cn';

/**
 * Cible tactile de 44 px de haut au moins, quelle que soit la hauteur visible de la commande : un
 * pseudo-élément déborde au-dessus et au-dessous quand la commande est plus basse (bouton de 40 px).
 */
export const TOUCH_TARGET =
  "relative after:absolute after:inset-x-0 after:inset-y-[min(0px,calc((100%_-_2.75rem)/2))] after:content-['']";

/**
 * Boîte de saisie : 48 px, rayon de 14 px, bordure de commande, bord accent au foyer ; une erreur
 * borde de danger, et le foyer reste visible par l'anneau.
 */
export const CONTROL =
  'min-h-12 w-full rounded-lg border border-border bg-surface-raised px-3.5 text-foreground ' +
  'transition-[border-color,box-shadow] duration-(--motion-fast) ease-out placeholder:text-muted-foreground ' +
  'hover:border-foreground-secondary focus-visible:border-accent focus-visible:ring-1 ' +
  'focus-visible:ring-accent focus-visible:outline-none aria-invalid:border-danger ' +
  'aria-invalid:ring-danger disabled:cursor-not-allowed disabled:opacity-60';

export interface FieldTextProps {
  /** Libellé, déjà traduit. */
  label: ReactNode;
  /** Aide sous le champ, déjà traduite. */
  hint?: ReactNode | undefined;
  /** Message d'erreur déjà traduit. Sa présence marque le champ comme invalide. */
  error?: ReactNode | undefined;
}

/** Identifiants qui relient un champ à son aide et à son erreur, et les attributs ARIA qui en découlent. */
export function useFieldIds(
  { hint, error }: Omit<FieldTextProps, 'label'>,
  id?: string,
  describedBy?: string,
) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return {
    inputId,
    hintId,
    errorId,
    aria: {
      'aria-invalid': error ? true : undefined,
      'aria-describedby': [describedBy, hintId, errorId].filter(Boolean).join(' ') || undefined,
    },
  };
}

/**
 * Libellé au-dessus, aide et erreur au-dessous ; l'erreur est une région vivante présente avant elle,
 * `alert` par défaut, polie (`polite`) pour un message qui suit la frappe et ne doit pas la couper.
 */
export function FieldFrame({
  ids,
  label,
  hint,
  error,
  quiet = false,
  polite = false,
  hideLabel = false,
  children,
}: FieldTextProps & {
  /** Libellé lu mais non affiché : un choix d'en-tête de page, que sa valeur suffit à montrer. */
  hideLabel?: boolean | undefined;
  /** Champ qui n'a jamais d'erreur (langue dans l'en-tête) : pas de région vivante vide à côté. */
  quiet?: boolean | undefined;
  ids: ReturnType<typeof useFieldIds>;
  polite?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <label htmlFor={ids.inputId} className={hideLabel ? 'sr-only' : 'mb-1.5 font-medium'}>
        {label}
      </label>
      {children}
      {hint && (
        <p id={ids.hintId} className="mt-1.5 text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {/* L'erreur n'est jamais portée par la couleur seule : texte explicite, annoncé. */}
      {!quiet && (
        <p
          id={ids.errorId}
          role={polite ? undefined : 'alert'}
          aria-live={polite ? 'polite' : undefined}
          className={cn('text-sm font-semibold text-danger', error ? 'mt-1.5' : undefined)}
        >
          {error}
        </p>
      )}
    </div>
  );
}
