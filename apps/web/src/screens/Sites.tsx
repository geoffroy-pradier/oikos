import { Button, Card } from '@oikos/ui';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { acquireSite, collectSite, setSiteRecipe, type CommandResponse } from '../api';
import { useRows, useSiteRules } from '../data';
import { useHouse } from '../house';

interface Site {
  id: string;
  recipe_id: string;
  cycle_started_at: string;
}
type Notice = { kind: 'status' | 'alert'; text: string } | null;
const CONTROL = 'min-h-11 w-full rounded-md border border-border bg-surface px-3';

/**
 * Sites de la maison : récolte, changement de production, acquisition d'un nouveau site
 * (docs/specs/04-systemes-gestion.md, 4.1 et 4.2). `onChanged` : la trésorerie ou le stock ont pu bouger.
 */
export function SitesCard({ onChanged }: { onChanged: () => Promise<unknown> }) {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const sites = useRows<Site>('my_sites', 'id, recipe_id, cycle_started_at', 'id');
  const { rules, failed: rulesFailed, reload: reloadRules } = useSiteRules();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  // Production choisie pour chaque site (tant que le joueur n'a pas validé) et site à acquérir.
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [wanted, setWanted] = useState('');
  // Une acquisition sans réponse garde sa clé : la renvoyer rejoue l'achat au lieu d'en payer un second.
  const pending = useRef(new Map<string, string>());

  const number = new Intl.NumberFormat(i18n.language);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  // Une recette ou un type ajoutés par le back-office sans traduction s'affichent par leur identifiant.
  const recipeName = (id: string) => t(`recipes.${id}`, { defaultValue: id });
  const typeName = (id: string) => t(`siteTypes.${id}`, { defaultValue: id });
  const offers = rules?.offers ?? [];
  const offer = offers.find((candidate) => candidate.recipe.id === wanted) ?? offers[0];
  const full = rules !== null && sites.rows !== null && sites.rows.length >= rules.limit;

  /** Envoie une commande, annonce son issue, puis relit ce qu'elle a pu changer. */
  async function run<T>(send: () => Promise<CommandResponse<T>>, done: (data: T) => string) {
    setBusy(true);
    setNotice(null);
    const result = await send();
    setNotice(
      result.ok
        ? { kind: 'status', text: done(result.data) }
        : { kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) },
    );
    // Relu même après un échec : la commande a pu aboutir sans que sa réponse nous parvienne. Les
    // règles aussi : une configuration activée entre-temps a pu changer les prix annoncés.
    await Promise.all([sites.reload(), reloadRules(), onChanged()]);
    setBusy(false);
    return result;
  }

  const collect = (site: Site) =>
    run(
      () => collectSite(site.id, house.accessToken),
      (data) =>
        t('home.collected', {
          list: data.outputs
            .map((stack) =>
              t('home.stack', {
                quantity: number.format(stack.quantity),
                good: t(`goods.${stack.goodId}`, { defaultValue: stack.goodId }),
              }),
            )
            .join(', '),
        }),
    );

  async function change(site: Site, recipeId: string) {
    await run(
      () => setSiteRecipe(site.id, recipeId, house.accessToken),
      (data) => t('home.recipeChanged', { site: recipeName(data.recipeId) }),
    );
    setChosen(({ [site.id]: _done, ...others }) => others);
  }

  async function acquire(event: FormEvent) {
    event.preventDefault();
    if (!offer) return;
    const recipeId = offer.recipe.id;
    const key = pending.current.get(recipeId) ?? crypto.randomUUID();
    pending.current.set(recipeId, key);
    const result = await run(
      () => acquireSite(recipeId, house.accessToken, key),
      (data) =>
        t('home.acquired', {
          site: recipeName(data.recipeId),
          cost: number.format(data.costOboles),
        }),
    );
    // Sans réponse de l'API (`INTERNAL`), l'intention reste en attente : son issue est inconnue.
    if (result.ok || result.error.code !== 'INTERNAL') pending.current.delete(recipeId);
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl">{t('home.sites')}</h2>
        {rules && sites.rows && (
          <p className="text-sm text-muted-foreground">
            {t('home.sitesCount', {
              count: sites.rows.length,
              limit: number.format(rules.limit),
            })}
          </p>
        )}
      </div>
      {(sites.failed || rulesFailed) && <p role="alert">{t('app.loadFailed')}</p>}
      {sites.rows?.length === 0 && <p className="text-muted-foreground">{t('home.sitesEmpty')}</p>}
      <ul className="flex flex-col gap-3">
        {sites.rows?.map((site) => {
          const name = recipeName(site.recipe_id);
          const type = rules?.siteTypeOf(site.recipe_id);
          const alternatives = rules?.alternatives(site.recipe_id) ?? [];
          const choice = chosen[site.id] ?? site.recipe_id;
          return (
            <li key={site.id} className="flex flex-col gap-2 border-t border-border pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-lg">{name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {type && <>{t('home.siteType', { type: typeName(type) })} · </>}
                    {t('home.siteSince', { date: date.format(new Date(site.cycle_started_at)) })}
                  </p>
                </div>
                <Button
                  disabled={busy}
                  aria-label={t('home.collectSite', { site: name })}
                  onClick={() => void collect(site)}
                >
                  {t('home.collect')}
                </Button>
              </div>
              {alternatives.length > 0 && (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                    <span>{t('home.production')}</span>
                    <select
                      className={CONTROL}
                      aria-label={t('home.productionOf', { site: name })}
                      value={choice}
                      disabled={busy}
                      onChange={(event) =>
                        setChosen((all) => ({ ...all, [site.id]: event.target.value }))
                      }
                    >
                      <option value={site.recipe_id}>{name}</option>
                      {alternatives.map((recipe) => (
                        <option key={recipe.id} value={recipe.id}>
                          {recipeName(recipe.id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    variant="secondary"
                    disabled={busy || choice === site.recipe_id}
                    aria-label={t('home.changeSite', { site: name })}
                    onClick={() => void change(site, choice)}
                  >
                    {t('home.change')}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {rules && (
        <form
          className="flex flex-col gap-2 border-t border-border pt-3"
          onSubmit={(event) => void acquire(event)}
        >
          <h3 className="text-lg">{t('home.acquire')}</h3>
          {full ? (
            <p className="text-muted-foreground">{t('home.limitReached')}</p>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span>{t('home.acquireRecipe')}</span>
                <select
                  className={CONTROL}
                  value={offer?.recipe.id ?? ''}
                  disabled={busy}
                  onChange={(event) => setWanted(event.target.value)}
                >
                  {offers.map(({ recipe, costOboles }) => (
                    <option key={recipe.id} value={recipe.id}>
                      {t('home.acquireOption', {
                        site: recipeName(recipe.id),
                        type: typeName(recipe.siteType),
                        cost: number.format(costOboles),
                      })}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" disabled={busy || !offer}>
                {t('home.acquireSubmit')}
              </Button>
            </>
          )}
        </form>
      )}
      {/* Toujours présent : un lecteur d'écran annonce le résultat dès qu'il apparaît. */}
      <p
        role={notice?.kind ?? 'status'}
        className={notice?.kind === 'alert' ? 'font-semibold text-danger' : ''}
      >
        {notice?.text}
      </p>
    </Card>
  );
}
