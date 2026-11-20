import { Button, Plus, Trash2 } from '@oikos/ui';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  addRow,
  composeTable,
  editNested,
  editRow,
  goodIds,
  readNested,
  readRows,
  removeRow,
  updateLines,
  type NestedTable,
  type Row,
} from '../goods-form';
import { FieldControl } from './FieldControl';
import { SECTION, SUMMARY } from '../ui';
import { useReshape } from './useReshape';

const GROUP = 'grid min-w-0 gap-2 rounded-lg border border-border-subtle p-3 wrap-anywhere';

/**
 * Formulaire d'une table dont les lignes portent des listes imbriquées (15.4) : recettes et leurs intrants
 * et extrants, classes de PNJ et leur panier. Comme celui des biens, sans état propre : il montre les lignes
 * du texte JSON et chaque saisie, chaque ajout ou retrait réécrit ce texte (`onChange`). L'API fait foi.
 */
export function NestedTableForm(props: {
  spec: NestedTable;
  config: unknown;
  readOnly: boolean;
  onChange: (text: string) => void;
}) {
  const { t } = useTranslation();
  const { table, texts, fields, lists } = props.spec;
  const reshapes = !props.readOnly && props.spec.fixedRows !== true;
  const read = (config: unknown) =>
    readNested(
      config,
      table,
      lists.map((list) => list.key),
    );
  const rows = read(props.config);
  const compose = (next: Row[]) => composeTable(props.config, table, next);
  // Un champ n'est rendu à nouveau que si sa valeur change (#884) : sa saisie lit le texte du moment.
  const latest = useRef(props.config);
  latest.current = props.config;
  const write = (change: (rows: Row[]) => Row[]) =>
    props.onChange(composeTable(latest.current, table, change(read(latest.current) ?? [])));
  const { guard, reshape, announcement } = useReshape(props.onChange);
  const label = (key: string) => t(`config.schemaPath.fields.${table}.${key}`);
  // Par identifiant, sinon par rang : un identifiant peut manquer, se répéter ou être en cours de frappe.
  const nameOf = (id: unknown, index: number) =>
    typeof id === 'string' && id.trim() !== ''
      ? id
      : t('config.schemaPath.position', { rank: index + 1 });
  const choices = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(props.spec.choices).map(([key, { values, labels }]) => [
          key,
          values.map((value) => ({ value, label: t(`${labels}.${value}`) })),
        ]),
      ),
    [props.spec.choices, t],
  );
  const suggestions = `${table}-good-ids`;
  return (
    // Nommé par son résumé : deux lignes de même nom (« élément 2 ») dans deux formulaires se distinguent.
    <details className={SECTION} aria-labelledby={`${table}-form`}>
      <summary id={`${table}-form`} className={SUMMARY}>
        {t(`config.schemaPath.tables.${table}`)}
      </summary>
      {(!rows || !props.readOnly) && (
        <p className="text-sm text-muted-foreground">
          {t(`config.${texts}.${rows ? 'hint' : 'unavailable'}`)}
        </p>
      )}
      {/* Suggestions pour le champ « bien » : les biens du texte. La saisie reste libre, l'API fait foi. */}
      <datalist id={suggestions}>
        {goodIds(props.config).map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      {rows?.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('config.tableForm.none')}</p>
      )}
      {rows?.map((entry, row) => {
        const name = nameOf(entry['id'], row);
        // Foyer après le retrait : la ligne suivante, sinon la précédente, sinon le bouton d'ajout.
        const after = row + 1 < rows.length ? row : row - 1;
        return (
          <fieldset key={row} className={`${GROUP} sm:grid-cols-2 lg:grid-cols-3`}>
            <legend className="px-1 font-medium">{name}</legend>
            {fields.map((field) => (
              <FieldControl
                key={field.key}
                id={`${table}-${row}-${field.key}`}
                label={label(field.key)}
                field={field}
                value={entry[field.key]}
                readOnly={props.readOnly}
                choices={choices[field.key]}
                onInput={(input) => write((all) => editRow(all, row, field, input))}
              />
            ))}
            {lists.map((list) => {
              const lines = readRows(entry, list.key) ?? [];
              const where = { list: label(list.key), row: name };
              const first = (line: number) =>
                `${table}-${row}-${list.key}-${line}-${list.fields[0]?.key ?? ''}`;
              const addLine = `${table}-${row}-${list.key}-add`;
              const change = (lines: (all: Row[]) => Row[]) =>
                compose(updateLines(rows, row, list.key, lines));
              return (
                <fieldset key={list.key} className="col-span-full min-w-0 space-y-2">
                  <legend className="first-letter:uppercase">{label(list.key)}</legend>
                  {lines.length === 0 && (
                    <p className="text-sm text-muted-foreground">{t(`config.${texts}.empty`)}</p>
                  )}
                  {lines.map((item, line) => (
                    <fieldset key={line} className={`${GROUP} sm:grid-cols-3`}>
                      <legend className="px-1">{nameOf(item['goodId'], line)}</legend>
                      {list.fields.map((field) => (
                        <FieldControl
                          key={field.key}
                          id={`${table}-${row}-${list.key}-${line}-${field.key}`}
                          label={label(field.key)}
                          field={field}
                          value={item[field.key]}
                          readOnly={props.readOnly}
                          choices={choices[field.key]}
                          list={field.key === 'goodId' ? suggestions : undefined}
                          onInput={(input) =>
                            write((all) => editNested(all, row, list.key, line, field, input))
                          }
                        />
                      ))}
                      {!props.readOnly && (
                        <Button
                          icon={<Trash2 aria-hidden="true" />}
                          variant="secondary"
                          className="col-span-full justify-self-start"
                          {...guard}
                          onClick={(event) => {
                            const lineName = nameOf(item['goodId'], line);
                            // Foyer : la ligne suivante, sinon la précédente, sinon l'ajout de ligne.
                            const next = line + 1 < lines.length ? line : line - 1;
                            reshape(
                              event,
                              change((all) => removeRow(all, line)),
                              next < 0 ? addLine : first(next),
                              t('config.tableForm.lineRemoved', { ...where, name: lineName }),
                            );
                          }}
                        >
                          {t('config.tableForm.removeLine', {
                            ...where,
                            name: nameOf(item['goodId'], line),
                          })}
                        </Button>
                      )}
                    </fieldset>
                  ))}
                  {!props.readOnly && (
                    <Button
                      icon={<Plus aria-hidden="true" />}
                      id={addLine}
                      variant="secondary"
                      {...guard}
                      onClick={(event) => reshape(event, change(addRow), first(lines.length))}
                    >
                      {t('config.tableForm.addLine', where)}
                    </Button>
                  )}
                </fieldset>
              );
            })}
            {reshapes && (
              <Button
                icon={<Trash2 aria-hidden="true" />}
                variant="secondary"
                className="col-span-full justify-self-start"
                {...guard}
                onClick={(event) =>
                  reshape(
                    event,
                    compose(removeRow(rows, row)),
                    after < 0 ? `${table}-add` : `${table}-${after}-id`,
                    t(`config.${texts}.removed`, { name }),
                  )
                }
              >
                {t(`config.${texts}.remove`, { name })}
              </Button>
            )}
          </fieldset>
        );
      })}
      {rows && reshapes && (
        <Button
          icon={<Plus aria-hidden="true" />}
          id={`${table}-add`}
          variant="secondary"
          {...guard}
          onClick={(event) => reshape(event, compose(addRow(rows)), `${table}-${rows.length}-id`)}
        >
          {t(`config.${texts}.add`)}
        </Button>
      )}
      {announcement(props.config, `${table}-announce`)}
    </details>
  );
}
