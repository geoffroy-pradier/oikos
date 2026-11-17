import type { WorldEventModel } from '@oikos/config';
import { createRng } from '@oikos/sim';
import goodsEn from '../chronicle/locales/en.json' with { type: 'json' };
import goodsFr from '../chronicle/locales/fr.json' with { type: 'json' };
import { CHRONICLE_LOCALES, type ChronicleLocale, type ChronicleTexts } from '../chronicle/compose';
import en from './locales/en.json' with { type: 'json' };
import fr from './locales/fr.json' with { type: 'json' };

/**
 * Oracles de repli de la Pythie (règle 6, 7.3, 8.4 ; #270) : écrits à la main, plusieurs par modèle d'événement, en
 * `fr` et en `en`, rangés dans le même ordre dans les deux langues. L'oracle d'un événement est l'un d'eux, choisi
 * par la graine de l'événement ; c'est lui que lit un joueur quand l'IA est coupée ou que sa réécriture est rejetée.
 * Il ne dit que la nature de l'événement, et le bien d'une caravane : ni cité, ni jour, ni ampleur, ni chiffre.
 */
export const ORACLE_LOCALES = CHRONICLE_LOCALES;
export type OracleTexts = ChronicleTexts;

const ORACLES: Record<ChronicleLocale, Record<WorldEventModel, readonly string[]>> = { fr, en };
const GOODS: Record<ChronicleLocale, Record<string, string>> = {
  fr: goodsFr.goods,
  en: goodsEn.goods,
};

/** Ce dont dépend l'oracle de repli d'un événement : son modèle, son bien (caravane) et sa graine. */
export interface OracleSubject {
  model: WorldEventModel;
  goodId: string | null;
  /** Graine de l'événement (celle de son jour, `world_events.seed`). */
  seed: string;
}

/** Oracles de repli d'un modèle, dans une langue. */
export function fallbackOracles(
  locale: ChronicleLocale,
  model: WorldEventModel,
): readonly string[] {
  return ORACLES[locale][model];
}

/**
 * Rang de l'oracle de repli d'un événement parmi ceux de son modèle : tiré uniformément par un générateur propre
 * à la graine et au modèle, si bien que deux événements d'un même jour n'ont pas forcément le même oracle.
 */
export function oracleVariant(subject: OracleSubject): number {
  const count = Math.min(...ORACLE_LOCALES.map((locale) => ORACLES[locale][subject.model].length));
  return createRng(`${subject.seed}:${subject.model}:oracle`).int(0, count - 1);
}

/** Bien d'une caravane dit par son nom ; un bien sans traduction, par son identifiant. */
export const goodName = (locale: ChronicleLocale, goodId: string) =>
  Object.hasOwn(GOODS[locale], goodId) ? (GOODS[locale][goodId] ?? goodId) : goodId;

/** Oracle de repli d'un événement, dans les deux langues, au même rang. */
export function fallbackOracle(subject: OracleSubject): OracleTexts {
  const variant = oracleVariant(subject);
  const text = (locale: ChronicleLocale) => {
    const template = ORACLES[locale][subject.model][variant];
    if (template === undefined) throw new Error(`Missing oracle ${locale}:${subject.model}`);
    return template.replace(/\{\{good\}\}/g, () => goodName(locale, subject.goodId ?? ''));
  };
  return { fr: text('fr'), en: text('en') };
}
