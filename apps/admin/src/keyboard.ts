import type { KeyboardEvent } from 'react';

/** Entrée tenue : la répétition du clavier n'ouvre, ne confirme ni n'annule rien. */
export const ignoreHeldEnter = (event: KeyboardEvent) => {
  if (event.repeat && event.key === 'Enter') event.preventDefault();
};
