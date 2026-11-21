import {
  Badge,
  Card,
  CalendarClock,
  Check,
  Coins,
  EmptyState,
  Hourglass,
  Landmark,
  Percent,
  StatCard,
  TriangleAlert,
  type Icon,
} from '@oikos/ui';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useRows } from '../data';
import { useGameTime } from '../game-time';
import { useHouse } from '../house';
import { HouseNav } from '../HouseNav';
import { LOAN_COLUMNS, parseHouseHonor, parseMyLoans, type MyLoan } from '../loans';
import { useMoney } from '../money';
import { ScreenHeader } from '../ScreenHeader';
import { LoadProblem, Loading } from './LoadProblem';
import { SectionTitle } from './SectionTitle';

/** Jours de jeu : un jour de jeu dure vingt-quatre heures, de clôture à clôture (conversion d'unité, pas d'équilibrage). */
const DAY_MS = 86_400_000;

type LoanState = 'active' | 'due' | 'defaulted';
/** Teinte et icône d'état : jamais la couleur seule, le texte dit l'état. */
const STATE: Record<LoanState, { tone: 'primary' | 'warning' | 'danger'; icon: Icon }> = {
  active: { tone: 'primary', icon: Check },
  due: { tone: 'warning', icon: Hourglass },
  defaulted: { tone: 'danger', icon: TriangleAlert },
};

/** État à un instant : un prêt non soldé est échu dès son échéance, en attendant que la clôture le prélève. */
const stateOf = (loan: MyLoan, now: number): LoanState =>
  loan.status === 'defaulted' ? 'defaulted' : now >= loan.dueAt ? 'due' : 'active';

/**
 * Finances de la maison (5.4, 10) : dettes en cours (prêteur, reste dû, échéance, intérêts) et marque de déshonneur,
 * lues pour sa seule maison. Une lecture en échec ou illisible est annoncée et se réessaie : jamais prise pour « aucune
 * dette ». Le remboursement et l'emprunt se font en feuille, depuis cet écran.
 */
export function FinancesScreen() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const money = useMoney();
  const now = useGameTime().getTime();
  const title = useRef<HTMLHeadingElement>(null);
  const mine = { house_id: house.id };
  const loanRows = useRows<unknown>('my_loans', LOAN_COLUMNS, 'due_at', mine);
  const honorRows = useRows<unknown>(
    'house_honor',
    'honor, dishonored, dishonored_until_day',
    'house_id',
    mine,
  );
  const reads = [loanRows, honorRows];
  const loans = loanRows.rows === null ? null : parseMyLoans(loanRows.rows);
  const honor = honorRows.rows === null ? null : parseHouseHonor(honorRows.rows);
  const loading = reads.some((read) => read.rows === null && !read.failed);
  const failed =
    reads.some((read) => read.failed) || (!loading && (loans === null || honor === null));
  const reload = () => Promise.all(reads.map((read) => read.reload()));
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 2,
  });
  const dishonor = honor?.dishonor;

  return (
    <div className="flex flex-col gap-4 [overflow-wrap:anywhere]">
      <ScreenHeader title={t('finances.title')} />
      <HouseNav />
      <p className="text-muted-foreground">{t('finances.intro')}</p>
      {dishonor?.dishonored && (
        <Card className="flex items-start gap-3 border-danger/50">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-danger" />
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold">{t('finances.dishonor.title')}</h2>
            <p className="text-sm">
              {dishonor.untilDay === null
                ? t('finances.dishonor.open')
                : t('finances.dishonor.until', {
                    // Le premier jour sans marque, en jour de jeu depuis l'époque : une date de calendrier.
                    date: new Intl.DateTimeFormat(i18n.language, {
                      dateStyle: 'long',
                      timeZone: 'UTC',
                    }).format(new Date(dishonor.untilDay * DAY_MS)),
                  })}
            </p>
          </div>
        </Card>
      )}
      <Card className="flex flex-col gap-4">
        <SectionTitle ref={title} tabIndex={-1} icon={<Coins />}>
          {t('finances.debts.title')}
        </SectionTitle>
        {loading && <Loading />}
        {failed && <LoadProblem heading={title} onRetry={reload} />}
        {!loading && !failed && loans?.length === 0 && (
          <EmptyState compact illustration="noEvent" title={t('finances.debts.empty')} />
        )}
        {!failed && loans && loans.length > 0 && (
          <ul className="flex flex-col gap-4">
            {loans.map((loan) => {
              const state = stateOf(loan, now);
              const StateIcon = STATE[state].icon;
              return (
                <li
                  key={loan.id}
                  data-loan={loan.id}
                  className="flex flex-col gap-3 rounded-xl border border-border-subtle p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 font-semibold">
                      <Landmark aria-hidden="true" className="size-5 text-accent" />
                      {t(`finances.debts.lender.${loan.lender}`)}
                    </h3>
                    <Badge tone={STATE[state].tone} icon={<StateIcon aria-hidden="true" />}>
                      {t(`finances.debts.state.${state}`)}
                    </Badge>
                  </div>
                  <dl className="grid gap-3 sm:grid-cols-3">
                    <StatCard
                      definition
                      label={t('finances.debts.outstanding')}
                      value={money(loan.outstanding)}
                      icon={<Coins />}
                    />
                    <StatCard
                      definition
                      label={t('finances.debts.dueAt')}
                      value={date.format(loan.dueAt)}
                      icon={<CalendarClock />}
                    />
                    <StatCard
                      definition
                      label={t('finances.debts.interest')}
                      value={money(loan.interestDue)}
                      icon={<Percent />}
                      hint={t('finances.debts.interestValue', {
                        total: money(loan.interest),
                        rate: percent.format(loan.rateBps / 10_000),
                      })}
                    />
                  </dl>
                  <p className="text-sm text-muted-foreground">
                    {t(`finances.debts.notes.${state}`)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
