import {
  Amphora,
  Anchor,
  Card,
  ChevronRight,
  CityVignette,
  Coins,
  EmptyState,
  Gavel,
  GodEmblem,
  Hammer,
  House,
  Landmark,
  Leaf,
  PartyPopper,
  PillTabs,
  ScrollText,
  Sparkles,
  TriangleAlert,
  Users,
  Vote,
  Waves,
  Wheat,
} from '@oikos/ui';
import { Link } from '@tanstack/react-router';
import { useRef, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { describeCity, parseCityIdentities } from '../city-identity';
import { useRows } from '../data';
import { useHouse } from '../house';
import { employmentShare, parseCityLabor } from '../labor';
import { useMoney } from '../money';
import { parkBySize } from '../property';
import { coverageShare, parseCityPopulation } from '../population';
import { ScreenHeader } from '../ScreenHeader';
import { CityAssembly } from './CityAssembly';
import { CityLiturgies } from './CityLiturgies';
import { CityChronicle } from './CityChronicle';
import { CityEvents } from './CityEvents';
import { CityPolitics } from './CityPolitics';
import { CityTreasury } from './CityTreasury';
import { LoadProblem, Loading } from './LoadProblem';

/** Ligne d'une liste de chiffres : une icône décorative, le texte qui porte l'information. */
const ROW = 'flex items-start gap-3 py-2.5 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0';

/** Titre d'une carte de l'écran : focalisable, le foyer y revient après une relecture réussie. */
export function CardTitle(props: {
  icon: ReactNode;
  title?: RefObject<HTMLHeadingElement | null>;
  children: ReactNode;
}) {
  return (
    <h2
      ref={props.title}
      tabIndex={-1}
      className="flex items-center gap-2 text-lg font-semibold [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-accent"
    >
      <span aria-hidden="true">{props.icon}</span>
      {props.children}
    </h2>
  );
}

/** Jauge décorative : le texte voisin dit déjà le chiffre. */
export function Meter({ share }: { share: number }) {
  return (
    <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full bg-muted">
      <span
        className="block h-full rounded-full bg-primary"
        style={{ width: `${Math.round(Math.min(Math.max(share, 0), 1) * 100)}%` }}
      />
    </span>
  );
}

/**
 * Onglet Cité : sous l'en-tête, les pastilles (vie politique, assemblée, liturgies (6.4), trésor, événements (7.4) et chronique
 * (6.6)) et leur panneau, comme sur Maison (#862) ; puis l'identité de la cité de la maison (6.1, vue
 * `city_identity`), sa population classe par classe et la couverture de ses besoins vitaux (5.2, vue
 * `city_population`), son marché du travail (4.4) et son parc de logements (4.5). Les panneaux restent montés :
 * une commande en vol ou une saisie survit au changement.
 */
export function CityScreen() {
  const { t, i18n } = useTranslation();
  // Titre de la carte : le foyer y va après une relecture réussie.
  const title = useRef<HTMLHeadingElement>(null);
  const house = useHouse();
  const rows = useRows<unknown>(
    'city_population',
    'class_id, population, coverage_bps',
    'class_id',
    {
      city_id: house.cityId,
    },
  );
  const city = rows.rows === null ? null : parseCityPopulation(rows.rows);
  const identityTitle = useRef<HTMLHeadingElement>(null);
  const read = useRows<unknown>(
    'city_identity',
    'city_id, terroir, has_port, patron_god_id, starting_recipe_id',
    'city_id',
    { city_id: house.cityId },
  );
  const identities = read.rows === null ? null : parseCityIdentities(read.rows);
  const identity = identities?.get(house.cityId);
  const lines = identity ? describeCity(identity, t, i18n.language) : null;
  const number = new Intl.NumberFormat(i18n.language);
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 0,
  });
  const failed = rows.failed || (rows.rows !== null && city === null);
  // Marché du travail du jour de la cité (4.4) et son parc de logements (4.5).
  const money = useMoney();
  const laborTitle = useRef<HTMLHeadingElement>(null);
  const laborRows = useRows<unknown>(
    'labor_market',
    'city_id, game_day, supply, employed, unhoused, wage_oboles, lodging_oboles',
    'city_id',
    { city_id: house.cityId },
  );
  const laborMap = laborRows.rows === null ? undefined : parseCityLabor(laborRows.rows);
  const labor = laborMap?.get(house.cityId);
  const employment = labor ? employmentShare(labor) : null;
  const parkTitle = useRef<HTMLHeadingElement>(null);
  const parkRows = useRows<unknown>('city_properties', 'id, size_id, for_sale', 'size_id', {
    city_id: house.cityId,
  });
  const park = parkRows.rows === null ? undefined : parkBySize(parkRows.rows);
  const sizeName = (id: string) => t(`propertySizes.${id}`, { defaultValue: id });
  // Une classe ou un nom ajoutés par le back-office sans traduction s'affichent par leur identifiant.
  const className = (id: string) => t(`npcClasses.${id}`, { defaultValue: id });
  // Vignette de la cité, par son identifiant de configuration ; inconnu : le dessin neutre.
  const slug = house.citySlugs?.[house.cityId] ?? '';
  // Sous-sections en pastilles (ADR 0011), la vie politique d'abord.
  const sections = [
    ['politics', <Vote key="politics" />, <CityPolitics key="politics" />],
    ['assembly', <Gavel key="assembly" />, <CityAssembly key="assembly" />],
    ['liturgies', <PartyPopper key="liturgies" />, <CityLiturgies key="liturgies" />],
    ['treasury', <Coins key="treasury" />, <CityTreasury key="treasury" />],
    ['events', <Sparkles key="events" />, <CityEvents key="events" />],
    ['chronicle', <ScrollText key="chronicle" />, <CityChronicle key="chronicle" />],
  ] as const;

  return (
    <div className="flex flex-col gap-4 [overflow-wrap:anywhere]">
      <ScreenHeader
        title={t('city.title', { city: house.cityName })}
        action={
          // Nom accessible complet, qui commence par le libellé visible.
          <Link
            to="/cite/temple"
            aria-label={t('city.templeLink')}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-surface-raised px-4 font-medium shadow-sm transition-colors duration-(--motion-fast) hover:bg-muted [&_svg]:size-[1.15em]"
          >
            <Amphora aria-hidden="true" className="text-accent" />
            {t('city.temple')}
          </Link>
        }
      />
      {/* Pastilles sous l'en-tête, comme sur Maison (#862) ; les chiffres de la cité suivent le panneau. */}
      <PillTabs
        label={t('city.sections.label')}
        // Panneaux gardés montés : une commande en vol, sa clé ou une saisie survivent au changement.
        keepMounted
        items={sections.map(([id, icon, content]) => ({
          id,
          icon,
          label: t(`city.sections.${id}`),
          content,
        }))}
      />
      {/* Téléphone : la vignette à côté du titre, la liste dessous ; ordinateur : la vignette à gauche du tout. */}
      <Card className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 sm:flex sm:gap-4">
        <CityVignette
          cityId={slug}
          className="h-auto w-full shrink-0 rounded-xl bg-muted p-1 text-foreground sm:w-48 sm:p-1.5"
        />
        <div className="contents min-w-0 flex-1 flex-col gap-3 sm:flex max-sm:[&>*:not(h2)]:col-span-2">
          <CardTitle icon={<Landmark />} title={identityTitle}>
            {t('cityIdentity.title')}
          </CardTitle>
          {read.rows === null && !read.failed && <Loading />}
          {(read.failed || (read.rows !== null && identities === null)) && (
            <LoadProblem heading={identityTitle} onRetry={() => read.reload()} />
          )}
          {identities && !lines && (
            <p className="text-muted-foreground">{t('cityIdentity.missing')}</p>
          )}
          {identity && lines && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  // Sans dieu protecteur, l'emblème neutre.
                  [lines.god, <GodEmblem key="god" godId={identity.patronGodId ?? ''} size={24} />],
                  [lines.port, identity.hasPort ? <Anchor /> : <Waves />],
                  [lines.terroir, <Leaf key="terroir" />],
                  [lines.start, <Wheat key="start" />],
                ] as const
              ).map(([line, icon]) => (
                <li
                  key={line}
                  className="flex items-center gap-3 rounded-lg bg-muted/60 px-3 py-1.5 text-sm sm:py-2 [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-accent"
                >
                  <span aria-hidden="true">{icon}</span>
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      {/* Trois cartes de même hauteur sur ordinateur, quel que soit leur contenu (#869). */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col gap-3">
          <CardTitle icon={<Users />} title={title}>
            {t('city.population')}
          </CardTitle>
          {rows.rows === null && !rows.failed && <Loading />}
          {failed && <LoadProblem heading={title} onRetry={() => rows.reload()} />}
          {city && city.classes.length === 0 && (
            <EmptyState compact illustration="noEvent" title={t('city.empty')} />
          )}
          {city && city.classes.length > 0 && (
            <>
              <p className="text-xl font-bold tabular-nums">
                {t('city.total', { count: city.total, number: number.format(city.total) })}
              </p>
              {/* Le détail par classe se replie : l'onglet garde ses pastilles près du haut sur téléphone. */}
              <details className="group rounded-lg border border-border-subtle px-3">
                <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium hover:text-primary">
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground transition-transform duration-(--motion-fast) group-open:rotate-90"
                  />
                  {t('city.byClass')}
                </summary>
                <p className="pb-1 text-sm text-muted-foreground">{t('city.intro')}</p>
                <ul className="flex flex-col divide-y divide-border-subtle">
                  {city.classes.map((row) => {
                    const share = coverageShare(row);
                    return (
                      <li key={row.class_id} className="flex flex-col gap-1.5 py-2.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <h3 className="font-semibold">{className(row.class_id)}</h3>
                          <p className="text-sm tabular-nums">
                            {t('city.inhabitants', {
                              count: row.population,
                              number: number.format(row.population),
                            })}
                          </p>
                        </div>
                        {share !== null && <Meter share={share} />}
                        <p className="text-sm text-muted-foreground">
                          {share === null
                            ? t('city.coverageUnknown')
                            : t('city.coverage', { percent: percent.format(share) })}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </details>
            </>
          )}
        </Card>
        <Card className="flex flex-col gap-3">
          <CardTitle icon={<Hammer />} title={laborTitle}>
            {t('city.labor.title')}
          </CardTitle>
          {laborRows.rows === null && !laborRows.failed && <Loading />}
          {(laborRows.failed || laborMap === null) && (
            <LoadProblem heading={laborTitle} onRetry={() => laborRows.reload()} />
          )}
          {laborMap && !labor && <p className="text-muted-foreground">{t('city.labor.none')}</p>}
          {labor && (
            <ul className="flex flex-col divide-y divide-border-subtle text-sm [&_svg]:text-muted-foreground">
              <li className={ROW}>
                <Coins aria-hidden="true" />
                {t('city.labor.wage', { cost: money(labor.wageOboles) })}
              </li>
              <li className={ROW}>
                <Users aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span>
                    {employment === null
                      ? t(labor.supply === 0 ? 'city.labor.noWorkers' : 'city.labor.unlimited', {
                          count: labor.employed,
                          employed: number.format(labor.employed),
                        })
                      : t('city.labor.employment', {
                          count: labor.employed,
                          percent: percent.format(employment),
                          employed: number.format(labor.employed),
                          supply: number.format(labor.supply ?? 0),
                        })}
                  </span>
                  {employment !== null && <Meter share={employment} />}
                </span>
              </li>
              <li className={ROW}>
                <House aria-hidden="true" />
                {t('city.labor.lodging', { cost: money(labor.lodgingOboles) })}
              </li>
              <li className={ROW}>
                <TriangleAlert aria-hidden="true" />
                {t('city.labor.unhoused', { number: number.format(labor.unhoused) })}
              </li>
            </ul>
          )}
        </Card>
        <Card className="flex flex-col gap-3">
          <CardTitle icon={<House />} title={parkTitle}>
            {t('city.park.title')}
          </CardTitle>
          {parkRows.rows === null && !parkRows.failed && <Loading />}
          {(parkRows.failed || park === null) && (
            <LoadProblem heading={parkTitle} onRetry={() => parkRows.reload()} />
          )}
          {park?.length === 0 && (
            <EmptyState compact illustration="noProperty" title={t('city.park.empty')} />
          )}
          {park && park.length > 0 && (
            <ul className="flex flex-col divide-y divide-border-subtle text-sm">
              {park.map((size) => (
                <li key={size.sizeId} className="py-2.5">
                  {t('city.park.size', {
                    size: sizeName(size.sizeId),
                    total: number.format(size.total),
                    forSale: number.format(size.forSale),
                  })}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
