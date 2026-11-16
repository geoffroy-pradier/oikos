import { Card } from '@oikos/ui';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useRows } from '../data';
import { useHouse } from '../house';
import { parseCityLabor } from '../labor';
import { houseAlerts, parseUnhoused } from '../property-alerts';
import { parseLeases, parseMyProperties, parsePropertyRules } from '../property';

/**
 * Alertes du tableau de bord (#259) : travailleurs sans logement, bien à rénover ou dont l'entretien est
 * impayé, bail résilié. Rien à signaler, ou une lecture qui n'aboutit pas : la carte se tait, les écrans
 * Personnel et Immobilier disent le détail.
 */
export function HouseAlerts() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const staffRows = useRows<unknown>('my_workforce', 'site_id, city_id, unhoused', 'site_id');
  // Les cités du monde de la maison seulement : la dernière clôture est celle de son monde.
  const laborRows = useRows<unknown>(
    'labor_market',
    'city_id, game_day, supply, employed, unhoused, wage_oboles, lodging_oboles',
    'city_id',
    { city_id: Object.keys(house.cityNames) },
  );
  const rulesRows = useRows<unknown>('property_rules', 'properties', 'properties');
  const mineRows = useRows<unknown>(
    'my_properties',
    'id, city_id, size_id, lot, condition, upkeep_unpaid_since',
    'lot',
  );
  const leaseRows = useRows<unknown>(
    'my_leases',
    'id, property_id, city_id, size_id, lot, tenant_house_id, rent_oboles, end_requested_at, ended_at, ended_day, end_reason',
    'started_at',
  );
  const sizes = rulesRows.rows ? parsePropertyRules(rulesRows.rows[0] ?? null) : null;
  const properties = mineRows.rows ? parseMyProperties(mineRows.rows) : null;
  const leases = leaseRows.rows ? parseLeases(leaseRows.rows, house.id) : null;
  const labor = laborRows.rows ? parseCityLabor(laborRows.rows) : null;
  // Sans logement là seulement où l'hébergement coûte : à 0 obole, rien à signaler.
  const staff = staffRows.rows && labor ? parseUnhoused(staffRows.rows, labor) : null;
  const alerts =
    sizes && properties && leases && labor && staff !== null
      ? houseAlerts({
          unhoused: staff,
          properties,
          sizes,
          leases,
          lastCloseDay: Math.max(...[...labor.values()].map((city) => city.gameDay), -1),
        })
      : [];
  if (alerts.length === 0) return null;
  const number = new Intl.NumberFormat(i18n.language);
  const describe = (property: { sizeId: string; lot: number; cityId: string }) =>
    t('property.describe', {
      size: t(`propertySizes.${property.sizeId}`, { defaultValue: property.sizeId }),
      lot: number.format(property.lot),
      city: house.cityNames[property.cityId] ?? property.cityId,
    });
  const LINK = 'underline underline-offset-4';

  return (
    <Card className="flex flex-col gap-2">
      <h2 className="text-xl">{t('alerts.title')}</h2>
      <ul className="flex flex-col gap-2">
        {alerts.map((alert) => {
          const key =
            alert.kind === 'unhoused'
              ? alert.kind
              : `${alert.kind}:${'lease' in alert ? alert.lease.id : alert.property.id}`;
          return (
            <li key={key} className="font-semibold text-danger">
              {alert.kind === 'unhoused'
                ? t('alerts.unhoused', {
                    count: alert.workers,
                    number: number.format(alert.workers),
                  })
                : t(`alerts.${alert.kind}`, {
                    property: describe('lease' in alert ? alert.lease : alert.property),
                  })}{' '}
              <Link to={alert.kind === 'unhoused' ? '/personnel' : '/immobilier'} className={LINK}>
                {t(alert.kind === 'unhoused' ? 'alerts.toStaff' : 'alerts.toProperty')}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
