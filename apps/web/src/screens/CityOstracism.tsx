import { Button, Card, Check, EmptyState, Hourglass, Info, UserMinus, Vote } from '@oikos/ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCitedHouses } from '../cited-houses';
import { useRows } from '../data';
import { useGameTime } from '../game-time';
import { useHouse } from '../house';
import {
  castAt,
  currentOstracism,
  ostracismPhase,
  parseOstracismResults,
  parseOstracisms,
} from '../ostracism';
import { parseHouseNames } from '../politics';
import { noticeClass } from './CommandNotice';
import { PANEL_TITLE } from './city-section';
import { LoadProblem, Loading } from './LoadProblem';
import { OstraconSheet } from './OstraconSheet';
import { OstracismOutcome } from './OstracismOutcome';
import { SectionTitle } from './SectionTitle';

/**
 * Ostracisme de la cité (6.4) : le vote en cours, avec le choix d'un citoyen dans une liste filtrable et la
 * confirmation de la maison, puis, après le dépouillement, le décompte et l'ostracisé. Le vote est secret : une
 * maison ne lit que le fait qu'elle a voté, jamais le nom inscrit ; le décompte par nom ne paraît qu'après le
 * dépouillement. Un métèque voit tout, sans bouton.
 */
export function CityOstracism() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const now = useGameTime();
  const title = useRef<HTMLHeadingElement>(null);
  const done = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const voteRows = useRows<unknown>(
    'ostracisms',
    'id, city_id, opened_at, voting_closes_at, quorum_bps, tallied_at, electorate, ballots, outcome, ostracized_house_id, ends_at, in_force',
    'opened_at',
    { city_id: house.cityId },
  );
  const castRows = useRows<unknown>('my_ostraca', 'ostracism_id, cast_at', 'cast_at');
  const resultRows = useRows<unknown>(
    'ostracism_results',
    'ostracism_id, house_id, ostraca',
    'ostraca',
  );
  const votes = voteRows.rows === null ? null : parseOstracisms(voteRows.rows);
  const vote = votes ? currentOstracism(votes) : null;
  const phase = vote ? ostracismPhase(vote, now.getTime()) : null;
  const cast = vote && castRows.rows !== null ? castAt(castRows.rows, vote.id) : null;
  const results =
    vote && resultRows.rows !== null ? parseOstracismResults(resultRows.rows, vote.id) : null;
  // La citoyenneté se relit dans la vue des maisons : elle a pu changer depuis la fondation de la maison (6.2).
  const named = useCitedHouses(
    phase === 'tallied'
      ? [vote?.ostracizedHouseId ?? undefined, ...(results ?? []).map((result) => result.houseId)]
      : [],
  );
  const citizen = (named.status ?? house.citizenshipStatus) === 'citizen';
  const choosing = phase === 'voting' && citizen;
  // Les citoyens parmi lesquels choisir ne se lisent qu'au vote : ils servent à la feuille seulement.
  const citizenRows = useRows<unknown>(
    'houses',
    'id, name, citizenship_status',
    'name',
    choosing ? { city_id: house.cityId, citizenship_status: 'citizen' } : null,
  );
  const citizens = citizenRows.rows === null ? null : parseHouseNames(citizenRows.rows);
  const reads = [voteRows, castRows, resultRows];
  const loading =
    reads.some((read) => read.rows === null && !read.failed) ||
    (choosing && citizenRows.rows === null && !citizenRows.failed) ||
    named.loading;
  const failed =
    reads.some((read) => read.failed) ||
    (choosing && (citizenRows.failed || (citizenRows.rows !== null && citizens === null))) ||
    named.failed ||
    (voteRows.rows !== null && votes === null) ||
    cast === undefined ||
    (phase === 'tallied' && resultRows.rows !== null && results === null);
  const reload = () => Promise.all([...reads, citizenRows, named].map((read) => read.reload()));
  const nameOf = (id: string) => named.names?.get(id) ?? t('cityPolitics.unknownHouse');
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 2,
  });
  const citizenList = citizens ? [...citizens].map(([id, name]) => ({ id, name })) : [];

  return (
    <Card className="flex flex-col gap-4">
      <SectionTitle ref={title} tabIndex={-1} className={PANEL_TITLE} icon={<UserMinus />}>
        {t('cityOstracism.title')}
      </SectionTitle>
      <p className="text-sm text-muted-foreground">{t('cityOstracism.intro')}</p>
      {/* Région présente avant son texte : le bulletin déposé s'annonce ici, la feuille fermée. */}
      <p ref={done} role="status" tabIndex={-1} className={noticeClass('status')}>
        {announcement}
      </p>
      {loading && !failed && <Loading />}
      {failed && <LoadProblem heading={title} onRetry={reload} />}
      {!loading && !failed && !vote && (
        <EmptyState compact illustration="noEvent" title={t('cityOstracism.empty')} />
      )}
      {!loading && !failed && vote && phase && (
        <>
          {phase === 'voting' && (
            <div className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4">
              <p className="flex items-start gap-2 font-medium">
                <Hourglass aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" />
                {t('cityOstracism.voting', {
                  date: date.format(vote.votingClosesAt),
                  percent: percent.format(vote.quorumBps / 10_000),
                })}
              </p>
              {!citizen && (
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  {t('cityOstracism.metic')}
                </p>
              )}
              {citizen && cast !== null && (
                <p className="flex items-start gap-2 text-sm">
                  <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                  {t('cityOstracism.voted', { date: date.format(cast) })}
                </p>
              )}
              {citizen && cast === null && (
                <>
                  <Button
                    className="self-start"
                    icon={<Vote aria-hidden="true" />}
                    aria-haspopup="dialog"
                    onClick={() => setOpen(true)}
                  >
                    {t('cityOstracism.cast')}
                  </Button>
                  <OstraconSheet
                    ostracismId={vote.id}
                    citizens={citizenList}
                    open={open}
                    onClose={() => setOpen(false)}
                    onCast={async (message) => {
                      setAnnouncement(message);
                      await reload();
                      done.current?.focus();
                    }}
                    onRefused={reload}
                  />
                </>
              )}
            </div>
          )}
          {phase === 'counting' && (
            <p className="flex items-start gap-2 font-medium">
              <Hourglass aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" />
              {t('cityOstracism.counting')}
            </p>
          )}
          {phase === 'tallied' && (
            <OstracismOutcome vote={vote} results={results} nameOf={nameOf} />
          )}
        </>
      )}
    </Card>
  );
}
