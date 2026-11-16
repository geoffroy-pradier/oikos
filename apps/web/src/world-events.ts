import { WORLD_EVENT_CATALOGUE, type WorldEventKind } from '@oikos/sim';
import type { TFunction } from 'i18next';
import { useEffect, useMemo, useState } from 'react';
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

/**
 * Événements en cours (vue `world_events`) selon `filters`, à l'heure du serveur, relus chaque minute onglet
 * visible et au retour sur l'onglet ; `null` tant que rien n'est lu. Seuls ceux qui finissent après
 * l'ouverture de l'écran sont lus (instant repris une fois l'heure du serveur lue) : la vue garde le passé.
 */
export function useWorldEvents(filters: Record<string, string | readonly string[]>) {
  const [now, setNow] = useState(() => serverClock.now());
  const [since, setSince] = useState(() => now.toISOString());
  const read = useRows<unknown>('world_events', WORLD_EVENT_COLUMNS, 'starts_at', {
    ...filters,
    ends_at: { gt: since },
  });
  const all = useMemo(() => (read.rows === null ? null : parseWorldEvents(read.rows)), [read.rows]);
  const { reload } = read;
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
      setNow(serverClock.now());
      if (document.visibilityState === 'visible') void reload();
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
