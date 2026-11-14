import { Button, Card } from '@oikos/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { acquireSite, collectSite, setSiteRecipe, type CommandResponse } from '../api';
import { useRows, useSiteRules } from '../data';
import { useHouse } from '../house';
import { freeStockIn, previewHarvest, type StockLine } from '../site-rules';

interface Site {
  id: string;
  recipe_id: string;
  cycle_started_at: string;
}
/** Résultat d'une action, affiché là où elle a été lancée : sous son site, ou sous le formulaire. */
type Notice = { target: string; kind: 'status' | 'alert'; text: string } | null;
const ACQUIRE = 'acquire';
const CONTROL = 'min-h-11 w-full rounded-md border border-border bg-surface px-3';
// Pendant une commande, les boutons restent atteignables (le focus ne retombe pas sur la page).
const WAITING = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

/**
 * Sites de la maison : récolte, changement de production, acquisition d'un nouveau site
 * (docs/specs/04-systemes-gestion.md, 4.1 et 4.2). `onChanged` : la trésorerie ou le stock ont pu bouger.
 */
export function SitesCard({
  stock,
  onChanged,
}: {
  /** Stock de la maison (`null` tant qu'il n'est pas lu) : intrants disponibles des ateliers. */
  stock: StockLine[] | null;
  onChanged: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  // Par identifiant (ordre de création) : une récolte ne réordonne pas la liste.
  const sites = useRows<Site>('my_sites', 'id, recipe_id, cycle_started_at', 'id');
  const { rules, failed: rulesFailed, reload: reloadRules } = useSiteRules();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  // Production choisie pour chaque site (tant que le joueur n'a pas validé) et site à acquérir.
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [wanted, setWanted] = useState('');
  // Une acquisition sans réponse garde sa clé : la renvoyer rejoue l'achat au lieu d'en payer un second.
  const pending = useRef(new Map<string, string>());
  // Une commande à la fois, même pour deux activations que le rendu n'a pas eu le temps de séparer.
  const running = useRef(false);
  // Le résultat reste dans la fenêtre, même quand un nouveau site a poussé le formulaire vers le bas.
  const noticeElement = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    noticeElement.current?.scrollIntoView({ block: 'nearest' });
  }, [notice]);

  const number = new Intl.NumberFormat(i18n.language);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  // Une recette ou un type ajoutés par le back-office sans traduction s'affichent par leur identifiant.
  const recipeName = (id: string) => t(`recipes.${id}`, { defaultValue: id });
  const stackText = (stack: { goodId: string; quantity: number }) =>
    t('home.stack', {
      quantity: number.format(stack.quantity),
      good: t(`goods.${stack.goodId}`, { defaultValue: stack.goodId }),
    });
  // Les sites de la maison sont dans sa cité : c'est ce stock-là, et lui seul, qu'un atelier consomme.
  const freeStock = (goodId: string) => freeStockIn(stock ?? [], house.cityId, goodId);
  // L'heure avance sans action du joueur : ce qui est récoltable est recompté chaque minute.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const typeName = (id: string) => t(`siteTypes.${id}`, { defaultValue: id });
  const rows = sites.rows ?? [];
  /** Nom d'un site : sa production, numérotée quand plusieurs sites ont la même. */
  const siteName = (site: Site) => {
    const alike = rows.filter((other) => other.recipe_id === site.recipe_id);
    const name = recipeName(site.recipe_id);
    return alike.length < 2
      ? name
      : t('home.siteNumbered', { site: name, number: number.format(alike.indexOf(site) + 1) });
  };
  const offers = rules?.offers ?? [];
  const offer = offers.find((candidate) => candidate.recipe.id === wanted) ?? offers[0];
  const full = rules !== null && sites.rows !== null && sites.rows.length >= rules.limit;

  /** Envoie une commande, relit ce qu'elle a pu changer, puis annonce son issue à l'endroit de l'action. */
  async function run<T>(
    target: string,
    send: () => Promise<CommandResponse<T>>,
    done: (data: T, replayed: boolean) => string,
  ) {
    if (running.current) return null;
    running.current = true;
    setBusy(true);
    setNotice(null);
    const result = await send();
    // Relu même après un échec : la commande a pu aboutir sans que sa réponse nous parvienne. Les
    // règles aussi : une configuration activée entre-temps a pu changer les prix annoncés.
    await Promise.all([sites.reload(), reloadRules(), onChanged()]);
    setNow(new Date());
    // Quand le message paraît, les chiffres sont à jour et les contrôles de nouveau prêts.
    setNotice(
      result.ok
        ? { target, kind: 'status', text: done(result.data, result.replayed) }
        : { target, kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) },
    );
    setBusy(false);
    running.current = false;
    return result;
  }

  const collect = (site: Site) =>
    run(
      site.id,
      () => collectSite(site.id, house.accessToken),
      (data) => t('home.collected', { list: data.outputs.map(stackText).join(', ') }),
    );

  async function change(site: Site, recipeId: string) {
    const result = await run(
      site.id,
      () => setSiteRecipe(site.id, recipeId, house.accessToken),
      (data) => t('home.recipeChanged', { site: recipeName(data.recipeId) }),
    );
    // Après un refus (récolter d'abord, par exemple), le choix reste : le joueur n'a qu'à réessayer.
    if (result?.ok) setChosen(({ [site.id]: _done, ...others }) => others);
  }

  async function acquire(event: FormEvent) {
    event.preventDefault();
    if (!offer) return;
    const recipeId = offer.recipe.id;
    const key = pending.current.get(recipeId) ?? crypto.randomUUID();
    pending.current.set(recipeId, key);
    const result = await run(
      ACQUIRE,
      () => acquireSite(recipeId, house.accessToken, key),
      // Rejeu : cet achat avait abouti lors d'un essai resté sans réponse. Rien n'est payé cette fois.
      (data, replayed) =>
        t(replayed ? 'home.alreadyAcquired' : 'home.acquired', {
          site: recipeName(data.recipeId),
          cost: number.format(data.costOboles),
        }),
    );
    // Sans réponse de l'API (`INTERNAL`), l'intention reste en attente : son issue est inconnue.
    if (result && (result.ok || result.error.code !== 'INTERNAL')) pending.current.delete(recipeId);
  }

  const announce = (target: string) =>
    notice?.target === target && (
      <p
        ref={noticeElement}
        role={notice.kind}
        className={notice.kind === 'alert' ? 'font-semibold text-danger' : ''}
      >
        {notice.text}
      </p>
    );

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl">{t('home.sites')}</h2>
        {rules && sites.rows && (
          <p className="text-sm text-muted-foreground">
            {t('home.sitesCount', {
              count: number.format(sites.rows.length),
              limit: number.format(rules.limit),
            })}
          </p>
        )}
      </div>
      {(sites.failed || rulesFailed) && <p role="alert">{t('app.loadFailed')}</p>}
      {sites.rows?.length === 0 && <p className="text-muted-foreground">{t('home.sitesEmpty')}</p>}
      <ul className="flex flex-col gap-3">
        {rows.map((site) => {
          const name = siteName(site);
          const type = rules?.siteTypeOf(site.recipe_id);
          const alternatives = rules?.alternatives(site.recipe_id) ?? [];
          const choice = chosen[site.id] ?? site.recipe_id;
          const recipe = rules?.recipe(site.recipe_id);
          // Tant que le stock n'est pas lu, rien n'est annoncé : on ne dit pas « à court » à tort.
          const harvest =
            recipe && stock
              ? previewHarvest(recipe, new Date(site.cycle_started_at), now, freeStock)
              : null;
          return (
            <li key={site.id} className="flex flex-col gap-2 border-t border-border pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-lg">{name}</h3>
                  <div className="text-sm text-muted-foreground">
                    {type && <p>{t('home.siteType', { type: typeName(type) })}</p>}
                    <p>
                      {t('home.siteSince', { date: date.format(new Date(site.cycle_started_at)) })}
                    </p>
                  </div>
                </div>
                <Button
                  className={WAITING}
                  aria-disabled={busy}
                  aria-label={t('home.collectSite', { site: name })}
                  onClick={() => void collect(site)}
                >
                  {t('home.collect')}
                </Button>
              </div>
              {recipe && recipe.inputs.length > 0 && (
                <div className="text-sm">
                  <p>{t('home.inputs')}</p>
                  <ul>
                    {recipe.inputs.map((stack) => (
                      <li key={stack.goodId}>
                        {t('home.inputLine', {
                          quantity: number.format(stack.quantity),
                          good: t(`goods.${stack.goodId}`, { defaultValue: stack.goodId }),
                          free: number.format(freeStock(stack.goodId)),
                        })}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {harvest && (
                <p className="text-sm">
                  {harvest.cycles > 0
                    ? t('home.harvestable', { list: harvest.outputs.map(stackText).join(', ') })
                    : t('home.harvestNone')}
                  {harvest.waiting > 0 && (
                    <> {t('home.harvestWaiting', { count: harvest.waiting })}</>
                  )}
                </p>
              )}
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
                      <option value={site.recipe_id}>{recipeName(site.recipe_id)}</option>
                      {alternatives.map((recipe) => (
                        <option key={recipe.id} value={recipe.id}>
                          {recipeName(recipe.id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    variant="secondary"
                    className={WAITING}
                    disabled={choice === site.recipe_id}
                    aria-disabled={busy}
                    aria-label={t('home.changeSite', { site: name })}
                    onClick={() => void change(site, choice)}
                  >
                    {t('home.change')}
                  </Button>
                </div>
              )}
              {announce(site.id)}
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
                  {offers.map(({ recipe, costOboles }) => {
                    const [site, type] = [recipeName(recipe.id), typeName(recipe.siteType)];
                    const cost = number.format(costOboles);
                    return (
                      <option key={recipe.id} value={recipe.id}>
                        {/* Le type n'est pas répété quand la production porte déjà son nom. */}
                        {site === type
                          ? t('home.acquireOptionPlain', { site, cost })
                          : t('home.acquireOption', { site, type, cost })}
                      </option>
                    );
                  })}
                </select>
              </label>
              <Button type="submit" className={WAITING} disabled={!offer} aria-disabled={busy}>
                {t('home.acquireSubmit')}
              </Button>
            </>
          )}
          {announce(ACQUIRE)}
        </form>
      )}
    </Card>
  );
}
