import type { AiRequest, AiResult } from '@oikos/ai';
import { OBOLS_PER_DRACHMA, type GameConfig } from '@oikos/config';
import {
  stewardRulesSchema,
  type StewardProposalRefusal,
  type StewardRule,
} from '@oikos/contracts';
import { z } from 'zod';
import { goodName } from '../oracle/compose';

/**
 * Traduction d'une consigne d'intendant par la passerelle IA (usage `steward`, 4.4, 8.1, 8.4, ADR 0005 ; #280). Le
 * modèle reçoit comme données le texte du joueur, les biens de la configuration et la recette du site, jamais dans
 * les consignes ; il rend des règles de la grammaire fermée, ou un refus. Règle 6 : il ne décide d'aucun nombre. Il
 * recopie chaque prix avec l'unité écrite par le joueur, que le code confronte au texte (`readNumbers`) puis convertit
 * en oboles, et chaque quantité doit être écrite en chiffres dans la consigne (une réserve absente vaut 0). Ce ne sont que des propositions : le joueur les
 * valide par `steward.setRules`, qui refait toutes ses vérifications.
 */
export const STEWARD_INSTRUCTIONS = [
  'Tu es l’intendant d’un site dans un jeu de gestion de la Grèce antique.',
  'Traduis la consigne du joueur (`instruction`, dans les données) en règles de gestion, de trois sortes seulement :',
  '{"kind": "collect"} récolte le site dès que possible ;',
  '{"kind": "sell", "good": id, "price": prix, "keep": n} vend le bien à ce prix l’unité ou plus, en gardant n unités',
  '(0 si la consigne n’en dit rien) ;',
  '{"kind": "buy", "good": id, "price": prix, "target": n} rachète un intrant du site (`inputs`) à ce prix l’unité',
  'ou moins, jusqu’à n unités en stock.',
  'Un prix est {"amount": nombre, "unit": "obol"} ou {"amount": nombre, "unit": "drachma"} : recopie le nombre et',
  'l’unité écrits par le joueur, sans conversion.',
  'N’utilise que des nombres écrits en chiffres dans la consigne ; n’en invente, n’en calcule et n’en convertis aucun.',
  'Un prix sans unité, décimal ou composé de drachmes et d’oboles rend la consigne ambiguë.',
  'Désigne chaque bien par son identifiant `id` dans `goods`.',
  'Au plus `maxRules` règles, une par sorte et par bien, dans l’ordre de la consigne.',
  'Réponds {"rules": [...]}.',
  'Si la consigne demande autre chose que ces règles, réponds {"refusal": "outOfGrammar"} ;',
  's’il y manque un prix, une quantité ou un bien, ou si elle est ambiguë, réponds {"refusal": "ambiguous"}.',
].join(' ');

/** Ce que rend une traduction : des règles de la grammaire, ou un refus motivé. */
export type Translation = { rules: StewardRule[] } | { refusal: StewardProposalRefusal };

/** Ce que l'IA sait du site : les biens de la configuration, et les extrants et intrants de sa recette. */
export interface StewardSite {
  goods: readonly string[];
  inputs: readonly string[];
  outputs: readonly string[];
  maxRules: number;
}

/** Site d'un intendant vu par la traduction, selon la configuration en vigueur et la recette du site. */
export function stewardSite(config: GameConfig, recipeId: string, maxRules: number): StewardSite {
  const recipe = config.recipes.find((candidate) => candidate.id === recipeId);
  return {
    goods: config.goods.map((good) => good.id),
    inputs: recipe?.inputs.map((stack) => stack.goodId) ?? [],
    outputs: recipe?.outputs.map((stack) => stack.goodId) ?? [],
    maxRules,
  };
}

/** Un prix tel que le joueur l'écrit : un nombre entier et son unité. */
export interface WrittenPrice {
  amount: number;
  unit: 'obol' | 'drachma';
}

/** Ce que la consigne écrit en chiffres : les seuls nombres qu'une proposition peut porter (règle 6). */
export interface WrittenNumbers {
  /** Prix : un nombre entier suivi de son unité, obole(s), obol(s), drachme(s), drachma(s). */
  prices: WrittenPrice[];
  /** Nombres entiers écrits sans unité de monnaie : les quantités possibles. */
  quantities: Set<number>;
  /** Un nombre décimal (« 12,5 ») ou un prix composé (« 1 drachme 3 oboles ») : la consigne est ambiguë. */
  ambiguous: boolean;
}

// Un nombre en chiffres latins, groupes de milliers séparés par une espace compris (« 1 000 »), qui ne prolonge pas
// un autre nombre ; sa partie décimale éventuelle ; son unité de monnaie éventuelle, mot entier.
const WRITTEN = new RegExp(
  String.raw`(?<![\d.,])(\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?!\d)|\d+)([.,]\d+)?` +
    String.raw`(?:\s*(?:(drachm(?:es?|as?|ae))|(obol(?:es?|s)?))(?!\p{L}))?`,
  'giu',
);

/**
 * Lit les nombres d'une consigne. Un nombre écrit en lettres n'en est pas un ; un nombre suivi d'une unité de
 * monnaie est un prix, et seulement un prix. Une partie décimale, ou des drachmes suivies d'oboles (« 1 drachme
 * 3 oboles », « 1 drachme et 3 oboles »), rendent la consigne ambiguë : la grammaire ne porte qu'un prix entier
 * dans une seule unité.
 */
export function readNumbers(text: string): WrittenNumbers {
  const read: WrittenNumbers = { prices: [], quantities: new Set(), ambiguous: false };
  let previous: { unit: WrittenPrice['unit'] | null; end: number } | null = null;
  for (const match of text.matchAll(WRITTEN)) {
    const [whole, digits = '', decimals, drachma, obol] = match;
    const amount = Number(digits.replace(/\D/g, ''));
    const unit = drachma ? 'drachma' : obol ? 'obol' : null;
    if (decimals) read.ambiguous = true;
    else if (unit) read.prices.push({ amount, unit });
    else read.quantities.add(amount);
    const between = previous ? text.slice(previous.end, match.index) : '';
    if (
      previous?.unit === 'drachma' &&
      unit === 'obol' &&
      /^\s*(?:(?:et|and)\s+)?$/iu.test(between)
    )
      read.ambiguous = true;
    previous = { unit, end: match.index + whole.length };
  }
  return read;
}

/**
 * Refus que le code décide seul, avant tout appel : une consigne ambiguë par ses nombres ne se traduit pas, quoi
 * que le modèle réponde (le schéma la refuse aussi).
 */
export function refusalBeforeCall(text: string): StewardProposalRefusal | null {
  return readNumbers(text).ambiguous ? 'AMBIGUOUS' : null;
}

const price: z.ZodType<WrittenPrice> = z.strictObject({
  amount: z.number().int().positive(),
  unit: z.enum(['obol', 'drachma']),
});
const proposedRule = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('collect') }),
  z.strictObject({
    kind: z.literal('sell'),
    good: z.string(),
    price,
    keep: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal('buy'),
    good: z.string(),
    price,
    target: z.number().int().positive(),
  }),
]);
const answer = z.union([
  z.strictObject({ rules: z.array(proposedRule).min(1).max(20) }),
  z.strictObject({ refusal: z.enum(['outOfGrammar', 'ambiguous']) }),
]);

/**
 * Schéma de la réponse, propre à une consigne et à un site : il rejette toute sorte hors de la grammaire, tout bien
 * inconnu, tout rachat qui ne vise pas un intrant du site, tout prix qui n'est pas écrit tel quel dans la consigne
 * (nombre et unité), toute quantité absente de la consigne, et ce que `stewardRulesSchema` refuse (bornes,
 * doublons) ; il convertit les prix en oboles. Une consigne ambiguë par ses nombres est refusée quoi que le modèle
 * réponde. Un prix écrit sans unité ne se distingue pas d'une quantité : aucune règle ne peut le porter.
 */
export function translationSchema(text: string, site: StewardSite): z.ZodType<Translation> {
  const written = readNumbers(text);
  const isWritten = (p: WrittenPrice) =>
    written.prices.some((w) => w.amount === p.amount && w.unit === p.unit);
  const oboles = (p: WrittenPrice) => p.amount * (p.unit === 'drachma' ? OBOLS_PER_DRACHMA : 1);
  return answer.transform((value, ctx): Translation => {
    if (written.ambiguous) return { refusal: 'AMBIGUOUS' };
    if ('refusal' in value)
      return { refusal: value.refusal === 'outOfGrammar' ? 'OUT_OF_GRAMMAR' : 'AMBIGUOUS' };
    const issue = (message: string) => {
      ctx.addIssue({ code: 'custom', message });
      return z.NEVER;
    };
    if (value.rules.length > site.maxRules) return issue('too many rules');
    const rules: StewardRule[] = [];
    for (const rule of value.rules) {
      if (rule.kind === 'collect') {
        rules.push(rule);
        continue;
      }
      const units = rule.kind === 'sell' ? rule.keep : rule.target;
      if (!site.goods.includes(rule.good)) return issue(`unknown good ${rule.good}`);
      if (rule.kind === 'buy' && !site.inputs.includes(rule.good)) return issue('not an input');
      if (!isWritten(rule.price)) return issue('a price not written as such in the instruction');
      if (!(written.quantities.has(units) || units === 0))
        return issue('a quantity absent from the instruction');
      rules.push(
        rule.kind === 'sell'
          ? {
              kind: 'sell',
              goodId: rule.good,
              minPriceOboles: oboles(rule.price),
              keepUnits: units,
            }
          : {
              kind: 'buy',
              goodId: rule.good,
              maxPriceOboles: oboles(rule.price),
              targetUnits: units,
            },
      );
    }
    const checked = stewardRulesSchema.safeParse(rules);
    return checked.success ? { rules: checked.data } : issue('outside the grammar bounds');
  });
}

/** Requête de traduction : consignes constantes ; le texte du joueur et le site comme données ; repli : refus. */
export function translationRequest(text: string, site: StewardSite): AiRequest<Translation> {
  const goods = site.goods.map((id) => ({ id, fr: goodName('fr', id), en: goodName('en', id) }));
  return {
    usage: 'steward',
    instructions: STEWARD_INSTRUCTIONS,
    data: {
      instruction: text,
      goods,
      inputs: site.inputs,
      outputs: site.outputs,
      maxRules: site.maxRules,
    },
    schema: translationSchema(text, site),
    fallback: { refusal: 'AI_UNAVAILABLE' },
  };
}

/** La réponse d'une traduction : celle du modèle, ou le refus qui dit pourquoi le repli a servi. */
export function translationOf(result: AiResult<Translation>): Translation {
  if (result.source === 'ai') return result.value;
  return { refusal: result.outcome === 'invalid' ? 'INVALID_PROPOSAL' : 'AI_UNAVAILABLE' };
}
