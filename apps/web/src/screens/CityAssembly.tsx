import type { DecreeProposal } from '@oikos/contracts';
import { Card } from '@oikos/ui';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useRows } from '../data';
import { groupDecrees, parseDecrees, type Decree } from '../decrees';
import { useHouse } from '../house';
import { useMoney } from '../money';
import { parseHouseNames, statusOf } from '../politics';
import { LoadProblem, Loading } from './LoadProblem';

const ROW = 'flex flex-col gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0';

/** Ce que dit un décret, en une phrase : son modèle et ses paramètres. */
export function useDescribeDecree() {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 2,
  });
  const factor = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });
  return (proposal: DecreeProposal | null, model: string) => {
    if (!proposal) return t('assembly.unreadable', { model });
    switch (proposal.model) {
      case 'market_tax_rate':
        return t('assembly.models.market_tax_rate', {
          rate: percent.format(proposal.params.rateBps / 10_000),
        });
      case 'port_dues':
        return t('assembly.models.port_dues', {
          factor: factor.format(proposal.params.coefficientBps / 10_000),
        });
      case 'public_works':
        return t('assembly.models.public_works', { amount: money(proposal.params.amountOboles) });
      case 'festival':
        return t('assembly.models.festival', {
          count: proposal.params.days,
          amount: money(proposal.params.amountOboles),
          goods: proposal.params.goodIds
            .map((good) => t(`goods.${good}`, { defaultValue: good }))
            .join(', '),
        });
    }
  };
}

/**
 * Assemblée de la cité (6.3) : décrets au vote, décrets adoptés et en vigueur, décrets rejetés ou caducs avec
 * leur décompte. Un métèque voit tout, et l'écran dit pourquoi il ne vote pas.
 */
export function CityAssembly() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const describe = useDescribeDecree();
  const title = useRef<HTMLHeadingElement>(null);
  const city = { city_id: house.cityId };
  const decreeRows = useRows<unknown>(
    'decrees',
    'id, city_id, model, params, proposed_by, status, proposed_at, voting_closes_at, quorum_bps, tallied_at, electorate, votes_for, votes_against, applied_at',
    'proposed_at',
    city,
  );
  const houseRows = useRows<unknown>('houses', 'id, name, citizenship_status', 'name', city);
  const reads = [decreeRows, houseRows];
  const decrees = decreeRows.rows === null ? null : parseDecrees(decreeRows.rows);
  const names = houseRows.rows === null ? null : parseHouseNames(houseRows.rows);
  const loading = reads.some((read) => read.rows === null && !read.failed);
  const failed = reads.some((read) => read.failed) || (!loading && [decrees, names].includes(null));
  const reload = () => Promise.all(reads.map((read) => read.reload()));

  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const number = new Intl.NumberFormat(i18n.language);
  const nameOf = (id: string) => names?.get(id) ?? t('cityPolitics.unknownHouse');
  const groups = decrees ? groupDecrees(decrees) : null;
  const status = houseRows.rows ? statusOf(houseRows.rows, house.id) : null;
  const citizen = (status ?? house.citizenshipStatus) === 'citizen';
  const tally = (decree: Decree) =>
    decree.talliedAt === null
      ? null
      : t('assembly.tally', {
          for: number.format(decree.votesFor ?? 0),
          against: number.format(decree.votesAgainst ?? 0),
          electorate: number.format(decree.electorate ?? 0),
        });

  return (
    <Card className="flex flex-col gap-3">
      <h2 ref={title} tabIndex={-1} className="text-xl">
        {t('assembly.title')}
      </h2>
      {loading && <Loading />}
      {failed && <LoadProblem heading={title} onRetry={reload} />}
      {groups && names && (
        <>
          <h3 className="font-semibold">{t('assembly.open')}</h3>
          {!citizen && <p className="text-muted-foreground">{t('assembly.meticNotice')}</p>}
          {groups.open.length === 0 && (
            <p className="text-muted-foreground">{t('assembly.noOpen')}</p>
          )}
          <ul className="flex flex-col gap-2">
            {groups.open.map((decree) => {
              return (
                <li key={decree.id} className={ROW}>
                  <p className="font-semibold">{describe(decree.proposal, decree.model)}</p>
                  <p className="text-muted-foreground">
                    {t('assembly.proposed', {
                      house: nameOf(decree.proposedBy),
                      closes: date.format(decree.votingClosesAt),
                    })}
                  </p>
                </li>
              );
            })}
          </ul>
          <h3 className="font-semibold">{t('assembly.passed')}</h3>
          {groups.passed.length === 0 && (
            <p className="text-muted-foreground">{t('assembly.noPassed')}</p>
          )}
          <ul className="flex flex-col gap-2">
            {groups.passed.map((decree) => (
              <li key={decree.id} className={ROW}>
                <p className="font-semibold">{describe(decree.proposal, decree.model)}</p>
                <p>
                  {decree.appliedAt === null
                    ? t('assembly.status.adopted')
                    : t('assembly.status.applied', { at: date.format(decree.appliedAt) })}
                </p>
                <p className="text-muted-foreground">{tally(decree)}</p>
              </li>
            ))}
          </ul>
          {groups.other.length > 0 && (
            <>
              <h3 className="font-semibold">{t('assembly.other')}</h3>
              <ul className="flex flex-col gap-2">
                {groups.other.map((decree) => (
                  <li key={decree.id} className={ROW}>
                    <p className="font-semibold">{describe(decree.proposal, decree.model)}</p>
                    <p>{t(`assembly.status.${decree.status}`)}</p>
                    <p className="text-muted-foreground">{tally(decree)}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Card>
  );
}
