import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

/**
 * Montant en oboles, écrit avec son unité accordée au nombre dans la langue de l'interface (« 0 obole »,
 * « 1 obole », « 2 oboles » ; « 1 obol », « 0 obols »). Les textes qui reçoivent ce montant ne portent
 * pas l'unité.
 */
export function formatOboles(t: TFunction, language: string, oboles: number): string {
  return t('money.oboles', {
    count: oboles,
    amount: new Intl.NumberFormat(language).format(oboles),
  });
}

export function useMoney() {
  const { t, i18n } = useTranslation();
  return (oboles: number) => formatOboles(t, i18n.language, oboles);
}
