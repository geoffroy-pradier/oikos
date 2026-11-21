import type { CloseStep } from './close';
import { archonHonor } from './steps/archon-honor';
import { archonOpening } from './steps/archon-opening';
import { archonTally } from './steps/archon-tally';
import { citizenship } from './steps/citizenship';
import { decreeApplication } from './steps/decree-application';
import { decreeSpending } from './steps/decree-spending';
import { decreeTally } from './steps/decree-tally';
import { favorDecay } from './steps/favor-decay';
import { laborMarket } from './steps/labor-market';
import { leaseRent } from './steps/lease-rent';
import { liturgyAssignment } from './steps/liturgy-assignment';
import { liturgyEvasion, liturgyLevy } from './steps/liturgy-settlement';
import { npcHouseSurplusStep } from './steps/npc-house-surplus';
import { npcHouses } from './steps/npc-houses';
import { npcPopulation } from './steps/npc-population';
import { npcPublicIncome } from './steps/npc-public-income';
import { ostracismOpening } from './steps/ostracism-opening';
import { ostracismTally } from './steps/ostracism-tally';
import { propertyWear } from './steps/property-wear';
import { siteUpkeep } from './steps/site-upkeep';
import { worldEventPlanning } from './steps/world-event-planning';

/**
 * Étapes de la clôture quotidienne, dans l'ordre : la citoyenneté des métèques, le dépouillement des ostracismes
 * (6.4, #722), qui écarte l'ostracisé de l'élection dépouillée ensuite et lui fait quitter sa charge, le
 * dépouillement des élections de l'archonte (6.2), la Timè des mandats finis (4.1, #704), qui ne prend que les
 * verrous de la Timè, l'ouverture des élections suivantes, le dépouillement des décrets (6.3), l'ouverture du vote
 * des ostracismes adoptés, la population des PNJ,
 * qui ne retient que ses propres lignes, la planification des événements du monde (7.3, #267), qui n'écrit que
 * les siens, sans autre verrou que celui de la clôture du monde, la désignation des liturgies (6.4, #719), qui lit
 * la fortune des maisons avant que la clôture ne touche la monnaie, sans autre verrou non plus, la dérobade aux
 * liturgies échues (#720), qui prend les Timè de leurs maisons puis les verrouille avant les Charis et l'agora, dans
 * l'ordre de `liturgy.perform`, le déclin de la Charis (7.1, #265),
 * l'application des décrets de taux (5.6, #262), le règlement des
 * décrets de dépense (5.5, #263), les loyers des baux (4.5, #257), le prélèvement d'office des liturgies échues
 * (#720), sur ce que les loyers laissent, la vétusté des biens immobiliers (4.5),
 * le marché du travail du jour (4.4, #258), la fondation des maisons PNJ de secours (8.3, #715), le revenu public
 * des PNJ (5.5, #632), le surplus des maisons PNJ (8.3, #716), puis l'entretien.
 * Les maisons PNJ ne touchent que leur robinet et la maison qu'elles fondent, sans verrou d'agora : leurs sites,
 * créés après l'instant de la clôture, n'entrent ni dans le marché du travail ni dans l'entretien du jour.
 * Leur surplus prend les verrous de l'entretien, dans son ordre, et son puits avant les trésoreries : l'entretien
 * qui le suit paie avec ce qui reste sous le plafond.
 * Le revenu public n'est ici qu'un secours : le moteur jouant les ticks avant les clôtures, le premier tick du jour
 * l'a presque toujours versé (sur la population de la veille). S'il ne l'a pas fait, la clôture le verse sur la
 * population du jour, avec les verrous de l'entretien, avant lui : l'agora, les puits, puis les bourses des PNJ.
 * Les décrets de taux s'appliquent avant tout ce qui taxe ou paie, sous le verrou de l'agora, qu'ils ne
 * prennent qu'avec un décret à appliquer : placés juste avant les loyers, qui le prennent de toute façon.
 * Les dépenses des décrets, qui ne touchent que les trésors des cités et leurs puits, prennent les mêmes
 * verrous dans le même ordre, et seulement avec un décret à régler.
 * Le déclin de la Charis ne touche ni monnaie ni bien et ne prend pas l'agora : il verrouille les Charis du
 * monde, qu'une offrande verrouille avant l'agora (`temple.makeOffering`).
 * Les loyers sont les premiers à toucher la monnaie des maisons : avant l'entretien, qui se paie avec ce qu'il reste,
 * et avant ce qui lira les baux du jour (logement des travailleurs, #258). Les étapes d'avant ne touchent
 * ni monnaie ni bien : placées après elles, les loyers ne leur font pas tenir le verrou de l'agora.
 * Le marché du travail fixe le salaire et le prix de l'hébergement que l'entretien prélève : il lit les
 * logements après la fin des baux impayés et la vétusté du jour, et ne touche ni monnaie ni bien.
 * L'entretien reste la DERNIÈRE : il tient le verrou des appariements du monde, le puits et les
 * trésoreries jusqu'à la validation de la clôture, et tout ce qui s'exécuterait après lui allongerait
 * l'attente des ordres, des récoltes et des relances. La vétusté prend ce verrou juste avant lui, pour
 * verrouiller les biens sous lui.
 */
export const CLOSE_STEPS: readonly CloseStep[] = [
  citizenship,
  ostracismTally,
  archonTally,
  archonHonor,
  archonOpening,
  decreeTally,
  ostracismOpening,
  npcPopulation,
  worldEventPlanning,
  liturgyAssignment,
  liturgyEvasion,
  favorDecay,
  decreeApplication,
  decreeSpending,
  leaseRent,
  liturgyLevy,
  propertyWear,
  laborMarket,
  npcHouses,
  npcPublicIncome,
  npcHouseSurplusStep,
  siteUpkeep,
];
