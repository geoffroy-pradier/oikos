import { OBOLS_PER_DRACHMA } from '@oikos/config/schema';
import type { TFunction } from 'i18next';

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
  const part = (unit: 'drachmas' | 'obols', count: number) =>
    t(`money.${unit}`, { count, amount: number.format(count) });
  const parts = [
    ...(drachmas > 0 ? [part('drachmas', drachmas)] : []),
    ...(obols > 0 || drachmas === 0 ? [part('obols', obols)] : []),
  ].join(' ');
  return negative ? t('money.negative', { amount: parts }) : parts;
}
