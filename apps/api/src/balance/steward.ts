import type { LoadedConfig } from '@oikos/config';
import { runStewards } from '@oikos/engine';
import { sql } from 'kysely';
import { recipeOf, referenceOf, type City } from './city';
import type { Seller } from './strategy';

/*
 * Intendants du banc des quatre cités (#281) : une maison de production primaire embauche un intendant pour son
 * premier site et lui confie la vente de ses récoltes par `steward.setRules` (règles `sell` à un prix plancher) ; le
 * moteur le fait agir après chaque tick, et la maison ne met plus ces biens en vente elle-même. La règle de récolte
 * n'est pas jouée : la base date ses récoltes de l'instant réel, et le banc récolte, lui, à l'heure de jeu
 * (`balance/city.ts`). Ce sont des choix du banc, pas de l'équilibrage du jeu.
 */
/** Prix plancher de vente d'un bien de l'intendant, en multiple de son prix de référence. */
const RULE_FLOOR = 0.9;

/** Intendant en poste : son identifiant et le jour de jeu de son embauche. */
export interface Steward {
  stewardId: string;
  houseId: string;
  hiredDay: number;
}

/**
 * Embauche l'intendant du premier site de la maison, si elle récolte des biens primaires et n'a pas encore
 * d'intendant ; rend l'embauche. Ses règles : vendre chaque bien primaire que les sites du rôle récoltent.
 */
export async function hireSteward(
  city: City,
  house: Seller,
  day: number,
  now: Date,
  hired: readonly Steward[],
) {
  const goods = new Set(
    house.role.sites.flatMap((id) => {
      const recipe = recipeOf(id);
      return recipe.inputs.length === 0 ? recipe.outputs.map((stack) => stack.goodId) : [];
    }),
  );
  const site = house.sites[0];
  if (!site || goods.size === 0 || hired.some((steward) => steward.houseId === house.houseId))
    return undefined;
  const reply = await city.send(house.user, 'steward.hire', { siteId: site.id });
  if (!reply.ok) throw new Error(`steward.hire: ${reply.error?.code}`);
  // Embauché de l'instant réel par la base, il est ramené à son instant de jeu : la clôture ne paie que les
  // intendants embauchés avant elle (garde levée le temps de l'écriture, comme pour les sites).
  await city.owner.transaction().execute(async (trx) => {
    await sql`alter table game.stewards disable trigger stewards_guard`.execute(trx);
    await sql`update game.stewards set hired_at = ${now}, unpaid_since = ${now}
      where id = ${reply.data.stewardId}`.execute(trx);
    await sql`alter table game.stewards enable trigger stewards_guard`.execute(trx);
  });
  const rules = [...goods].map((goodId) => ({
    kind: 'sell',
    goodId,
    minPriceOboles: Math.max(1, Math.round(referenceOf(goodId) * RULE_FLOOR)),
    keepUnits: 0,
  }));
  const set = await city.send(house.user, 'steward.setRules', {
    stewardId: reply.data.stewardId,
    rules,
  });
  if (!set.ok) throw new Error(`steward.setRules: ${set.error?.code}`);
  house.delegated = goods;
  return { stewardId: reply.data.stewardId as string, houseId: house.houseId, hiredDay: day };
}

/** Opérations des intendants du monde pour un tick joué, sous la configuration du banc. */
export async function actAfterTick(city: City, loaded: LoadedConfig, index: number) {
  return runStewards(city.db, {
    worldId: city.worldId,
    index,
    configVersionId: loaded.id,
    config: loaded.config,
  });
}
