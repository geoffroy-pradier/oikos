import { useEffect, useRef, useState } from 'react';

/**
 * Cadre d'un résultat de commande. Vide, la région reste dans l'arbre d'accessibilité (`empty:sr-only`,
 * jamais `display:none`), pour que l'annonce soit lue dès qu'elle apparaît.
 */
export function noticeClass(kind: 'status' | 'alert' | undefined) {
  return (
    'rounded-lg p-3 empty:sr-only ' +
    (kind === 'alert'
      ? 'bg-danger-subtle font-semibold text-danger'
      : 'bg-success-subtle text-foreground')
  );
}

/** Régions d'annonce des formulaires : cadrées quand elles ont un texte, masquées à la vue (jamais `display:none`) sinon. */
export const STATUS_BOX = noticeClass('status') + ' py-2';
export const ALERT_BOX = noticeClass('alert') + ' py-2';

export type Notice = { kind: 'status' | 'alert'; text: string } | null;

/**
 * Résultat d'une commande, annoncé près de l'action dans une région vivante présente avant lui (10, Exigences) :
 * si le contrôle qui l'a lancée est devenu inactif ou a disparu, le foyer passe sur ce résultat, sinon il reste
 * sur le contrôle.
 */
export function useCommandNotice({ styled = false }: { styled?: boolean } = {}) {
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
      className={
        styled
          ? noticeClass(notice?.kind)
          : notice?.kind === 'alert'
            ? 'font-semibold text-danger'
            : ''
      }
    >
      {notice?.text ?? ''}
    </p>
  );
  return { setNotice, region };
}
