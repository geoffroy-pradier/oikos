import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../cn';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Éléments atteignables à la tabulation dans `root`, hors des parties cachées (étapes inactives). */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.closest('[hidden]'),
  );
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Identifiant du titre visible qui nomme la fenêtre. */
  labelledBy: string;
  describedBy?: string | undefined;
  role?: 'dialog' | 'alertdialog';
  /** Classes du panneau : sa place et sa forme. */
  className?: string;
  children: ReactNode;
}

/**
 * Socle commun de `Sheet` et `Dialog` : voile, piège du foyer, Échap, foyer rendu au déclencheur et
 * défilement de la page bloqué tant que la fenêtre est ouverte. Le foyer va au premier élément
 * atteignable, sauf si un enfant l'a déjà pris (`autoFocus`).
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  describedBy,
  role = 'dialog',
  className,
  children,
}: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const current = panel.current;
    if (!open || !current) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.documentElement;
    // Valeur précédente gardée : deux fenêtres empilées se referment dans l'ordre inverse.
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    if (!current.contains(document.activeElement)) (focusables(current)[0] ?? current).focus();
    return () => {
      root.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panel.current) return;
    const items = focusables(panel.current);
    const first = items[0];
    const last = items.at(-1);
    const active = document.activeElement;
    if (!first || !last) {
      event.preventDefault();
    } else if (event.shiftKey && (active === first || active === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex p-4">
      <div
        aria-hidden="true"
        className="absolute inset-0 animate-fade bg-scrim"
        onClick={onClose}
      />
      <div
        ref={panel}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn(
          'flex flex-col border border-border-subtle bg-surface text-foreground shadow-lg',
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
