import { PageHeader, type PageHeaderProps } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import { formatTime, useGameTime } from './game-time';

/** En-tête de page du jeu : `PageHeader`, avec l'heure de jeu en sous-titre. */
export function ScreenHeader(props: Omit<PageHeaderProps, 'subtitle'>) {
  const { t, i18n } = useTranslation();
  const now = useGameTime();
  return (
    <PageHeader
      {...props}
      subtitle={t('shell.clock.now', { time: formatTime(i18n.language, now) })}
    />
  );
}
