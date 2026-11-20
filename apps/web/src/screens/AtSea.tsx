import { Card, Progress } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import type { VoyageRow } from '../fleet';
import { formatList } from '../lists';
import { voyageProgress } from '../map-layout';

/**
 * « Vos navires en mer », à côté de la carte : chaque voyage en cours, sa route, sa cargaison, son
 * arrivée prévue et la part du trajet faite à l'heure du serveur. Le lien vers la fiche du navire est
 * dans la flotte, plus bas.
 */
export function AtSea(props: {
  voyages: readonly (VoyageRow & { name: string })[];
  cityName: (cityId: string) => string;
  now: Date;
}) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const percent = new Intl.NumberFormat(i18n.language, { style: 'percent' });
  const time = new Intl.DateTimeFormat(i18n.language, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t('map.atSeaTitle')}</h2>
      {props.voyages.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('map.noneAtSea')}</p>
      )}
      <ul className="flex flex-col divide-y divide-border-subtle">
        {props.voyages.map((voyage) => {
          const done = voyageProgress(voyage.departed_at, voyage.arrives_at, props.now);
          const cargo =
            voyage.cargo.length === 0
              ? t('ship.ballast')
              : formatList(
                  i18n.language,
                  voyage.cargo.map((line) =>
                    t('home.stack', {
                      quantity: number.format(line.quantity),
                      good: t(`goods.${line.goodId}`, { defaultValue: line.goodId }),
                    }),
                  ),
                );
          return (
            <li key={voyage.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
              <p className="flex flex-wrap justify-between gap-x-3 text-sm">
                <span className="font-semibold">{voyage.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {t('map.arrivesAt', { time: time.format(new Date(voyage.arrives_at)) })}
                </span>
              </p>
              <Progress
                label={
                  <span className="text-muted-foreground">
                    {t('map.atSeaRoute', {
                      route: t('ship.voyage', {
                        from: props.cityName(voyage.from_city_id),
                        to: props.cityName(voyage.to_city_id),
                      }),
                      cargo,
                    })}
                  </span>
                }
                value={Math.round(done * 100)}
                valueText={percent.format(done)}
              />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
