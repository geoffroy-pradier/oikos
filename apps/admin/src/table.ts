/**
 * Tableaux du back-office : denses, lisibles à 360 px dans une zone défilante.
 * En-têtes sur fond de surface, filets entre les lignes, survol de ligne.
 */
export const TABLE =
  'w-full text-left text-sm [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top [&_th]:px-2 [&_th]:py-1.5 [&_th]:align-bottom ' +
  '[&_thead_th]:border-b [&_thead_th]:border-border [&_thead_th]:bg-muted/60 [&_thead_th]:text-xs [&_thead_th]:font-semibold [&_thead_th]:text-muted-foreground ' +
  '[&_tbody_tr]:border-b [&_tbody_tr]:border-border-subtle [&_tbody_tr:hover]:bg-muted/40';
