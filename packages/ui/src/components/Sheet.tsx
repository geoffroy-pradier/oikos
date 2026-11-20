import { useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../cn';
import { IconButton } from './Button';
import { Modal } from './Modal';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Nom du bouton Fermer (« Fermer »), traduit par l'écran. */
  closeLabel: string;
  /** Commande en vol : le bouton Fermer est inactif (l'appelant ignore aussi Échap et le voile). */
  closeDisabled?: boolean;
  /** Actions fixées en bas de la feuille, hors de la partie qui défile. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Feuille d'action (ADR 0011) : montée du bas sous 1 024 px, panneau latéral droit au-delà. Fermée par
 * le bouton Fermer, Échap ou le voile ; le foyer revient alors au contrôle qui l'a ouverte.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  closeLabel,
  closeDisabled = false,
  footer,
  children,
  className,
}: SheetProps) {
  const id = useId();
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={`${id}-title`}
      className={cn(
        'absolute inset-x-0 bottom-0 max-h-[90dvh] animate-sheet-up rounded-t-3xl border-b-0',
        'lg:inset-y-0 lg:right-0 lg:left-auto lg:max-h-none lg:w-md lg:animate-sheet-left',
        'lg:rounded-none lg:border-y-0 lg:border-r-0',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-border lg:hidden"
      />
      <header className="flex items-start gap-3 px-5 pt-3 pb-2 lg:pt-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-2">
          <h2 id={`${id}-title`} className="text-lg">
            {title}
          </h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <IconButton icon={<X />} label={closeLabel} onClick={onClose} disabled={closeDisabled} />
      </header>
      <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
      {footer && (
        <footer className="flex flex-wrap justify-end gap-2 border-t border-border-subtle px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {footer}
        </footer>
      )}
    </Modal>
  );
}
