import { Button, cn, Plus, Sheet, Stepper } from '@oikos/ui';
import { GoodPicture } from '../good-tiers';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatList } from '../lists';
import { useMoney } from '../money';
import type { SiteRecipe } from '../site-rules';
import { useStepperLabels } from '../stepper-labels';

/** Fiche à cocher d'une feuille : tout entière cliquable, cochée en accent, foyer visible. */
export const CHOICE_CARD = cn(
  'relative flex cursor-pointer items-center gap-3 rounded-xl border border-border-subtle p-3',
  'transition-colors duration-(--motion-fast) hover:bg-muted',
  'has-[:checked]:border-primary has-[:checked]:bg-primary-subtle',
  'has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--focus)',
);
/** Le bouton radio de la fiche : invisible mais sur toute la fiche, un clic n'importe où la coche. */
export const CHOICE_INPUT = 'absolute inset-0 z-10 size-full cursor-pointer opacity-0';

export interface SiteOffer {
  recipe: SiteRecipe;
  costOboles: number;
}

/**
 * Acquisition d'un site (4.2) en feuille, par étapes : la production, parmi celles du terroir de la cité et les
 * ateliers, puis le récapitulatif chiffré, au prix vu. Confirmer referme la feuille et lance la commande : son issue
 * s'annonce près du bouton qui l'a ouverte, dans la région de l'écran.
 */
export function SiteAcquire(props: {
  offers: readonly SiteOffer[];
  /** Entretien d'un jour d'une production, si les règles le connaissent. */
  upkeepOf: (recipeId: string) => number;
  /** Trésorerie lue, pour dire ce qu'il en restera ; absente tant qu'elle n'est pas lue. */
  balance?: number | undefined;
  /** Sites de la maison et limite du siège, pour la description de la feuille. */
  count: number;
  limit: number;
  busy: boolean;
  /** Avertissement d'une acquisition dont la réponse s'est perdue, rappelé avant un nouvel achat. */
  warning: string | null;
  onConfirm: (offer: SiteOffer) => void;
}) {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const number = new Intl.NumberFormat(i18n.language);
  const labels = useStepperLabels();
  const [open, setOpen] = useState(false);
  const [wanted, setWanted] = useState('');
  const offer = props.offers.find((each) => each.recipe.id === wanted) ?? props.offers[0];
  const name = (id: string) => t(`recipes.${id}`, { defaultValue: id });
  const type = (id: string) => t(`siteTypes.${id}`, { defaultValue: id });
  const stack = (good: { goodId: string; quantity: number }) =>
    t('home.stack', {
      quantity: number.format(good.quantity),
      good: t(`goods.${good.goodId}`, { defaultValue: good.goodId }),
    });
  const hours = (minutes: number) =>
    minutes % 60 === 0
      ? t('sites.acquire.hours', { count: minutes / 60, number: number.format(minutes / 60) })
      : t('sites.acquire.minutes', { number: number.format(minutes) });
  const line = (label: string, value: string) => (
    <div className="flex flex-wrap justify-between gap-x-4 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );

  return (
    <>
      <Button
        icon={<Plus aria-hidden="true" />}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        aria-disabled={props.busy}
        disabled={!offer}
        onClick={() => !props.busy && setOpen(true)}
      >
        {t('home.acquire')}
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('home.acquire')}
        description={t('sites.acquire.description', {
          count: props.count,
          number: number.format(props.count),
          limit: number.format(props.limit),
        })}
        closeLabel={t('shell.close')}
      >
        {offer && (
          <Stepper
            labels={{
              ...labels,
              confirm: t('sites.acquire.confirm', { cost: money(offer.costOboles) }),
            }}
            onConfirm={() => {
              setOpen(false);
              props.onConfirm(offer);
            }}
            steps={[
              {
                id: 'production',
                title: t('sites.acquire.choose'),
                content: (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="sr-only">{t('home.acquireRecipe')}</legend>
                    {props.offers.map(({ recipe, costOboles }) => (
                      <label key={recipe.id} className={CHOICE_CARD}>
                        <input
                          type="radio"
                          name="acquire"
                          value={recipe.id}
                          checked={offer.recipe.id === recipe.id}
                          onChange={() => setWanted(recipe.id)}
                          className={CHOICE_INPUT}
                        />
                        <span
                          aria-hidden="true"
                          className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-raised text-primary"
                        >
                          {recipe.outputs[0] && <GoodPicture goodId={recipe.outputs[0].goodId} />}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="font-semibold">{name(recipe.id)}</span>
                          <span className="text-sm text-muted-foreground">
                            {type(recipe.siteType)}
                          </span>
                        </span>
                        <span className="font-semibold tabular-nums">{money(costOboles)}</span>
                      </label>
                    ))}
                  </fieldset>
                ),
              },
              {
                id: 'summary',
                title: t('sites.acquire.summary'),
                content: (
                  <div className="flex flex-col gap-3">
                    <dl className="divide-y divide-border-subtle text-sm">
                      {line(t('sites.acquire.site'), name(offer.recipe.id))}
                      {line(
                        t('sites.acquire.cycle', { duration: hours(offer.recipe.durationMinutes) }),
                        formatList(i18n.language, offer.recipe.outputs.map(stack)),
                      )}
                      {offer.recipe.inputs.length > 0 &&
                        line(
                          t('sites.acquire.inputs'),
                          formatList(i18n.language, offer.recipe.inputs.map(stack)),
                        )}
                      {line(t('sites.acquire.workers'), number.format(offer.recipe.workers))}
                      {line(t('sites.acquire.upkeep'), money(props.upkeepOf(offer.recipe.id)))}
                      {line(t('sites.acquire.cost'), money(offer.costOboles))}
                      {props.balance !== undefined &&
                        line(t('sites.acquire.after'), money(props.balance - offer.costOboles))}
                    </dl>
                    {props.warning && (
                      <p className="rounded-lg bg-warning-subtle p-3 text-sm font-semibold text-warning">
                        {props.warning}
                      </p>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Sheet>
    </>
  );
}
