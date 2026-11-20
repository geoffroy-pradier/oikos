import { PageHeader, type PageHeaderProps } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import { nextClose } from './clock-rules';
import { useClockRules } from './data';
import { formatTime, useGameTime } from './game-time';

/**
 * En-tête de page du jeu : `PageHeader`, avec l'heure de jeu et la prochaine clôture quotidienne en sous-titre.
 * Horloge du monde inconnue (lecture en échec, fuseau illisible) : l'heure seule, l'écran reste utilisable.
 */
export function ScreenHeader(props: Omit<PageHeaderProps, 'subtitle'>) {
  const { t, i18n } = useTranslation();
  const now = useGameTime();
  const close = nextClose(now, useClockRules().rules?.clock);
  const time = formatTime(i18n.language, now);
  return (
    <PageHeader
      {...props}
      subtitle={
        close
          ? t('shell.clock.withClose', { time, close: formatTime(i18n.language, close) })
          : t('shell.clock.now', { time })
      }
    />
  );
}
