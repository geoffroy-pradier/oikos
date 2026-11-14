import type { CloseStep } from './close';
import { siteUpkeep } from './steps/site-upkeep';

/**
 * Étapes de la clôture quotidienne, dans l'ordre. L'entretien reste la DERNIÈRE : il tient le verrou des
 * appariements du monde, le puits et les trésoreries jusqu'à la validation de la clôture, et tout ce
 * qui s'exécuterait après lui allongerait l'attente des ordres, des récoltes et des relances.
 */
export const CLOSE_STEPS: readonly CloseStep[] = [siteUpkeep];
