import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { ignoreHeldEnter, SHIFT_GUARD_MS } from '../keyboard';

/**
 * Ajout et retrait de lignes dans un formulaire de table (15.4). Comme une saisie, un geste réécrit le
 * texte entier (`write`). Les lignes viennent alors de bouger sous le pointeur : le second clic d'un double
 * clic (`detail`), ou un toucher juste après, n'agit pas et ne prend pas le foyer. Le délai ne vaut pas
 * pour la souris, dont le compte de clics distingue déjà un double clic ; type de pointeur inconnu : délai,
 * par prudence. Le foyer va ensuite dans un champ, ou sur un bouton d'ajout, jamais sur un autre bouton de
 * retrait ; une touche Entrée tenue ne répète aucun geste (`guard`).
 */
export function useReshape(write: (text: string) => void) {
  /**
   * Retrait annoncé tant que le texte reste celui qu'il a écrit. `count` numérote les retraits : deux
   * retraits de suite au même nom donnent deux annonces, pas un texte inchangé.
   */
  const [removed, setRemoved] = useState<{ text: string; message: string; count: number } | null>(
    null,
  );
  /** Élément qui prend le foyer quand le texte réécrit par le geste est affiché. */
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    if (focusNext.current) document.getElementById(focusNext.current)?.focus();
    focusNext.current = null;
  });
  const movedAt = useRef(-Infinity);
  const stray = ({ detail, nativeEvent }: MouseEvent) =>
    detail > 1 ||
    (detail === 1 &&
      (nativeEvent as Partial<PointerEvent>).pointerType !== 'mouse' &&
      performance.now() - movedAt.current < SHIFT_GUARD_MS);
  return {
    /** À poser sur chaque bouton d'ajout ou de retrait. */
    guard: {
      onMouseDown: (event: MouseEvent) => {
        if (stray(event)) event.preventDefault();
      },
      onKeyDown: ignoreHeldEnter,
    },
    /** Écrit `text`, puis pose le foyer sur `focus` ; `removal` : annonce d'un retrait. */
    reshape(event: MouseEvent, text: string, focus: string, removal?: string) {
      if (stray(event)) return;
      // Un clic né du clavier (`detail` nul) ne déplace rien sous le pointeur : il n'arme pas le délai.
      if (event.detail > 0) movedAt.current = performance.now();
      focusNext.current = focus;
      write(text);
      if (removal !== undefined)
        setRemoved((last) => ({ text, message: removal, count: (last?.count ?? 0) + 1 }));
    },
    /**
     * Région de l'annonce, toujours présente. Sans rôle `status` : celui de l'écran reste le seul, qui
     * annonce l'issue des commandes. Un nœud neuf à chaque retrait (`key`) : il est lu même inchangé.
     */
    announcement: (config: unknown, id: string) => (
      <p id={id} aria-live="polite" className="text-sm">
        {removed && removed.text === JSON.stringify(config, null, 2) && (
          <span key={removed.count}>{removed.message}</span>
        )}
      </p>
    ),
  };
}
