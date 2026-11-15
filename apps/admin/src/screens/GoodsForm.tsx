import { Button, cn } from '@oikos/ui';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  addGood,
  composeGoods,
  editGood,
  GOOD_FIELDS,
  GOOD_TIERS,
  readGoods,
  removeGood,
  shown,
} from '../goods-form';
import { SHIFT_GUARD_MS } from '../keyboard';

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
  /** Bien retiré, annoncé tant que le texte reste celui que ce retrait a écrit. */
  const [removed, setRemoved] = useState<{ name: string; text: string } | null>(null);
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
   */
  const stray = ({ detail }: MouseEvent) =>
    detail > 1 || (detail === 1 && performance.now() - movedAt.current < SHIFT_GUARD_MS);
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
            {!props.readOnly && (
              <Button
                variant="secondary"
                className="col-span-full justify-self-start"
                onMouseDown={keepFocus}
                onClick={(event) => {
                  const text = reshape(
                    event,
                    removeGood(goods, row),
                    after < 0 ? 'goods-add' : `goods-${after}-id`,
                  );
                  if (text) setRemoved({ name, text });
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
          onClick={(event) => reshape(event, addGood(goods), `goods-${goods.length}-id`)}
        >
          {t('config.goodsForm.add')}
        </Button>
      )}
      {/* Toujours présente : le retrait est annoncé dès qu'il est fait. Sans rôle `status` : celui de
          l'écran reste le seul, qui annonce l'issue des commandes. */}
      <p id="goods-announce" aria-live="polite" className="text-sm">
        {announced && t('config.goodsForm.removed', { name: removed.name })}
      </p>
    </details>
  );
}
