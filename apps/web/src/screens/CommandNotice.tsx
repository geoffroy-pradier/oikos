import { useEffect, useRef, useState } from 'react';

export type Notice = { kind: 'status' | 'alert'; text: string } | null;

/**
 * Résultat d'une commande, annoncé près de l'action dans une région vivante présente avant lui (10, Exigences) :
 * si le contrôle qui l'a lancée est devenu inactif ou a disparu, le foyer passe sur ce résultat, sinon il reste
 * sur le contrôle.
 */
export function useCommandNotice() {
  const element = useRef<HTMLParagraphElement>(null);
  const [notice, setNotice] = useState<Notice>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (notice && (active === document.body || active?.hasAttribute('disabled')))
      element.current?.focus();
  }, [notice]);
  const region = (
    <p
      ref={element}
      tabIndex={-1}
      role={notice?.kind ?? 'status'}
      className={notice?.kind === 'alert' ? 'font-semibold text-danger' : ''}
    >
      {notice?.text ?? ''}
    </p>
  );
  return { setNotice, region };
}
