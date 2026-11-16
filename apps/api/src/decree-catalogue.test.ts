import { decreesSchema } from '@oikos/config';
import { DECREE_MODELS, decreeProposalSchema } from '@oikos/contracts';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

// Le catalogue des décrets et ses plafonds techniques sont écrits deux fois : dans le schéma de la
// configuration (`@oikos/config`) et dans les contrats (`@oikos/contracts`), qui ne peuvent pas s'importer
// l'un l'autre. Ce test, qui voit les deux, les garde alignés.
type Num = { minValue: number | null; maxValue: number | null };
const range = (schema: unknown) => [(schema as Num).minValue, (schema as Num).maxValue];
const configModels = decreesSchema.shape.models.shape;
const configBounds = (model: keyof typeof configModels) =>
  (configModels[model].unwrap() as z.ZodObject).shape as Record<string, unknown>;
const contractParams = (model: string) => {
  const option = decreeProposalSchema.options.find(
    (candidate) => candidate.shape.model.value === model,
  );
  if (!option) throw new Error(`model ${model} missing from the contracts`);
  return option.shape.params.shape as Record<string, unknown>;
};

describe('catalogue des décrets : configuration et contrats alignés', () => {
  it('mêmes modèles, dans le même ordre', () => {
    expect(Object.keys(configModels)).toEqual([...DECREE_MODELS]);
    expect(decreeProposalSchema.options.map((option) => option.shape.model.value)).toEqual([
      ...DECREE_MODELS,
    ]);
  });

  // Modèle, paramètre du décret, suffixe des bornes `minX` et `maxX` de la configuration.
  it.each([
    ['market_tax_rate', 'rateBps', 'RateBps'],
    ['port_dues', 'coefficientBps', 'CoefficientBps'],
    ['public_works', 'amountOboles', 'Oboles'],
    ['festival', 'amountOboles', 'Oboles'],
    ['festival', 'days', 'Days'],
  ] as const)('%s.%s : mêmes plafonds techniques que min%s et max%s', (model, param, bound) => {
    const bounds = configBounds(model);
    const expected = range(contractParams(model)[param]);
    expect(expected.every((value) => value !== null)).toBe(true);
    expect(range(bounds[`min${bound}`])).toEqual(expected);
    expect(range(bounds[`max${bound}`])).toEqual(expected);
  });

  it('une fête ne célèbre pas plus de biens que le plafond de `maxGoods`', () => {
    const goodIds = contractParams('festival')['goodIds'] as z.ZodType;
    const maxGoods = range(configBounds('festival')['maxGoods'])[1] ?? 0;
    const distinct = Array.from({ length: maxGoods + 1 }, (_, rank) => `good_${rank}`);
    expect(goodIds.safeParse(distinct.slice(0, maxGoods)).success).toBe(true);
    expect(goodIds.safeParse(distinct).success).toBe(false);
  });
});
