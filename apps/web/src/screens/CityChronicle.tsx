import { gameDayDate } from '@oikos/sim';
import { Card, ChevronRight, EmptyState, ScrollText, Sparkles } from '@oikos/ui';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { chronicleParagraphs, parseChronicle, type ChronicleArticle } from '../chronicle';
import { useRows } from '../data';
import { useHouse } from '../house';
import { LoadProblem, Loading } from './LoadProblem';
import { PANEL_TITLE } from './city-section';

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
        <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          <Sparkles aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t('chronicle.aiNote')}
        </p>
      )}
    </>
  );

  return (
    <section className="flex flex-col gap-4">
      <h2
        ref={title}
        tabIndex={-1}
        className={`${PANEL_TITLE} flex items-center gap-2 text-lg font-semibold [&_svg]:size-5 [&_svg]:text-accent`}
      >
        <ScrollText aria-hidden="true" />
        {t('chronicle.title')}
      </h2>
      {read.rows === null && !read.failed && <Loading />}
      {(read.failed || (read.rows !== null && articles === null)) && (
        <LoadProblem heading={title} onRetry={() => read.reload()} />
      )}
      {articles?.length === 0 && <EmptyState illustration="noEvent" title={t('chronicle.none')} />}
      {latest && (
        <Card className="flex flex-col gap-3 break-words sm:p-6">
          <article className="flex max-w-prose flex-col gap-3 leading-relaxed">
            <h3 className="text-lg font-semibold">{heading(latest)}</h3>
            {body(latest)}
          </article>
        </Card>
      )}
      {earlier.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="eyebrow">{t('chronicle.earlier')}</h3>
          {earlier.map((article) => (
            <details
              key={article.id}
              className="group rounded-xl border border-border-subtle bg-surface px-4 break-words"
            >
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 py-2.5 font-medium hover:text-primary">
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground transition-transform duration-(--motion-fast) group-open:rotate-90"
                />
                {heading(article)}
              </summary>
              <div className="flex max-w-prose flex-col gap-2 pb-4 leading-relaxed">
                {body(article)}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
