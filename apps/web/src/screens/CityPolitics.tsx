import { Card } from '@oikos/ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCitedHouses } from '../cited-houses';
import { useRows } from '../data';
import { useHouse } from '../house';
import {
  currentElection,
  electionPhase,
  parseCandidates,
  parseElections,
  parseOffices,
  parseResults,
} from '../politics';
import { serverClock } from '../server-clock';
import { ElectionActions } from './ElectionActions';
import { LoadProblem, Loading } from './LoadProblem';

/**
 * Vie politique de la cité de la maison (6.2) : son statut, l'archonte en charge, l'élection en cours
 * (calendrier, candidats, candidature, vote) et les résultats de la dernière élection dépouillée. Un métèque
 * voit tout, sans bouton, et l'écran dit pourquoi. Le vote est secret : rien ne dit pour qui la maison a voté.
 */
export function CityPolitics() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const title = useRef<HTMLHeadingElement>(null);
  const city = { city_id: house.cityId };
  const officeRows = useRows<unknown>(
    'offices',
    'house_id, office, ends_at, in_office',
    'starts_at',
    city,
  );
  const electionRows = useRows<unknown>(
    'elections',
    'id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at, tallied_at',
    'candidacy_opens_at',
    city,
  );
  const elections = electionRows.rows === null ? null : parseElections(electionRows.rows);
  const ids = elections?.map((election) => election.id) ?? [];
  const byElection = { election_id: ids };
  const candidateRows = useRows<unknown>(
    'election_candidates',
    'id, election_id, house_id, withdrawn_at',
    'filed_at',
    byElection,
  );
  const resultRows = useRows<unknown>(
    'election_results',
    'election_id, house_id, votes, elected',
    'votes',
    byElection,
  );
  const offices = officeRows.rows === null ? null : parseOffices(officeRows.rows);
  const candidates = candidateRows.rows === null ? null : parseCandidates(candidateRows.rows);
  const results = resultRows.rows === null ? null : parseResults(resultRows.rows);
  const archon = offices?.find((office) => office.office === 'archon' && office.inOffice);
  const election = elections ? currentElection(elections) : null;
  const running = candidates?.filter((c) => c.electionId === election?.id && !c.withdrawn) ?? [];
  const last = elections?.find((e) => e.talliedAt !== null);
  const lastResults = results?.filter((result) => result.electionId === last?.id) ?? [];
  // Seules les maisons citées sont lues, une fois connues (#441).
  const houses = useCitedHouses(
    offices && elections && candidates && results
      ? [archon?.houseId, ...lastResults.map((r) => r.houseId), ...running.map((c) => c.houseId)]
      : null,
  );
  const reads = [officeRows, electionRows, candidateRows, resultRows];
  const names = houses.names;
  const loading = houses.loading || reads.some((read) => read.rows === null && !read.failed);
  const failed =
    houses.failed ||
    reads.some((read) => read.failed) ||
    (!loading && [names, offices, elections, candidates, results].includes(null));
  const [now, setNow] = useState(() => serverClock.now().getTime());
  const reload = async () => {
    await Promise.all([...reads, houses].map((read) => read.reload()));
    setNow(serverClock.now().getTime());
  };

  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const number = new Intl.NumberFormat(i18n.language);
  const nameOf = (id: string) => names?.get(id) ?? t('cityPolitics.unknownHouse');
  const citizen = (houses.status ?? house.citizenshipStatus) === 'citizen';
  const phase = election ? electionPhase(election, now) : null;
  const office = (id: string) => t(`cityPolitics.offices.${id}`, { defaultValue: id });

  return (
    <Card className="flex flex-col gap-3">
      <h2 ref={title} tabIndex={-1} className="text-xl">
        {t('cityPolitics.title')}
      </h2>
      {loading && <Loading />}
      {failed && <LoadProblem heading={title} onRetry={reload} />}
      {!loading && !failed && (
        <>
          <p>{t(`home.status.${citizen ? 'citizen' : 'metic'}`, { city: house.cityName })}</p>
          {!citizen && <p className="text-muted-foreground">{t('cityPolitics.meticNotice')}</p>}
          <p>
            {archon
              ? t('cityPolitics.archon', {
                  house: nameOf(archon.houseId),
                  until: date.format(archon.endsAt),
                })
              : t('cityPolitics.noArchon')}
          </p>
          <h3 className="font-semibold">{t('cityPolitics.election')}</h3>
          {!election && <p className="text-muted-foreground">{t('cityPolitics.noElection')}</p>}
          {election && phase && (
            <>
              <p>{t(`cityPolitics.phase.${phase}`, { office: office(election.office) })}</p>
              <ul className="flex flex-col gap-1 text-muted-foreground">
                <li>{t('cityPolitics.filing', { at: date.format(election.candidacyOpensAt) })}</li>
                <li>{t('cityPolitics.voting', { at: date.format(election.votingOpensAt) })}</li>
                <li>{t('cityPolitics.closing', { at: date.format(election.votingClosesAt) })}</li>
              </ul>
              {running.length === 0 && <p>{t('cityPolitics.noCandidate')}</p>}
              <ul className="flex flex-col gap-1">
                {running.map((candidate) => (
                  <li key={candidate.id}>{nameOf(candidate.houseId)}</li>
                ))}
              </ul>
              {citizen && (
                <ElectionActions
                  election={election}
                  phase={phase}
                  candidates={running}
                  withdrawn={
                    candidates?.some(
                      (c) => c.electionId === election.id && c.houseId === house.id && c.withdrawn,
                    ) ?? false
                  }
                  nameOf={nameOf}
                  onDone={reload}
                />
              )}
            </>
          )}
          <h3 className="font-semibold">{t('cityPolitics.lastResults')}</h3>
          {!last && <p className="text-muted-foreground">{t('cityPolitics.noResults')}</p>}
          {last && (
            <ul className="flex flex-col gap-1">
              {lastResults.map((result) => (
                <li key={result.houseId}>
                  {t(result.elected ? 'cityPolitics.elected' : 'cityPolitics.result', {
                    house: nameOf(result.houseId),
                    count: result.votes,
                    votes: number.format(result.votes),
                  })}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
