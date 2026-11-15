import { useTranslation } from 'react-i18next';
import { composeTable, editNested, editRow, goodIds, readRows, type Row } from '../goods-form';
import {
  readRecipes,
  RECIPE_FIELDS,
  RECIPE_SIDES,
  SITE_TYPES,
  STACK_FIELDS,
} from '../recipes-form';
import { FieldControl } from './FieldControl';

const GROUP = 'grid min-w-0 gap-2 rounded-md border border-border p-3 wrap-anywhere';

/**
 * Formulaire des recettes (15.4), comme celui des biens : sans état propre, il montre les recettes du
 * texte JSON et chaque saisie réécrit ce texte (`onChange`). Il ne contrôle rien : l'API fait foi.
 */
export function RecipesForm(props: {
  config: unknown;
  readOnly: boolean;
  onChange: (text: string) => void;
}) {
  const { t } = useTranslation();
  const recipes = readRecipes(props.config);
  const write = (next: Row[]) => props.onChange(composeTable(props.config, 'recipes', next));
  const label = (key: string) => t(`config.schemaPath.fields.recipes.${key}`);
  // Par identifiant, sinon par rang : un identifiant peut manquer ou être en cours de frappe.
  const nameOf = (id: unknown, index: number) =>
    typeof id === 'string' && id.trim() !== ''
      ? id
      : t('config.schemaPath.position', { rank: index + 1 });
  const siteTypes = SITE_TYPES.map((type) => ({
    value: type,
    label: t(`config.recipesForm.siteTypes.${type}`),
  }));
  return (
    <details className="space-y-3">
      <summary className="min-h-11 text-lg">{t('config.schemaPath.tables.recipes')}</summary>
      {(!recipes || !props.readOnly) && (
        <p className="text-sm text-muted-foreground">
          {t(recipes ? 'config.recipesForm.hint' : 'config.recipesForm.unavailable')}
        </p>
      )}
      {/* Suggestions pour le champ « bien » : les biens du texte. La saisie reste libre, l'API fait foi. */}
      <datalist id="recipes-good-ids">
        {goodIds(props.config).map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      {recipes?.map((recipe, row) => (
        <fieldset key={row} className={`${GROUP} sm:grid-cols-2 lg:grid-cols-5`}>
          <legend className="px-1 font-medium">{nameOf(recipe['id'], row)}</legend>
          {RECIPE_FIELDS.map((field) => (
            <FieldControl
              key={field.key}
              id={`recipes-${row}-${field.key}`}
              label={label(field.key)}
              field={field}
              value={recipe[field.key]}
              readOnly={props.readOnly}
              choices={siteTypes}
              onInput={(input) => write(editRow(recipes, row, field, input))}
            />
          ))}
          {RECIPE_SIDES.map((side) => {
            const lines = readRows(recipe, side) ?? [];
            return (
              <fieldset key={side} className="col-span-full min-w-0 space-y-2">
                <legend className="first-letter:uppercase">{label(side)}</legend>
                {lines.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t('config.recipesForm.empty')}</p>
                )}
                {lines.map((stack, line) => (
                  <fieldset key={line} className={`${GROUP} sm:grid-cols-2`}>
                    <legend className="px-1">{nameOf(stack['goodId'], line)}</legend>
                    {STACK_FIELDS.map((field) => (
                      <FieldControl
                        key={field.key}
                        id={`recipes-${row}-${side}-${line}-${field.key}`}
                        label={label(field.key)}
                        field={field}
                        value={stack[field.key]}
                        readOnly={props.readOnly}
                        list={field.key === 'goodId' ? 'recipes-good-ids' : undefined}
                        onInput={(input) =>
                          write(editNested(recipes, row, side, line, field, input))
                        }
                      />
                    ))}
                  </fieldset>
                ))}
              </fieldset>
            );
          })}
        </fieldset>
      ))}
    </details>
  );
}
