import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../cn';
import { moveTo, PILL_LIST, pillClass } from './pills';

export interface SegmentOption {
  value: string;
  label: ReactNode;
  /** Icône décorative avant le libellé. */
  icon?: ReactNode;
}

export interface SegmentedControlProps {
  /** Nom du groupe, déjà traduit. */
  label: string;
  options: readonly SegmentOption[];
  /** Choix, si le parent le tient ; sinon `defaultValue`, puis le premier. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Choix unique entre quelques options, en pastilles (`radiogroup`) : un seul arrêt de tabulation, les
 * quatre flèches, Début et Fin déplacent le choix.
 */
export function SegmentedControl({
  label,
  options,
  value,
  defaultValue,
  onValueChange,
  disabled,
  className,
}: SegmentedControlProps) {
  const [own, setOwn] = useState(defaultValue ?? options[0]?.value);
  const selected = value ?? own;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (next: string) => {
    setOwn(next);
    onValueChange?.(next);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const index = options.findIndex((option) => option.value === selected);
    const next = moveTo(event.key, index, options.length, true);
    const option = next === undefined ? undefined : options[next];
    if (next === undefined || !option) return;
    event.preventDefault();
    select(option.value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className={cn(PILL_LIST, className)}
    >
      {options.map((option, index) => {
        const active = option.value === selected;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={disabled}
            onClick={() => select(option.value)}
            className={cn(pillClass(active), 'flex-1')}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
