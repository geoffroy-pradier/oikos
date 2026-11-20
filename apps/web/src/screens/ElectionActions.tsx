import { Button, Check, TriangleAlert, Vote } from '@oikos/ui';
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
/** Carte d'action dans la carte de l'élection : candidature ou bulletin. */
const PANEL = 'flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4';

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
    <div className="flex flex-col gap-3">
      {phase === 'filing' && withdrawn && <p className={PANEL}>{t('cityPolitics.withdrawn')}</p>}
      {phase === 'filing' && !withdrawn && (
        <div className={PANEL}>
          <h4 className="font-semibold">{t('cityPolitics.candidacy')}</h4>
          {mine ? (
            <p
              id={`withdraw-${election.id}`}
              className="flex items-start gap-2 text-sm text-warning"
            >
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t('cityPolitics.withdrawWarning')}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('cityPolitics.standHint')}</p>
          )}
          <Button
            variant={mine ? 'secondary' : 'primary'}
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
        </div>
      )}
      {phase === 'voting' && (ballotRows.failed || (ballotRows.rows !== null && !voted)) && (
        <LoadProblem onRetry={() => ballotRows.reload()} />
      )}
      {phase === 'voting' && voted?.has(election.id) && (
        <p className={`${PANEL} flex-row items-center`}>
          <Check aria-hidden="true" className="size-5 shrink-0 text-success" />
          {t('cityPolitics.voted')}
        </p>
      )}
      {phase === 'voting' && voted && !voted.has(election.id) && (
        <div className={PANEL}>
          <h4 className="font-semibold">{t('cityPolitics.ballot')}</h4>
          <p className="text-sm text-muted-foreground">{t('cityPolitics.ballotHint')}</p>
          {/* Un bulletin par candidature, en carte : le nom de la maison est dans le bouton. */}
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <Button
                  variant="secondary"
                  icon={<Vote />}
                  className={`h-auto min-h-14 w-full justify-start py-3 text-left break-all ${WAITING}`}
                  aria-disabled={busy}
                  onClick={() =>
                    void run('city.castVote', {
                      electionId: election.id,
                      candidacyId: candidate.id,
                    })
                  }
                >
                  {t('cityPolitics.voteFor', { house: nameOf(candidate.houseId) })}
                </Button>
              </li>
            ))}
          </ul>
        </div>
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
