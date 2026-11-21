import { describe, expect, it } from 'vitest';
import { CLOSE_STEPS } from './close-steps';
import { archonHonor } from './steps/archon-honor';
import { archonOpening } from './steps/archon-opening';
import { archonTally } from './steps/archon-tally';
import { bankInterest } from './steps/bank-interest';
import { citizenship } from './steps/citizenship';
import { decreeApplication } from './steps/decree-application';
import { decreeSpending } from './steps/decree-spending';
import { decreeTally } from './steps/decree-tally';
import { favorDecay } from './steps/favor-decay';
import { hubrisGauge } from './steps/hubris-gauge';
import { laborMarket } from './steps/labor-market';
import { leaseRent } from './steps/lease-rent';
import { liturgyAssignment } from './steps/liturgy-assignment';
import { liturgyEvasion, liturgyLevy } from './steps/liturgy-settlement';
import { loanCollection, loanDefaultLocks } from './steps/loan-collection';
import { npcHouseRetreatStep } from './steps/npc-house-retreat';
import { npcHouseSurplusStep } from './steps/npc-house-surplus';
import { npcHouses } from './steps/npc-houses';
import { npcPopulation } from './steps/npc-population';
import { npcPublicIncome } from './steps/npc-public-income';
import { ostracismOpening } from './steps/ostracism-opening';
import { ostracismTally } from './steps/ostracism-tally';
import { propertyWear } from './steps/property-wear';
import { siteUpkeep } from './steps/site-upkeep';
import { worldEventPlanning } from './steps/world-event-planning';

describe('étapes de la clôture quotidienne du moteur', () => {
  it('l’entretien des sites est joué, et en dernier : il tient ses verrous jusqu’à la validation', () => {
    expect(CLOSE_STEPS).toContain(siteUpkeep);
    expect(CLOSE_STEPS).toContain(npcPopulation);
    expect(CLOSE_STEPS.at(-1)).toBe(siteUpkeep);
    // Avant l'entretien (ordre de clôture de la phase 2), sans monnaie ni stock : la citoyenneté (une
    // maison promue ce jour vote déjà), puis le dépouillement, la Timè des mandats finis (#704), puis
    // l'ouverture du mandat suivant ; la
    // vétusté des biens juste avant l'entretien, qu'elle précède sous le verrou de l'agora ; les loyers
    // avant elle, les premiers de ce qui touche la monnaie (#257). Le dépouillement des décrets, sans monnaie
    // ni stock, passe avant les loyers ; l'application des décrets de taux le suit, avant tout ce qui taxe ou
    // paie (#262) ; le règlement des dépenses (#263) vient juste après, juste avant les loyers : les étapes
    // d'avant ne tiennent pas le verrou de l'agora. Le marché du travail (#258) juste avant l'entretien, qui
    // prélève son salaire et son hébergement ; le revenu public des PNJ (#632) entre les deux, après la population ;
    // les maisons PNJ de secours (#715) juste avant lui, sans verrou d'agora ; leur surplus (#716) juste avant
    // l'entretien, sous ses verrous ; leur retrait (#717) juste avant le marché du travail : un site fermé ce jour
    // n'emploie ni ne doit rien.
    // La planification des événements (#267) puis le déclin de la Charis
    // (#265), sans monnaie ni stock ni agora, passent avant tout ce qui peut prendre l'agora.
    // L'ostracisme (#722) : son dépouillement avant celui des élections, qui écarte l'ostracisé ; l'ouverture de
    // son vote juste après le dépouillement des décrets, qui l'adopte. Les liturgies (#719), sans monnaie ni stock ni
    // agora, lisent la fortune après les événements du monde et avant tout ce qui touche la monnaie ; la dérobade
    // (#720) prend les Timè et les liturgies échues avant les Charis et l'agora, le prélèvement suit les loyers.
    // L'échéance des prêts du temple (#725) : les Timè des maisons en défaut possible avec la dérobade, avant l'agora ;
    // le prélèvement après celui des liturgies, avant l'entretien, qui paie avec ce qui reste. L'intérêt des dépôts (#727)
    // juste après, sous l'agora que l'échéance tient déjà.
    // La jauge d'Hybris (#734), sans monnaie ni stock ni agora, après les événements du monde et avant les liturgies.
    const order = [
      citizenship,
      ostracismTally,
      archonTally,
      archonHonor,
      archonOpening,
      decreeTally,
      ostracismOpening,
      npcPopulation,
      worldEventPlanning,
      hubrisGauge,
      liturgyAssignment,
      liturgyEvasion,
      loanDefaultLocks,
      favorDecay,
      decreeApplication,
      decreeSpending,
      leaseRent,
      liturgyLevy,
      loanCollection,
      bankInterest,
      propertyWear,
      npcHouseRetreatStep,
      laborMarket,
      npcHouses,
      npcPublicIncome,
      npcHouseSurplusStep,
      siteUpkeep,
    ].map((step) => CLOSE_STEPS.indexOf(step));
    expect(order).not.toContain(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(CLOSE_STEPS.indexOf(npcHouseSurplusStep)).toBe(CLOSE_STEPS.length - 2);
    expect(CLOSE_STEPS.indexOf(npcPublicIncome)).toBe(CLOSE_STEPS.length - 3);
    expect(CLOSE_STEPS.indexOf(npcHouses)).toBe(CLOSE_STEPS.length - 4);
    expect(CLOSE_STEPS.indexOf(laborMarket)).toBe(CLOSE_STEPS.length - 5);
    expect(CLOSE_STEPS.indexOf(npcHouseRetreatStep)).toBe(CLOSE_STEPS.length - 6);
    expect(CLOSE_STEPS.indexOf(propertyWear)).toBe(CLOSE_STEPS.length - 7);
    expect(CLOSE_STEPS.indexOf(bankInterest)).toBe(CLOSE_STEPS.length - 8);
    expect(CLOSE_STEPS.indexOf(loanCollection)).toBe(CLOSE_STEPS.length - 9);
    expect(CLOSE_STEPS.indexOf(liturgyLevy)).toBe(CLOSE_STEPS.length - 10);
    expect(CLOSE_STEPS.indexOf(leaseRent)).toBe(CLOSE_STEPS.length - 11);
    expect(CLOSE_STEPS.indexOf(decreeApplication)).toBe(CLOSE_STEPS.indexOf(leaseRent) - 2);
    expect(CLOSE_STEPS.indexOf(decreeSpending)).toBe(CLOSE_STEPS.indexOf(leaseRent) - 1);
    expect(CLOSE_STEPS.indexOf(favorDecay)).toBe(CLOSE_STEPS.indexOf(decreeApplication) - 1);
    expect(CLOSE_STEPS.indexOf(ostracismTally)).toBe(CLOSE_STEPS.indexOf(archonTally) - 1);
    expect(CLOSE_STEPS.indexOf(ostracismOpening)).toBe(CLOSE_STEPS.indexOf(decreeTally) + 1);
    expect(CLOSE_STEPS.indexOf(liturgyAssignment)).toBe(CLOSE_STEPS.indexOf(favorDecay) - 3);
    expect(CLOSE_STEPS.indexOf(liturgyEvasion)).toBe(CLOSE_STEPS.indexOf(favorDecay) - 2);
    expect(CLOSE_STEPS.indexOf(loanDefaultLocks)).toBe(CLOSE_STEPS.indexOf(favorDecay) - 1);
    const names = CLOSE_STEPS.map((step) => step.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
