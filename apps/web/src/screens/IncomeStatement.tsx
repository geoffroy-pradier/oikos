import { Card, DataTable, EmptyState, ScrollText, Select, type DataColumn } from '@oikos/ui';
import { gameDayDate } from '@oikos/sim';
import { useTranslation } from 'react-i18next';
import { Help } from './Help';
import { INCOME_COLUMNS, type IncomeColumn, type IncomeRow } from '../accounts';
import { formatMoney } from '../money';
import { Loading } from './LoadProblem';

/** Ce que le joueur a choisi de lire : par jour ou par saison, et combien de périodes, les dernières. */
export interface IncomeView {
  grouping: 'day' | 'season';
  limit: number;
}
/** Choix du nombre de périodes lues : un confort de lecture, sous la limite de 1 000 lignes de l'API. */
const LIMITS = [7, 30, 90];
/** Soldes du compte, mis en avant parmi les montants. */
const TOTALS: readonly IncomeColumn[] = ['operating_result', 'non_operating', 'cash_change'];

/**
 * Un montant passe à la ligne entre ses parts (« 486 drachmes » puis « 4 oboles »), jamais entre un nombre et son
 * unité ; le texte reste celui du format unique des montants.
 */
function Amount({ text }: { text: string }) {
  const parts = text.match(/[−-]?[\d\u202f\u00a0.,]+ [^\d\s]+/g);
  if (!parts || parts.join(' ') !== text) return <>{text}</>;
  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 && ' '}
          <span className="whitespace-nowrap">{part}</span>
        </span>
      ))}
    </>
  );
}

/**
 * Compte de résultat de la maison (4.1), par jour de jeu ou par saison (`DataTable`) : tableau triable sur
 * ordinateur, qui tient à 1 440 px et défile dans sa carte en dessous, fiches sur téléphone, périodes les plus récentes d'abord. Une
 * période porte la date civile de son jour de jeu (ou de son premier au dernier jour), jamais un rang ; sans
 * horloge, elle est dite inconnue. `rows` : `undefined` tant que rien n'est lu, `null` après un échec,
 * annoncé par l'écran.
 */
export function IncomeStatement(props: {
  rows: IncomeRow[] | null | undefined;
  view: IncomeView;
  onView: (view: IncomeView) => void;
}) {
  const { rows, view, onView } = props;
  const { t, i18n } = useTranslation();
  const money = (amount: number) => formatMoney(amount, t, i18n.language);
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' });
  const period = (row: IncomeRow) =>
    row.firstDay === null || row.lastDay === null
      ? t('accounts.income.unknown')
      : dates.formatRange(gameDayDate(row.firstDay), gameDayDate(row.lastDay));
  const columns: DataColumn<IncomeRow>[] = [
    {
      id: 'period',
      header: t(`accounts.income.${view.grouping}`),
      cell: period,
      sortValue: (row) => row.firstDay,
    },
    ...INCOME_COLUMNS.map((column) => ({
      id: column,
      header: t(`accounts.income.${column}`),
      cell: (row: IncomeRow) => (
        <span className={TOTALS.includes(column) ? 'font-semibold' : undefined}>
          <Amount text={money(row[column])} />
        </span>
      ),
      sortValue: (row: IncomeRow) => row[column],
      numeric: true,
    })),
  ];

  return (
    // Douze colonnes : à 1 440 px la carte déborde sur les marges de l'écran, de quoi montrer toutes les colonnes.
    <Card className="flex flex-col gap-3 min-[90rem]:-mx-22" aria-labelledby="income-statement">
      <h2 id="income-statement" className="flex items-center gap-2 text-lg font-semibold">
        <ScrollText aria-hidden="true" className="size-5 shrink-0 text-accent" />
        {t('accounts.income.title')}
      </h2>
      <Help>{t('accounts.income.intro')}</Help>
      <div className="flex flex-wrap gap-3">
        <Select
          quiet
          label={t('accounts.income.groupBy')}
          value={view.grouping}
          onChange={(event) =>
            onView({ ...view, grouping: event.target.value as 'day' | 'season' })
          }
        >
          {(['day', 'season'] as const).map((grouping) => (
            <option key={grouping} value={grouping}>
              {t(`accounts.income.${grouping}`)}
            </option>
          ))}
        </Select>
        <Select
          quiet
          label={t('accounts.income.shown')}
          value={view.limit}
          onChange={(event) => onView({ ...view, limit: Number(event.target.value) })}
        >
          {LIMITS.map((limit) => (
            <option key={limit} value={limit}>
              {t('accounts.income.latest', { count: limit })}
            </option>
          ))}
        </Select>
      </div>
      {rows === undefined && <Loading />}
      {rows?.length === 0 && (
        <EmptyState illustration="noEntry" title={t('accounts.income.empty')} />
      )}
      {rows && rows.length > 0 && (
        // Plus étroit que ses colonnes, le tableau défile dans sa carte, avec un fondu sur le bord.
        <DataTable
          className="[&_tbody_td]:text-[0.8125rem] [&_tbody_th]:text-[0.8125rem]"
          caption={t('accounts.income.title')}
          columns={columns}
          rows={rows}
          rowKey={(row) => String(row.firstDay ?? 'unknown')}
          defaultSort={{ column: 'period', direction: 'descending' }}
          locale={i18n.language}
          sortAnnouncement={(column, direction) =>
            t(
              direction === 'ascending' ? 'accounts.sortedAscending' : 'accounts.sortedDescending',
              {
                column,
              },
            )
          }
        />
      )}
    </Card>
  );
}
