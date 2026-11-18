import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../cn';

export interface TabItem {
  id: string;
  label: ReactNode;
  /** Icône décorative avant le libellé. */
  icon?: ReactNode;
  content: ReactNode;
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

const KEYS: Record<string, (index: number, count: number) => number> = {
  ArrowRight: (i, n) => (i + 1) % n,
  ArrowLeft: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_i, n) => n - 1,
};

/** Onglets WAI-ARIA : un seul arrêt de tabulation, flèches, Début et Fin ; activation au foyer. */
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
    const move = KEYS[event.key];
    if (!move) return;
    event.preventDefault();
    const next = move(
      items.findIndex((item) => item.id === selected),
      items.length,
    );
    const item = items[next];
    if (!item) return;
    select(item.id);
    refs.current[next]?.focus();
  };

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex gap-1 self-start overflow-x-auto rounded-lg bg-muted p-1"
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
              aria-controls={`${base}-panel-${item.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => select(item.id)}
              className={cn(
                'inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap',
                'transition-[background-color,color,box-shadow] duration-(--motion-base) ease-out [&_svg]:size-4',
                active
                  ? 'bg-surface-raised text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) =>
        item.id === selected ? (
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
