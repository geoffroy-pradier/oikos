import type { HubrisCauseCode } from '@oikos/db';
import { HUBRIS_CAUSES, type HubrisCause } from '@oikos/sim';
import { expect, expectTypeOf, it } from 'vitest';

// Les causes du journal de l'Hybris (#734) sont écrites deux fois : dans `@oikos/sim`, qui les calcule, et dans le type
// de la colonne `cause` de `@oikos/db`, qui ne dépend pas de `sim`. Contrôlé par `pnpm typecheck` et par ce test.
it('les causes de la simulation et celles du type de la base sont les mêmes', () => {
  expectTypeOf<HubrisCause>().toEqualTypeOf<HubrisCauseCode>();
  const codes: Record<HubrisCauseCode, true> = {
    market_share: true,
    wealth: true,
    liturgy_levied: true,
    offering: true,
    liturgy_performed: true,
    decay: true,
  };
  expect([...HUBRIS_CAUSES].sort()).toEqual(Object.keys(codes).sort());
});
