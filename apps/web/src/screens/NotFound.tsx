import { Card } from '@oikos/ui';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export function NotFound() {
  const { t } = useTranslation();
  return (
    <Card>
      <h1 className="text-2xl">{t('shell.notFound')}</h1>
      <Link to="/" className="font-semibold text-primary underline underline-offset-4">
        {t('shell.backHome')}
      </Link>
    </Card>
  );
}
