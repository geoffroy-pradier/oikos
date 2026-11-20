import { Minus, Plus } from 'lucide-react';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../cn';
import { numberProblem, readTypedNumber, type NumberProblem } from '../numbers';
import { IconButton } from './Button';
import { CONTROL, FieldFrame, TOUCH_TARGET, useFieldIds, type FieldTextProps } from './field-parts';

export interface NumberFieldProps extends FieldTextProps {
  /** Langue de l'interface : la saisie se lit et s'affiche à son format (séparateur des milliers). */
  locale: string;
  /** Valeur, si le parent la tient ; sinon `defaultValue`. */
  value?: number | null;
  defaultValue?: number | null;
  /** À chaque frappe : le nombre lu, `null` si rien n'est saisi, `NaN` si la saisie est illisible. */
  onValueChange?: (value: number | null) => void;
  min?: number;
  max?: number;
  /** Pas des flèches et des boutons ± (1 par défaut) ; un pas entier n'accepte que des entiers. */
  step?: number;
  /** Pas de Page haut et Page bas (dix pas par défaut). */
  largeStep?: number;
  /** Textes déjà traduits des boutons et des raccourcis. */
  labels: { decrement: string; increment: string; all: string; shortcuts: string };
  /** Raccourcis 25 %, 50 % et tout, montrés quand `max` est connu (par défaut). */
  shortcuts?: boolean;
  /** Messages des problèmes repérés à la saisie, déjà traduits ; `error` l'emporte sur eux. */
  messages?: Partial<Record<NumberProblem, ReactNode>>;
  id?: string;
  name?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

const FRACTIONS = [0.25, 0.5, 1] as const;

const decimals = (step: number) => (String(step).split('.')[1] ?? '').length;

/** Saisie numérique : boutons ± de part et d'autre, ↑/↓ et Page haut/bas, raccourcis sous le champ. */
export function NumberField({
  label,
  hint,
  error,
  locale,
  value,
  defaultValue = null,
  onValueChange,
  min,
  max,
  step = 1,
  largeStep = step * 10,
  labels,
  shortcuts = true,
  messages,
  id,
  className,
  ...props
}: NumberFieldProps) {
  const format = (n: number | null) =>
    n === null ? '' : new Intl.NumberFormat(locale, { maximumFractionDigits: 20 }).format(n);
  const [text, setText] = useState(() => format(value ?? defaultValue));
  const [seen, setSeen] = useState(value);
  const current = readTypedNumber(text, locale);
  // Valeur changée par le parent : le texte la suit, sauf s'il la dit déjà (« 1 250 » contre « 1250 »).
  if (value !== undefined && !Object.is(value, seen)) {
    setSeen(value);
    if (!Object.is(current, value) && !Number.isNaN(value)) setText(format(value));
  }
  const problem = numberProblem(text, locale, { min, max, step });
  const shown = error ?? (problem ? messages?.[problem] : undefined);
  const ids = useFieldIds({ hint, error: shown }, id);

  const change = (typed: string) => {
    setText(typed);
    onValueChange?.(readTypedNumber(typed, locale));
  };
  const commit = (n: number) => {
    const bounded = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    const snapped = Number(bounded.toFixed(decimals(step)));
    setText(format(snapped));
    onValueChange?.(snapped);
  };
  const base = current !== null && Number.isFinite(current) ? current : null;
  const stepBy = (delta: number) => commit((base ?? min ?? 0) + (base === null ? 0 : delta));
  const onKeyDown = (event: KeyboardEvent) => {
    const delta = { ArrowUp: step, ArrowDown: -step, PageUp: largeStep, PageDown: -largeStep }[
      event.key
    ];
    if (delta === undefined) return;
    event.preventDefault();
    stepBy(delta);
  };
  const percent = new Intl.NumberFormat(locale, { style: 'percent' });

  return (
    // Un problème repéré à la frappe s'annonce poliment ; l'erreur du parent reste une alerte.
    <FieldFrame ids={ids} label={label} hint={hint} error={shown} polite={error === undefined}>
      <div className="flex gap-2">
        <IconButton
          label={labels.decrement}
          icon={<Minus />}
          variant="secondary"
          tabIndex={-1}
          aria-controls={ids.inputId}
          disabled={props.disabled || (base !== null && min !== undefined && base <= min)}
          onClick={() => stepBy(-step)}
          className="size-12 shrink-0 rounded-lg"
        />
        <input
          {...props}
          id={ids.inputId}
          {...ids.aria}
          role="spinbutton"
          inputMode={Number.isInteger(step) && (min ?? 0) >= 0 ? 'numeric' : 'decimal'}
          autoComplete="off"
          value={text}
          aria-valuenow={base ?? undefined}
          aria-valuetext={base === null ? undefined : format(base)}
          aria-valuemin={min}
          aria-valuemax={max}
          onChange={(event) => change(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => base !== null && setText(format(base))}
          className={cn(CONTROL, 'min-w-0 text-center font-medium tabular-nums', className)}
        />
        <IconButton
          label={labels.increment}
          icon={<Plus />}
          variant="secondary"
          tabIndex={-1}
          aria-controls={ids.inputId}
          disabled={props.disabled || (base !== null && max !== undefined && base >= max)}
          onClick={() => stepBy(step)}
          className="size-12 shrink-0 rounded-lg"
        />
      </div>
      {shortcuts && max !== undefined && (
        <div role="group" aria-label={labels.shortcuts} className="mt-2.5 flex flex-wrap gap-2">
          {FRACTIONS.map((fraction) => {
            const amount =
              fraction === 1 ? max : Math.max(min ?? 0, Math.floor((max * fraction) / step) * step);
            return (
              <button
                key={fraction}
                type="button"
                disabled={props.disabled}
                aria-controls={ids.inputId}
                onClick={() => commit(amount)}
                className={cn(
                  TOUCH_TARGET,
                  'min-h-8 rounded-full border border-border bg-surface-raised px-3.5 text-sm font-medium',
                  'text-foreground-secondary tabular-nums transition-colors duration-(--motion-fast)',
                  'enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-60',
                  base === amount && 'border-accent bg-accent-subtle text-accent',
                )}
              >
                {fraction === 1 ? labels.all : percent.format(fraction)}
              </button>
            );
          })}
        </div>
      )}
    </FieldFrame>
  );
}
