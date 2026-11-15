import { useTranslation } from 'react-i18next';
import { composeTable, editNested, editRow, goodIds, readRows, type Row } from '../goods-form';
import { BASKET_FIELDS, NEED_LEVELS, NPC_CLASS_FIELDS, readNpcClasses } from '../npc-classes-form';
import { FieldControl } from './FieldControl';

const GROUP = 'grid min-w-0 gap-2 rounded-md border border-border p-3 wrap-anywhere';

/**
 * Formulaire des classes de PNJ (15.4), comme ceux des biens et des recettes : sans état propre, il
 * montre les classes du texte JSON et chaque saisie réécrit ce texte (`onChange`). L'API fait foi.
 */
export function NpcClassesForm(props: {
  config: unknown;
  readOnly: boolean;
  onChange: (text: string) => void;
}) {
  const { t } = useTranslation();
  const classes = readNpcClasses(props.config);
  const write = (next: Row[]) => props.onChange(composeTable(props.config, 'npcClasses', next));
  const label = (key: string) => t(`config.schemaPath.fields.npcClasses.${key}`);
  // Par identifiant, sinon par rang : un identifiant peut manquer ou être en cours de frappe.
  const nameOf = (id: unknown, index: number) =>
    typeof id === 'string' && id.trim() !== ''
      ? id
      : t('config.schemaPath.position', { rank: index + 1 });
  const needs = NEED_LEVELS.map((need) => ({
    value: need,
    label: t(`config.npcClassesForm.needs.${need}`),
  }));
  return (
    <details className="space-y-3">
      <summary className="min-h-11 text-lg">{t('config.schemaPath.tables.npcClasses')}</summary>
      {(!classes || !props.readOnly) && (
        <p className="text-sm text-muted-foreground">
          {t(classes ? 'config.npcClassesForm.hint' : 'config.npcClassesForm.unavailable')}
        </p>
      )}
      {/* Suggestions pour le champ « bien » : les biens du texte. La saisie reste libre, l'API fait foi. */}
      <datalist id="npc-classes-good-ids">
        {goodIds(props.config).map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      {classes?.map((npcClass, row) => {
        const basket = readRows(npcClass, 'basket') ?? [];
        return (
          <fieldset key={row} className={`${GROUP} sm:grid-cols-3`}>
            <legend className="px-1 font-medium">{nameOf(npcClass['id'], row)}</legend>
            {NPC_CLASS_FIELDS.map((field) => (
              <FieldControl
                key={field.key}
                id={`npc-classes-${row}-${field.key}`}
                label={label(field.key)}
                field={field}
                value={npcClass[field.key]}
                readOnly={props.readOnly}
                onInput={(input) => write(editRow(classes, row, field, input))}
              />
            ))}
            <fieldset className="col-span-full min-w-0 space-y-2">
              <legend className="first-letter:uppercase">{label('basket')}</legend>
              {basket.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('config.npcClassesForm.empty')}</p>
              )}
              {basket.map((entry, line) => (
                <fieldset key={line} className={`${GROUP} sm:grid-cols-3`}>
                  <legend className="px-1">{nameOf(entry['goodId'], line)}</legend>
                  {BASKET_FIELDS.map((field) => (
                    <FieldControl
                      key={field.key}
                      id={`npc-classes-${row}-basket-${line}-${field.key}`}
                      label={label(field.key)}
                      field={field}
                      value={entry[field.key]}
                      readOnly={props.readOnly}
                      choices={needs}
                      list={field.key === 'goodId' ? 'npc-classes-good-ids' : undefined}
                      onInput={(input) =>
                        write(editNested(classes, row, 'basket', line, field, input))
                      }
                    />
                  ))}
                </fieldset>
              ))}
            </fieldset>
          </fieldset>
        );
      })}
    </details>
  );
}
