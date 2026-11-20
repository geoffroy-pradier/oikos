/**
 * Classes communes des écrans d'Olympe, prises des composants de `@oikos/ui` (ADR 0011) pour les champs que
 * le back-office écrit encore lui-même : boîte de saisie de 48 px, bord accent au foyer, bord de danger en erreur.
 */
export const CONTROL =
  'min-h-12 w-full rounded-lg border border-border bg-surface-raised px-3.5 text-foreground ' +
  'transition-[border-color,box-shadow] duration-(--motion-fast) ease-out placeholder:text-muted-foreground ' +
  'hover:border-foreground-secondary focus-visible:border-accent focus-visible:ring-1 ' +
  'focus-visible:ring-accent focus-visible:outline-none aria-invalid:border-danger aria-invalid:ring-danger';
