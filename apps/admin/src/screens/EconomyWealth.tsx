import type { AdminEconomy } from '@oikos/contracts';
import { Card, DataTable, type SortDirection, StatCard, StatGrid, Users } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import { SectionTitle } from './SectionTitle';

type Inequality = AdminEconomy['worlds'][number]['inequality'];
type City = Inequality['cities'][number];

/**
 * Inégalité des fortunes d'un monde (15.1 ; 4.1, 5.5 ; #718) : Gini du monde et de ses maisons comptées, puis le
 * tableau triable des cités. Le coefficient est écrit de 0 (fortunes égales) à 1 ; sans maison, il est dit
 * inconnu, jamais nul. Les stocks sans prix observé, que les fortunes ignorent, sont comptés à côté.
 */
export function WealthInequality({ inequality, slug }: { inequality: Inequality; slug: string }) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  // Points de base rendus en coefficient : 10 000 font 1, toujours deux décimales, au plus quatre.
  const coefficient = new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  const gini = (bps: number | null) =>
    bps === null ? t('economy.wealth.unknown') : coefficient.format(bps / 10_000);
  const sorted = (header: string, direction: SortDirection) =>
    t('app.sorted', { column: header, direction: t(`app.${direction}`) });
  const caption = t('economy.wealth.byCity', { slug });
  return (
    <Card className="flex flex-col gap-4 lg:p-5">
      <SectionTitle as="h3" icon={<Users />}>
        {t('economy.wealth.title')}
      </SectionTitle>
      <StatGrid as="dl">
        {[
          [t('economy.wealth.gini'), gini(inequality.giniBps)],
          [t('economy.wealth.houses'), number.format(inequality.houses)],
          [t('economy.wealth.unpriced'), number.format(inequality.unpricedStocks)],
        ].map(([label, value]) => (
          <StatCard key={label} definition dense label={label} value={value} />
        ))}
      </StatGrid>
      <p className="text-sm text-foreground-secondary">{t('economy.wealth.definition')}</p>
      {inequality.cities.length > 0 && (
        <DataTable
          caption={caption}
          rows={inequality.cities}
          rowKey={(city) => city.cityId}
          locale={i18n.language}
          defaultSort={{ column: 'city', direction: 'ascending' }}
          sortAnnouncement={sorted}
          columns={[
            {
              id: 'city',
              header: t('economy.wealth.city'),
              cell: (city) => city.slug,
              sortValue: (city) => city.slug,
            },
            {
              id: 'gini',
              header: t('economy.wealth.giniShort'),
              numeric: true,
              cell: (city) => gini(city.giniBps),
              sortValue: (city) => city.giniBps,
            },
            ...(['houses', 'unpricedStocks'] as const).map((part) => ({
              id: part,
              header: t(`economy.wealth.${part === 'houses' ? 'houses' : 'unpriced'}`),
              numeric: true,
              cell: (city: City) => number.format(city[part]),
              sortValue: (city: City) => city[part],
            })),
          ]}
        />
      )}
    </Card>
  );
}
