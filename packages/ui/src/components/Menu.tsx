import { Ellipsis } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../cn';
import { Button } from './Button';

export interface MenuItem {
  /** Identifiant DOM de l'élément, unique dans la page. */
  id: string;
  /** Libellé, déjà traduit. */
  label: string;
  /** Icône décorative, devant le libellé. */
  icon: ReactNode;
  onSelect: () => void;
  /** Geste lourd de conséquences : texte en danger. */
  danger?: boolean;
  /** Trait de séparation avant l'élément : il ouvre un nouveau groupe de gestes. */
  separated?: boolean;
}

export interface MenuProps {
  /** Libellé visible du bouton qui ouvre le menu, déjà traduit. */
  label: string;
  items: readonly MenuItem[];
  /** Identifiant DOM du bouton. */
  id?: string;
  disabled?: boolean;
  /**
   * Rouvre le menu le foyer sur cet élément (son `id`) : après une feuille ouverte par un élément puis annulée, le
   * foyer revient au geste. Changer la valeur rouvre ; `null` ne fait rien.
   */
  reopenOn?: string | null;
}

/** Largeur du menu (`w-64`) : il s'ouvre vers la droite du bouton s'il tient, sinon vers la gauche. */
const MENU_WIDTH = 256;

/**
 * Menu d'actions (motif « menu button » de l'ARIA) : un bouton, puis une liste de gestes, chacun avec son icône.
 * Clavier : Entrée, Espace ou ↓ ouvrent sur le premier geste, ↑ sur le dernier ; ↑ ↓ parcourent en boucle, Début et
 * Fin vont aux bouts ; Échap referme et rend le foyer au bouton ; Tab referme. Un geste choisi referme le menu et
 * rend le foyer au bouton avant d'agir : une feuille ouverte par lui le lui rend à sa fermeture.
 */
export function Menu({ label, items, id, disabled, reopenOn = null }: MenuProps) {
  const generated = useId();
  const triggerId = id ?? `${generated}-trigger`;
  const menuId = `${generated}-menu`;
  const trigger = useRef<HTMLButtonElement>(null);
  const entries = useRef<(HTMLButtonElement | null)[]>([]);
  /** Geste qui a le foyer, menu ouvert ; `null` : menu fermé. */
  const [active, setActive] = useState<number | null>(null);
  const [alignEnd, setAlignEnd] = useState(false);
  const open = active !== null;

  const show = (index: number) => {
    const rect = trigger.current?.getBoundingClientRect();
    setAlignEnd(!!rect && rect.left + MENU_WIDTH > window.innerWidth - 16);
    setActive((index + items.length) % items.length);
  };
  const close = (refocus: boolean) => {
    setActive(null);
    if (refocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (active !== null) entries.current[active]?.focus();
  }, [active]);

  // Rouverture demandée sur un geste : seule la valeur compte, pas la liste qui se recompose à chaque rendu.
  const itemIds = items.map((item) => item.id).join(' ');
  useEffect(() => {
    const index = reopenOn ? itemIds.split(' ').indexOf(reopenOn) : -1;
    if (index >= 0) setActive(index);
  }, [reopenOn, itemIds]);

  // Un appui hors du menu le referme, sans déplacer le foyer.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setActive(null);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const onTriggerKey = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    show(event.key === 'ArrowDown' ? 0 : -1);
  };
  const onMenuKey = (event: KeyboardEvent) => {
    if (active === null) return;
    const moves: Record<string, number> = {
      ArrowDown: active + 1,
      ArrowUp: active - 1,
      Home: 0,
      End: -1,
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      setActive((next + items.length) % items.length);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  return (
    <div ref={root} className="relative inline-flex">
      <Button
        ref={trigger}
        id={triggerId}
        variant="secondary"
        icon={<Ellipsis aria-hidden="true" />}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : show(0))}
        onKeyDown={onTriggerKey}
      >
        {label}
      </Button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          onKeyDown={onMenuKey}
          className={cn(
            'absolute top-full z-30 mt-1.5 flex w-64 max-w-[calc(100vw-2rem)] animate-fade flex-col',
            'rounded-xl border border-border-subtle bg-surface p-1.5 shadow-lg',
            alignEnd ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, index) => (
            <div key={item.id} role="none" className="flex flex-col">
              {item.separated && (
                <div role="separator" className="mx-2 my-1 border-t border-border-subtle" />
              )}
              <button
                ref={(node) => {
                  entries.current[index] = node;
                }}
                id={item.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
                className={cn(
                  'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[0.9375rem] font-medium',
                  'transition-colors duration-(--motion-fast) ease-out hover:bg-muted focus:bg-muted',
                  '[&_svg]:size-4.5 [&_svg]:shrink-0',
                  item.danger ? 'text-danger' : 'text-foreground',
                )}
              >
                <span
                  aria-hidden="true"
                  className={item.danger ? undefined : 'text-foreground-secondary'}
                >
                  {item.icon}
                </span>
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
