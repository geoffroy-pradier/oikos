import { cityTerroirAdmits } from '@oikos/config/schema';
import type { SiteCollectOutput } from '@oikos/contracts';
import { yieldModelOf, type WorldEventKind } from '@oikos/sim';
import {
  Button,
  Coins,
  EmptyIllustration,
  EmptyState,
  GoodIcon,
  Package,
  StatCard,
  TriangleAlert,
  Wheat,
} from '@oikos/ui';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { acquireSite, collectSite, restartSite, setSiteRecipe, type CommandResponse } from '../api';
import { useRows, useSiteRules } from '../data';
import { useHouse } from '../house';
import { parseCityIdentities } from '../city-identity';
import {
  gapsExplainedBy,
  harvestUnderEvents,
  YIELD_MODELS,
  yieldEventsOf,
  yieldGaps,
} from '../harvest-events';
import {
  cycleProgress,
  freeStockIn,
  parseLaborMarket,
  parseSiteStaff,
  parseWorkforce,
  previewHarvest,
  siteAlerts,
  type SiteAlert,
  type StockLine,
} from '../site-rules';
import { useMoney } from '../money';
import { collectAll } from '../collect-all';
import { formatList } from '../lists';
import {
  acquireIntent,
  acquireIntentBelow,
  pendingKeys,
  restartIntent,
  sendUnderKey,
} from '../pending-keys';
import { LoadProblem, Loading } from './LoadProblem';
import { ProductionList, type ProductionItem } from './HomeProduction';
import { SiteAcquire, type SiteOffer } from './SiteAcquire';
import { SiteProduction } from './SiteProduction';
import { SiteRestart } from './SiteRestart';
import { HouseNav } from '../HouseNav';
import { ScreenHeader } from '../ScreenHeader';
import { SiteSteward } from './SiteSteward';
import {
  parseInstructions,
  parseStewardActivity,
  parseStewardOrders,
  parseStewards,
} from '../stewards';
import { serverClock, syncServerClock } from '../server-clock';
import { describeWorldEvent, inForce, useEventRows } from '../world-events';

interface Site {
  id: string;
  city_id: string;
  recipe_id: string;
  cycle_started_at: string;
  /** Instant de l'arrêt d'un site dont l'entretien n'a pas été payé ; `null` s'il tourne (5.5). */
  halted_at: string | null;
}
/** Sites de la maison pour les chiffres clés du tableau de bord. */
export interface SitesSummary {
  running: number;
  total: number;
  workers: number;
  /** Intendants en poste. */
  posted: number;
}
/**
 * Résultat d'une action, affiché là où elle a été lancée : sous son site, ou sous le formulaire.
 * `unanswered` : l'avertissement d'une acquisition abandonnée, que le joueur dit avoir vérifiée.
 */
type Notice = { target: string; kind: 'status' | 'alert'; text: string; unanswered?: true } | null;
const ACQUIRE = 'acquire';
const ALL = 'all';
// Pendant une commande, les boutons restent atteignables (le focus ne retombe pas sur la page).
const WAITING = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

/** Un intendant lu sans opération : la fiche le dit, plutôt que de taire la section. */
const NO_ACTIVITY = { recent: [], lastRefusal: null };

/**
 * Sites de la maison : récolte, changement de production, acquisition d'un nouveau site
 * (docs/specs/04-systemes-gestion.md, 4.1 et 4.2). `onChanged` : la trésorerie ou le stock ont pu bouger.
 */
export function SitesCard({
  stock,
  onChanged,
  titleRef,
  figures,
  balance,
  variant = 'full',
  onSummary,
}: {
  /** Stock de la maison (`null` tant qu'il n'est pas lu) : intrants disponibles des ateliers. */
  stock: StockLine[] | null;
  onChanged: () => Promise<unknown>;
  /** Titre de l'écran Sites, qui nomme alors la liste : le foyer y va après une relecture réussie. */
  titleRef?: RefObject<HTMLHeadingElement | null>;
  /** Chiffres clés de l'écran, rangés avant celui des sites (trésorerie). */
  figures?: ReactNode;
  /** Trésorerie lue, que l'acquisition dit avant et après l'achat. */
  balance?: number | undefined;
  /** `production` : la production en cours du tableau de bord, avec les mêmes commandes de récolte. */
  variant?: 'full' | 'production';
  /** Sites en activité, travailleurs et intendants, pour les chiffres clés ; `null` tant qu'ils ne sont pas lus. */
  onSummary?: (summary: SitesSummary | null) => void;
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
  // Terroir de chaque cité (6.1) : seules ses productions sont proposées, l'API restant seule juge. Tant
  // que l'identité n'est pas lue, ou si elle est illisible, tout est proposé et l'API tranche.
  const identityRows = useRows<unknown>(
    'city_identity',
    'city_id, slug, terroir, has_port, patron_god_id, starting_recipe_id',
    'city_id',
  );
  const identities = useMemo(
    () => (identityRows.rows === null ? null : parseCityIdentities(identityRows.rows)),
    [identityRows.rows],
  );
  const reloadIdentities = identityRows.reload;
  // Salaire et hébergement du jour de chaque cité, et travailleurs sans logement de chaque site (#258) :
  // le prix d'une relance les comprend.
  const laborRows = useRows<unknown>(
    'labor_market',
    'city_id, wage_oboles, lodging_oboles',
    'city_id',
  );
  const workforceRows = useRows<unknown>(
    'my_workforce',
    'site_id, workers, housed, unhoused',
    'site_id',
  );
  // `null` tant que le marché du travail n'est pas lu (ou que sa lecture échoue) : aucun prix de relance
  // n'est annoncé, plutôt qu'un prix au salaire de base que l'API refuserait.
  const laborDays = useMemo(
    () => (laborRows.rows === null ? null : parseLaborMarket(laborRows.rows)),
    [laborRows.rows],
  );
  const unhousedOf = useMemo(
    () => (workforceRows.rows === null ? null : parseWorkforce(workforceRows.rows)),
    [workforceRows.rows],
  );
  const staffOf = useMemo(() => parseSiteStaff(workforceRows.rows), [workforceRows.rows]);
  // Intendants en poste et leurs règles (#278) ; leur section n'est montrée qu'une fois les deux vues lues.
  const stewardRows = useRows<unknown>(
    'my_stewards',
    'id, site_id, name, hired_at, unpaid_since, rules_revision',
    'hired_at',
  );
  const stewardRuleRows = useRows<unknown>(
    'my_steward_rules',
    'steward_id, position, kind, good_id, price_oboles, units',
    'position',
  );
  const stewards = useMemo(
    () =>
      stewardRows.rows && stewardRuleRows.rows
        ? parseStewards(stewardRows.rows, stewardRuleRows.rows)
        : null,
    [stewardRows.rows, stewardRuleRows.rows],
  );
  // Dernières opérations de chaque intendant et son dernier refus (#279), menées par le moteur.
  const operationRows = useRows<unknown>(
    'my_steward_operations',
    'steward_id, tick_index, rank, created_at, status, error_code, kind, good_id, summary, rules_revision',
    'created_at',
  );
  const activity = useMemo(
    () => (operationRows.rows ? parseStewardActivity(operationRows.rows) : null),
    [operationRows.rows],
  );
  // Dernière consigne de chaque intendant et sa réponse (#280).
  const instructionRows = useRows<unknown>(
    'my_steward_instructions',
    'steward_id, rules_revision, text, status, rules, simulation, refusal',
    'created_at',
  );
  const instructions = useMemo(
    () => (instructionRows.rows ? parseInstructions(instructionRows.rows) : null),
    [instructionRows.rows],
  );
  // Ordres ouverts posés par chaque intendant (#562) : des règles nouvelles ou son renvoi les annulent.
  const stewardOrderRows = useRows<unknown>(
    'my_steward_orders',
    'id, steward_id, side, good_id, price, quantity, remaining, created_at',
    'created_at',
  );
  const stewardOrders = useMemo(
    () => (stewardOrderRows.rows ? parseStewardOrders(stewardOrderRows.rows) : null),
    [stewardOrderRows.rows],
  );
  const { reload: reloadStewardOrders } = stewardOrderRows;
  const { reload: reloadStewards } = stewardRows;
  const { reload: reloadStewardRules } = stewardRuleRows;
  const { reload: reloadInstructions } = instructionRows;
  // Événements de rendement des cités des sites (7.4, #417) qui finissent après le début du plus ancien cycle
  // en cours : les seuls qu'une récolte peut encore rencontrer. La vue ne rend que ceux commencés.
  // Rien n'est lu tant que les sites ne sont pas lus, ni sans site : une lecture vide ferait estimer un champ
  // comme sans événement.
  const siteRows = sites.rows ?? [];
  const oldest = Math.min(...siteRows.map((site) => Date.parse(site.cycle_started_at)));
  const eventRows = useEventRows(
    siteRows.length === 0
      ? null
      : {
          city_id: [...new Set(siteRows.map((site) => site.city_id))].sort(),
          model: YIELD_MODELS,
          ends_at: { gt: new Date(oldest).toISOString() },
        },
  );
  const { events, reload: reloadEvents } = eventRows;
  const { reload: reloadLaborDays } = laborRows;
  const { reload: reloadWorkforce } = workforceRows;
  const admits = (cityId: string) => (recipe: { id: string; siteType: string }) => {
    const identity = identities?.get(cityId);
    return cityTerroirAdmits(
      identity ? { terroir: identity.terroir ?? undefined } : undefined,
      recipe,
    );
  };
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  // Production choisie pour chaque site (tant que le joueur n'a pas validé) et site à acquérir.
  const [chosen, setChosen] = useState<Record<string, string>>({});
  // Une commande sans réponse garde sa clé, même onglet quitté : la renvoyer rejoue la commande au lieu
  // de la payer une seconde fois.
  const pending = useMemo(() => pendingKeys(house.id, () => window.sessionStorage), [house.id]);
  // Une commande à la fois, même pour deux activations que le rendu n'a pas eu le temps de séparer.
  const running = useRef(false);
  // Sites lus, hors commande (à sa fin, écran rouvert, retour sur l'onglet) : une acquisition demandée
  // avec moins de sites ne sera plus rejouée. Sa clé n'est rendue qu'ici, même après un succès. Restée
  // sans réponse, le joueur est prévenu avant l'affichage : réessayer serait un nouvel achat. Cet
  // avertissement est rappelé à chaque ouverture de l'écran, tant qu'il n'a pas dit avoir vérifié.
  const recalled = useRef(false);
  useLayoutEffect(() => {
    if (running.current || !sites.rows) return;
    const abandoned = pending.settleWhere(acquireIntentBelow(sites.rows.length)) > 0;
    if (abandoned) pending.warning.set(true);
    const opening = !recalled.current;
    recalled.current = true;
    if ((abandoned || opening) && pending.warning.get())
      setNotice({
        target: ACQUIRE,
        kind: 'alert',
        text: t('home.acquireUnanswered'),
        unanswered: true,
      });
  }, [pending, sites.rows, busy]);
  // Le résultat reste dans la fenêtre, même quand un nouveau site a poussé le formulaire vers le bas.
  const noticeElement = useRef<HTMLParagraphElement>(null);
  // Titre de la carte, ou de l'écran : le foyer y va après une relecture réussie.
  const ownTitle = useRef<HTMLHeadingElement>(null);
  const title = titleRef ?? ownTitle;
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
  /**
   * Explication d'une récolte touchée par un événement de rendement (7.4) : à rien (sécheresse au plus
   * fort, ou extrant arrondi à zéro), ou de combien. `tense` : estimation, ou récolte faite.
   */
  const gapText = (
    site: Site,
    outputs: readonly { goodId: string; quantity: number }[],
    gaps: readonly { goodId: string; quantity: number }[],
    tense: 'eventGap' | 'collectedGap',
  ) => {
    const model = yieldModelOf(rules?.siteTypeOf(site.recipe_id) ?? '');
    if (model === undefined || gaps.length === 0) return null;
    if (outputs.every((stack) => stack.quantity === 0)) return t(`home.${tense}Zero`);
    const lost = gaps.map((gap) => stackText({ ...gap, quantity: Math.abs(gap.quantity) }));
    return t(`home.${tense}.${model}`, { list: list(lost) });
  };
  /**
   * Écart d'une récolte faite à son rendement sans événement : celui d'un champ ou d'un verger (#417), et
   * seulement s'il est du signe de l'événement de son type (`gapsExplainedBy`).
   */
  const collectedGaps = (site: Site, data: SiteCollectOutput) => {
    const recipe = rules?.recipe(site.recipe_id);
    const model = recipe && yieldModelOf(recipe.siteType);
    return recipe && model && Number.isSafeInteger(data.cycles)
      ? gapsExplainedBy(model, yieldGaps(recipe, data.cycles, data.outputs))
      : [];
  };
  /** Surplus d'une grâce consommée par une récolte (7.1, #477), bien par bien, tel que l'API l'a rendu. */
  const graceText = ({ grace }: SiteCollectOutput, site?: string) =>
    grace &&
    t(`home.${site === undefined ? 'collectedGrace' : 'collectedAllGrace'}.${grace.effect}`, {
      site,
      list: list(grace.surplus.map(stackText)),
    });
  // Un atelier ne consomme que le stock de sa propre cité, quelle que soit celle de la maison.
  const freeStockOf = (site: Site) => (goodId: string) =>
    freeStockIn(stock ?? [], site.city_id, goodId);
  // L'heure avance sans action du joueur : ce qui est récoltable est recompté chaque minute, à l'heure
  // du serveur. Au retour sur un onglet resté en arrière-plan (minuterie ralentie, clôture passée
  // entre-temps), l'heure et les sites sont relus, puis tout est recompté.
  // Tant que la première lecture de l'heure n'a pas abouti (ou échoué), rien n'est annoncé : l'heure
  // du navigateur peut être fausse de plusieurs heures. Deux lectures simultanées : la dernière gagne.
  // Les sites et les règles sont aussi relus à chaque minute, onglet visible et hors commande : un
  // arrêt prononcé par la clôture, une version activée, paraissent sans rechargement.
  const [now, setNow] = useState<Date | null>(null);
  const reloadSites = sites.reload;
  useEffect(() => {
    let live = true;
    const sync = () => void syncServerClock().then(() => live && setNow(serverClock.now()));
    sync();
    const reread = () => {
      if (running.current) return;
      void reloadSites();
      void reloadRules();
      // Une version activée entre-temps a pu resserrer ou élargir le terroir, comme changer les règles.
      void reloadIdentities();
      // Une clôture a pu fixer un autre salaire ; un bail, loger d'autres travailleurs.
      void reloadLaborDays();
      void reloadWorkforce();
      // Un événement a pu commencer.
      void reloadEvents();
    };
    const timer = setInterval(() => {
      setNow(serverClock.now());
      if (document.visibilityState === 'visible') reread();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      reread();
      sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reloadSites, reloadRules, reloadIdentities, reloadLaborDays, reloadWorkforce, reloadEvents]);
  // Fiche demandée par l'adresse (`/sites#site-…`, « Détails » du tableau de bord) : une fois les sites lus,
  // elle vient dans la fenêtre et son titre prend le foyer.
  const reached = useRef(false);
  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (reached.current || variant !== 'full' || !sites.rows || !target.startsWith('site-')) return;
    reached.current = true;
    const card = document.getElementById(target);
    card?.scrollIntoView({ block: 'start' });
    card?.querySelector<HTMLElement>('h3')?.focus();
  }, [sites.rows, variant]);
  const typeName = (id: string) => t(`siteTypes.${id}`, { defaultValue: id });
  const rows = sites.rows ?? [];
  // En activité : ni à l'arrêt, ni sans production (4.2, 5.5).
  const active =
    rules && sites.rows
      ? sites.rows.filter((site) => !site.halted_at && rules.recipe(site.recipe_id)).length
      : null;
  const workers = [...staffOf.values()].reduce((sum, staff) => sum + staff.workers, 0);
  const posted = stewards?.size ?? 0;
  useEffect(() => {
    onSummary?.(active === null ? null : { running: active, total: rows.length, workers, posted });
  }, [onSummary, active, rows.length, workers, posted]);
  /** Nom d'un site : sa production, numérotée quand plusieurs sites ont la même. */
  const siteName = (site: Site) => {
    const alike = rows.filter((other) => other.recipe_id === site.recipe_id);
    const name = recipeName(site.recipe_id);
    return alike.length < 2
      ? name
      : t('home.siteNumbered', { site: name, number: number.format(alike.indexOf(site) + 1) });
  };
  // Arrêt prononcé pendant que la fiche est ouverte (clôture impayée), vu à une relecture : annoncé, pas
  // seulement affiché. La première lecture n'annonce rien : l'arrêt est alors dit sur la fiche.
  const haltsSeen = useRef<Map<string, string | null> | null>(null);
  // Pendant une commande, la relecture n'est pas retenue : l'issue de la commande s'annonce à sa place,
  // et un arrêt découvert alors l'est à la relecture suivante (minute, retour sur l'onglet).
  useEffect(() => {
    if (!sites.rows || (haltsSeen.current && running.current)) return;
    const before = haltsSeen.current;
    haltsSeen.current = new Map(sites.rows.map((site) => [site.id, site.halted_at]));
    if (!before) return;
    // Un arrêt nouveau : site déjà lu, à l'arrêt depuis un autre instant que celui retenu (ou aucun).
    const halted = sites.rows.filter(
      (site) => site.halted_at && before.has(site.id) && before.get(site.id) !== site.halted_at,
    );
    const [first] = halted;
    if (first)
      setNotice({
        target: first.id,
        kind: 'alert',
        text: t('home.haltedNow', { list: list(halted.map(siteName)) }),
      });
  }, [sites.rows]);
  /**
   * Ce qu'une récolte donnerait maintenant (`harvest`, `null` sans règles ni stock), la quantité estimée sous
   * les événements de rendement (`estimate`, `null` tant qu'ils ne sont pas lus), ceux en cours (`current`)
   * et les alertes du site.
   */
  const stateOf = (site: Site) => {
    const recipe = rules?.recipe(site.recipe_id);
    const halted = site.halted_at ? new Date(site.halted_at) : null;
    const none = { estimate: null, current: [] };
    // Recette retirée de la configuration (4.2) : le site ne produit plus, quel que soit son arrêt.
    if (rules && !recipe)
      return { halted, harvest: null, ...none, alerts: ['retired'] as SiteAlert[] };
    // Tant que le stock ou l'heure ne sont pas lus, rien n'est annoncé : on ne dit pas « à court » à tort.
    if (!recipe || !stock || !now)
      return { halted, harvest: null, ...none, alerts: halted ? ['halted' as const] : [] };
    const harvest = previewHarvest(
      recipe,
      new Date(site.cycle_started_at),
      now,
      freeStockOf(site),
      halted,
    );
    const alerts = siteAlerts(recipe, harvest, halted !== null);
    // Champ ou verger : sa récolte n'est estimée qu'une fois ses événements lus.
    const mine =
      yieldModelOf(recipe.siteType) === undefined
        ? []
        : events && yieldEventsOf(events, site.city_id, recipe.siteType);
    if (!mine) return { halted, harvest, ...none, alerts };
    const start = new Date(site.cycle_started_at);
    const estimate = harvestUnderEvents(recipe, harvest.cycles, start, mine);
    // Un site à l'arrêt a ses cycles gelés : l'événement en cours ne touche pas sa récolte, il n'est pas dit.
    return { halted, harvest, estimate, current: halted ? [] : inForce(mine, now), alerts };
  };
  const watched = rows
    .map((site) => ({ site, alerts: stateOf(site).alerts }))
    .filter(({ alerts }) => alerts.length > 0);
  const offers = (rules?.offers ?? []).filter(({ recipe }) => admits(house.cityId)(recipe));
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
    await Promise.all([
      sites.reload(),
      reloadRules(),
      reloadIdentities(),
      reloadLaborDays(),
      reloadWorkforce(),
      reloadEvents(),
      onChanged(),
    ]);
    setNow(serverClock.now());
  }

  const collect = (site: Site) =>
    run(
      site.id,
      () => collectSite(site.id, house.accessToken),
      (data) => {
        const done = t('home.collected', { list: list(data.outputs.map(stackText)) });
        // Rendement touché par un événement : l'écart à `cycles` × extrant est expliqué (7.4, #417).
        const why = gapText(site, data.outputs, collectedGaps(site, data), 'collectedGap');
        // La grâce joue après l'événement (7.1) : son surplus est dit après l'écart dû à l'événement.
        return [done, why, graceText(data)].filter(Boolean).join(' ');
      },
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

  /** Relance un site à l'arrêt : la maison paie un jour d'entretien et de salaires, le site repart (5.5). */
  async function restart(site: Site, cost: number) {
    // Un refus reste attaché à sa clé (« le site vient de changer », prix changé) : le prochain essai en
    // prend une neuve. Sans réponse de l'API, la même clé rejoue la relance, au prix alors envoyé.
    const intent = restartIntent(site.id, site.halted_at ?? '');
    await run(
      site.id,
      () =>
        sendUnderKey(
          pending,
          intent,
          () => crypto.randomUUID(),
          cost,
          (key, sent) => restartSite(site.id, sent, house.accessToken, key),
        ),
      (data, replayed) =>
        t(replayed ? 'home.alreadyRestarted' : 'home.restarted', {
          site: siteName(site),
          // Une réponse rejouée d'avant les salaires n'a pas `wagesOboles`.
          cost: money(data.upkeepOboles + ((data.wagesOboles as number | undefined) ?? 0)),
        }),
    );
  }

  async function acquire(offer: SiteOffer) {
    // Pendant une autre commande, rien ne part : aucune clé n'est créée qui ne serait jamais envoyée.
    if (running.current) return;
    const { recipe, costOboles } = offer;
    const recipeId = recipe.id;
    // Un achat abouti sans réponse a ajouté un site, vu à la relecture : vouloir de nouveau la même
    // production est alors un nouvel achat. Sans site de plus, l'issue reste inconnue : même clé.
    const intent = acquireIntent(recipeId, sites.rows?.length ?? null);
    // Sites non lus (retour sur l'onglet, lecture en échec) : rien ne part, quel que soit l'affichage.
    if (intent === null) return;
    // Le joueur réessaie : l'avertissement d'une acquisition abandonnée a fait son office.
    pending.warning.set(false);
    // Refus : l'intention est réglée avant toute relecture. Sans réponse de l'API, ou écartée avant
    // son registre, elle reste en attente, avec le prix envoyé : un nouvel essai renvoie ce prix sous
    // la même clé, même si le tarif affiché a changé entre-temps.
    const send = () =>
      sendUnderKey(
        pending,
        intent,
        () => crypto.randomUUID(),
        costOboles,
        (key, sent) => acquireSite(recipeId, sent, house.accessToken, key),
        // Un succès ne rend la clé qu'à la relecture qui montre le site acquis : un autre écran de
        // cette maison, encore à N sites, renverrait sinon la même intention sous une clé neuve.
        true,
      );
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

  /** Un site tel que le tableau de bord le montre : avancement du cycle en cours, ce qui est prêt. */
  const twoDigits = new Intl.NumberFormat(i18n.language, { minimumIntegerDigits: 2 });
  const productionOf = (site: Site): ProductionItem => {
    const recipe = rules?.recipe(site.recipe_id);
    const { halted, harvest, estimate, alerts } = stateOf(site);
    const cycle =
      recipe && now && cycleProgress(recipe, new Date(site.cycle_started_at), now, halted);
    const left = cycle?.minutesLeft ?? 0;
    const text = halted
      ? t('production.halted')
      : cycle?.full
        ? t('production.full')
        : t('production.left', {
            hours: number.format(Math.floor(left / 60)),
            minutes: twoDigits.format(left % 60),
            context: left < 60 ? 'minutes' : 'hours',
          });
    return {
      id: site.id,
      name: siteName(site),
      city: house.cityNames[site.city_id] ?? site.city_id,
      goodId: recipe?.outputs[0]?.goodId ?? null,
      progress: cycle
        ? { done: cycle.done, text, tone: halted ? 'danger' : cycle.full ? 'success' : 'primary' }
        : null,
      // Sans production, rien ; tant que l'heure, le stock ou les événements manquent, pas encore estimé.
      ready: alerts.includes('retired')
        ? null
        : harvest && estimate
          ? harvest.cycles > 0
            ? list(estimate.outputs.map(stackText))
            : null
          : undefined,
      retired: alerts.includes('retired'),
    };
  };

  /** « Tout récolter » : une commande par site récoltable ; le résultat dit ce qui a échoué, et où. */
  async function collectEverything() {
    if (running.current || harvestable.length === 0) return;
    running.current = true;
    setBusy(true);
    setNotice(null);
    const names = new Map(harvestable.map((site) => [site.id, siteName(site)]));
    // Sites dont la récolte faite a été touchée par un événement de rendement, par modèle (7.4, #417).
    const touched = new Map<WorldEventKind, string[]>();
    // Surplus des grâces consommées, site par site (7.1, #477).
    const blessed: string[] = [];
    try {
      const outcome = await collectAll(
        harvestable.map((site) => site.id),
        async (siteId) => {
          const result = await collectSite(siteId, house.accessToken);
          const site = harvestable.find((candidate) => candidate.id === siteId);
          const model = yieldModelOf(rules?.siteTypeOf(site?.recipe_id ?? '') ?? '');
          if (result.ok && site && model && collectedGaps(site, result.data).length > 0)
            touched.set(model, [...(touched.get(model) ?? []), siteName(site)]);
          const grace = result.ok && graceText(result.data, site ? siteName(site) : siteId);
          if (grace) blessed.push(grace);
          return result;
        },
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
      // Tout réduit à zéro : dit « à rien », comme pour une récolte seule.
      const nothing = outcome.collected.every((stack) => stack.quantity === 0);
      for (const [model, touchedSites] of touched)
        parts.push(
          t(nothing ? 'home.collectedAllGapZero' : `home.collectedAllGap.${model}`, {
            list: list(touchedSites),
          }),
        );
      parts.push(...blessed);
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
      <div key={kind} role={kind} className="empty:sr-only">
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

  const problem = (sites.failed || rulesFailed || eventRows.failed) && (
    <LoadProblem
      heading={title}
      onRetry={() =>
        Promise.all([sites.reload(), reloadRules(), reloadIdentities(), reloadEvents()])
      }
    />
  );
  if (variant === 'production')
    return (
      <ProductionList
        titleRef={title}
        items={sites.rows && rows.map(productionOf)}
        harvestable={harvestable.length}
        busy={busy}
        onCollect={(id) => {
          const site = rows.find((candidate) => candidate.id === id);
          if (site) void collect(site);
        }}
        onCollectAll={() => void collectEverything()}
        announce={announce}
        status={problem || (sites.rows === null && !sites.failed && <Loading />)}
        // Une acquisition sans réponse a ajouté un site : rappelé ici aussi, tant qu'on n'a pas vérifié la liste.
        warning={pending.warning.get() ? t('home.acquireUnanswered') : null}
      />
    );

  // Coût d'un jour de tous les sites qui tournent : ce que la prochaine clôture prélèvera (`null` : inconnu).
  const costs = rows
    .filter((site) => !site.halted_at && rules?.recipe(site.recipe_id))
    .map((site) =>
      rules && laborDays
        ? rules.restartCostOf(
            site.recipe_id,
            identities?.get(site.city_id)?.slug ?? null,
            laborDays.get(site.city_id),
            unhousedOf?.get(site.id),
          )
        : null,
    );
  const known = sites.rows !== null && costs.every((cost) => cost !== null);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {figures}
        <StatCard
          dense
          label={t('home.sites')}
          icon={<Wheat />}
          value={
            rules && sites.rows
              ? t('home.sitesCount', {
                  count: number.format(sites.rows.length),
                  limit: number.format(rules.limit),
                })
              : '—'
          }
        />
        <StatCard
          dense
          label={t('sites.ready')}
          icon={<Package />}
          // Tant que l'heure du serveur ou le stock ne sont pas lus, rien n'est compté prêt : « — », pas zéro.
          value={sites.rows && now && stock ? number.format(harvestable.length) : '—'}
          hint={
            sites.rows && now && stock
              ? t('sites.readyHint', { count: harvestable.length })
              : undefined
          }
        />
        <StatCard
          dense
          label={t('sites.daily')}
          icon={<Coins />}
          value={known ? money(costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0)) : '—'}
          hint={t('sites.dailyHint')}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {harvestable.length > 0 && (
          <Button
            className={WAITING}
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
        {/* Proposée une fois les sites lus : leur nombre fait partie de l'intention (rejeu ou nouvel achat). */}
        {rules && sites.rows && (
          <div className="ml-auto">
            {full ? (
              <p className="text-sm text-muted-foreground">{t('home.limitReached')}</p>
            ) : (
              <SiteAcquire
                offers={offers}
                upkeepOf={rules.upkeepOf}
                balance={balance}
                count={sites.rows.length}
                limit={rules.limit}
                busy={busy}
                warning={notice?.unanswered ? notice.text : null}
                onConfirm={(offer) => void acquire(offer)}
              />
            )}
          </div>
        )}
      </div>
      {announce(ALL)}
      {rules && sites.rows && (
        <div role="group" aria-label={t('home.acquire')} className="flex flex-col gap-2">
          {announce(ACQUIRE)}
          {notice?.unanswered && (
            <Button
              variant="secondary"
              className="self-start"
              onClick={() => {
                pending.warning.set(false);
                setNotice(null);
                title.current?.focus();
              }}
            >
              {t('home.acquireChecked')}
            </Button>
          )}
        </div>
      )}
      {problem}
      {/* Titre de la liste, pour le plan de la page : les fiches et l'état vide sont des titres de niveau 3. */}
      {sites.rows && <h2 className="sr-only">{t('home.sitesList')}</h2>}
      {sites.rows === null && !sites.failed && <Loading />}
      {sites.rows?.length === 0 && (
        <EmptyState
          illustration={<EmptyIllustration kind="noSite" />}
          title={t('home.sitesEmpty')}
          headingLevel={3}
        />
      )}
      {watched.length > 0 && (
        <section
          aria-labelledby="sites-watch"
          className="flex flex-col gap-1 rounded-lg border border-danger/40 bg-danger-subtle/40 p-3"
        >
          <h3 id="sites-watch" className="flex items-center gap-2 font-semibold">
            <TriangleAlert aria-hidden="true" className="size-4 text-danger" />
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
          const alternatives = (rules?.alternatives(site.recipe_id) ?? []).filter(
            admits(site.city_id),
          );
          // Un choix fait avant la lecture du terroir, et que le filtre a retiré depuis, n'est pas envoyé.
          const picked = chosen[site.id];
          const choice =
            picked !== undefined && alternatives.some((recipe) => recipe.id === picked)
              ? picked
              : site.recipe_id;
          const recipe = rules?.recipe(site.recipe_id);
          const { halted, harvest, estimate, current, alerts } = stateOf(site);
          // Récolte estimée touchée par un événement de rendement : à rien, ou de combien (7.4, #417).
          const why =
            estimate && harvest && harvest.cycles > 0
              ? gapText(site, estimate.outputs, estimate.gaps, 'eventGap')
              : null;
          // Sans recette, ni récolte ni relance : seul le changement de production est proposé.
          const retired = alerts.includes('retired');
          // `null` tant que les règles ne sont pas lues : aucun prix n'est annoncé à leur place.
          const upkeep = rules ? rules.upkeepOf(site.recipe_id) : null;
          // Prix d'une relance : l'entretien, les salaires et l'hébergement du site (5.5, #258), au salaire du
          // jour de sa cité s'il est lu. Sans l'identité de la cité ni son marché du travail, aucun salaire
          // n'est compté ; l'API refuse alors un prix faux plutôt que d'en prélever un autre.
          const slug = identities?.get(site.city_id)?.slug ?? null;
          const day = laborDays?.get(site.city_id);
          const staff = staffOf.get(site.id);
          const restartCost =
            rules && laborDays
              ? rules.restartCostOf(site.recipe_id, slug, day, unhousedOf?.get(site.id))
              : null;
          return (
            <li
              key={site.id}
              id={`site-${site.id}`}
              className="flex scroll-mt-4 flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-subtle text-primary"
                >
                  {recipe?.outputs[0] && <GoodIcon goodId={recipe.outputs[0].goodId} />}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 tabIndex={-1} className="text-lg font-semibold">
                    {name}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {[
                      type && t('home.siteType', { type: typeName(type) }),
                      house.cityNames[site.city_id] ?? site.city_id,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
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
              {retired && (
                <p className="rounded-md bg-danger-subtle px-3 py-2 font-semibold text-danger">
                  {t('home.retired')}
                </p>
              )}
              {/* Production gardée d'avant un resserrement du terroir : elle tourne, mais on n'y revient pas. */}
              {recipe && !admits(site.city_id)(recipe) && (
                <p className="text-muted-foreground">{t('home.outOfTerroir')}</p>
              )}
              {halted && !retired && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 flex-1 rounded-md bg-danger-subtle px-3 py-2 font-semibold text-danger">
                    {t('home.halted', { date: date.format(halted) })}
                  </p>
                  {/* Sans les règles, le prix est inconnu : pas de bouton qui annoncerait « 0 obole ». */}
                  {restartCost !== null && (
                    <SiteRestart
                      siteName={name}
                      cost={restartCost}
                      upkeep={upkeep ?? 0}
                      busy={busy}
                      onConfirm={() => void restart(site, restartCost)}
                    />
                  )}
                </div>
              )}
              {current.map((event) => (
                <p key={event.id} className="text-sm font-semibold">
                  {describeWorldEvent(event, t, i18n.language, house.cityNames)}
                </p>
              ))}
              {harvest && estimate && (
                <p className="rounded-md bg-muted/60 px-3 py-2 text-sm">
                  {harvest.cycles > 0
                    ? t('home.harvestable', { list: list(estimate.outputs.map(stackText)) })
                    : t('home.harvestNone')}
                  {why && <> {why}</>}
                  {harvest.waiting > 0 && (
                    <> {t('home.harvestWaiting', { count: harvest.waiting })}</>
                  )}
                  {alerts.includes('full') && (
                    // Sans aucun cycle récoltable, récolter n'y changerait rien : il faut des intrants.
                    <> {t(harvest.cycles > 0 ? 'home.harvestFull' : 'home.harvestFullShort')}</>
                  )}
                </p>
              )}
              {alternatives.length > 0 && rules && (
                <div className="flex flex-wrap gap-2">
                  <SiteProduction
                    siteName={name}
                    current={site.recipe_id}
                    recipe={recipe ?? null}
                    alternatives={alternatives}
                    choice={choice}
                    onChoice={(recipeId) => setChosen((all) => ({ ...all, [site.id]: recipeId }))}
                    upkeepOf={rules.upkeepOf}
                    busy={busy}
                    onConfirm={(recipeId) => void change(site, recipeId)}
                  />
                </div>
              )}
              {announce(site.id)}
              <div className="grid gap-x-6 gap-y-1 text-sm text-muted-foreground sm:grid-cols-2">
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
                {staff && staff.workers > 0 && (
                  <p>
                    {t('home.siteStaff', {
                      count: staff.workers,
                      workers: number.format(staff.workers),
                      housed: number.format(staff.housed),
                      unhoused: number.format(staff.unhoused),
                    })}
                  </p>
                )}
                {day && recipe && recipe.workers > 0 && (
                  <p>{t('home.wageOfDay', { cost: money(day.wageOboles) })}</p>
                )}
                {/* Le dû d'un jour est le prix d'une relance : entretien, salaires et hébergement. */}
                {!retired && restartCost !== null && restartCost > 0 && (
                  <p>{t('home.dailyCost', { cost: money(restartCost) })}</p>
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
              {rules && stewards && (
                <SiteSteward
                  siteId={site.id}
                  siteName={name}
                  recipe={recipe ?? null}
                  steward={stewards.get(site.id)}
                  activity={
                    activity
                      ? (activity.get(stewards.get(site.id)?.id ?? '') ?? NO_ACTIVITY)
                      : undefined
                  }
                  instruction={instructions?.get(stewards.get(site.id)?.id ?? '')}
                  orders={
                    stewardOrders
                      ? (stewardOrders.get(stewards.get(site.id)?.id ?? '') ?? [])
                      : undefined
                  }
                  rules={rules.stewards}
                  tickMinutes={rules.tickMinutes}
                  posted={stewards.size}
                  onChanged={() =>
                    Promise.all([
                      reloadStewards(),
                      reloadStewardRules(),
                      reloadInstructions(),
                      reloadStewardOrders(),
                    ])
                  }
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Écran Sites de l'onglet Maison : chiffres clés, chaque site et sa fiche, l'acquisition. */
export function SitesScreen() {
  const { t } = useTranslation();
  const money = useMoney();
  const title = useRef<HTMLHeadingElement>(null);
  const treasury = useRows<{ balance: number }>('my_treasury', 'balance', 'house_id');
  const stock = useRows<StockLine & { id: string }>(
    'my_inventories',
    'id, city_id, good_id, quantity, reserved',
    'good_id',
  );
  const balance = treasury.rows?.[0]?.balance;
  return (
    <div className="flex flex-col gap-4 [overflow-wrap:anywhere]">
      <ScreenHeader title={t('home.sites')} titleRef={title} />
      <HouseNav />
      {(treasury.failed || stock.failed) && (
        <LoadProblem onRetry={() => Promise.all([treasury.reload(), stock.reload()])} />
      )}
      <SitesCard
        stock={stock.rows}
        onChanged={() => Promise.all([treasury.reload(), stock.reload()])}
        titleRef={title}
        balance={balance}
        figures={
          <StatCard
            dense
            label={t('home.treasury')}
            icon={<Coins />}
            value={balance === undefined ? '—' : money(balance)}
          />
        }
      />
    </div>
  );
}
