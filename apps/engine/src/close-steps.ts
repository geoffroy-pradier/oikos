import type { CloseStep } from './close';
import { archonOpening } from './steps/archon-opening';
import { archonTally } from './steps/archon-tally';
import { citizenship } from './steps/citizenship';
import { decreeTally } from './steps/decree-tally';
import { leaseRent } from './steps/lease-rent';
import { npcPopulation } from './steps/npc-population';
import { propertyWear } from './steps/property-wear';
import { siteUpkeep } from './steps/site-upkeep';

/**
 * Étapes de la clôture quotidienne, dans l'ordre : la citoyenneté des métèques, le dépouillement puis
 * l'ouverture des élections de l'archonte (6.2), le dépouillement des décrets (6.3), la population des PNJ,
 * qui ne retient que ses propres lignes, les loyers des baux (4.5, #257), la vétusté des biens immobiliers
 * (4.5), puis l'entretien.
 * Les loyers sont les premiers à toucher la monnaie : avant l'entretien, qui se paie avec ce qu'il reste,
 * et avant ce qui lira les baux du jour (logement des travailleurs, #258). Les étapes d'avant ne touchent
 * ni monnaie ni bien : placées après elles, les loyers ne leur font pas tenir le verrou de l'agora.
 * L'entretien reste la DERNIÈRE : il tient le verrou des appariements du monde, le puits et les
 * trésoreries jusqu'à la validation de la clôture, et tout ce qui s'exécuterait après lui allongerait
 * l'attente des ordres, des récoltes et des relances. La vétusté prend ce verrou juste avant lui, pour
 * verrouiller les biens sous lui.
 */
export const CLOSE_STEPS: readonly CloseStep[] = [
  citizenship,
  archonTally,
  archonOpening,
  decreeTally,
  npcPopulation,
  leaseRent,
  propertyWear,
  siteUpkeep,
];
