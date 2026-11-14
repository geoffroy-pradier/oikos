import { OBOLS_PER_DRACHMA } from '@oikos/config/schema';
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

/**
 * Découpe un montant entier en oboles : son signe, puis des drachmes entières et un reste d'oboles
 * comptés sur sa valeur absolue. Aucun arrondi : `drachmas × 6 + obols` rend la valeur absolue exacte.
 */
export function splitObols(amount: number) {
  const absolute = Math.abs(amount);
  const obols = absolute % OBOLS_PER_DRACHMA;
  return { negative: amount < 0, drachmas: (absolute - obols) / OBOLS_PER_DRACHMA, obols };
}

/**
 * Écrit un montant en drachmes et oboles dans la langue donnée : « 1 drachme 1 obole ». Une part nulle
 * est tue, sauf un montant nul, écrit en oboles ; le signe porte sur tout le montant. Le montant est un
 * entier sûr, en oboles : les lectures le garantissent (`accounts.ts`).
 */
export function formatMoney(amount: number, t: TFunction, language: string): string {
  const { negative, drachmas, obols } = splitObols(amount);
  const number = new Intl.NumberFormat(language);
  const part = (unit: 'drachmas' | 'oboles', count: number) =>
    t(`money.${unit}`, { count, amount: number.format(count) });
  const parts = [
    ...(drachmas > 0 ? [part('drachmas', drachmas)] : []),
    ...(obols > 0 || drachmas === 0 ? [part('oboles', obols)] : []),
  ].join(' ');
  return negative ? t('money.negative', { amount: parts }) : parts;
}
