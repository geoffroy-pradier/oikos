import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import { formatMoney, formatOboles } from './money';
import en from './locales/en.json';
import fr from './locales/fr.json';

async function translator(language: 'fr' | 'en') {
  const instance = i18next.createInstance();
  await instance.init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng: language,
    interpolation: { escapeValue: false },
  });
  return instance.t;
}

describe('montants en oboles', () => {
  it('accorde l’unité au nombre en français : zéro et un au singulier', async () => {
    const t = await translator('fr');
    expect(formatOboles(0, t, 'fr')).toBe('0 obole');
    expect(formatOboles(1, t, 'fr')).toBe('1 obole');
    expect(formatOboles(2, t, 'fr')).toBe('2 oboles');
    expect(formatOboles(3000, t, 'fr')).toBe(`${new Intl.NumberFormat('fr').format(3000)} oboles`);
  });

  it('accorde l’unité au nombre en anglais : un seul singulier', async () => {
    const t = await translator('en');
    expect(formatOboles(0, t, 'en')).toBe('0 obols');
    expect(formatOboles(1, t, 'en')).toBe('1 obol');
    expect(formatOboles(1500, t, 'en')).toBe('1,500 obols');
  });

  it('les textes qui reçoivent un montant ne répètent pas l’unité', async () => {
    const t = await translator('fr');
    const text = t('agora.placedBuy', {
      quantity: '1',
      good: 'Blé',
      price: formatMoney(1, t, 'fr'),
      held: formatMoney(7, t, 'fr'),
    });
    expect(text).toBe(
      "Achat en attente : 1 × Blé à 1 obole. Le séquestre retient 1 drachme 1 obole jusqu'à l'exécution ou l'annulation.",
    );
  });
});
