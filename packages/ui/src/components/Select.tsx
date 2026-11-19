import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../cn';
import { CONTROL, FieldFrame, useFieldIds, type FieldTextProps } from './field-parts';

export interface SelectProps extends ComponentProps<'select'>, FieldTextProps {}

/** Liste de choix native (clavier et lecteurs d'écran du système), habillée comme les champs. */
export function Select({ label, hint, error, className, id, children, ...props }: SelectProps) {
  const ids = useFieldIds({ hint, error }, id, props['aria-describedby']);
  return (
    <FieldFrame ids={ids} label={label} hint={hint} error={error}>
      <div className="relative">
        <select
          {...props}
          id={ids.inputId}
          {...ids.aria}
          className={cn(CONTROL, 'appearance-none pr-10', className)}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    </FieldFrame>
  );
}
