import type { ComponentProps } from 'react';
import { cn } from '../cn';
import { CONTROL, FieldFrame, useFieldIds, type FieldTextProps } from './field-parts';

export interface TextFieldProps extends ComponentProps<'input'>, FieldTextProps {}

/** Champ de saisie avec libellé, aide et erreur reliés pour les lecteurs d'écran. */
export function TextField({ label, hint, error, className, id, ...props }: TextFieldProps) {
  const ids = useFieldIds({ hint, error }, id, props['aria-describedby']);
  return (
    <FieldFrame ids={ids} label={label} hint={hint} error={error}>
      <input {...props} id={ids.inputId} {...ids.aria} className={cn(CONTROL, className)} />
    </FieldFrame>
  );
}

/** Ancien nom de `TextField`, gardé pour les écrans qui l'emploient. */
export const Field = TextField;
export type FieldProps = TextFieldProps;
