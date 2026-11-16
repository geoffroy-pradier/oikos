import { describe, expect, it } from 'vitest';
import { INITIAL_CONFIG, validateConfig, WORLD_EVENT_MODELS, type WorldEvents } from './index';

const base = () =>
  structuredClone(INITIAL_CONFIG) as Record<string, unknown> & { worldEvents: WorldEvents };
const fieldsOf = (worldEvents: unknown) => {
  const result = validateConfig({ ...base(), worldEvents });
  return result.ok ? [] : result.errors.map((error) => error.split(':')[0]);
};
const events = () => base().worldEvents;

describe('événements du monde (7.4, #267)', () => {
  it('la configuration initiale ouvre les quatre modèles, chacun à probabilité nulle', () => {
    const result = validateConfig(INITIAL_CONFIG);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const worldEvents = result.config.worldEvents;
    expect(Object.keys(worldEvents?.models ?? {})).toEqual([...WORLD_EVENT_MODELS]);
    for (const model of WORLD_EVENT_MODELS)
      expect([model, worldEvents?.models[model]?.probabilityBps]).toEqual([model, 0]);
    expect(worldEvents?.planningLeadDays).toBeGreaterThanOrEqual(1);
  });

  it('une version publiée avant les événements reste lisible, sans section', () => {
    const older: Record<string, unknown> = base();
    delete older['worldEvents'];
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.worldEvents).toBeUndefined();
  });

  it('délai, probabilité, durée et ampleur bornés', () => {
    expect(fieldsOf(events())).toEqual([]);
    for (const [key, value] of [
      ['planningLeadDays', 0],
      ['planningLeadDays', 31],
      ['planningLeadDays', 1.5],
    ] as const)
      expect(fieldsOf({ ...events(), [key]: value })).toEqual([`worldEvents.${key}`]);
    const storm = events().models.storm;
    for (const [key, value] of [
      ['probabilityBps', -1],
      ['probabilityBps', 10_001],
      ['minDays', 0],
      ['maxDays', 31],
      ['minMagnitudeBps', -1],
      ['maxMagnitudeBps', 10_001],
      ['maxMagnitudeBps', 0.5],
    ] as const)
      expect([
        key,
        value,
        fieldsOf({ ...events(), models: { storm: { ...storm, [key]: value } } }),
      ]).toEqual([key, value, [`worldEvents.models.storm.${key}`]]);
    // Bornes atteintes : certitude, rendement nul ou durée doublée.
    expect(
      fieldsOf({
        ...events(),
        models: { storm: { ...storm, probabilityBps: 10_000, maxMagnitudeBps: 10_000 } },
      }),
    ).toEqual([]);
  });

  it('chaque minimum au plus égal à son maximum ; modèle inconnu refusé', () => {
    const drought = events().models.drought;
    expect(
      fieldsOf({ ...events(), models: { drought: { ...drought, minDays: 3, maxDays: 2 } } }),
    ).toEqual(['worldEvents.models.drought.maxDays']);
    expect(
      fieldsOf({
        ...events(),
        models: { drought: { ...drought, minMagnitudeBps: 5000, maxMagnitudeBps: 4999 } },
      }),
    ).toEqual(['worldEvents.models.drought.maxMagnitudeBps']);
    expect(fieldsOf({ ...events(), models: { eclipse: drought } })).toEqual(['worldEvents.models']);
  });

  it('caravane : des biens achetés par les PNJ, sans doublon', () => {
    const caravan = events().models.caravan;
    const withGoods = (goodIds: string[]) =>
      fieldsOf({ ...events(), models: { caravan: { ...caravan, goodIds } } });
    expect(withGoods(['wine'])).toEqual([]);
    // L'argile existe mais aucune classe ne l'achète : une caravane n'y changerait rien.
    expect(withGoods(['wine', 'clay', 'unobtainium', 'wine'])).toEqual([
      'worldEvents.models.caravan.goodIds[1]',
      'worldEvents.models.caravan.goodIds[2]',
      'worldEvents.models.caravan.goodIds[3]',
    ]);
    expect(withGoods([])).toEqual(['worldEvents.models.caravan.goodIds']);
  });
});
