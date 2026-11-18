import { Card, Sparkles } from '@oikos/ui';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useHouse } from '../house';
import { describeWorldEvent, useWorldEvents } from '../world-events';
import { LoadProblem, Loading } from './LoadProblem';

// Événements d'une cité (7.4) : une tempête, elle, touche une route ; elle est dite au départ d'un navire.
const MODELS = ['drought', 'good_year', 'caravan'];

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
    <Card className="flex flex-col gap-3">
      <h2 ref={title} tabIndex={-1} className="text-xl">
        <Sparkles aria-hidden="true" className="mr-2 inline size-5 align-[-0.15em] text-accent" />
        {t('worldEvents.title')}
      </h2>
      <p className="text-muted-foreground">{t('worldEvents.intro')}</p>
      {events === null && !failed && <Loading />}
      {failed && <LoadProblem heading={title} onRetry={reload} />}
      {events?.length === 0 && <p className="text-muted-foreground">{t('worldEvents.none')}</p>}
      {events && events.length > 0 && (
        <ul className="flex flex-col gap-1">
          {events.map((event) => (
            <li key={event.id} className="rounded-lg bg-accent-subtle/60 px-3 py-2 break-words">
              {describeWorldEvent(event, t, i18n.language, house.cityNames)}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
