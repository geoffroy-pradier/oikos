import { WORLD_EVENT_CATALOGUE, type WorldEventKind } from '@oikos/sim';
import type { TFunction } from 'i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { useRows } from './data';
import { serverClock, syncServerClock } from './server-clock';

/** Un événement du monde commencé (vue `world_events`, 7.4) : seuls ceux-là sont lisibles par les joueurs. */
export interface WorldEvent {
  id: string;
  model: WorldEventKind;
  cityId: string;
  /** Seconde extrémité de la route d'une tempête ; nulle sinon. */
  otherCityId: string | null;
  /** Bien d'une caravane ; nul sinon. */
  goodId: string | null;
  startsAt: Date;
  endsAt: Date;
  magnitudeBps: number;
}

export const WORLD_EVENT_COLUMNS =
  'id, model, city_id, other_city_id, good_id, starts_at, ends_at, magnitude_bps';

const MODELS = Object.keys(WORLD_EVENT_CATALOGUE) as [WorldEventKind, ...WorldEventKind[]];
const instant = z
  .string()
  .transform((text) => new Date(text))
  .refine((date) => !Number.isNaN(date.getTime()));
const id = z.string().min(1);
const rowSchema = z
  .object({
    id,
    model: z.enum(MODELS),
    city_id: id,
    other_city_id: id.nullable(),
    good_id: id.nullable(),
    starts_at: instant,
    ends_at: instant,
    magnitude_bps: z.number().int().min(0).max(10_000),
  })
  .transform((row): WorldEvent => ({
    id: row.id,
    model: row.model,
    cityId: row.city_id,
    otherCityId: row.other_city_id,
    goodId: row.good_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    magnitudeBps: row.magnitude_bps,
  }));

/**
 * Événements lus. Une ligne illisible, ou d'un modèle que le client ne connaît pas encore (catalogue élargi
 * par une version plus récente), est ignorée : l'écran tait cet événement plutôt que d'en inventer l'effet.
 */
export const parseWorldEvents = (rows: readonly unknown[]): WorldEvent[] =>
  rows.flatMap((raw) => {
    const parsed = rowSchema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });

/** Événements en cours à l'instant donné : le début compris, la fin exclue, comme pour le serveur. */
export const inForce = (events: readonly WorldEvent[], at: Date) =>
  events.filter((event) => event.startsAt <= at && at < event.endsAt);

/** Événements lus de la vue `world_events` selon `filters` (`useRows`) ; `null` tant que rien n'est lu. */
export function useEventRows(filters: Parameters<typeof useRows>[3]) {
  const read = useRows<unknown>('world_events', WORLD_EVENT_COLUMNS, 'starts_at', filters);
  const events = useMemo(
    () => (read.rows === null ? null : parseWorldEvents(read.rows)),
    [read.rows],
  );
  return { events, failed: read.failed, reload: read.reload };
}

/**
 * Événements en cours (vue `world_events`) selon `filters`, à l'heure du serveur, relus chaque minute onglet
 * visible et au retour sur l'onglet ; `null` tant que rien n'est lu. Seuls ceux qui finissent après une borne
 * sont lus, la vue gardant le passé : l'heure du serveur à l'ouverture de l'écran (reprise une fois lue),
 * puis, à la relecture qui suit la fin d'un événement lu, l'heure de cette relecture. Une longue session ne
 * garde donc pas les événements finis depuis l'ouverture. Pendant la lecture sous la nouvelle borne, les
 * événements déjà lus restent rendus : l'écran ne repasse pas par le chargement.
 */
export function useWorldEvents(filters: Record<string, string | readonly string[]>) {
  const [now, setNow] = useState(() => serverClock.now());
  const [since, setSince] = useState(() => now.toISOString());
  const read = useEventRows({ ...filters, ends_at: { gt: since } });
  const { events: fresh, reload } = read;
  const filterKey = JSON.stringify(filters);
  const last = useRef<{ filterKey: string; events: WorldEvent[] } | null>(null);
  if (fresh) last.current = { filterKey, events: fresh };
  const all = fresh ?? (last.current?.filterKey === filterKey ? last.current.events : null);
  const lastEvents = useRef(all);
  lastEvents.current = all;
  // Une fois, au montage : la borne change avec l'heure du serveur lue, et `reload` avec elle.
  useEffect(() => {
    let live = true;
    void syncServerClock().then(() => {
      if (!live) return;
      const at = serverClock.now();
      setNow(at);
      setSince(at.toISOString());
    });
    return () => void (live = false);
  }, []);
  useEffect(() => {
    const reread = () => {
      const at = serverClock.now();
      setNow(at);
      if (document.visibilityState !== 'visible') return;
      // Un événement lu est fini : la borne avance, et la lecture sous la nouvelle borne tient lieu de
      // relecture (une seule lecture).
      if (lastEvents.current?.some((event) => event.endsAt <= at)) setSince(at.toISOString());
      else void reload();
    };
    const timer = setInterval(reread, 60_000);
    document.addEventListener('visibilitychange', reread);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', reread);
    };
  }, [reload]);
  return {
    events: all && inForce(all, now),
    now,
    failed: read.failed,
    reload: () => reload().then(() => setNow(serverClock.now())),
  };
}

/**
 * Tempête qui allonge un départ entre deux cités parmi `events` (7.4, comme `voyage.depart`) : la plus forte
 * de la route, dans un sens ou dans l'autre ; à égalité, le plus petit identifiant (la plus ancienne).
 */
export function stormOn(events: readonly WorldEvent[], from: string, to: string) {
  let best: WorldEvent | undefined;
  for (const event of events) {
    const ends = [event.cityId, event.otherCityId];
    if (event.model !== 'storm' || !ends.includes(from) || !ends.includes(to) || from === to)
      continue;
    const [mine, theirs] = [event.magnitudeBps, best?.magnitudeBps ?? -1];
    if (mine > theirs || (mine === theirs && best && event.id < best.id)) best = event;
  }
  return best;
}

/**
 * Un événement en une phrase traduite : sa portée, sa fin et son effet, l'ampleur en pourcentage. Une cité
 * ou un bien sans nom connu s'affichent par leur identifiant.
 */
export function describeWorldEvent(
  event: WorldEvent,
  t: TFunction,
  language: string,
  cityNames: Readonly<Record<string, string>>,
) {
  const date = new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' });
  const percent = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 2 });
  const city = (id: string) => cityNames[id] ?? id;
  return t(`worldEvents.${event.model}`, {
    city: city(event.cityId),
    other: event.otherCityId === null ? '' : city(event.otherCityId),
    good: event.goodId === null ? '' : t(`goods.${event.goodId}`, { defaultValue: event.goodId }),
    date: date.format(event.endsAt),
    percent: percent.format(event.magnitudeBps / 10_000),
  });
}
