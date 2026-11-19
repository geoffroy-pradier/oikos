import { useId, useState, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../cn';
import { TOUCH_TARGET } from './field-parts';

export interface SwitchProps extends Omit<ComponentProps<'button'>, 'onChange' | 'value'> {
  /** Libellé, déjà traduit : il nomme l'interrupteur et l'actionne au clic. */
  label: ReactNode;
  hint?: ReactNode;
  /** État, si le parent le tient ; sinon `defaultChecked`. */
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

/** Interrupteur (`role="switch"`) : un bouton natif, donc Espace et Entrée le basculent. */
export function Switch({
  label,
  hint,
  checked,
  defaultChecked = false,
  onCheckedChange,
  className,
  id,
  onClick,
  'aria-describedby': describedBy,
  ...props
}: SwitchProps) {
  const generated = useId();
  const switchId = id ?? generated;
  const hintId = hint ? `${switchId}-hint` : undefined;
  const [own, setOwn] = useState(defaultChecked);
  const on = checked ?? own;
  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      <div className="flex flex-col gap-0.5">
        <label htmlFor={switchId} className="font-medium">
          {label}
        </label>
        {hint && (
          <p id={hintId} className="text-sm text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
      <button
        {...props}
        id={switchId}
        type="button"
        role="switch"
        aria-checked={on}
        aria-describedby={[describedBy, hintId].filter(Boolean).join(' ') || undefined}
        onClick={(event) => {
          // Le clic de l'appelant passe d'abord ; il peut empêcher la bascule (`preventDefault`).
          onClick?.(event);
          if (event.defaultPrevented) return;
          setOwn(!on);
          onCheckedChange?.(!on);
        }}
        className={cn(
          TOUCH_TARGET,
          'inline-flex h-7 w-12 shrink-0 items-center rounded-full border p-0.5',
          'transition-colors duration-(--motion-fast) disabled:cursor-not-allowed disabled:opacity-60',
          on ? 'border-primary bg-primary' : 'border-border bg-muted',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-5 rounded-full transition-transform duration-(--motion-fast) ease-out',
            on ? 'translate-x-5 bg-primary-foreground' : 'bg-muted-foreground',
          )}
        />
      </button>
    </div>
  );
}
