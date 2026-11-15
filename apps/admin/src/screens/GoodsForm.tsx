import { cn } from '@oikos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { composeGoods, editGood, GOOD_FIELDS, GOOD_TIERS, readGoods, shown } from '../goods-form';

const CONTROL = 'min-h-11 w-full rounded-md border border-border bg-surface px-3';
const INPUT_MODE = { text: undefined, integer: 'numeric', decimal: 'decimal' } as const;

/**
 * Formulaire des biens (15.4), sans état propre : il montre les biens du texte JSON, et chaque saisie
 * réécrit ce texte (`onChange`), seule chose enregistrée. Il ne contrôle rien : l'API fait foi.
 */
export function GoodsForm(props: {
  config: unknown;
  readOnly: boolean;
  onChange: (text: string) => void;
}) {
  const { t } = useTranslation();
  const goods = readGoods(props.config);
  /** Frappe en cours dans un champ : affichée telle quelle (« 1.0 » ne redevient pas « 1 » avant « 1.05 »). */
  const [draft, setDraft] = useState<{ cell: string; text: string } | null>(null);
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-lg">{t('config.schemaPath.tables.goods')}</h3>
      {(!goods || !props.readOnly) && (
        <p className="text-sm text-muted-foreground">
          {t(goods ? 'config.goodsForm.hint' : 'config.goodsForm.unavailable')}
        </p>
      )}
      {goods?.map((good, row) => {
        const id = good['id'];
        const named = typeof id === 'string' && id.trim() !== '';
        return (
          // Par rang : un identifiant peut manquer, se répéter ou être en cours de frappe.
          <fieldset
            key={row}
            className="grid min-w-0 gap-2 rounded-md border border-border p-3 wrap-anywhere sm:grid-cols-2 lg:grid-cols-4"
          >
            <legend className="px-1 font-medium">
              {named ? id : t('config.schemaPath.position', { rank: row + 1 })}
            </legend>
            {GOOD_FIELDS.map((field) => {
              const cell = `goods-${row}-${field.key}`;
              const value = good[field.key];
              const set = (input: string) =>
                props.onChange(composeGoods(props.config, editGood(goods, row, field, input)));
              // Un niveau hors de la liste reste affiché : rien n'est remplacé sans un choix.
              const known = typeof value === 'string' && GOOD_TIERS.includes(value);
              return (
                <div key={field.key} className="flex min-w-0 flex-col gap-1">
                  <label htmlFor={cell} className="first-letter:uppercase">
                    {t(`config.schemaPath.fields.goods.${field.key}`)}
                  </label>
                  {field.kind === 'choice' ? (
                    <select
                      id={cell}
                      className={CONTROL}
                      disabled={props.readOnly}
                      value={known ? value : ''}
                      onChange={(event) => set(event.target.value)}
                    >
                      {!known && (
                        <option value="">
                          {value === undefined
                            ? t('config.goodsForm.choose')
                            : shown('text', value)}
                        </option>
                      )}
                      {GOOD_TIERS.map((tier) => (
                        <option key={tier} value={tier}>
                          {t(`config.goodsForm.tiers.${tier}`)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={cell}
                      className={cn(CONTROL, field.kind === 'text' && 'font-mono')}
                      inputMode={INPUT_MODE[field.kind]}
                      autoComplete="off"
                      spellCheck={false}
                      readOnly={props.readOnly}
                      value={draft?.cell === cell ? draft.text : shown(field.kind, value)}
                      onChange={(event) => {
                        setDraft({ cell, text: event.target.value });
                        set(event.target.value);
                      }}
                      onBlur={() => setDraft(null)}
                    />
                  )}
                </div>
              );
            })}
          </fieldset>
        );
      })}
    </section>
  );
}
