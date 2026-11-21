import {
  Ban,
  Card,
  Check,
  EmptyState,
  Hourglass,
  ScrollText,
  StatCard,
  TriangleAlert,
} from '@oikos/ui';
import { Link } from '@tanstack/react-router';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useCitedHouses } from '../cited-houses';
import { useRows } from '../data';
import { useGameTime } from '../game-time';
import { useHouse } from '../house';
import {
  liturgyState,
  parseCityLiturgies,
  type CityLiturgy,
  type LiturgyState,
} from '../liturgies';
import { HouseLink } from './HouseLink';
import { LoadProblem, Loading } from './LoadProblem';
import { PropertyTable } from './PropertySheet';
import { SectionTitle } from './SectionTitle';
import { GENRE_ICONS } from './liturgy-genre';
import { PANEL_TITLE } from './city-section';

const STATE_ICONS = { assigned: Hourglass, overdue: TriangleAlert, performed: Check, levied: Ban };
const STATE_ORDER: LiturgyState[] = ['assigned', 'overdue', 'performed', 'levied'];

/**
 * Liturgies de la saison de la cité (6.4) : pour chaque maison désignée, son genre et l'état de sa liturgie, jamais un
 * montant (le dû ne se lit que pour sa propre maison, 4.1). Les maisons sont rangées par nom, jamais par ce qui dirait
 * leur fortune. Une maison désignée a le lien vers sa propre liturgie.
 */
export function CityLiturgies() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const now = useGameTime();
  const title = useRef<HTMLHeadingElement>(null);
  const rows = useRows<unknown>(
    'city_liturgies',
    'house_id, season, genre, status, due_at',
    'house_id',
    { city_id: house.cityId },
  );
  const liturgies = rows.rows === null ? null : parseCityLiturgies(rows.rows);
  const houses = useCitedHouses(liturgies && liturgies.map((liturgy) => liturgy.houseId));
  const loading = houses.loading || rows.rows === null;
  const failed = rows.failed || houses.failed || (rows.rows !== null && liturgies === null);
  const reload = () => Promise.all([rows.reload(), houses.reload()]);
  const nameOf = (id: string) => houses.names?.get(id) ?? t('cityPolitics.unknownHouse');
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const number = new Intl.NumberFormat(i18n.language);
  const state = (liturgy: CityLiturgy) => liturgyState(liturgy, now.getTime());
  const count = (wanted: LiturgyState) =>
    (liturgies ?? []).filter((liturgy) => state(liturgy) === wanted).length;
  const designated = liturgies?.some((liturgy) => liturgy.houseId === house.id) ?? false;

  return (
    <Card className="flex flex-col gap-4">
      <SectionTitle ref={title} tabIndex={-1} className={PANEL_TITLE} icon={<ScrollText />}>
        {t('cityLiturgies.title')}
      </SectionTitle>
      <p className="text-sm text-muted-foreground">{t('cityLiturgies.intro')}</p>
      {loading && !failed && <Loading />}
      {failed && <LoadProblem heading={title} onRetry={reload} />}
      {!loading && !failed && liturgies?.length === 0 && (
        <EmptyState compact illustration="noEvent" title={t('cityLiturgies.empty')} />
      )}
      {!loading && !failed && liturgies && liturgies.length > 0 && (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              definition
              label={t('cityLiturgies.designated')}
              value={number.format(liturgies.length)}
            />
            {STATE_ORDER.filter((wanted) => wanted !== 'overdue').map((wanted) => (
              <StatCard
                key={wanted}
                definition
                label={t(`cityLiturgies.counts.${wanted}`)}
                value={number.format(
                  count(wanted) + (wanted === 'assigned' ? count('overdue') : 0),
                )}
              />
            ))}
          </dl>
          <p className="text-sm text-muted-foreground">
            {t('cityLiturgies.deadline', { date: date.format(liturgies[0]?.dueAt ?? 0) })}
          </p>
          {designated && (
            <p className="flex flex-wrap items-center gap-x-3 rounded-lg bg-primary-subtle p-3 text-sm">
              {t('cityLiturgies.yours')}
              <Link
                to="/cite/liturgie"
                className="font-semibold text-primary underline underline-offset-4"
              >
                {t('cityLiturgies.yoursLink')}
              </Link>
            </p>
          )}
          <PropertyTable
            caption={t('cityLiturgies.caption')}
            rows={liturgies}
            rowKey={(liturgy) => liturgy.houseId}
            defaultSort={{ column: 'house', direction: 'ascending' }}
            columns={[
              {
                id: 'house',
                header: t('cityLiturgies.columns.house'),
                sortValue: (liturgy) => nameOf(liturgy.houseId),
                cell: (liturgy) => (
                  <HouseLink houseId={liturgy.houseId}>{nameOf(liturgy.houseId)}</HouseLink>
                ),
              },
              {
                id: 'genre',
                header: t('cityLiturgies.columns.genre'),
                sortValue: (liturgy) => t(`liturgy.genres.${liturgy.genre}`),
                cell: (liturgy) => {
                  const GenreIcon = GENRE_ICONS[liturgy.genre];
                  return (
                    <span className="inline-flex items-center gap-1.5">
                      <GenreIcon aria-hidden="true" className="size-4 shrink-0 text-accent" />
                      {t(`liturgy.genres.${liturgy.genre}`)}
                    </span>
                  );
                },
              },
              {
                id: 'state',
                header: t('cityLiturgies.columns.state'),
                sortValue: (liturgy) => STATE_ORDER.indexOf(state(liturgy)),
                cell: (liturgy) => {
                  const StateIcon = STATE_ICONS[state(liturgy)];
                  return (
                    <span className="inline-flex items-center gap-1.5">
                      <StateIcon aria-hidden="true" className="size-4 shrink-0" />
                      {t(`liturgy.state.${state(liturgy)}`)}
                    </span>
                  );
                },
              },
            ]}
          />
        </>
      )}
    </Card>
  );
}
