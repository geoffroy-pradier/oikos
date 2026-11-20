import { Archipelago, GoodIcon, IconButton, LocateFixed, Minus, Plus } from '@oikos/ui';
import { useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  along,
  CITY_LABEL,
  cityDot,
  cityLabels,
  MAP_HEIGHT,
  MAP_WIDTH,
  placeBoxes,
  placeLabels,
  scaleBar,
  type Box,
  type Point,
} from '../map-layout';
import { useMapView } from '../map-view';

export interface MapRoute {
  from: string;
  to: string;
  hours: number;
  /** Un navire de la maison y est en mer : la route est mise en avant. */
  ours: boolean;
}
export interface MapCity {
  id: string;
  name: string;
  at: Point;
  home: boolean;
  /** Navires de la maison à quai. */
  docked: number;
  /** Cité du panneau, cerclée. */
  selected: boolean;
  /** Biens de son terroir (calque Terroirs). */
  goods: readonly string[];
}
export interface MapShip {
  id: string;
  name: string;
  from: Point;
  to: Point;
  /** Part du trajet faite, de 0 à 1. */
  progress: number;
}

/** Largeur affichée de la carte, en pixels CSS : les noms y gardent leur taille quel que soit le zoom. */
function useWidth(frame: RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(760);
  useEffect(() => {
    const element = frame.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth > 0) setWidth(element.clientWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [frame]);
  return width;
}

/**
 * Le dessin de l'archipel (#696) : côtes et îles dessinées à la main, routes en pointillés (celles où la
 * maison a un navire en mer, en accent), cités et navires. Image décrite : la liste de l'écran en porte
 * les informations, au clavier.
 */
export function ArchipelagoMap(props: {
  label: string;
  routes: readonly MapRoute[];
  cities: readonly MapCity[];
  ships: readonly MapShip[];
  pointOf: (cityId: string) => Point | undefined;
  /** Cité de la maison : le recentrage y mène. */
  home: Point | undefined;
  /** Calque : les routes et les navires, ou le terroir de chaque cité. */
  layer: 'routes' | 'terroirs';
  /** Un clic sur une cité la choisit pour le panneau (au clavier : la liste du panneau). */
  onSelect: (cityId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const map = useMapView(props.home);
  const { box } = map;
  const width = useWidth(map.frame);
  const unit = box.width / width;
  const number = new Intl.NumberFormat(i18n.language);
  const hours = (count: number) => t('map.hours', { count, number: number.format(count) });
  const px = (size: number) => size * unit;
  // Texte cerné de la couleur de la mer : lisible sur la terre, la mer et les routes.
  const halo = { paintOrder: 'stroke', strokeLinejoin: 'round' } as const;
  const legs = props.routes.flatMap((route) => {
    const [a, b] = [props.pointOf(route.from), props.pointOf(route.to)];
    return a && b ? [{ ...route, a, b }] : [];
  });
  const scale = scaleBar(legs.map(({ a, b, hours: h }) => ({ a, b, hours: h })));
  // Dessin petit à l'écran (téléphone, sans zoom) : ni durées ni navires à quai, que la liste dit.
  const dense = unit > 0.2;
  const routesShown = props.layer === 'routes';
  const ring = (at: Point, r: number) =>
    `M${at.x - px(r)} ${at.y}a${px(r)} ${px(r)} 0 1 0 ${px(2 * r)} 0a${px(r)} ${px(r)} 0 1 0 ${-px(2 * r)} 0Z`;
  // Boutons de zoom, en haut à droite de la vue : un nom de cité ne s'y cache pas tant que la carte n'est pas
  // zoomée. Sous chaque cité, ses navires à quai ou les biens de son terroir : sur un dessin petit, ceux de la
  // seule cité choisie (le panneau les dit tous) ; au bas du dessin, au-dessus d'elle.
  const controls = { x: box.x + box.width - px(56), y: box.y, width: px(56), height: px(148) };
  const terroir = (city: MapCity) => {
    if (routesShown || city.goods.length === 0 || (dense && !city.selected)) return null;
    const height = px(24 * Math.ceil(city.goods.length / 4));
    const under = city.at.y + px(10) + height <= MAP_HEIGHT;
    const y = under ? city.at.y + px(10) : city.at.y - px(10) - height;
    return { x: city.at.x - px(48), y, width: px(96), height };
  };
  const below = props.cities.flatMap((city): Box[] => {
    const { at, docked } = city;
    const goods = terroir(city);
    if (goods) return [goods];
    return routesShown && docked > 0 && !dense
      ? [{ x: at.x - px(40), y: at.y + px(10), width: px(80), height: px(14) }]
      : [];
  });
  const names = cityLabels(props.cities, unit, [...(map.zoomed ? [] : [controls]), ...below]).map(
    (box, index) => {
      const at = props.cities[index]?.at ?? { x: 0, y: 0 };
      // Nom à droite du point : aligné à gauche ; à gauche : aligné à droite ; dessus ou dessous : centré.
      const [start, end] = [box.x >= at.x, box.x + box.width <= at.x];
      const x = start ? box.x : end ? box.x + box.width : box.x + box.width / 2;
      const anchor = start ? 'start' : end ? 'end' : 'middle';
      return { box, x, y: box.y + px(CITY_LABEL.baseline), anchor } as const;
    },
  );
  const dots = props.cities.map(({ at }) => cityDot(at, unit));
  // Durée de chaque route au-dessus de son milieu, sinon au-dessous ; sans place, la liste la dit.
  const durations = placeBoxes(
    legs.map(({ a, b, hours: h }) => {
      const middle = along(a, b, 0.5);
      const [width, height] = [px(hours(h).length * 7 + 4), px(14)];
      return [
        { x: middle.x - width / 2, y: middle.y - px(4) - height, width, height },
        { x: middle.x - width / 2, y: middle.y + px(4), width, height },
      ];
    }),
    [...names.map(({ box }) => box), ...dots, ...below],
    { x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT },
  );
  const ships = (routesShown ? props.ships : []).map((ship) => ({
    ...ship,
    at: along(ship.from, ship.to, ship.progress),
    width: px(ship.name.length * 7 + 16),
    height: px(20),
  }));
  // Les étiquettes des navires évitent les noms des cités, les unes les autres et le bord du dessin.
  const labels = placeLabels(
    ships,
    [
      ...names.map(({ box }) => box),
      ...dots,
      ...(dense ? [] : durations.flatMap((duration) => (duration ? [duration] : []))),
      ...ships.map(({ at }) => ({
        x: at.x - px(13),
        y: at.y - px(13),
        width: px(26),
        height: px(26),
      })),
      // Les boutons de zoom, en haut à droite ; la légende, en haut à gauche.
      controls,
      ...(width >= 512 ? [{ x: box.x, y: box.y, width: px(250), height: px(50) }] : []),
    ],
    box,
    px(13),
  );

  return (
    // Arrêt de tabulation de la carte : flèches, + et −, 0 ; glisser, pincer, molette.
    <div
      ref={map.frame}
      role="group"
      tabIndex={0}
      aria-label={t('map.pan')}
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight + - 0"
      className={`@container relative cursor-grab rounded-[inherit] outline-offset-[-3px] active:cursor-grabbing ${map.zoomed ? 'touch-none' : 'touch-pan-y'}`}
      {...map.handlers}
    >
      <svg
        viewBox={[box.x, box.y, box.width, box.height]
          .map((n) => Math.round(n * 1000) / 1000)
          .join(' ')}
        role="img"
        aria-label={props.label}
        className="block h-auto w-full select-none"
      >
        <Archipelago width={MAP_WIDTH} height={MAP_HEIGHT} />
        {(routesShown ? legs : []).map(({ from, to, a, b, ours, hours: duration }, index) => {
          const place = durations[index];
          return (
            <g key={`${from}-${to}`}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className={ours ? 'stroke-primary' : 'stroke-route'}
                strokeWidth={px(ours ? 2.5 : 2)}
                strokeLinecap="round"
                strokeDasharray={`${px(2)} ${px(7)}`}
              />
              <text
                visibility={dense || !place ? 'hidden' : undefined}
                x={place ? place.x + place.width / 2 : a.x}
                y={place ? place.y + px(11) : a.y}
                textAnchor="middle"
                fontSize={px(11)}
                className="fill-muted-foreground stroke-sea font-medium"
                strokeWidth={px(3)}
                style={halo}
              >
                {hours(duration)}
              </text>
            </g>
          );
        })}
        {props.cities.map((city, index) => (
          <g key={city.id} className="cursor-pointer" onClick={() => props.onSelect(city.id)}>
            {city.home && <path className="fill-primary" opacity={0.25} d={ring(city.at, 12)} />}
            {city.selected && (
              <path
                className="stroke-foreground"
                fill="none"
                strokeWidth={px(1.5)}
                d={ring(city.at, 16)}
              />
            )}
            <circle
              cx={city.at.x}
              cy={city.at.y}
              r={px(5.5)}
              className={`${city.home ? 'fill-primary' : 'fill-foreground'} stroke-sea`}
              strokeWidth={px(2.5)}
            />
            <text
              x={names[index]?.x}
              y={names[index]?.y}
              textAnchor={names[index]?.anchor}
              fontSize={px(CITY_LABEL.font)}
              className="fill-foreground stroke-sea font-bold"
              strokeWidth={px(3.5)}
              style={halo}
            >
              {city.name}
            </text>
            {terroir(city) &&
              city.goods.map((good, i) => {
                // Quatre biens par rangée, centrées sous la cité (au-dessus d'elle, au bas du dessin).
                const row = Math.min(4, city.goods.length - Math.floor(i / 4) * 4);
                const x = city.at.x + px(24 * (i % 4) - 12 * row);
                const y = (terroir(city)?.y ?? 0) + px(24 * Math.floor(i / 4));
                return (
                  <g key={good} className="text-foreground" transform={`translate(${x} ${y})`}>
                    <rect width={px(22)} height={px(22)} rx={px(6)} className="fill-surface" />
                    <g transform={`translate(${px(2)} ${px(2)}) scale(${px(18) / 24})`}>
                      <GoodIcon goodId={good} />
                    </g>
                  </g>
                );
              })}
            {routesShown && city.docked > 0 && !dense && (
              <text
                x={city.at.x}
                y={city.at.y + px(20)}
                textAnchor="middle"
                fontSize={px(11)}
                className="fill-muted-foreground stroke-sea font-medium"
                strokeWidth={px(3)}
                style={halo}
              >
                {t('map.dockedCount', { count: city.docked, number: number.format(city.docked) })}
              </text>
            )}
          </g>
        ))}
        {ships.map((ship, index) => {
          const [dx, dy] = [ship.to.x - ship.from.x, ship.to.y - ship.from.y];
          // La proue suit la route ; vers l'ouest, le navire est retourné plutôt que mis tête en bas.
          const tilt = Math.max(-25, Math.min(25, (Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI));
          const label = labels[index];
          return (
            <g key={ship.id}>
              <g transform={`translate(${ship.at.x} ${ship.at.y})`}>
                <circle
                  r={px(11)}
                  className="fill-surface stroke-foreground"
                  strokeWidth={px(1.5)}
                />
                <path
                  transform={`scale(${(dx < 0 ? -1 : 1) * px(1)} ${px(1)}) rotate(${tilt})`}
                  className="fill-foreground"
                  d="M-8 3H8L5 7H-5ZM0.5 1.5V-9.5L7.5 1.5ZM-1 1.5V-7L-6 1.5Z"
                />
              </g>
              {label && (
                <g transform={`translate(${label.x} ${label.y})`}>
                  <rect
                    width={label.width}
                    height={label.height}
                    rx={label.height / 2}
                    className="fill-surface stroke-border-subtle"
                    strokeWidth={px(1)}
                  />
                  <text
                    x={px(8)}
                    y={px(14)}
                    fontSize={px(12)}
                    className="fill-foreground font-semibold"
                  >
                    {ship.name}
                  </text>
                </g>
              )}
            </g>
          );
        })}
        {scale && routesShown && (
          <g className="stroke-muted-foreground" strokeWidth={px(2)} strokeLinecap="round">
            <path
              fill="none"
              d={`M${88 - scale.length} 66.5H88M${88 - scale.length} ${66.5 - px(4)}v${px(8)}M88 ${66.5 - px(4)}v${px(8)}`}
            />
            <text
              x={88}
              y={66.5 - px(8)}
              textAnchor="end"
              fontSize={px(11)}
              strokeWidth={px(3)}
              className="fill-muted-foreground stroke-sea font-medium"
              style={halo}
            >
              {t('map.scale', { duration: hours(scale.hours) })}
            </text>
          </g>
        )}
      </svg>
      {!routesShown && dense && (
        <p className="m-2 text-xs text-foreground-secondary">{t('map.terroirHint')}</p>
      )}
      <ul
        hidden={!routesShown}
        aria-label={t('map.legend')}
        className="m-2 flex w-fit flex-wrap @lg:absolute @lg:top-3 @lg:left-3 @lg:m-0 gap-x-3 gap-y-1 rounded-lg border border-border-subtle bg-surface/90 px-2.5 py-1.5 text-xs text-foreground-secondary"
      >
        {(['ourRoutes', 'otherRoutes'] as const).map((key) => (
          <li key={key} className="flex items-center gap-1.5">
            <svg aria-hidden="true" width="22" height="4" className="shrink-0">
              <path
                d="M2 2H20"
                className={key === 'ourRoutes' ? 'stroke-primary' : 'stroke-route'}
                strokeWidth={key === 'ourRoutes' ? 2.5 : 2}
                strokeLinecap="round"
                strokeDasharray="2 5"
              />
            </svg>
            {t(`map.${key}`)}
          </li>
        ))}
      </ul>
      <div className="absolute top-2 right-2 flex flex-col gap-1 @lg:top-3 @lg:right-3 @lg:gap-1.5">
        <IconButton
          variant="secondary"
          icon={<Plus />}
          label={t('map.zoomIn')}
          onClick={map.zoomIn}
        />
        <IconButton
          variant="secondary"
          icon={<Minus />}
          label={t('map.zoomOut')}
          onClick={map.zoomOut}
        />
        <IconButton
          variant="secondary"
          icon={<LocateFixed />}
          label={t('map.recenter')}
          onClick={map.recenter}
        />
      </div>
    </div>
  );
}
