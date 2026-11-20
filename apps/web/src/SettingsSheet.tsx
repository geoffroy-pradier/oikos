import { LogOut, Moon, MonitorSmartphone, SegmentedControl, Sheet, Sun, Button } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import { LanguageSelect } from './LanguageSelect';
import { THEME_CHOICES, type ThemeChoice } from './preferences';

const THEME_ICONS = {
  light: <Sun aria-hidden="true" />,
  dark: <Moon aria-hidden="true" />,
  system: <MonitorSmartphone aria-hidden="true" />,
} as const;

interface Props {
  open: boolean;
  onClose: () => void;
  theme: ThemeChoice;
  onTheme: (choice: ThemeChoice) => void;
  onSignOut: () => void;
}

/**
 * Réglages du joueur, en feuille : thème (clair, sombre, celui de l'appareil), langue et déconnexion.
 * Échap, Fermer ou le voile la referment et rendent le foyer au bouton Réglages (`Sheet`).
 */
export function SettingsSheet({ open, onClose, theme, onTheme, onSignOut }: Props) {
  const { t } = useTranslation();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('shell.settings')}
      closeLabel={t('shell.close')}
      footer={
        <Button variant="secondary" icon={<LogOut aria-hidden="true" />} onClick={onSignOut}>
          {t('app.signOut')}
        </Button>
      }
    >
      <div className="flex flex-col gap-6 pt-2">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium" aria-hidden="true">
            {t('shell.theme')}
          </p>
          <SegmentedControl
            label={t('shell.theme')}
            value={theme}
            onValueChange={(value) => onTheme(value as ThemeChoice)}
            options={THEME_CHOICES.map((choice) => ({
              value: choice,
              label: t(`shell.themes.${choice}`),
              icon: THEME_ICONS[choice],
            }))}
          />
        </div>
        <LanguageSelect field />
      </div>
    </Sheet>
  );
}
