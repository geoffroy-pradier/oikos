/**
 * Classes communes des écrans d'Olympe, prises des composants de `@oikos/ui` (ADR 0011) pour les champs que
 * le back-office écrit encore lui-même : boîte de saisie de 48 px, bord accent au foyer, bord de danger en erreur.
 */
export const CONTROL =
  'min-h-12 w-full rounded-lg border border-border bg-surface-raised px-3.5 text-foreground ' +
  'transition-[border-color,box-shadow] duration-(--motion-fast) ease-out placeholder:text-muted-foreground ' +
  'hover:border-foreground-secondary focus-visible:border-accent focus-visible:ring-1 ' +
  'focus-visible:ring-accent focus-visible:outline-none aria-invalid:border-danger aria-invalid:ring-danger';

/** Alerte écrite d'un écran : fond et texte de danger, jamais la couleur seule (le texte dit l'alerte). */
export const ALERT =
  'rounded-xl border border-danger/30 bg-danger-subtle px-4 py-3 text-sm font-semibold text-danger';

/** Cadre d'un tableau de données sur ordinateur ; sous 1 024 px, ses fiches s'empilent sans cadre. */
export const FRAME =
  'lg:rounded-xl lg:border lg:border-border-subtle lg:bg-surface lg:px-2 lg:shadow-sm';

/** Section repliable d'un panneau (tables des Paramètres) : résumé en rangée, chevron qui pivote à l'ouverture. */
export const SECTION =
  'group rounded-xl border border-border-subtle px-3 py-2 open:pb-4 [&>*+*]:mt-3';
export const SUMMARY =
  'flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg font-semibold ' +
  "before:size-2 before:shrink-0 before:rotate-45 before:border-t-2 before:border-r-2 before:border-current before:content-[''] " +
  'before:transition-transform group-open:before:rotate-135 [&::-webkit-details-marker]:hidden';
