import { Button } from '@oikos/ui';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  addGood,
  composeGoods,
  editRow,
  GOOD_FIELDS,
  GOOD_TIERS,
  readGoods,
  removeGood,
} from '../goods-form';
import { ignoreHeldEnter, SHIFT_GUARD_MS } from '../keyboard';
import { FieldControl } from './FieldControl';

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
  const tiers = GOOD_TIERS.map((tier) => ({
    value: tier,
    label: t(`config.goodsForm.tiers.${tier}`),
  }));
  /**
   * Bien retiré, annoncé tant que le texte reste celui que ce retrait a écrit. `count` numérote les
   * retraits : deux retraits de suite au même nom donnent deux annonces, pas un texte inchangé.
   */
  const [removed, setRemoved] = useState<{ name: string; text: string; count: number } | null>(
    null,
  );
  /** Élément qui prend le foyer quand le texte réécrit par un ajout ou un retrait est affiché. */
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    if (focusNext.current) document.getElementById(focusNext.current)?.focus();
    focusNext.current = null;
  });
  const movedAt = useRef(-Infinity);
  /**
   * Ajout ou retrait : comme une saisie, il réécrit le texte entier. Les biens viennent de bouger sous le
   * pointeur : le second clic d'un double clic (`detail`), ou un toucher juste après, n'agit pas. Le foyer
   * va dans un champ, jamais sur un autre bouton : une touche Entrée tenue ne retire pas bien après bien.
   * Sur le bouton d'ajout, où le foyer va après le retrait du seul bien, sa répétition n'agit pas.
   * Le délai ne vaut pas pour la souris, dont le compte de clics distingue déjà un double clic : un clic
   * voulu sur un autre bouton, même aussitôt après, agit. Type de pointeur inconnu : délai, par prudence.
   */
  const stray = ({ detail, nativeEvent }: MouseEvent) =>
    detail > 1 ||
    (detail === 1 &&
      (nativeEvent as Partial<PointerEvent>).pointerType !== 'mouse' &&
      performance.now() - movedAt.current < SHIFT_GUARD_MS);
  /** Un appui ignoré ne prend pas non plus le foyer, laissé dans le champ choisi après le geste. */
  const keepFocus = (event: MouseEvent) => {
    if (stray(event)) event.preventDefault();
  };
  const reshape = (event: MouseEvent, next: Record<string, unknown>[], focus: string) => {
    if (stray(event)) return;
    // Un clic né du clavier (`detail` nul) ne déplace rien sous le pointeur : il n'arme pas le délai.
    if (event.detail > 0) movedAt.current = performance.now();
    focusNext.current = focus;
    const text = composeGoods(props.config, next);
    props.onChange(text);
    return text;
  };
  const announced = removed && removed.text === JSON.stringify(props.config, null, 2);
  return (
    <details className="space-y-3">
      <summary className="min-h-11 text-lg">{t('config.schemaPath.tables.goods')}</summary>
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
            className="grid min-w-0 gap-2 rounded-md border border-border p-3 wrap-anywhere sm:grid-cols-2 lg:grid-cols-4"
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
                  props.onChange(composeGoods(props.config, editRow(goods, row, field, input)))
                }
              />
            ))}
            {!props.readOnly && (
              <Button
                variant="secondary"
                className="col-span-full justify-self-start"
                onMouseDown={keepFocus}
                onKeyDown={ignoreHeldEnter}
                onClick={(event) => {
                  const text = reshape(
                    event,
                    removeGood(goods, row),
                    after < 0 ? 'goods-add' : `goods-${after}-id`,
                  );
                  if (text) setRemoved((last) => ({ name, text, count: (last?.count ?? 0) + 1 }));
                }}
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
          onMouseDown={keepFocus}
          onKeyDown={ignoreHeldEnter}
          onClick={(event) => reshape(event, addGood(goods), `goods-${goods.length}-id`)}
        >
          {t('config.goodsForm.add')}
        </Button>
      )}
      {/* Toujours présente : le retrait est annoncé dès qu'il est fait. Sans rôle `status` : celui de
          l'écran reste le seul, qui annonce l'issue des commandes. */}
      <p id="goods-announce" aria-live="polite" className="text-sm">
        {/* Un nœud neuf à chaque retrait (`key`) : le lecteur d'écran lit l'annonce même inchangée. */}
        {announced && (
          <span key={removed.count}>{t('config.goodsForm.removed', { name: removed.name })}</span>
        )}
      </p>
    </details>
  );
}
