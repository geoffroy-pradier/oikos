import { Button, Settings, Skeleton } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import { Blazon } from './Blazon';
import { useRows } from './data';
import { useHouse } from './house';
import { useMoney } from './money';

interface Props {
  settingsOpen: boolean;
  onSettings: () => void;
}

/** En-tête de la coquille : maison (nom, blason, cité), trésorerie et bouton des Réglages (`SettingsSheet`). */
export function ShellHeader({ settingsOpen, onSettings }: Props) {
  const { t } = useTranslation();
  const house = useHouse();
  const money = useMoney();
  const treasury = useRows<{ balance: number }>('my_treasury', 'balance', 'house_id');
  const balance = treasury.rows?.[0]?.balance;

  return (
    <header className="relative flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-subtle bg-surface px-4 py-3">
      <div className="flex min-w-0 flex-1 basis-40 items-center gap-3">
        {house.blazon && <Blazon blazon={house.blazon} />}
        <div className="min-w-0">
          <p className="truncate text-lg leading-tight font-semibold">
            {t('shell.house', { name: house.name })}
          </p>
          <p className="truncate text-sm text-muted-foreground">{house.cityName}</p>
        </div>
      </div>
      {/* Libellé et montant dans un seul élément : le montant seul reste celui de l'écran Maison. */}
      <p className="order-1 flex flex-col text-lg font-semibold tabular-nums sm:order-none">
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
      <Button
        variant="secondary"
        icon={<Settings aria-hidden="true" />}
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        onClick={onSettings}
      >
        {/* Sur téléphone, l'icône seule garde le nom accessible : l'en-tête tient en deux lignes. */}
        <span className="sr-only sm:not-sr-only">{t('shell.settings')}</span>
      </Button>
    </header>
  );
}
