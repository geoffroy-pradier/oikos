import { Card, Select, Store } from '@oikos/ui';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { describeCity, type CityIdentity } from '../city-identity';
import { useRows } from '../data';
import { useMoney } from '../money';
import { parseCityPopulation } from '../population';

interface Observed {
  good_id: string;
  price: number;
  volume: number;
}

/**
 * Panneau de la cité choisie sur la carte (#696) : population, taxe de marché en vigueur, les cours des
 * biens les plus échangés, terroir et dieu protecteur, et le lien vers son agora (ou celle de la maison). Une valeur pas encore
 * lue, ou illisible, s'écrit « — » : jamais un chiffre inventé.
 */
export function CityPanel(props: {
  cityIds: readonly string[];
  cityId: string;
  onChange: (cityId: string) => void;
  cityName: (cityId: string) => string;
  identity: CityIdentity | undefined;
  homeId: string; // cité de la maison
}) {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const { cityId } = props;
  const number = new Intl.NumberFormat(i18n.language);
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 2,
  });
  const people = useRows<unknown>(
    'city_population',
    'class_id, population, coverage_bps',
    'class_id',
    {
      city_id: cityId,
    },
  );
  // Aucune ligne : population pas encore mesurée, dite inconnue plutôt que nulle.
  const population = people.rows?.length ? parseCityPopulation(people.rows) : null;
  const rate = useRows<{ market_tax_rate_bps: number }>(
    'city_rates',
    'market_tax_rate_bps',
    'city_id',
    {
      city_id: cityId,
    },
  );
  const tax = rate.rows?.[0]?.market_tax_rate_bps;
  const prices = useRows<Observed>('observed_prices', 'good_id, price, volume', 'good_id', {
    city_id: cityId,
  });
  // Les trois biens les plus échangés dans la fenêtre du dernier calcul.
  const quotes = [...(prices.rows ?? [])].sort((a, b) => b.volume - a.volume).slice(0, 3);
  // L'agora ne propose que la cité de la maison et celles où elle a un stock ou un site (comme `Agora`) :
  // pour une autre cité, le lien mène à celle de la maison, et le panneau le dit.
  const stocks = useRows<{ city_id: string }>('my_inventories', 'city_id', 'city_id');
  const sites = useRows<{ city_id: string }>('my_sites', 'city_id', 'id');
  const offered =
    cityId === props.homeId ||
    stocks.rows === null ||
    sites.rows === null ||
    [...stocks.rows, ...sites.rows].some((row) => row.city_id === cityId);
  const agoraCity = offered ? cityId : props.homeId;
  const lines = props.identity && describeCity(props.identity, t, i18n.language);
  const tile = (label: string, value: string) => (
    <div key={label} className="rounded-xl bg-surface-raised p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-bold tabular-nums">{value}</dd>
    </div>
  );

  return (
    <Card className="flex flex-col gap-3">
      <Select
        label={t('map.city.choose')}
        value={cityId}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.cityIds.map((id) => (
          <option key={id} value={id}>
            {props.cityName(id)}
          </option>
        ))}
      </Select>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-lg font-bold">{props.cityName(cityId)}</h2>
        {lines && <p className="text-xs text-muted-foreground">{lines.god}</p>}
      </div>
      <dl className="grid grid-cols-2 gap-2.5">
        {tile(t('map.city.population'), population ? number.format(population.total) : '—')}
        {tile(t('map.city.tax'), tax === undefined ? '—' : percent.format(tax / 10_000))}
        {quotes.map((quote) =>
          tile(
            t('map.city.price', {
              good: t(`goods.${quote.good_id}`, { defaultValue: quote.good_id }),
            }),
            money(quote.price),
          ),
        )}
      </dl>
      {prices.rows?.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('map.city.noPrices')}</p>
      )}
      {lines && <p className="text-sm text-muted-foreground">{lines.terroir}</p>}
      {!offered && (
        <p className="text-sm text-muted-foreground">
          {t('map.city.notAtAgora', { city: props.cityName(cityId) })}
        </p>
      )}
      <Link
        to="/agora"
        search={{ cite: agoraCity }}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-surface-raised px-4 font-medium shadow-sm hover:bg-muted [&_svg]:size-[1.15em]"
      >
        <Store aria-hidden="true" />
        {t('map.city.agora', { city: props.cityName(agoraCity) })}
      </Link>
    </Card>
  );
}
