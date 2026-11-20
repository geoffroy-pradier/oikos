import type { AdminEventsData, AdminWorldEvent } from '@oikos/contracts';
import { PageHeader, SegmentedControl } from '@oikos/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminGet } from '../api';
import { LoadError } from '../LoadError';
import { TABLE } from '../table';

/** Un événement tel que le rend l'API (`adminWorldEventSchema` de `@oikos/contracts`). */
export type WorldEventRow = AdminWorldEvent;

/** État d'un événement à l'heure donnée : à venir, en cours ou passé. */
export function eventStatus(event: Pick<WorldEventRow, 'startsAt' | 'endsAt'>, now: Date) {
  if (now < new Date(event.startsAt)) return 'upcoming';
  return now < new Date(event.endsAt) ? 'ongoing' : 'past';
}

/**
 * Calendrier des événements du monde (7.3, 7.4 ; #267), en lecture : ceux à venir, que les joueurs ne voient
 * pas encore, et ceux en cours ou finis depuis peu, de tous les mondes. L'heure de référence est celle que rend
 * l'API, pas celle du navigateur. Le tableau est une région focalisable : à 360 px, il défile aussi au clavier.
 * Une liste coupée à la limite de l'API le dit, sous la légende (#446).
 */
export function Events({ accessToken }: { accessToken: string }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<AdminEventsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** État montré (`all` : tous) ; les autres lignes sont retirées du tableau, pas de la lecture. */
  const [shown, setShown] = useState<'all' | ReturnType<typeof eventStatus>>('all');
  const title = useRef<HTMLHeadingElement>(null);
  const token = useRef(accessToken);
  token.current = accessToken;
  const time = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  const count = new Intl.NumberFormat(i18n.language);
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 2,
  });

  const load = useCallback(async (retried = false) => {
    const reply = await adminGet<AdminEventsData>('events', token.current);
    setError(reply.ok ? null : reply.code);
    if (reply.ok) setData(reply.data);
    if (retried) title.current?.focus();
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // Identifiants de la configuration, comme dans les Paramètres.
  const scope = (event: WorldEventRow) =>
    event.otherCity !== null
      ? t('events.route', { from: event.city, to: event.otherCity })
      : event.goodId !== null
        ? t('events.cityGood', { city: event.city, good: event.goodId })
        : event.city;

  return (
    <>
      <PageHeader title={t('events.title')} titleRef={title} />
      {!data && !error && <p>{t('app.loading')}</p>}
      {error && <LoadError code={error} onRetry={() => void load(true)} />}
      {data?.events.length === 0 && <p className="text-muted-foreground">{t('events.empty')}</p>}
      {data && data.events.length > 0 && (
        <>
          <SegmentedControl
            label={t('events.filter')}
            className="self-start"
            value={shown}
            onValueChange={(value) => setShown(value as typeof shown)}
            options={(['all', 'upcoming', 'ongoing', 'past'] as const).map((value) => ({
              value,
              label: value === 'all' ? t('events.all') : t(`events.statuses.${value}`),
            }))}
          />
          <p id="events-caption" className="text-sm text-muted-foreground">
            {t('events.caption', { now: time.format(new Date(data.now)), days: data.pastDays })}
          </p>
          {data.truncated && (
            <p id="events-truncated" className="text-sm font-semibold">
              {t('events.truncated', { shown: count.format(data.events.length) })}
            </p>
          )}
          <div
            className="overflow-x-auto rounded-xl border border-border-subtle bg-surface shadow-sm"
            role="region"
            aria-labelledby="events-caption"
            tabIndex={0}
          >
            <table
              aria-labelledby="events-caption"
              aria-describedby={data.truncated ? 'events-truncated' : undefined}
              className={TABLE}
            >
              <thead>
                <tr>
                  <th scope="col">{t('events.status')}</th>
                  <th scope="col">{t('events.model')}</th>
                  <th scope="col">{t('events.scope')}</th>
                  <th scope="col">{t('events.starts')}</th>
                  <th scope="col">{t('events.ends')}</th>
                  <th scope="col">{t('events.magnitude')}</th>
                  <th scope="col">{t('events.world')}</th>
                </tr>
              </thead>
              <tbody>
                {data.events
                  .filter(
                    (event) => shown === 'all' || eventStatus(event, new Date(data.now)) === shown,
                  )
                  .map((event) => (
                    <tr key={event.id}>
                      <td>{t(`events.statuses.${eventStatus(event, new Date(data.now))}`)}</td>
                      <td>{t(`events.models.${event.model}`)}</td>
                      <td>{scope(event)}</td>
                      <td>{time.format(new Date(event.startsAt))}</td>
                      <td>{time.format(new Date(event.endsAt))}</td>
                      <td>
                        {t(`events.effects.${event.model}`, {
                          value: percent.format(event.magnitudeBps / 10_000),
                        })}
                      </td>
                      <td>
                        <code>{event.world}</code>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
