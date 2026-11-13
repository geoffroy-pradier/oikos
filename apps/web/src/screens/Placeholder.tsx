import { Card } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import type { TabId } from '../router';

/** Écran d'attente d'un onglet dont les écrans de jeu ne sont pas encore construits. */
export function Placeholder({ tab }: { tab: Exclude<TabId, 'house'> }) {
  const { t } = useTranslation();
  return (
    <Card>
      <h1 className="text-2xl">{t(`tabs.${tab}.label`)}</h1>
      <p>{t(`tabs.${tab}.summary`)}</p>
      <p className="text-muted-foreground">{t('shell.comingSoon')}</p>
    </Card>
  );
}
