import type { LoadedConfig } from '@oikos/config';
import { runStewards } from '@oikos/engine';
import { sql } from 'kysely';
import { config, recipeOf, referenceOf, type City } from './city';
import type { Seller } from './strategy';

/*
 * Intendants du banc des quatre cités (#281, #283) : une maison embauche un intendant pour son premier site et lui
 * confie la vente de ses récoltes et des biens du panier que font ses ateliers par `steward.setRules` (règles `sell` à
 * prix fixe) ; le moteur le fait agir après chaque tick, et la maison ne met plus ces biens en vente elle-même, ni ne
 * retire ses ventes. La règle de récolte
 * n'est pas jouée : la base date ses récoltes de l'instant réel, et le banc récolte, lui, à l'heure de jeu
 * (`balance/city.ts`). Ce sont des choix du banc, pas de l'équilibrage du jeu.
 */
/** Prix plancher de vente d'un bien de l'intendant, en multiple de son prix de référence. */
const RULE_FLOOR = 0.9;
/** Prix de vente d'un bien par un intendant, en oboles. */
export const stewardPrice = (goodId: string) =>
  Math.max(1, Math.round(referenceOf(goodId) * RULE_FLOOR));

/** Intendant en poste : son identifiant et le jour de jeu de son embauche. */
export interface Steward {
  stewardId: string;
  houseId: string;
  hiredDay: number;
}

/**
 * Embauche l'intendant du premier site de la maison, si elle a des biens à lui confier et n'a pas encore d'intendant ;
 * rend l'embauche. Ses règles : vendre chaque bien primaire que les sites du rôle récoltent, au prix d'un intendant, et
 * chaque bien du panier de l'indice que font ses ateliers, à sa référence, sauf ce que ses ateliers consomment ; garder
 * de quoi rénover un bien.
 */
export async function hireSteward(
  city: City,
  house: Seller,
  day: number,
  now: Date,
  hired: readonly Steward[],
) {
  // Prix de chaque bien confié : les récoltes au prix d'un intendant, les biens du panier que font ses ateliers à
  // leur référence. Ce que ses ateliers consomment, la maison le garde : l'intendant le vendrait sous ses intrants.
  const basket = new Set(config.priceIndex.basket.map((entry) => entry.goodId));
  const prices = new Map<string, number>();
  for (const recipe of house.role.sites.map(recipeOf))
    for (const { goodId } of recipe.outputs)
      if (recipe.inputs.length === 0) prices.set(goodId, stewardPrice(goodId));
      else if (basket.has(goodId)) prices.set(goodId, referenceOf(goodId));
  for (const recipe of house.role.sites.map(recipeOf))
    for (const { goodId } of recipe.inputs) prices.delete(goodId);
  const goods = new Set(prices.keys());
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
  // Il garde de quoi rénover un bien (4.5) : la maison le prend dans son stock plutôt que de racheter sa récolte.
  const keep = (goodId: string) =>
    Math.max(
      0,
      ...city.played.properties.sizes.flatMap((size) =>
        size.renovation.goods.filter((stack) => stack.goodId === goodId).map((s) => s.quantity),
      ),
    );
  const rules = [...goods].map((goodId) => ({
    kind: 'sell',
    goodId,
    minPriceOboles: prices.get(goodId) ?? stewardPrice(goodId),
    keepUnits: keep(goodId),
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
