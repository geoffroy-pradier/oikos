import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../cn';
import { moveTo, PILL_LIST, pillClass } from './pills';

export interface TabItem {
  id: string;
  label: ReactNode;
  /** Icône décorative avant le libellé. */
  icon?: ReactNode;
  /** Panneau de l'onglet ; sans panneau (sous-sections routées), seule la liste s'affiche. */
  content?: ReactNode;
}

export interface TabsProps {
  /** Nom de la liste d'onglets, déjà traduit. */
  label: string;
  items: readonly TabItem[];
  /** Onglet choisi, si le parent le tient ; sinon `defaultValue`, puis le premier. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  className?: string;
}

/**
 * Onglets en pastilles dans une gélule (WAI-ARIA) : un seul arrêt de tabulation, flèches, Début et
 * Fin ; activation au foyer.
 */
export function Tabs({ label, items, value, defaultValue, onValueChange, className }: TabsProps) {
  const base = useId();
  const [own, setOwn] = useState(defaultValue ?? items[0]?.id);
  const selected = value ?? own;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (id: string) => {
    setOwn(id);
    onValueChange?.(id);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const index = items.findIndex((item) => item.id === selected);
    const next = moveTo(event.key, index, items.length);
    const item = next === undefined ? undefined : items[next];
    if (next === undefined || !item) return;
    event.preventDefault();
    select(item.id);
    refs.current[next]?.focus();
  };

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={cn(PILL_LIST, 'self-start')}
      >
        {items.map((item, index) => {
          const active = item.id === selected;
          return (
            <button
              key={item.id}
              ref={(node) => {
                refs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${item.id}`}
              aria-selected={active}
              aria-controls={item.content === undefined ? undefined : `${base}-panel-${item.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => select(item.id)}
              className={pillClass(active)}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) =>
        item.id === selected && item.content !== undefined ? (
          <div
            key={item.id}
            role="tabpanel"
            id={`${base}-panel-${item.id}`}
            aria-labelledby={`${base}-tab-${item.id}`}
            tabIndex={0}
            className="animate-rise rounded-md"
          >
            {item.content}
          </div>
        ) : null,
      )}
    </div>
  );
}

/** Nom de la refonte (ADR 0011) : les sous-sections d'un onglet sont des onglets en pastilles. */
export const PillTabs = Tabs;
export type PillTabsProps = TabsProps;
