import { Card, EmptyState, Package, Sparkles, TriangleAlert, Wheat } from '@oikos/ui';
import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useHouse } from '../house';
import { describeWorldEvent, useWorldEvents } from '../world-events';
import { LoadProblem, Loading } from './LoadProblem';
import { PANEL_TITLE } from './city-section';

// Événements d'une cité (7.4) : une tempête, elle, touche une route ; elle est dite au départ d'un navire.
const MODELS = ['drought', 'good_year', 'caravan'];
/** Pictogramme décoratif de chaque événement ; le texte dit tout. */
const ICONS: Record<string, ReactNode> = {
  drought: <TriangleAlert />,
  good_year: <Wheat />,
  caravan: <Package />,
  storm: <Sparkles />,
};

/**
 * Événements en cours dans la cité de la maison (vue `world_events`, 7.4) : sécheresse, bonne année,
 * caravane étrangère, chacun avec sa fin et son ampleur. Ceux à venir ne sont pas lisibles (Pythie, 7.3).
 */
export function CityEvents() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const title = useRef<HTMLHeadingElement>(null);
  const { events, failed, reload } = useWorldEvents({ city_id: house.cityId, model: MODELS });
  return (
    <section className="flex flex-col gap-4">
      <h2
        ref={title}
        tabIndex={-1}
        className={`${PANEL_TITLE} flex items-center gap-2 text-lg font-semibold [&_svg]:size-5 [&_svg]:text-accent`}
      >
        <Sparkles aria-hidden="true" />
        {t('worldEvents.title')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('worldEvents.intro')}</p>
      {events === null && !failed && <Loading />}
      {failed && <LoadProblem heading={title} onRetry={reload} />}
      {events?.length === 0 && <EmptyState illustration="noEvent" title={t('worldEvents.none')} />}
      {events && events.length > 0 && (
        <ul className="grid gap-3 lg:grid-cols-2">
          {events.map((event) => (
            <li key={event.id}>
              <Card className="flex h-full items-start gap-3 break-words">
                <span
                  aria-hidden="true"
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-subtle text-accent [&_svg]:size-4.5"
                >
                  {ICONS[event.model]}
                </span>
                <p className="min-w-0">
                  {describeWorldEvent(event, t, i18n.language, house.cityNames)}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
