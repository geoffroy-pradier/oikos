import { gameDayDate } from '@oikos/sim';
import { Card, ScrollText } from '@oikos/ui';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { chronicleParagraphs, parseChronicle, type ChronicleArticle } from '../chronicle';
import { useRows } from '../data';
import { useHouse } from '../house';
import { LoadProblem, Loading } from './LoadProblem';

/** Chroniques montrées, la plus récente d'abord : un choix d'affichage, pas une règle du jeu. */
const SHOWN_ARTICLES = 7;

/**
 * Chronique de la cité de la maison (6.6, #271) : celle de la dernière clôture en entier, les précédentes
 * repliées (un élément `details`, ouvert au clavier). Lecture seule ; une chronique réécrite par l'IA le dit.
 */
export function CityChronicle() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const title = useRef<HTMLHeadingElement>(null);
  const read = useRows<unknown>(
    'chronicle_articles',
    'id, city_id, game_day, text_fr, text_en, source',
    'game_day',
    { city_id: house.cityId },
    { limit: SHOWN_ARTICLES },
  );
  const articles = read.rows === null ? null : parseChronicle(read.rows, house.cityId);
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long', timeZone: 'UTC' });
  const [latest, ...earlier] = articles ?? [];
  const heading = (article: ChronicleArticle) =>
    t('chronicle.day', { date: dates.format(gameDayDate(article.gameDay)) });
  const body = (article: ChronicleArticle) => (
    <>
      {chronicleParagraphs(article, i18n.language).map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
      {article.source === 'ai' && (
        <p className="text-sm text-muted-foreground">{t('chronicle.aiNote')}</p>
      )}
    </>
  );

  return (
    <Card className="flex flex-col gap-3">
      <h2 ref={title} tabIndex={-1} className="text-xl">
        <ScrollText aria-hidden="true" className="mr-2 inline size-5 align-[-0.15em] text-accent" />
        {t('chronicle.title')}
      </h2>
      {read.rows === null && !read.failed && <Loading />}
      {(read.failed || (read.rows !== null && articles === null)) && (
        <LoadProblem heading={title} onRetry={() => read.reload()} />
      )}
      {articles?.length === 0 && <p className="text-muted-foreground">{t('chronicle.none')}</p>}
      {latest && (
        <article className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3 break-words">
          <h3 className="font-semibold">{heading(latest)}</h3>
          {body(latest)}
        </article>
      )}
      {earlier.length > 0 && (
        <section className="flex flex-col gap-2 border-t border-border-subtle pt-3">
          <h3 className="font-semibold">{t('chronicle.earlier')}</h3>
          {earlier.map((article) => (
            <details
              key={article.id}
              className="rounded-lg border border-border-subtle px-3 py-1 break-words"
            >
              <summary className="min-h-11 cursor-pointer py-2.5 font-medium">
                {heading(article)}
              </summary>
              <div className="flex flex-col gap-2 pt-2">{body(article)}</div>
            </details>
          ))}
        </section>
      )}
    </Card>
  );
}
