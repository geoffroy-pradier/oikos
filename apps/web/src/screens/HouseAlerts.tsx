import {
  Card,
  ChevronRight,
  cn,
  Coins,
  Hammer,
  type Icon,
  KeyRound,
  ListTodo,
  Users,
} from '@oikos/ui';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { SectionTitle } from './SectionTitle';
import { useRows } from '../data';
import { useHouse } from '../house';
import { parseCityLabor } from '../labor';
import { houseAlerts, parseUnhoused, type HouseAlert } from '../property-alerts';
import { parseLeases, parseMyProperties, parsePropertyRules } from '../property';

/** Icône et teinte de chaque alerte : un défaut de paiement en danger, un bien à rénover en alerte. */
const KINDS: Record<HouseAlert['kind'], { icon: Icon; tone: string }> = {
  unhoused: { icon: Users, tone: 'bg-danger-subtle text-danger' },
  renovate: { icon: Hammer, tone: 'bg-warning-subtle text-warning' },
  unpaid: { icon: Coins, tone: 'bg-danger-subtle text-danger' },
  leaseTerminated: { icon: KeyRound, tone: 'bg-danger-subtle text-danger' },
};

/**
 * Alertes du tableau de bord (#259) : travailleurs sans logement, bien à rénover ou dont l'entretien est
 * impayé, bail résilié. Rien à signaler, ou une lecture qui n'aboutit pas : la carte se tait, les écrans
 * Personnel et Immobilier disent le détail. Carte « À faire aujourd'hui » (#693) : une ligne par alerte, chacune un
 * lien vers l'écran où y répondre.
 */
export function HouseAlerts({ className }: { className?: string }) {
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

  return (
    <Card data-todo className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <SectionTitle icon={<ListTodo />}>{t('alerts.title')}</SectionTitle>
        <span
          aria-hidden="true"
          className="min-w-6 rounded-full bg-primary-subtle px-2 text-center text-xs leading-6 font-semibold text-primary tabular-nums"
        >
          {number.format(alerts.length)}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {alerts.map((alert) => {
          const key =
            alert.kind === 'unhoused'
              ? alert.kind
              : `${alert.kind}:${'lease' in alert ? alert.lease.id : alert.property.id}`;
          const { icon: AlertIcon, tone } = KINDS[alert.kind];
          return (
            <li key={key}>
              <Link
                to={alert.kind === 'unhoused' ? '/personnel' : '/immobilier'}
                className="flex items-center gap-3 rounded-xl bg-surface-raised p-3 transition-colors duration-(--motion-fast) hover:bg-muted"
              >
                <span
                  aria-hidden="true"
                  className={cn('grid size-9 shrink-0 place-items-center rounded-lg', tone)}
                >
                  <AlertIcon className="size-5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium">
                    {alert.kind === 'unhoused'
                      ? t('alerts.unhoused', {
                          count: alert.workers,
                          number: number.format(alert.workers),
                        })
                      : t(`alerts.${alert.kind}`, {
                          property: describe('lease' in alert ? alert.lease : alert.property),
                        })}
                  </span>{' '}
                  <span className="text-sm text-muted-foreground">
                    {t(alert.kind === 'unhoused' ? 'alerts.toStaff' : 'alerts.toProperty')}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
