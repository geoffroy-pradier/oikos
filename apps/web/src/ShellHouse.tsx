import { IconButton, Settings, Skeleton } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import { Blazon } from './Blazon';
import { useRows } from './data';
import { useGameTime } from './game-time';
import { useHouse } from './house';
import { useMoney } from './money';

/** Carte de la maison en tête de la barre latérale (ordinateur) : blason, nom, cité, statut et trésorerie. */
export function HouseCard() {
  const { t } = useTranslation();
  const house = useHouse();
  const money = useMoney();
  const treasury = useRows<{ balance: number }>('my_treasury', 'balance', 'house_id');
  const balance = treasury.rows?.[0]?.balance;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface-raised p-3 [overflow-wrap:anywhere]">
      <div className="flex items-center gap-3">
        {house.blazon && <Blazon blazon={house.blazon} />}
        <div className="min-w-0">
          <p className="leading-tight font-semibold">{t('shell.house', { name: house.name })}</p>
          <p className="text-sm text-muted-foreground">
            <span>{house.cityName}</span> · {t(`shell.status.${house.citizenshipStatus}`)}
          </p>
        </div>
      </div>
      {/* Libellé et montant dans un seul élément : le montant seul reste celui de l'écran Maison. */}
      <p className="flex flex-col font-semibold tabular-nums">
        <span className="eyebrow">{t('shell.balance')}</span>
        {balance !== undefined ? (
          money(balance)
        ) : treasury.failed || treasury.rows ? (
          // Lecture en échec ou sans ligne : un tiret plutôt qu'un chargement sans fin ; l'écran Maison le dit.
          <span aria-hidden="true">—</span>
        ) : (
          <Skeleton className="mt-1 h-5 w-24" />
        )}
      </p>
    </div>
  );
}

/** En-tête compact du téléphone : blason, nom, cité et heure de jeu, bouton Réglages. */
export function CompactHeader({
  settingsOpen,
  onSettings,
}: {
  settingsOpen: boolean;
  onSettings: () => void;
}) {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const now = useGameTime();
  const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' });
  return (
    <header className="flex items-center gap-3 border-b border-border-subtle bg-surface px-4 py-2 lg:hidden">
      {house.blazon && <Blazon blazon={house.blazon} className="size-9" />}
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <p className="leading-tight font-semibold">{t('shell.house', { name: house.name })}</p>
        <p className="text-sm text-muted-foreground">
          {house.cityName} · <time dateTime={now.toISOString()}>{time.format(now)}</time>
        </p>
      </div>
      {/* Icône seule, même nom accessible que le bouton de la barre latérale. */}
      <IconButton
        icon={<Settings />}
        label={t('shell.settings')}
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        onClick={onSettings}
        className="size-11"
      />
    </header>
  );
}
