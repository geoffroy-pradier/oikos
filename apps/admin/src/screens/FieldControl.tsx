import { cn } from '@oikos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shown, type TableField } from '../goods-form';

const CONTROL = 'min-h-11 w-full rounded-md border border-border bg-surface px-3';
const INPUT_MODE = { text: undefined, integer: 'numeric', decimal: 'decimal' } as const;

/**
 * Un champ d'un formulaire de table (15.4), sous son libellé : il montre la valeur du texte JSON et rend
 * chaque saisie brute (`onInput`), que le formulaire écrit dans le texte. Il ne contrôle rien.
 */
export function FieldControl(props: {
  id: string;
  label: string;
  field: TableField;
  value: unknown;
  readOnly: boolean;
  /** Choix proposés (`kind: 'choice'`), avec leur libellé. */
  choices?: { value: string; label: string }[];
  /** Suggestions d'une liste `<datalist>` : la saisie reste libre. */
  list?: string | undefined;
  onInput: (input: string) => void;
}) {
  const { t } = useTranslation();
  const { field, value } = props;
  /** Frappe en cours : affichée telle quelle (« 1.0 » ne redevient pas « 1 » avant « 1.05 »). */
  const [typing, setTyping] = useState<string | null>(null);
  // Un choix hors de la liste reste affiché : rien n'est remplacé sans un choix.
  const known = props.choices?.some((choice) => choice.value === value) === true;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={props.id} className="first-letter:uppercase">
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
              {value === undefined ? t('config.goodsForm.choose') : shown('text', value)}
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
}
