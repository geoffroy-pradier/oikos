import type { KeyboardEvent } from 'react';

/** Entrée tenue : la répétition du clavier n'ouvre, ne confirme ni n'annule rien. */
export const ignoreHeldEnter = (event: KeyboardEvent) => {
  if (event.repeat && event.key === 'Enter') event.preventDefault();
};

/**
 * Après un geste qui déplace ce qui est sous le pointeur (une confirmation qui disparaît, un bien
 * retiré), durée pendant laquelle un clic au pointeur est ignoré : le second toucher d'un double toucher.
 */
export const SHIFT_GUARD_MS = 500;
