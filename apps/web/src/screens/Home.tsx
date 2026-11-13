import { Card } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import { useHouse } from '../house';

export function HomeScreen() {
  const { t } = useTranslation();
  const house = useHouse();
  return (
    <Card>
      <h1 className="text-2xl">{t('home.title', { name: house.name })}</h1>
      <p className="text-muted-foreground">
        {t(`home.status.${house.citizenshipStatus}`, { city: house.cityName })}
      </p>
    </Card>
  );
}
