import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  hint?: ReactNode;
  /** Message d'erreur déjà traduit. Sa présence marque le champ comme invalide. */
  error?: ReactNode;
}

/** Champ de saisie avec libellé, aide et erreur reliés pour les lecteurs d'écran. */
export function Field({ label, hint, error, className, id, ...props }: FieldProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="font-medium">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        className={cn(
          'min-h-11 w-full rounded-md border border-border bg-surface px-3 text-foreground',
          error && 'border-danger',
          className,
        )}
        {...props}
      />
      {hint && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {/* L'erreur n'est jamais portée par la couleur seule : texte explicite, annoncé. */}
      <p id={errorId} role="alert" className="text-sm font-semibold text-danger">
        {error}
      </p>
    </div>
  );
}
