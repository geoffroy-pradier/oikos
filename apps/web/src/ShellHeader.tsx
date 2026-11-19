import { Button, Settings, Skeleton } from '@oikos/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Blazon } from './Blazon';
import { useRows } from './data';
import { useHouse } from './house';
import { LanguageSelect } from './LanguageSelect';
import { useMoney } from './money';

interface Props {
  dark: boolean;
  onToggleTheme: () => void;
  onSignOut: () => void;
}

/** En-tête de la coquille : maison (nom, blason, cité), trésorerie et accès aux réglages. */
export function ShellHeader({ dark, onToggleTheme, onSignOut }: Props) {
  const { t } = useTranslation();
  const house = useHouse();
  const money = useMoney();
  const treasury = useRows<{ balance: number }>('my_treasury', 'balance', 'house_id');
  const balance = treasury.rows?.[0]?.balance;
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Échap referme le panneau et rend le foyer au bouton ; un clic ailleurs le referme aussi.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggle.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !toggle.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

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
      <div className="order-2 sm:order-none">
        <LanguageSelect />
      </div>
      <Button
        ref={toggle}
        variant="secondary"
        icon={<Settings aria-hidden="true" />}
        aria-expanded={open}
        aria-controls="shell-settings"
        onClick={() => setOpen(!open)}
      >
        {/* Sur téléphone, l'icône seule garde le nom accessible : l'en-tête tient en deux lignes. */}
        <span className="sr-only sm:not-sr-only">{t('shell.settings')}</span>
      </Button>
      {open && (
        <div
          ref={panel}
          id="shell-settings"
          role="group"
          aria-label={t('shell.settingsPanel')}
          className="absolute top-full right-4 z-30 mt-2 flex w-64 animate-rise flex-col gap-2 rounded-xl border border-border-subtle bg-surface-raised p-3 shadow-lg"
        >
          <Button variant="secondary" aria-pressed={dark} onClick={onToggleTheme}>
            {t('shell.darkTheme')}
          </Button>
          <Button variant="ghost" onClick={onSignOut}>
            {t('app.signOut')}
          </Button>
        </div>
      )}
    </header>
  );
}
