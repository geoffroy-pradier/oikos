import { Card } from '@oikos/ui';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useRows } from '../data';
import { useHouse } from '../house';
import { parseSiteStaff } from '../site-rules';
import { houseAlerts } from '../property-alerts';
import { parseLeases, parseMyProperties, parsePropertyRules } from '../property';
import { serverClock } from '../server-clock';

/**
 * Alertes du tableau de bord (#259) : travailleurs sans logement, bien à rénover ou dont l'entretien est
 * impayé, bail résilié. Rien à signaler, ou une lecture qui n'aboutit pas : la carte se tait, les écrans
 * Personnel et Immobilier disent le détail.
 */
export function HouseAlerts() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const staffRows = useRows<unknown>(
    'my_workforce',
    'site_id, workers, housed, unhoused',
    'site_id',
  );
  const rulesRows = useRows<unknown>('property_rules', 'properties', 'properties');
  const mineRows = useRows<unknown>(
    'my_properties',
    'id, city_id, size_id, lot, condition, upkeep_unpaid_since',
    'lot',
  );
  const leaseRows = useRows<unknown>(
    'my_leases',
    'id, property_id, city_id, size_id, lot, tenant_house_id, rent_oboles, end_requested_at, ended_at, end_reason',
    'started_at',
  );
  const sizes = rulesRows.rows ? parsePropertyRules(rulesRows.rows[0] ?? null) : null;
  const properties = mineRows.rows ? parseMyProperties(mineRows.rows) : null;
  const leases = leaseRows.rows ? parseLeases(leaseRows.rows, house.id) : null;
  const staff = staffRows.rows ? [...parseSiteStaff(staffRows.rows).values()] : null;
  const alerts =
    sizes && properties && leases && staff
      ? houseAlerts({
          unhoused: staff.reduce((sum, site) => sum + site.unhoused, 0),
          properties,
          sizes,
          leases,
          now: serverClock.now().getTime(),
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
