import { cn } from '@oikos/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shown, type TableField } from '../goods-form';
import { CONTROL } from '../ui';

const INPUT_MODE = { text: undefined, integer: 'numeric', decimal: 'decimal' } as const;

/**
 * Un champ d'un formulaire de table (15.4), sous son libellé : il montre la valeur du texte JSON et rend
 * chaque saisie brute (`onInput`), que le formulaire écrit dans le texte. Il ne contrôle rien.
 * Il n'est rendu à nouveau que si ce qu'il montre change (#884) : une saisie ne rend pas les centaines
 * d'autres champs de l'écran. `onInput` n'est donc pas comparé : il doit écrire dans le texte du moment.
 */
interface FieldControlProps {
  id: string;
  label: string;
  field: TableField;
  value: unknown;
  readOnly: boolean;
  /** Choix proposés (`kind: 'choice'`), avec leur libellé. */
  choices?: { value: string; label: string }[] | undefined;
  /** Suggestions d'une liste `<datalist>` : la saisie reste libre. */
  list?: string | undefined;
  /** Écrit dans le texte du moment, pas dans celui du dernier rendu du champ, qui peut être plus ancien. */
  onInput: (input: string) => void;
}
export const FieldControl = memo(function FieldControl(props: FieldControlProps) {
  const { t } = useTranslation();
  const { field, value } = props;
  /** Frappe en cours : affichée telle quelle (« 1.0 » ne redevient pas « 1 » avant « 1.05 »). */
  const [typing, setTyping] = useState<string | null>(null);
  // Un choix hors de la liste reste affiché : rien n'est remplacé sans un choix.
  const known = props.choices?.some((choice) => choice.value === value) === true;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={props.id} className="text-sm first-letter:uppercase">
        {props.label}
      </label>
      {field.kind === 'choice' ? (
        <select
          id={props.id}
          className={CONTROL}
          disabled={props.readOnly}
          value={known ? (value as string) : ''}
          onChange={(event) => props.onInput(event.target.value)}
        >
          {!known && (
            <option value="">
              {value === undefined ? t('config.tableForm.choose') : shown('text', value)}
            </option>
          )}
          {props.choices?.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={props.id}
          className={cn(CONTROL, field.kind === 'text' && 'font-mono')}
          inputMode={INPUT_MODE[field.kind]}
          list={props.list}
          autoComplete="off"
          spellCheck={false}
          readOnly={props.readOnly}
          value={typing ?? shown(field.kind, value)}
          onChange={(event) => {
            setTyping(event.target.value);
            props.onInput(event.target.value);
          }}
          onBlur={() => setTyping(null)}
        />
      )}
    </div>
  );
}, sameExceptInput);

/** Mêmes valeurs montrées : `onInput` excepté, qui lit le texte du moment. */
function sameExceptInput(before: FieldControlProps, after: FieldControlProps) {
  return (Object.keys({ ...before, ...after }) as (keyof FieldControlProps)[]).every(
    (key) => key === 'onInput' || Object.is(before[key], after[key]),
  );
}
