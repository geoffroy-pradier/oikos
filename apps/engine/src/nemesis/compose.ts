import { createHash } from 'node:crypto';
import type { NemesisModel } from '@oikos/config';
import { createRng } from '@oikos/sim';
import { CHRONICLE_LOCALES, type ChronicleLocale, type ChronicleTexts } from '../chronicle/compose';
import en from './locales/en.json' with { type: 'json' };
import fr from './locales/fr.json' with { type: 'json' };

/**
 * Présages de repli de Némésis (règle 6, 7.2 ; #735) : écrits à la main, plusieurs par modèle de sanction, en `fr` et en
 * `en`, rangés dans le même ordre dans les deux langues. Un présage dit à mots couverts ce qui menace, sans chiffre ni
 * jour ; c'est lui que le joueur lit, sans IA.
 */
const OMENS: Record<ChronicleLocale, Record<NemesisModel, readonly string[]>> = { fr, en };

/**
 * Graine d'un présage : SHA-256 de la graine du monde, de la maison et du jour, à sens unique (13) ; elle tire le modèle
 * de la sanction et le texte, et n'est pas enregistrée.
 */
export function omenSeed(worldSeed: string, houseId: string, gameDay: number): string {
  if (!Number.isSafeInteger(gameDay)) throw new RangeError(`Invalid game day ${gameDay}`);
  return createHash('sha256').update(`${worldSeed}:nemesis:${houseId}:${gameDay}`).digest('hex');
}

/** Présages de repli d'un modèle, dans une langue. */
export function fallbackOmens(locale: ChronicleLocale, model: NemesisModel): readonly string[] {
  return OMENS[locale][model];
}

/** Présage de repli d'une sanction, dans les deux langues, au même rang, tiré par la graine. */
export function fallbackOmen(model: NemesisModel, seed: string): ChronicleTexts {
  const count = Math.min(...CHRONICLE_LOCALES.map((locale) => OMENS[locale][model].length));
  const variant = createRng(`${seed}:${model}:omen`).int(0, count - 1);
  const text = (locale: ChronicleLocale) => {
    const omen = OMENS[locale][model][variant];
    if (omen === undefined) throw new Error(`Missing omen ${locale}:${model}`);
    return omen;
  };
  return { fr: text('fr'), en: text('en') };
}
