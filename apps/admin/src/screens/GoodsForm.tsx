import { Button } from '@oikos/ui';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  addRow,
  composeGoods,
  editRow,
  GOOD_FIELDS,
  GOOD_TIERS,
  readGoods,
  removeRow,
} from '../goods-form';
import { FieldControl } from './FieldControl';
import { SECTION, SUMMARY } from '../ui';
import { useReshape } from './useReshape';

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
  const tiers = useMemo(
    () => GOOD_TIERS.map((tier) => ({ value: tier, label: t(`config.goodsForm.tiers.${tier}`) })),
    [t],
  );
  // Un champ n'est rendu à nouveau que si sa valeur change (#884) : sa saisie lit le texte du moment.
  const latest = useRef(props.config);
  latest.current = props.config;
  const { guard, reshape, announcement } = useReshape(props.onChange);
  return (
    // Nommé par son résumé, comme les autres formulaires de table.
    <details className={SECTION} aria-labelledby="goods-form">
      <summary id="goods-form" className={SUMMARY}>
        {t('config.schemaPath.tables.goods')}
      </summary>
      {(!goods || !props.readOnly) && (
        <p className="text-sm text-muted-foreground">
          {t(goods ? 'config.goodsForm.hint' : 'config.goodsForm.unavailable')}
        </p>
      )}
      {goods?.map((good, row) => {
        const id = good['id'];
        const named = typeof id === 'string' && id.trim() !== '';
        const name = named ? id : t('config.schemaPath.position', { rank: row + 1 });
        // Foyer après le retrait : le bien suivant, sinon le précédent, sinon le bouton d'ajout.
        const after = row + 1 < goods.length ? row : row - 1;
        return (
          // Par rang : un identifiant peut manquer, se répéter ou être en cours de frappe.
          <fieldset
            key={row}
            className="grid min-w-0 gap-2 rounded-lg border border-border-subtle p-3 wrap-anywhere sm:grid-cols-2 lg:grid-cols-4"
          >
            <legend className="px-1 font-medium">{name}</legend>
            {GOOD_FIELDS.map((field) => (
              <FieldControl
                key={field.key}
                id={`goods-${row}-${field.key}`}
                label={t(`config.schemaPath.fields.goods.${field.key}`)}
                field={field}
                value={good[field.key]}
                readOnly={props.readOnly}
                choices={tiers}
                onInput={(input) =>
                  props.onChange(
                    composeGoods(
                      latest.current,
                      editRow(readGoods(latest.current) ?? [], row, field, input),
                    ),
                  )
                }
              />
            ))}
            {!props.readOnly && (
              <Button
                variant="secondary"
                className="col-span-full justify-self-start"
                {...guard}
                onClick={(event) =>
                  reshape(
                    event,
                    composeGoods(props.config, removeRow(goods, row)),
                    after < 0 ? 'goods-add' : `goods-${after}-id`,
                    t('config.goodsForm.removed', { name }),
                  )
                }
              >
                {t('config.goodsForm.remove', { name })}
              </Button>
            )}
          </fieldset>
        );
      })}
      {goods && !props.readOnly && (
        <Button
          id="goods-add"
          variant="secondary"
          {...guard}
          onClick={(event) =>
            reshape(event, composeGoods(props.config, addRow(goods)), `goods-${goods.length}-id`)
          }
        >
          {t('config.goodsForm.add')}
        </Button>
      )}
      {announcement(props.config, 'goods-announce')}
    </details>
  );
}
