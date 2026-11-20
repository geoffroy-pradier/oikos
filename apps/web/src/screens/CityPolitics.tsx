import { gameDayDate } from '@oikos/sim';
import { CalendarClock, Card, Check, cn, Crown, Info, Users, Vote } from '@oikos/ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCitedHouses } from '../cited-houses';
import { useRows } from '../data';
import { useHouse } from '../house';
import {
  currentElection,
  electionPhase,
  parseCandidates,
  parseCitizenship,
  parseElections,
  parseOffices,
  parseResults,
} from '../politics';
import { serverClock } from '../server-clock';
import { ElectionActions } from './ElectionActions';
import { HouseLink } from './HouseLink';
import { LoadProblem, Loading } from './LoadProblem';
import { PANEL_TITLE } from './city-section';

/** Titre de section, icône en accent. */
const TITLE =
  'flex items-center gap-2 text-lg font-semibold [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-accent';
/** Pastille ronde d'une icône décorative. */
const ROUND =
  'grid size-9 shrink-0 place-items-center rounded-full bg-primary-subtle text-primary [&_svg]:size-4.5';

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
  // Statut et date de la maison du joueur, lus ensemble dans `my_citizenships` (#420).
  const citizenshipRows = useRows<unknown>(
    'my_citizenships',
    'house_id, status, since, since_day',
    'since',
    { house_id: house.id },
  );
  const citizenship =
    citizenshipRows.rows === null ? null : parseCitizenship(citizenshipRows.rows, house.id);
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
  const reads = [officeRows, electionRows, candidateRows, resultRows, citizenshipRows];
  const names = houses.names;
  const loading = houses.loading || reads.some((read) => read.rows === null && !read.failed);
  const failed =
    houses.failed ||
    reads.some((read) => read.failed) ||
    (!loading && [names, offices, elections, candidates, results, citizenship].includes(null));
  const [now, setNow] = useState(() => serverClock.now().getTime());
  const reload = async () => {
    await Promise.all([...reads, houses].map((read) => read.reload()));
    setNow(serverClock.now().getTime());
  };

  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const number = new Intl.NumberFormat(i18n.language);
  const nameOf = (id: string) => names?.get(id) ?? t('cityPolitics.unknownHouse');
  const status = citizenship?.status ?? houses.status ?? house.citizenshipStatus;
  const citizen = status === 'citizen';
  // Le jour de jeu du statut, comme les autres dates de jeu ; sans horloge, le jour local de l'instant.
  const since = (value: { since: number; sinceDay: number | null }) =>
    value.sinceDay === null
      ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(value.since)
      : new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long', timeZone: 'UTC' }).format(
          gameDayDate(value.sinceDay),
        );
  const phase = election ? electionPhase(election, now) : null;
  const office = (id: string) => t(`cityPolitics.offices.${id}`, { defaultValue: id });

  // Étape du calendrier en cours : dépôt, vote, puis clôture (vote clos ou dépouillé).
  const step = phase === 'filing' ? 0 : phase === 'voting' ? 1 : phase === 'upcoming' ? -1 : 2;
  const most = Math.max(1, ...lastResults.map((result) => result.votes));

  return (
    <section className="flex flex-col gap-4">
      <h2 ref={title} tabIndex={-1} className={`${PANEL_TITLE} ${TITLE}`}>
        <Vote aria-hidden="true" />
        {t('cityPolitics.title')}
      </h2>
      {loading && <Loading />}
      {failed && <LoadProblem heading={title} onRetry={reload} />}
      {!loading && !failed && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={cn(ROUND, !citizen && 'bg-muted text-muted-foreground')}
              >
                {citizen ? <Check /> : <Info />}
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-medium">
                  {citizenship
                    ? t(`cityPolitics.statusSince.${citizenship.status}`, {
                        city: house.cityName,
                        date: since(citizenship),
                      })
                    : t(`home.status.${citizen ? 'citizen' : 'metic'}`, { city: house.cityName })}
                </p>
                {!citizen && (
                  <p className="text-sm text-muted-foreground">{t('cityPolitics.meticNotice')}</p>
                )}
              </div>
            </Card>
            <Card className="flex items-start gap-3">
              <span aria-hidden="true" className={ROUND}>
                <Crown />
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-medium">
                  {archon
                    ? t('cityPolitics.archon', {
                        house: nameOf(archon.houseId),
                        until: date.format(archon.endsAt),
                      })
                    : t('cityPolitics.noArchon')}
                </p>
                {archon && (
                  <HouseLink houseId={archon.houseId} className="text-sm">
                    {t('houseProfile.view', { house: nameOf(archon.houseId) })}
                  </HouseLink>
                )}
              </div>
            </Card>
          </div>
          <Card elevation="raised" className="flex flex-col gap-4">
            <h3 className={`${TITLE} text-base`}>
              <CalendarClock aria-hidden="true" />
              {t('cityPolitics.election')}
            </h3>
            {!election && <p className="text-muted-foreground">{t('cityPolitics.noElection')}</p>}
            {election && phase && (
              <>
                <p className="font-medium">
                  {t(`cityPolitics.phase.${phase}`, { office: office(election.office) })}
                </p>
                <ol className="grid gap-2 text-sm sm:grid-cols-3">
                  {(
                    [
                      ['filing', election.candidacyOpensAt],
                      ['voting', election.votingOpensAt],
                      ['closing', election.votingClosesAt],
                    ] as const
                  ).map(([key, at], index) => (
                    <li
                      key={key}
                      aria-current={index === step ? 'step' : undefined}
                      className={
                        index === step
                          ? 'rounded-lg border border-primary bg-primary-subtle p-3 font-medium'
                          : 'rounded-lg border border-border-subtle p-3 text-muted-foreground'
                      }
                    >
                      {t(`cityPolitics.${key}`, { at: date.format(at) })}
                    </li>
                  ))}
                </ol>
                <h4 className="text-sm font-semibold">
                  {t('cityPolitics.candidates', { count: running.length })}
                </h4>
                {running.length === 0 && (
                  <p className="text-muted-foreground">{t('cityPolitics.noCandidate')}</p>
                )}
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
                  {running.map((candidate) => (
                    <li
                      key={candidate.id}
                      className="flex items-center gap-2.5 rounded-xl border border-border-subtle bg-surface p-2.5"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(ROUND, 'bg-muted text-muted-foreground')}
                      >
                        <Users />
                      </span>
                      <HouseLink houseId={candidate.houseId} className="min-w-0 break-all">
                        {nameOf(candidate.houseId)}
                      </HouseLink>
                    </li>
                  ))}
                </ul>
                {citizen && (
                  <ElectionActions
                    election={election}
                    phase={phase}
                    candidates={running}
                    withdrawn={
                      candidates?.some(
                        (c) =>
                          c.electionId === election.id && c.houseId === house.id && c.withdrawn,
                      ) ?? false
                    }
                    nameOf={nameOf}
                    onDone={reload}
                  />
                )}
              </>
            )}
          </Card>
          <Card className="flex flex-col gap-3">
            <h3 className={`${TITLE} text-base`}>
              <Crown aria-hidden="true" />
              {t('cityPolitics.lastResults')}
            </h3>
            {!last && <p className="text-muted-foreground">{t('cityPolitics.noResults')}</p>}
            {last && (
              <ul className="flex flex-col gap-3">
                {/* La barre double le nombre de voix, écrit dans le texte. */}
                {lastResults.map((result) => (
                  <li key={result.houseId} className="flex flex-col gap-1.5 break-words">
                    <span className={result.elected ? 'font-semibold' : undefined}>
                      {t(result.elected ? 'cityPolitics.elected' : 'cityPolitics.result', {
                        house: nameOf(result.houseId),
                        count: result.votes,
                        votes: number.format(result.votes),
                      })}
                    </span>
                    <span
                      aria-hidden="true"
                      className="block h-2 overflow-hidden rounded-full bg-muted"
                    >
                      <span
                        className={`block h-full rounded-full ${result.elected ? 'bg-primary' : 'bg-muted-foreground'}`}
                        style={{ width: `${Math.round((result.votes / most) * 100)}%` }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </section>
  );
}
