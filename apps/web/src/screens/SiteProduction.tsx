import { Button, GoodIcon, RefreshCw, Sheet, Stepper } from '@oikos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatList } from '../lists';
import { useMoney } from '../money';
import type { SiteRecipe } from '../site-rules';
import { useStepperLabels } from '../stepper-labels';
import { CHOICE_CARD, CHOICE_INPUT } from './SiteAcquire';

/**
 * Changement de production d'un site (4.2) en feuille, par étapes : la production, parmi celles que la cité du site
 * admet, puis ce qui change (extrants, intrants, travailleurs, entretien). Continuer reste inactif tant que la
 * production choisie est l'actuelle ; confirmer referme la feuille et lance la commande, dont l'issue s'annonce sur
 * la fiche. Le choix appartient à l'écran : gardé après un refus (récolter d'abord), il est proposé de nouveau.
 */
export function SiteProduction(props: {
  siteName: string;
  /** Production actuelle : son identifiant, et la recette si la configuration la connaît encore. */
  current: string;
  recipe: SiteRecipe | null;
  alternatives: readonly SiteRecipe[];
  choice: string;
  onChoice: (recipeId: string) => void;
  upkeepOf: (recipeId: string) => number;
  busy: boolean;
  onConfirm: (recipeId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const number = new Intl.NumberFormat(i18n.language);
  const labels = useStepperLabels();
  const [open, setOpen] = useState(false);
  const name = (id: string) => t(`recipes.${id}`, { defaultValue: id });
  const retired = props.recipe === null;
  // Sans recette, toutes les productions sont proposées : leur type est précisé.
  const label = (recipe: SiteRecipe) =>
    retired
      ? t('home.productionTyped', {
          site: name(recipe.id),
          type: t(`siteTypes.${recipe.siteType}`, { defaultValue: recipe.siteType }),
        })
      : name(recipe.id);
  const stacks = (list: readonly { goodId: string; quantity: number }[]) =>
    list.length === 0
      ? '—'
      : formatList(
          i18n.language,
          list.map((stack) =>
            t('home.stack', {
              quantity: number.format(stack.quantity),
              good: t(`goods.${stack.goodId}`, { defaultValue: stack.goodId }),
            }),
          ),
        );
  const next = props.alternatives.find((recipe) => recipe.id === props.choice);
  const row = (title: string, before: string | null, after: string) => (
    <div className="flex flex-col gap-0.5 py-2">
      <dt className="text-muted-foreground">{title}</dt>
      <dd className="font-medium tabular-nums">
        {before === null || before === after
          ? after
          : t('sites.production.fromTo', { before, after })}
      </dd>
    </div>
  );
  const option = (id: string, text: string, goodId: string | undefined) => (
    <label key={id} className={CHOICE_CARD}>
      <input
        type="radio"
        name={`production-${props.siteName}`}
        value={id}
        checked={props.choice === id}
        onChange={() => props.onChoice(id)}
        className={CHOICE_INPUT}
      />
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-raised text-primary"
      >
        {goodId && <GoodIcon goodId={goodId} />}
      </span>
      <span className="min-w-0 flex-1 font-semibold">{text}</span>
    </label>
  );

  return (
    <>
      <Button
        variant="secondary"
        icon={<RefreshCw aria-hidden="true" />}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        aria-disabled={props.busy}
        aria-label={t('home.changeSite', { site: props.siteName })}
        onClick={() => !props.busy && setOpen(true)}
      >
        {t('sites.production.open')}
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('sites.production.title', { site: props.siteName })}
        description={t('sites.production.description')}
        closeLabel={t('shell.close')}
      >
        <Stepper
          labels={{ ...labels, confirm: t('sites.production.confirm') }}
          onConfirm={() => {
            setOpen(false);
            props.onConfirm(props.choice);
          }}
          steps={[
            {
              id: 'production',
              title: t('home.production'),
              valid: next !== undefined,
              content: (
                <fieldset className="flex flex-col gap-2">
                  <legend className="sr-only">
                    {t('home.productionOf', { site: props.siteName })}
                  </legend>
                  {option(
                    props.current,
                    retired
                      ? t('home.retiredOption', { site: name(props.current) })
                      : name(props.current),
                    props.recipe?.outputs[0]?.goodId,
                  )}
                  {props.alternatives.map((recipe) =>
                    option(recipe.id, label(recipe), recipe.outputs[0]?.goodId),
                  )}
                </fieldset>
              ),
            },
            {
              id: 'summary',
              title: t('sites.acquire.summary'),
              content: next && (
                <div className="flex flex-col gap-3 text-sm">
                  <dl className="divide-y divide-border-subtle">
                    {row(t('home.production'), name(props.current), name(next.id))}
                    {row(
                      t('sites.production.outputs'),
                      props.recipe && stacks(props.recipe.outputs),
                      stacks(next.outputs),
                    )}
                    {row(
                      t('sites.acquire.inputs'),
                      props.recipe && stacks(props.recipe.inputs),
                      stacks(next.inputs),
                    )}
                    {row(
                      t('sites.acquire.workers'),
                      props.recipe && number.format(props.recipe.workers),
                      number.format(next.workers),
                    )}
                    {row(
                      t('sites.acquire.upkeep'),
                      props.recipe && money(props.upkeepOf(props.current)),
                      money(props.upkeepOf(next.id)),
                    )}
                  </dl>
                  <p className="text-muted-foreground">{t('sites.production.note')}</p>
                </div>
              ),
            },
          ]}
        />
      </Sheet>
    </>
  );
}
