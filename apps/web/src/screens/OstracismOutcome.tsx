import { Ban, StatCard } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import type { Ostracism, OstracismResult } from '../ostracism';
import { HouseLink } from './HouseLink';
import { PropertyTable } from './PropertySheet';

/**
 * Issue d'un vote d'ostracisme dépouillé (6.4) : la maison ostracisée et jusqu'à quand (au passé si son ostracisme a
 * pris fin), ou l'égalité en tête ou le quorum manqué ; les bulletins et les citoyens ; puis le décompte par nom, des
 * plus nommées aux moins nommées. Le décompte n'existe qu'après le dépouillement : le vote reste secret avant.
 */
export function OstracismOutcome(props: {
  vote: Ostracism;
  /** Voix par maison nommée ; `null` : pas lues. */
  results: readonly OstracismResult[] | null;
  nameOf: (houseId: string) => string;
}) {
  const { vote, results, nameOf } = props;
  const { t, i18n } = useTranslation();
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const number = new Intl.NumberFormat(i18n.language);
  const ostracized = vote.ostracizedHouseId;

  return (
    <>
      <p className="flex items-start gap-2 font-medium">
        <Ban aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" />
        {vote.outcome === 'ostracized' && ostracized && vote.endsAt !== null ? (
          <span>
            {t(vote.inForce ? 'cityOstracism.ostracized' : 'cityOstracism.ostracizedEnded', {
              house: nameOf(ostracized),
              date: date.format(vote.endsAt),
            })}
          </span>
        ) : (
          <span>{t(`cityOstracism.outcome.${vote.outcome ?? 'tie'}`)}</span>
        )}
      </p>
      {ostracized && (
        <HouseLink houseId={ostracized} className="text-sm">
          {t('houseProfile.view', { house: nameOf(ostracized) })}
        </HouseLink>
      )}
      <dl className="grid grid-cols-2 gap-3">
        <StatCard
          definition
          label={t('cityOstracism.ballots')}
          value={number.format(vote.ballots ?? 0)}
        />
        <StatCard
          definition
          label={t('cityOstracism.electorate')}
          value={number.format(vote.electorate ?? 0)}
        />
      </dl>
      {results && results.length > 0 && (
        <PropertyTable
          caption={t('cityOstracism.results')}
          rows={results}
          rowKey={(result) => result.houseId}
          defaultSort={{ column: 'votes', direction: 'descending' }}
          columns={[
            {
              id: 'house',
              header: t('cityOstracism.columns.house'),
              sortValue: (result) => nameOf(result.houseId),
              cell: (result) => (
                <HouseLink houseId={result.houseId}>{nameOf(result.houseId)}</HouseLink>
              ),
            },
            {
              id: 'votes',
              header: t('cityOstracism.columns.votes'),
              numeric: true,
              sortValue: (result) => result.votes,
              cell: (result) => number.format(result.votes),
            },
          ]}
        />
      )}
    </>
  );
}
