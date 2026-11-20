/** Gestes du joueur qui font ou annoncent un défilement : le premier arrête tout suivi. */
const GESTURES = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

/**
 * Durée au plus pendant laquelle le résultat d'une commande suit la page : les relectures que la commande ou la
 * minuterie relancent (sites, journées de travail, intendants, événements) se rendent en bien moins.
 */
export const KEEP_IN_VIEW_MS = 5_000;

/**
 * Garde `element` dans la fenêtre après son annonce (#869) : rendu visible une fois, puis de nouveau chaque fois
 * que la page change de taille (une relecture qui agrandit une fiche au-dessus de lui), jusqu'au premier geste
 * du joueur (molette, doigt, pointeur, touche) ou `KEEP_IN_VIEW_MS` au plus. Le joueur n'est jamais retenu : son
 * premier geste arrête le suivi, avant que son défilement ne commence. Rend la fonction qui arrête le suivi.
 */
export function keepInView(element: Element, ms = KEEP_IN_VIEW_MS): () => void {
  element.scrollIntoView({ block: 'nearest' });
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  const observer = new ResizeObserver(() => element.scrollIntoView({ block: 'nearest' }));
  observer.observe(document.body);
  const options = { capture: true, passive: true } as const;
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
    for (const gesture of GESTURES) window.removeEventListener(gesture, stop, options);
  };
  for (const gesture of GESTURES) window.addEventListener(gesture, stop, options);
  const timer = setTimeout(stop, ms);
  return stop;
}
