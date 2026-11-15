import { Button, Card } from '@oikos/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { acquireSite, collectSite, restartSite, setSiteRecipe, type CommandResponse } from '../api';
import { useRows, useSiteRules } from '../data';
import { useHouse } from '../house';
import {
  freeStockIn,
  previewHarvest,
  siteAlerts,
  type SiteAlert,
  type StockLine,
} from '../site-rules';
import { useMoney } from '../money';
import { collectAll } from '../collect-all';
import { formatList } from '../lists';
import { acquireIntent, acquireIntentBelow, outcomeKnown, pendingKeys } from '../pending-keys';
import { LoadProblem, Loading } from './LoadProblem';
import { serverClock, syncServerClock } from '../server-clock';

interface Site {
  id: string;
  city_id: string;
  recipe_id: string;
  cycle_started_at: string;
  /** Instant de l'arrêt d'un site dont l'entretien n'a pas été payé ; `null` s'il tourne (5.5). */
  halted_at: string | null;
}
/** Résultat d'une action, affiché là où elle a été lancée : sous son site, ou sous le formulaire. */
type Notice = { target: string; kind: 'status' | 'alert'; text: string } | null;
const ACQUIRE = 'acquire';
const ALL = 'all';
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
  const sites = useRows<Site>(
    'my_sites',
    'id, city_id, recipe_id, cycle_started_at, halted_at',
    'id',
  );
  const { rules, failed: rulesFailed, reload: reloadRules } = useSiteRules();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  // Production choisie pour chaque site (tant que le joueur n'a pas validé) et site à acquérir.
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [wanted, setWanted] = useState('');
  // Une commande sans réponse garde sa clé, même onglet quitté : la renvoyer rejoue la commande au lieu
  // de la payer une seconde fois.
  const pending = useMemo(() => pendingKeys(house.id, () => window.sessionStorage), [house.id]);
  // Une commande à la fois, même pour deux activations que le rendu n'a pas eu le temps de séparer.
  const running = useRef(false);
  // Sites lus, hors commande (à sa fin, écran rouvert, retour sur l'onglet) : une acquisition demandée
  // avec moins de sites et restée sans réponse ne sera plus rejouée. Sa clé n'est rendue qu'ici, et le
  // joueur est prévenu avant l'affichage : réessayer serait un nouvel achat.
  useLayoutEffect(() => {
    if (running.current || !sites.rows) return;
    if (pending.settleWhere(acquireIntentBelow(sites.rows.length)) > 0)
      setNotice({ target: ACQUIRE, kind: 'alert', text: t('home.acquireUnanswered') });
  }, [pending, sites.rows, busy]);
  // Le résultat reste dans la fenêtre, même quand un nouveau site a poussé le formulaire vers le bas.
  const noticeElement = useRef<HTMLParagraphElement>(null);
  // Titre de la carte : le foyer y va après une relecture réussie.
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const element = noticeElement.current;
    element?.scrollIntoView({ block: 'nearest' });
    // Le bouton qui a lancé l'action a pu disparaître (un site relancé n'a plus de bouton « Relancer »,
    // « Acquérir » s'efface à la limite) ou devenir inactif (« Changer » après un
    // changement réussi) : le foyer, retombé sur la page, est posé sur le message qui annonce l'issue.
    const active = document.activeElement;
    const lost = active === document.body || active?.matches(':disabled') === true;
    if (element && lost) element.focus();
  }, [notice]);

  const number = new Intl.NumberFormat(i18n.language);
  const list = (items: string[]) => formatList(i18n.language, items);
  const money = useMoney();
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  // Une recette ou un type ajoutés par le back-office sans traduction s'affichent par leur identifiant.
  const recipeName = (id: string) => t(`recipes.${id}`, { defaultValue: id });
  const stackText = (stack: { goodId: string; quantity: number }) =>
    t('home.stack', {
      quantity: number.format(stack.quantity),
      good: t(`goods.${stack.goodId}`, { defaultValue: stack.goodId }),
    });
  // Un atelier ne consomme que le stock de sa propre cité, quelle que soit celle de la maison.
  const freeStockOf = (site: Site) => (goodId: string) =>
    freeStockIn(stock ?? [], site.city_id, goodId);
  // L'heure avance sans action du joueur : ce qui est récoltable est recompté chaque minute, à l'heure
  // du serveur. Au retour sur un onglet resté en arrière-plan (minuterie ralentie, clôture passée
  // entre-temps), l'heure et les sites sont relus, puis tout est recompté.
  // Tant que la première lecture de l'heure n'a pas abouti (ou échoué), rien n'est annoncé : l'heure
  // du navigateur peut être fausse de plusieurs heures. Deux lectures simultanées : la dernière gagne.
  const [now, setNow] = useState<Date | null>(null);
  const reloadSites = sites.reload;
  useEffect(() => {
    let live = true;
    const sync = () => void syncServerClock().then(() => live && setNow(serverClock.now()));
    sync();
    const timer = setInterval(() => setNow(serverClock.now()), 60_000);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void reloadSites();
      sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reloadSites]);
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
  /** Ce qu'une récolte donnerait maintenant (`harvest`, `null` sans règles ni stock) et les alertes du site. */
  const stateOf = (site: Site) => {
    const recipe = rules?.recipe(site.recipe_id);
    const halted = site.halted_at ? new Date(site.halted_at) : null;
    // Recette retirée de la configuration (4.2) : le site ne produit plus, quel que soit son arrêt.
    if (rules && !recipe) return { halted, harvest: null, alerts: ['retired'] as SiteAlert[] };
    // Tant que le stock ou l'heure ne sont pas lus, rien n'est annoncé : on ne dit pas « à court » à tort.
    if (!recipe || !stock || !now)
      return { halted, harvest: null, alerts: halted ? ['halted' as const] : [] };
    const harvest = previewHarvest(
      recipe,
      new Date(site.cycle_started_at),
      now,
      freeStockOf(site),
      halted,
    );
    return { halted, harvest, alerts: siteAlerts(recipe, harvest, halted !== null) };
  };
  const watched = rows
    .map((site) => ({ site, alerts: stateOf(site).alerts }))
    .filter(({ alerts }) => alerts.length > 0);
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
    try {
      const result = await send();
      // Relu même après un échec : la commande a pu aboutir sans que sa réponse nous parvienne. Les
      // règles aussi : une configuration activée entre-temps a pu changer les prix annoncés.
      await refresh();
      // Quand le message paraît, les chiffres sont à jour et les contrôles de nouveau prêts.
      setNotice(
        result.ok
          ? { target, kind: 'status', text: done(result.data, result.replayed) }
          : { target, kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) },
      );
      return result;
    } catch {
      // Un appel qui a levé (envoi, relecture, message) : l'issue est tenue pour inconnue, même si la
      // commande a pu aboutir. La clé éventuelle reste en attente (la renvoyer rejoue la réponse), ce
      // qui a pu changer est relu une fois, l'erreur est annoncée et l'écran redevient utilisable.
      await refresh().catch(() => undefined);
      setNotice({ target, kind: 'alert', text: t('errors.INTERNAL') });
      return null;
    } finally {
      setBusy(false);
      running.current = false;
    }
  }

  /** Relit ce qu'une commande a pu changer, puis l'heure. */
  async function refresh() {
    await Promise.all([sites.reload(), reloadRules(), onChanged()]);
    setNow(serverClock.now());
  }

  const collect = (site: Site) =>
    run(
      site.id,
      () => collectSite(site.id, house.accessToken),
      (data) => t('home.collected', { list: list(data.outputs.map(stackText)) }),
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

  /** Relance un site à l'arrêt : la maison paie l'entretien d'un jour, le site repart (5.5). */
  async function restart(site: Site) {
    // L'arrêt fait partie de l'intention : relancer un site arrêté de nouveau est une autre demande, qui
    // ne doit pas rejouer la réponse d'une relance précédente restée sans réponse.
    const intent = `restart:${site.id}:${site.halted_at}`;
    const key = pending.keyFor(intent, () => crypto.randomUUID());
    const result = await run(
      site.id,
      () => restartSite(site.id, house.accessToken, key),
      (data, replayed) =>
        t(replayed ? 'home.alreadyRestarted' : 'home.restarted', {
          site: siteName(site),
          cost: money(data.upkeepOboles),
        }),
    );
    // Un refus reste attaché à sa clé (« le site vient de changer », trésorerie insuffisante) : le
    // prochain essai en prend une neuve. Sans réponse de l'API, la même clé rejoue la relance.
    if (result && outcomeKnown(result)) pending.settle(intent);
  }

  async function acquire(event: FormEvent) {
    event.preventDefault();
    if (!offer) return;
    const recipeId = offer.recipe.id;
    // Un achat abouti sans réponse a ajouté un site, vu à la relecture : vouloir de nouveau la même
    // production est alors un nouvel achat. Sans site de plus, l'issue reste inconnue : même clé.
    const intent = acquireIntent(recipeId, sites.rows?.length ?? null);
    // Sites non lus (retour sur l'onglet, lecture en échec) : rien ne part, quel que soit l'affichage.
    if (intent === null) return;
    const key = pending.keyFor(intent, () => crypto.randomUUID());
    const send = async () => {
      const answer = await acquireSite(recipeId, house.accessToken, key);
      // Issue connue : l'intention est réglée avant toute relecture. Sans réponse de l'API, ou écartée
      // avant son registre, elle reste en attente.
      if (outcomeKnown(answer)) pending.settle(intent);
      return answer;
    };
    await run(
      ACQUIRE,
      async () => {
        const first = await send();
        if (first.ok || first.error.code !== 'INTERNAL') return first;
        // Sans réponse, mais un site de plus qu'à l'envoi : l'achat a sans doute abouti. La même clé
        // repart une fois, pour connaître l'issue.
        const read = await sites.reload();
        return read !== null && read.length > rows.length ? send() : first;
      },
      // Rejeu : cet achat avait abouti lors d'un essai resté sans réponse. Rien n'est payé cette fois.
      (data, replayed) =>
        t(replayed ? 'home.alreadyAcquired' : 'home.acquired', {
          site: recipeName(data.recipeId),
          cost: money(data.costOboles),
        }),
    );
  }

  /** Sites qui ont quelque chose à récolter maintenant, d'après le calcul affiché. */
  const harvestable = rows.filter((site) => (stateOf(site).harvest?.cycles ?? 0) > 0);

  /** « Tout récolter » : une commande par site récoltable ; le résultat dit ce qui a échoué, et où. */
  async function collectEverything() {
    if (running.current || harvestable.length === 0) return;
    running.current = true;
    setBusy(true);
    setNotice(null);
    const names = new Map(harvestable.map((site) => [site.id, siteName(site)]));
    try {
      const outcome = await collectAll(
        harvestable.map((site) => site.id),
        (siteId) => collectSite(siteId, house.accessToken),
      );
      await refresh();
      const parts: string[] = [];
      if (outcome.succeeded.length > 0)
        parts.push(
          t('home.collectedAll', {
            count: outcome.succeeded.length,
            number: number.format(outcome.succeeded.length),
            list: list(outcome.collected.map(stackText)),
          }),
        );
      for (const failure of outcome.failed)
        parts.push(
          t('home.collectAllFailed', {
            site: names.get(failure.siteId) ?? failure.siteId,
            reason: t([`errors.${failure.code}`, 'errors.INTERNAL']),
          }),
        );
      setNotice({
        target: ALL,
        kind: outcome.succeeded.length === 0 ? 'alert' : 'status',
        text: parts.join(' '),
      });
    } catch {
      // Des récoltes ont pu aboutir avant l'appel qui a levé : ce qui a changé est relu une fois.
      await refresh().catch(() => undefined);
      setNotice({ target: ALL, kind: 'alert', text: t('errors.INTERNAL') });
    } finally {
      setBusy(false);
      running.current = false;
    }
  }

  // Chaque cible a ses deux régions vivantes, présentes avant le message : un lecteur d'écran n'annonce
  // de façon sûre que ce qui change dans une région déjà là. Le message lui-même n'a pas de rôle (une
  // seule région l'annonce). Vide, une région sort du flux (`absolute`) sans quitter l'arbre
  // d'accessibilité : l'espacement de la carte ne bouge pas.
  const announce = (target: string) =>
    (['status', 'alert'] as const).map((kind) => (
      <div key={kind} role={kind} className="empty:absolute">
        {notice?.target === target && notice.kind === kind && (
          <p
            ref={noticeElement}
            tabIndex={-1}
            className={kind === 'alert' ? 'font-semibold text-danger' : ''}
          >
            {notice.text}
          </p>
        )}
      </div>
    ));

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 ref={title} tabIndex={-1} className="text-xl">
          {t('home.sites')}
        </h2>
        {rules && sites.rows && (
          <p className="text-sm text-muted-foreground">
            {t('home.sitesCount', {
              count: number.format(sites.rows.length),
              limit: number.format(rules.limit),
            })}
          </p>
        )}
      </div>
      {harvestable.length > 0 && (
        <Button
          className={`self-start ${WAITING}`}
          aria-disabled={busy}
          aria-label={t('home.collectAllLabel', {
            count: harvestable.length,
            number: number.format(harvestable.length),
          })}
          onClick={() => void collectEverything()}
        >
          {t('home.collectAll')}
        </Button>
      )}
      {announce(ALL)}
      {(sites.failed || rulesFailed) && (
        <LoadProblem heading={title} onRetry={() => Promise.all([sites.reload(), reloadRules()])} />
      )}
      {sites.rows === null && !sites.failed && <Loading />}
      {sites.rows?.length === 0 && <p className="text-muted-foreground">{t('home.sitesEmpty')}</p>}
      {watched.length > 0 && (
        <section aria-labelledby="sites-watch" className="flex flex-col gap-1">
          <h3 id="sites-watch" className="font-semibold">
            {t('home.watch')}
          </h3>
          <ul className="list-disc pl-5">
            {watched.map(({ site, alerts }) => (
              <li key={site.id}>
                {t('home.watchLine', {
                  site: siteName(site),
                  alerts: list(alerts.map((alert) => t(`home.alert.${alert}`))),
                })}
              </li>
            ))}
          </ul>
        </section>
      )}
      <ul className="flex flex-col gap-3">
        {rows.map((site) => {
          const name = siteName(site);
          const type = rules?.siteTypeOf(site.recipe_id);
          const alternatives = rules?.alternatives(site.recipe_id) ?? [];
          const choice = chosen[site.id] ?? site.recipe_id;
          const recipe = rules?.recipe(site.recipe_id);
          const { halted, harvest, alerts } = stateOf(site);
          // Sans recette, ni récolte ni relance : seul le changement de production est proposé.
          const retired = alerts.includes('retired');
          // `null` tant que les règles ne sont pas lues : aucun prix n'est annoncé à leur place.
          const upkeep = rules ? rules.upkeepOf(site.recipe_id) : null;
          return (
            <li key={site.id} className="flex flex-col gap-2 border-t border-border pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-lg">{name}</h3>
                  <div className="text-sm text-muted-foreground">
                    {type && <p>{t('home.siteType', { type: typeName(type) })}</p>}
                    {!retired && (
                      <p>
                        {t('home.siteSince', {
                          date: date.format(new Date(site.cycle_started_at)),
                        })}
                      </p>
                    )}
                    {upkeep !== null && upkeep > 0 && (
                      <p>{t('home.upkeep', { cost: money(upkeep) })}</p>
                    )}
                    {recipe && (
                      <p>
                        {t('home.cap', {
                          count: recipe.maxAccruedCycles,
                          cycles: number.format(recipe.maxAccruedCycles),
                          list: list(
                            recipe.outputs.map((stack) =>
                              stackText({
                                goodId: stack.goodId,
                                quantity: stack.quantity * recipe.maxAccruedCycles,
                              }),
                            ),
                          ),
                        })}
                      </p>
                    )}
                  </div>
                </div>
                {!retired && (
                  <Button
                    className={WAITING}
                    aria-disabled={busy}
                    aria-label={t('home.collectSite', { site: name })}
                    onClick={() => void collect(site)}
                  >
                    {t('home.collect')}
                  </Button>
                )}
              </div>
              {retired && <p className="font-semibold text-danger">{t('home.retired')}</p>}
              {halted && !retired && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 flex-1 font-semibold text-danger">
                    {t('home.halted', { date: date.format(halted) })}
                  </p>
                  {/* Sans les règles, le prix est inconnu : pas de bouton qui annoncerait « 0 obole ». */}
                  {upkeep !== null && (
                    <Button
                      variant="secondary"
                      className={WAITING}
                      aria-disabled={busy}
                      aria-label={t('home.restartSite', {
                        site: name,
                        cost: money(upkeep),
                      })}
                      onClick={() => void restart(site)}
                    >
                      {t('home.restart', { cost: money(upkeep) })}
                    </Button>
                  )}
                </div>
              )}
              {recipe && recipe.inputs.length > 0 && (
                <div className="text-sm">
                  <p>{t('home.inputs')}</p>
                  <ul>
                    {recipe.inputs.map((stack) => (
                      <li key={stack.goodId}>
                        {t('home.inputLine', {
                          quantity: number.format(stack.quantity),
                          good: t(`goods.${stack.goodId}`, { defaultValue: stack.goodId }),
                          free: number.format(freeStockOf(site)(stack.goodId)),
                        })}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {harvest && (
                <p className="text-sm">
                  {harvest.cycles > 0
                    ? t('home.harvestable', { list: list(harvest.outputs.map(stackText)) })
                    : t('home.harvestNone')}
                  {harvest.waiting > 0 && (
                    <> {t('home.harvestWaiting', { count: harvest.waiting })}</>
                  )}
                  {alerts.includes('full') && (
                    // Sans aucun cycle récoltable, récolter n'y changerait rien : il faut des intrants.
                    <> {t(harvest.cycles > 0 ? 'home.harvestFull' : 'home.harvestFullShort')}</>
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
                      <option value={site.recipe_id}>
                        {retired
                          ? t('home.retiredOption', { site: recipeName(site.recipe_id) })
                          : recipeName(site.recipe_id)}
                      </option>
                      {alternatives.map((recipe) => (
                        <option key={recipe.id} value={recipe.id}>
                          {/* Toutes les productions sont proposées : leur type est précisé. */}
                          {retired
                            ? t('home.productionTyped', {
                                site: recipeName(recipe.id),
                                type: typeName(recipe.siteType),
                              })
                            : recipeName(recipe.id)}
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

      {/* Proposée une fois les sites lus : leur nombre fait partie de l'intention (rejeu ou nouvel achat). */}
      {rules && sites.rows && (
        <form
          aria-labelledby="sites-acquire"
          className="flex flex-col gap-2 border-t border-border pt-3"
          onSubmit={(event) => void acquire(event)}
        >
          <h3 id="sites-acquire" className="text-lg">
            {t('home.acquire')}
          </h3>
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
                    const cost = money(costOboles);
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
