import { Archipelago } from '@oikos/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { along, MAP_HEIGHT, MAP_WIDTH, placeLabels, scaleBar, type Point } from '../map-layout';

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
}
export interface MapShip {
  id: string;
  name: string;
  from: Point;
  to: Point;
  /** Part du trajet faite, de 0 à 1. */
  progress: number;
}

/** Unités du dessin par pixel CSS, d'après la largeur affichée : les noms gardent leur taille à l'écran. */
function useUnitsPerPixel() {
  const frame = useRef<HTMLDivElement>(null);
  const [unit, setUnit] = useState(MAP_WIDTH / 760);
  useEffect(() => {
    const element = frame.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth > 0) setUnit(MAP_WIDTH / element.clientWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { frame, unit };
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
}) {
  const { t, i18n } = useTranslation();
  const { frame, unit } = useUnitsPerPixel();
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
  const ships = props.ships.map((ship) => ({
    ...ship,
    at: along(ship.from, ship.to, ship.progress),
    width: px(ship.name.length * 7 + 16),
    height: px(20),
  }));
  // Les étiquettes des navires évitent les noms des cités, les unes les autres et le bord du dessin.
  const labels = placeLabels(
    ships,
    props.cities.map(({ at, name }) => ({
      x: at.x - px(name.length * 4.5),
      y: at.y - px(28),
      width: px(name.length * 9),
      height: px(36),
    })),
    { x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT },
    px(13),
  );

  return (
    <div ref={frame} className="relative w-full">
      <svg
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        role="img"
        aria-label={props.label}
        className="block h-auto w-full select-none"
      >
        <Archipelago width={MAP_WIDTH} height={MAP_HEIGHT} />
        {legs.map(({ from, to, a, b, ours, hours: duration }) => {
          const middle = along(a, b, 0.5);
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
                visibility={dense ? 'hidden' : undefined}
                x={middle.x}
                y={middle.y - px(6)}
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
        {props.cities.map((city) => (
          <g key={city.id}>
            {city.home && (
              <path
                className="fill-primary"
                opacity={0.25}
                d={`M${city.at.x - px(12)} ${city.at.y}a${px(12)} ${px(12)} 0 1 0 ${px(24)} 0a${px(12)} ${px(12)} 0 1 0 ${-px(24)} 0Z`}
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
              x={city.at.x}
              y={city.at.y - px(12)}
              textAnchor="middle"
              fontSize={px(14)}
              className="fill-foreground stroke-sea font-bold"
              strokeWidth={px(3.5)}
              style={halo}
            >
              {city.name}
            </text>
            {city.docked > 0 && !dense && (
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
        {scale && (
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
    </div>
  );
}
