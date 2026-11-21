import { createRng } from './rng';

/**
 * Pertes en mer (docs/specs/04-systemes-gestion.md, 4.6 ; 7.4 ; #730) : calcul pur, en points de base entiers.
 * Un voyage peut perdre toute sa cargaison, jamais son navire. Son risque est fixé au départ, puis le tirage se
 * fait à l'arrivée, par un générateur dont la graine vient du monde et de l'identifiant du voyage : rejouable,
 * et caché jusque-là, car les joueurs ne lisent pas la graine du monde.
 */
const BPS = 10_000;

const isBps = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= BPS;

/**
 * Risque de perte d'un voyage, fixé au départ : celui de la route, plus sa majoration si une tempête de la route
 * est en cours au départ (une tempête qui commence en mer ne le change pas, comme pour la durée), borné à 10 000.
 */
export function voyageLossRiskBps(rule: {
  routeRiskBps: number;
  stormRiskBps: number;
  storm: boolean;
}): number {
  if (!isBps(rule.routeRiskBps) || !isBps(rule.stormRiskBps))
    throw new RangeError(`loss risks must be integers between 0 and ${BPS}`);
  return Math.min(BPS, rule.routeRiskBps + (rule.storm ? rule.stormRiskBps : 0));
}

/** Graine du tirage d'un voyage : celle du monde, puis l'identifiant du voyage. */
export const voyageLossSeed = (worldSeed: string, voyageId: string) =>
  `${worldSeed}:voyage-loss:${voyageId}`;

/**
 * Vrai si le voyage perd sa cargaison. Un seul tirage uniforme parmi 10 000 valeurs, comparé au risque :
 * risque nul, jamais de perte ; risque plein, toujours ; à graine égale, un risque plus fort perd au moins
 * chaque fois qu'un risque plus faible perd. Déterministe : même graine, même risque, même issue.
 */
export function voyageLoss(input: {
  worldSeed: string;
  voyageId: string;
  riskBps: number;
}): boolean {
  if (!isBps(input.riskBps))
    throw new RangeError(`riskBps must be an integer between 0 and ${BPS}`);
  if (input.worldSeed.length === 0 || input.voyageId.length === 0)
    throw new RangeError('a loss draw needs a world seed and a voyage');
  const draw = createRng(voyageLossSeed(input.worldSeed, input.voyageId)).int(0, BPS - 1);
  return draw < input.riskBps;
}
