import type { DecreeProposal } from '@oikos/contracts';
import {
  Button,
  Card,
  Check,
  cn,
  Coins,
  EmptyState,
  Gavel,
  Hammer,
  Info,
  PartyPopper,
  Ship,
  X,
} from '@oikos/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cityCommand } from '../api';
import { useCitedHouses } from '../cited-houses';
import { useRows } from '../data';
import { groupDecrees, parseDecrees, ratesInForce, type Decree } from '../decrees';
import { useHouse } from '../house';
import { useMoney } from '../money';
import { parseVoted } from '../politics';
import { DecreeForm } from './DecreeForm';
import { noticeClass } from './CommandNotice';
import { LoadProblem, Loading } from './LoadProblem';
import { PANEL_TITLE } from './city-section';

type Notice = { kind: 'status' | 'alert'; text: string } | null;
const WAITING = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';
const GRID = 'grid gap-3 lg:grid-cols-2';
const TITLE =
  'flex items-center gap-2 text-lg font-semibold [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-accent';
/** Pastille du modèle d'un décret, décorative. */
const ICON =
  'grid size-9 shrink-0 place-items-center rounded-full bg-primary-subtle text-primary [&_svg]:size-4.5';

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
      case 'ostracism':
        return t('assembly.models.ostracism');
    }
  };
}

/**
 * Assemblée de la cité (6.3) : décrets au vote, avec le vote pour ou contre d'une citoyenne en deux touches
 * (Tab puis Entrée), décrets adoptés et en vigueur, décrets rejetés ou caducs avec leur décompte. Le vote est
 * secret : la maison lit seulement qu'elle a voté. Un métèque voit tout, sans bouton.
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
  const voteRows = useRows<unknown>('my_decree_votes', 'decree_id', 'cast_at');
  const decrees = decreeRows.rows === null ? null : parseDecrees(decreeRows.rows);
  const groups = decrees ? groupDecrees(decrees) : null;
  // Seuls les auteurs des décrets au vote sont nommés : seules leurs maisons sont lues (#441).
  const houses = useCitedHouses(groups && groups.open.map((decree) => decree.proposedBy));
  const reads = [decreeRows, voteRows];
  const voted = voteRows.rows === null ? null : parseVoted(voteRows.rows, 'decree_id');
  const names = houses.names;
  const loading = houses.loading || reads.some((read) => read.rows === null && !read.failed);
  const failed =
    houses.failed ||
    reads.some((read) => read.failed) ||
    (!loading && [decrees, voted, names].includes(null));
  const reload = () => Promise.all([...reads, houses].map((read) => read.reload()));

  const keys = useRef(new Map<string, string>());
  const noticeElement = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  async function vote(decreeId: string, approve: boolean) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const intent = `${decreeId}:${String(approve)}`;
    const key = keys.current.get(intent) ?? crypto.randomUUID();
    keys.current.set(intent, key);
    try {
      const result = await cityCommand(
        'city.voteDecree',
        { decreeId, approve },
        house.accessToken,
        key,
      );
      if (result.ok || result.error.code !== 'INTERNAL') keys.current.delete(intent);
      setNotice(
        result.ok
          ? { kind: 'status', text: t('assembly.voted') }
          : { kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) },
      );
      await reload();
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const active = document.activeElement;
    if (notice && (active === document.body || active?.getAttribute('aria-disabled') === 'true'))
      noticeElement.current?.focus();
  }, [notice]);

  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const number = new Intl.NumberFormat(i18n.language);
  const nameOf = (id: string) => names?.get(id) ?? t('cityPolitics.unknownHouse');
  const inForce = decrees ? ratesInForce(decrees) : new Set<string>();
  const citizen = (houses.status ?? house.citizenshipStatus) === 'citizen';
  const share = (votes: number | null, decree: Decree) =>
    `${Math.round(((votes ?? 0) / Math.max(1, decree.electorate ?? 0)) * 100)}%`;
  const tally = (decree: Decree) =>
    decree.talliedAt === null
      ? null
      : t('assembly.tally', {
          for: number.format(decree.votesFor ?? 0),
          against: number.format(decree.votesAgainst ?? 0),
          electorate: number.format(decree.electorate ?? 0),
        });

  const icon = (model: string) =>
    model === 'market_tax_rate' ? (
      <Coins />
    ) : model === 'port_dues' ? (
      <Ship />
    ) : model === 'festival' ? (
      <PartyPopper />
    ) : (
      <Hammer />
    );
  // Une carte par décret : son modèle illustré, ce qu'il dit, puis ce que l'écran en sait.
  const card = (decree: Decree, children: ReactNode, open = false) => (
    <li key={decree.id}>
      {/* Même fond que les autres cartes de la Cité (#869) ; un décret au vote se distingue par sa bordure. */}
      <Card className={cn('flex h-full gap-3 break-words', open && 'border-primary/40')}>
        <span aria-hidden="true" className={ICON}>
          {icon(decree.model)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="font-semibold">{describe(decree.proposal, decree.model)}</p>
          {children}
        </div>
      </Card>
    </li>
  );
  // Décompte dépouillé : la barre (pour, contre, sur les citoyens) double le texte.
  const counted = (decree: Decree) =>
    decree.talliedAt !== null && (
      <>
        <span aria-hidden="true" className="flex h-1.5 overflow-hidden rounded-full bg-muted">
          <span className="bg-primary" style={{ width: share(decree.votesFor, decree) }} />
          <span
            className="bg-muted-foreground"
            style={{ width: share(decree.votesAgainst, decree) }}
          />
        </span>
        <p className="text-sm text-muted-foreground">{tally(decree)}</p>
      </>
    );

  return (
    <section className="flex flex-col gap-4">
      <h2 ref={title} tabIndex={-1} className={`${PANEL_TITLE} ${TITLE}`}>
        <Gavel aria-hidden="true" />
        {t('assembly.title')}
      </h2>
      {loading && <Loading />}
      {failed && <LoadProblem heading={title} onRetry={reload} />}
      {groups && voted && names && (
        <>
          <h3 className="eyebrow">{t('assembly.open')}</h3>
          {!citizen && (
            <p className="flex items-start gap-2 rounded-lg bg-info-subtle p-3 text-sm">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
              {t('assembly.meticNotice')}
            </p>
          )}
          {groups.open.length === 0 && (
            <EmptyState compact illustration="noEvent" title={t('assembly.noOpen')} />
          )}
          <ul className={GRID}>
            {groups.open.map((decree) => {
              const what = describe(decree.proposal, decree.model);
              return card(
                decree,
                <>
                  <p className="text-sm text-muted-foreground">
                    {t('assembly.proposed', {
                      house: nameOf(decree.proposedBy),
                      closes: date.format(decree.votingClosesAt),
                    })}
                  </p>
                  {citizen && voted.has(decree.id) && (
                    <p className="flex items-center gap-2 text-sm">
                      <Check aria-hidden="true" className="size-4 shrink-0 text-success" />
                      {t('assembly.alreadyVoted')}
                    </p>
                  )}
                  {citizen && !voted.has(decree.id) && (
                    <div className="mt-1 flex flex-wrap gap-2 *:flex-1 *:basis-24">
                      {([true, false] as const).map((approve) => (
                        <Button
                          key={String(approve)}
                          variant={approve ? 'primary' : 'secondary'}
                          icon={approve ? <Check /> : <X />}
                          className={WAITING}
                          aria-disabled={busy}
                          aria-label={t(approve ? 'assembly.approveFor' : 'assembly.rejectFor', {
                            decree: what,
                          })}
                          onClick={() => void vote(decree.id, approve)}
                        >
                          {t(approve ? 'assembly.approve' : 'assembly.reject')}
                        </Button>
                      ))}
                    </div>
                  )}
                </>,
                true,
              );
            })}
          </ul>
          <p
            ref={noticeElement}
            tabIndex={-1}
            role={notice?.kind ?? 'status'}
            className={noticeClass(notice?.kind)}
          >
            {notice?.text ?? ''}
          </p>
          <DecreeForm onDone={reload} />
          <h3 className="eyebrow mt-2">{t('assembly.passed')}</h3>
          {groups.passed.length === 0 && (
            <EmptyState compact illustration="noEvent" title={t('assembly.noPassed')} />
          )}
          <ul className={GRID}>
            {groups.passed.map((decree) =>
              card(
                decree,
                <>
                  <p className="text-sm">
                    {decree.appliedAt === null
                      ? t('assembly.status.adopted')
                      : t(
                          inForce.has(decree.id)
                            ? 'assembly.status.inForce'
                            : 'assembly.status.applied',
                          {
                            at: date.format(decree.appliedAt),
                          },
                        )}
                  </p>
                  {counted(decree)}
                </>,
              ),
            )}
          </ul>
          {groups.other.length > 0 && (
            <>
              <h3 className="eyebrow mt-2">{t('assembly.other')}</h3>
              <ul className={GRID}>
                {groups.other.map((decree) =>
                  card(
                    decree,
                    <>
                      <p className="text-sm">{t(`assembly.status.${decree.status}`)}</p>
                      {counted(decree)}
                    </>,
                  ),
                )}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
