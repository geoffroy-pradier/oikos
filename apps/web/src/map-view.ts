import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MAP_HEIGHT, MAP_WIDTH, type Box, type Point } from './map-layout';

/** Vue de la carte : son centre dans le repère du dessin et son zoom (1 : tout le dessin). */
export interface MapView {
  x: number;
  y: number;
  zoom: number;
}
export const MAX_ZOOM = 4;
/** Zoom d'un bouton ou d'une touche, et zoom du recentrage sur la cité de la maison. */
export const ZOOM_STEP = 1.5;
export const RECENTER_ZOOM = 2;
/** Déplacement du pointeur, en pixels, au-delà duquel un appui devient un glisser. */
export const DRAG_PX = 4;
export const FULL_VIEW: MapView = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2, zoom: 1 };

/** Bornée au dessin : zoom de 1 à `MAX_ZOOM`, centre tel que la vue ne sorte jamais du dessin. */
export function clampView({ x, y, zoom }: MapView): MapView {
  const z = Math.min(MAX_ZOOM, Math.max(1, Number.isFinite(zoom) ? zoom : 1));
  const [halfW, halfH] = [MAP_WIDTH / z / 2, MAP_HEIGHT / z / 2];
  const clamp = (value: number, low: number, high: number) =>
    Math.min(high, Math.max(low, Number.isFinite(value) ? value : (low + high) / 2));
  return { x: clamp(x, halfW, MAP_WIDTH - halfW), y: clamp(y, halfH, MAP_HEIGHT - halfH), zoom: z };
}

/** Rectangle du dessin que la vue montre (le `viewBox` du SVG). */
export function viewBox(view: MapView): Box {
  const { x, y, zoom } = clampView(view);
  const [width, height] = [MAP_WIDTH / zoom, MAP_HEIGHT / zoom];
  return { x: x - width / 2, y: y - height / 2, width, height };
}

/** Zoom de `factor` autour de `anchor`, qui reste au même endroit de l'écran (molette, pincement). */
export function zoomAt(view: MapView, factor: number, anchor: Point = view): MapView {
  const zoom = clampView({ ...view, zoom: view.zoom * factor }).zoom;
  const keep = (from: number, to: number) => to + ((from - to) * view.zoom) / zoom;
  return clampView({ x: keep(view.x, anchor.x), y: keep(view.y, anchor.y), zoom });
}

const KEY_PAN = 0.15;
/** Vue après une touche : flèches (déplacement d'un peu plus d'un dixième de la vue), + et −, 0. */
export function viewAfterKey(view: MapView, key: string, home: Point | undefined) {
  const box = viewBox(view);
  const pan = (dx: number, dy: number) =>
    clampView({ ...view, x: view.x + dx * box.width, y: view.y + dy * box.height });
  const moves: Record<string, () => MapView> = {
    ArrowLeft: () => pan(-KEY_PAN, 0),
    ArrowRight: () => pan(KEY_PAN, 0),
    ArrowUp: () => pan(0, -KEY_PAN),
    ArrowDown: () => pan(0, KEY_PAN),
    '+': () => zoomAt(view, ZOOM_STEP),
    '-': () => zoomAt(view, 1 / ZOOM_STEP),
    '0': () => recenter(view, home),
  };
  return moves[key]?.();
}

/** Recentrée sur la cité de la maison, zoomée au moins à `RECENTER_ZOOM` ; sans elle, tout le dessin. */
export const recenter = (view: MapView, home: Point | undefined) =>
  home ? clampView({ ...home, zoom: Math.max(view.zoom, RECENTER_ZOOM) }) : FULL_VIEW;

// Sans `matchMedia` (tests), aucune animation.
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;

/**
 * Déplacement et zoom de la carte : glisser à la souris ou au doigt, pincer, molette, clavier (flèches, +,
 * −, 0) et boutons, bornés au dessin. Un bouton ou une touche glisse vers la vue visée en 200 ms, sauf
 * sous `prefers-reduced-motion` ; le doigt et la molette suivent sans délai.
 */
export function useMapView(home: Point | undefined) {
  const [view, setView] = useState(FULL_VIEW);
  const frame = useRef<HTMLDivElement>(null);
  const current = useRef(view);
  current.current = view;
  const animation = useRef(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragged = useRef(false);

  const go = useCallback((target: MapView) => {
    cancelAnimationFrame(animation.current);
    if (reducedMotion()) return setView(target);
    const [from, start] = [current.current, performance.now()];
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 200);
      const ease = 1 - (1 - t) ** 3;
      const mix = (k: keyof MapView) => from[k] + (target[k] - from[k]) * ease;
      setView({ x: mix('x'), y: mix('y'), zoom: mix('zoom') });
      if (t < 1) animation.current = requestAnimationFrame(step);
    };
    animation.current = requestAnimationFrame(step);
  }, []);
  useEffect(() => () => cancelAnimationFrame(animation.current), []);

  // Point du dessin sous un point de l'écran ; unités du dessin par pixel.
  const geometry = useCallback(() => {
    const rect = frame.current?.getBoundingClientRect();
    const box = viewBox(current.current);
    const unit = rect && rect.width > 0 ? box.width / rect.width : 0;
    const toMap = (clientX: number, clientY: number): Point =>
      rect && unit > 0
        ? { x: box.x + (clientX - rect.left) * unit, y: box.y + (clientY - rect.top) * unit }
        : current.current;
    return { unit, toMap };
  }, []);

  // Molette : écouteur non passif, pour que la page ne défile pas pendant le zoom.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const anchor = geometry().toMap(event.clientX, event.clientY);
      setView((before) => zoomAt(before, Math.exp(-event.deltaY * 0.002), anchor));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [geometry]);

  // Un appui ne devient un glisser qu'au-delà de `DRAG_PX` : en deçà, le clic va à sa cible (une cité).
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('button')) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) dragged.current = false;
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const before = pointers.current.get(event.pointerId);
    if (!before) return;
    const others = [...pointers.current].filter(([id]) => id !== event.pointerId);
    const next = { x: event.clientX, y: event.clientY };
    const other = others[0]?.[1];
    if (!dragged.current && !other && Math.hypot(next.x - before.x, next.y - before.y) < DRAG_PX)
      return;
    // Glisser ou pincer : le pointeur est capturé, le clic qui suivra ne choisira rien.
    if (!dragged.current) event.currentTarget.setPointerCapture?.(event.pointerId);
    dragged.current = true;
    pointers.current.set(event.pointerId, next);
    const { unit, toMap } = geometry();
    // Glisser : le dessin suit le doigt ou la souris.
    const [dx, dy] = [(next.x - before.x) * unit, (next.y - before.y) * unit];
    if (!other) return setView((view) => clampView({ ...view, x: view.x - dx, y: view.y - dy }));
    // Pincer : l'écart des deux doigts donne le zoom, autour de leur milieu.
    const spread = (a: { x: number; y: number }) => Math.hypot(a.x - other.x, a.y - other.y);
    if (spread(before) === 0) return;
    const anchor = toMap((next.x + other.x) / 2, (next.y + other.y) / 2);
    setView((view) => zoomAt(view, spread(next) / spread(before), anchor));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
  };
  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!dragged.current) return;
    event.stopPropagation();
    dragged.current = false;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey)
      return;
    const target = viewAfterKey(current.current, event.key, home);
    if (!target) return;
    event.preventDefault();
    go(target);
  };

  const handlers = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
  // À zoom 1, le doigt fait défiler la page verticalement ; zoomée, la carte prend tous les gestes.
  return {
    box: viewBox(view),
    frame,
    zoomIn: () => go(zoomAt(current.current, ZOOM_STEP)),
    zoomOut: () => go(zoomAt(current.current, 1 / ZOOM_STEP)),
    recenter: () => go(recenter(current.current, home)),
    zoomed: view.zoom > 1,
    handlers: { ...handlers, onClickCapture, onKeyDown },
  };
}
