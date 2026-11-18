import { Button } from '@oikos/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cityCommand, type CityCommandInputs } from '../api';
import { useRows } from '../data';
import { useHouse } from '../house';
import { parseVoted, type Candidate, type Election, type ElectionPhase } from '../politics';
import { noticeClass } from './CommandNotice';
import { LoadProblem } from './LoadProblem';

type Command = 'city.standForElection' | 'city.withdrawCandidacy' | 'city.castVote';
type Notice = { kind: 'status' | 'alert'; text: string } | null;
const WAITING = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

/**
 * Actions d'une citoyenne à l'élection en cours (6.2) : se porter candidate ou se retirer pendant le dépôt,
 * voter pour une candidature pendant le vote, une fois. Le résultat s'annonce dans une région vivante
 * toujours présente, sous les actions ; si le contrôle qui l'a lancé a disparu ou est inactif, le foyer y va.
 * Chaque commande garde sa clé tant qu'elle reste sans réponse : un nouvel essai la rejoue.
 */
export function ElectionActions(props: {
  election: Election;
  phase: ElectionPhase;
  candidates: readonly Candidate[];
  /** La maison a retiré sa candidature à cette élection : c'est définitif (6.2). */
  withdrawn: boolean;
  nameOf: (houseId: string) => string;
  onDone: () => Promise<unknown>;
}) {
  const { election, phase, candidates, withdrawn, nameOf, onDone } = props;
  const { t } = useTranslation();
  const house = useHouse();
  const ballotRows = useRows<unknown>('my_ballots', 'election_id', 'cast_at');
  const voted = ballotRows.rows === null ? null : parseVoted(ballotRows.rows, 'election_id');
  const mine = candidates.find((candidate) => candidate.houseId === house.id);

  const keys = useRef(new Map<string, string>());
  const noticeElement = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  async function run<N extends Command>(name: N, input: CityCommandInputs[N]) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const intent = `${name}:${JSON.stringify(input)}`;
    const key = keys.current.get(intent) ?? crypto.randomUUID();
    keys.current.set(intent, key);
    try {
      const result = await cityCommand(name, input, house.accessToken, key);
      if (result.ok || result.error.code !== 'INTERNAL') keys.current.delete(intent);
      setNotice(
        result.ok
          ? { kind: 'status', text: t(`cityPolitics.done.${name.slice('city.'.length)}`) }
          : { kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) },
      );
      await Promise.all([ballotRows.reload(), onDone()]);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const active = document.activeElement;
    if (notice && (active === document.body || active?.getAttribute('aria-disabled') === 'true'))
      noticeElement.current?.focus();
  }, [notice]);

  return (
    <div className="flex flex-col gap-2">
      {phase === 'filing' && withdrawn && <p>{t('cityPolitics.withdrawn')}</p>}
      {phase === 'filing' && !withdrawn && (
        <>
          {mine && (
            <p id={`withdraw-${election.id}`} className="text-muted-foreground">
              {t('cityPolitics.withdrawWarning')}
            </p>
          )}
          <Button
            className={`self-start ${WAITING}`}
            aria-disabled={busy}
            aria-describedby={mine ? `withdraw-${election.id}` : undefined}
            onClick={() =>
              void run(mine ? 'city.withdrawCandidacy' : 'city.standForElection', {
                electionId: election.id,
              })
            }
          >
            {t(mine ? 'cityPolitics.withdraw' : 'cityPolitics.stand')}
          </Button>
        </>
      )}
      {phase === 'voting' && (ballotRows.failed || (ballotRows.rows !== null && !voted)) && (
        <LoadProblem onRetry={() => ballotRows.reload()} />
      )}
      {phase === 'voting' && voted?.has(election.id) && <p>{t('cityPolitics.voted')}</p>}
      {phase === 'voting' && voted && !voted.has(election.id) && (
        <ul className="flex flex-wrap gap-2">
          {candidates.map((candidate) => (
            <li key={candidate.id}>
              <Button
                className={WAITING}
                aria-disabled={busy}
                onClick={() =>
                  void run('city.castVote', { electionId: election.id, candidacyId: candidate.id })
                }
              >
                {t('cityPolitics.voteFor', { house: nameOf(candidate.houseId) })}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p
        ref={noticeElement}
        tabIndex={-1}
        role={notice?.kind ?? 'status'}
        className={noticeClass(notice?.kind)}
      >
        {notice?.text ?? ''}
      </p>
    </div>
  );
}
