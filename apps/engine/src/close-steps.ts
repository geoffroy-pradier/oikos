import type { CloseStep } from './close';
import { archonOpening } from './steps/archon-opening';
import { archonTally } from './steps/archon-tally';
import { citizenship } from './steps/citizenship';
import { npcPopulation } from './steps/npc-population';
import { propertyWear } from './steps/property-wear';
import { siteUpkeep } from './steps/site-upkeep';

/**
 * Étapes de la clôture quotidienne, dans l'ordre : la citoyenneté des métèques, le dépouillement puis
 * l'ouverture des élections de l'archonte (6.2), la population des PNJ, qui ne retient que ses propres
 * lignes, la vétusté des biens immobiliers (4.5), puis l'entretien. L'entretien reste la DERNIÈRE : il
 * tient le verrou des appariements du monde, le puits et les trésoreries jusqu'à la validation de la
 * clôture, et tout ce qui s'exécuterait après lui allongerait l'attente des ordres, des récoltes et des
 * relances. La vétusté prend ce verrou juste avant lui, pour verrouiller les biens sous lui.
 */
export const CLOSE_STEPS: readonly CloseStep[] = [
  citizenship,
  archonTally,
  archonOpening,
  npcPopulation,
  propertyWear,
  siteUpkeep,
];
