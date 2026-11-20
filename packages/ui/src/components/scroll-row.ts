import { useEffect, useLayoutEffect, useState } from 'react';

/** Élément actif d'une rangée : lien de la page ouverte, onglet choisi ou option cochée. */
const ACTIVE = '[aria-current="page"], [aria-selected="true"], [aria-checked="true"]';

/** Bords de la rangée où il reste du contenu caché, pour le fondu de `scroll-fade` (`data-fade`). */
export function fadeEdges(row: Pick<HTMLElement, 'scrollLeft' | 'scrollWidth' | 'clientWidth'>) {
  const start = row.scrollLeft > 1;
  const end = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
  return [start && 'start', end && 'end'].filter(Boolean).join(' ');
}

/** Défile la rangée pour centrer son élément actif, sans faire défiler la page. */
export function centerActive(row: HTMLElement) {
  const here = row.querySelector<HTMLElement>(ACTIVE);
  if (!here) return;
  const offset = here.getBoundingClientRect().left - row.getBoundingClientRect().left;
  row.scrollLeft += offset - (row.clientWidth - here.offsetWidth) / 2;
}

/**
 * Défile la rangée juste assez pour montrer l'élément en entier, hors du fondu (marge de défilement de
 * `scroll-fade`) : le navigateur, lui, ne défile pas pour un élément déjà en partie visible qui prend le foyer.
 */
export function revealItem(row: HTMLElement, item: HTMLElement) {
  const margin = Number.parseFloat(getComputedStyle(row).scrollPaddingLeft) || 0;
  const left = item.getBoundingClientRect().left - row.getBoundingClientRect().left;
  const right = left + item.offsetWidth;
  if (left < margin) row.scrollLeft += left - margin;
  else if (right > row.clientWidth - margin) row.scrollLeft += right - row.clientWidth + margin;
}

/**
 * Rangée qui défile quand elle est plus large que l'écran (pastilles, navigation d'Olympe ; #700, #862) :
 * elle s'ouvre centrée sur son élément actif, et se recentre quand `active` change ; ses bords où il reste du
 * contenu portent un fondu (classe `scroll-fade`, attribut `data-fade` tenu à jour au défilement et au
 * redimensionnement) ; un élément qui prend le foyer y est montré en entier. Rien n'est animé : le défilement est
 * immédiat.
 */
export function useScrollRow<T extends HTMLElement>(active: unknown) {
  // Rappel de référence : une rangée montée après le premier rendu (navigation d'Olympe) est suivie aussi.
  const [row, setRow] = useState<T | null>(null);
  useLayoutEffect(() => {
    if (!row) return;
    const center = () => {
      centerActive(row);
      row.dataset.fade = fadeEdges(row);
    };
    center();
    // Police chargée après ce rendu : les éléments changent de largeur, la rangée se recentre.
    void document.fonts?.ready.then(center);
  }, [row, active]);
  useEffect(() => {
    if (!row) return;
    const update = () => {
      row.dataset.fade = fadeEdges(row);
    };
    const reveal = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) revealItem(row, event.target);
    };
    row.addEventListener('scroll', update, { passive: true });
    row.addEventListener('focusin', reveal);
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (sizes) for (const node of [row, ...row.children]) sizes.observe(node);
    return () => {
      row.removeEventListener('scroll', update);
      row.removeEventListener('focusin', reveal);
      sizes?.disconnect();
    };
  }, [row]);
  return setRow;
}
