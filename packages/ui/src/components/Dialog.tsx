import { useId, type ReactNode } from 'react';
import { Modal } from './Modal';

export interface DialogProps {
  open: boolean;
  /** Échap et le voile valent l'annulation. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /**
   * Boutons de la décision ; le premier reçoit le foyer, il est donc le moins risqué (« Annuler »)
   * quand l'action est destructrice.
   */
  actions: ReactNode;
}

/** Boîte de confirmation courte, centrée, une seule question. */
export function Dialog({ open, onClose, title, description, actions }: DialogProps) {
  const id = useId();
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={`${id}-title`}
      describedBy={description ? `${id}-text` : undefined}
      role="alertdialog"
      className="relative m-auto w-full max-w-md animate-rise gap-2 rounded-2xl p-6"
    >
      <h2 id={`${id}-title`} className="text-lg">
        {title}
      </h2>
      {description && (
        <p id={`${id}-text`} className="text-sm text-foreground-secondary">
          {description}
        </p>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">{actions}</div>
    </Modal>
  );
}
