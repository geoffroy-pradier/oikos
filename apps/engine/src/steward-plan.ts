import { stewardRulesLimit, type GameConfig } from '@oikos/config';
import { MAX_ORDER_QUANTITY } from '@oikos/contracts';
import type { Db } from '@oikos/db';
import {
  accrueProduction,
  nextStewardOperation,
  type StewardPlanRule,
  type StewardSight,
} from '@oikos/sim';
import { sql } from 'kysely';

/** Tick dont les intendants mènent leurs opérations, avec la version de configuration qu'il a lue. */
export interface StewardTick {
  worldId: string;
  index: number;
  configVersionId: string;
  config: GameConfig;
}

export interface Steward {
  id: string;
  house_id: string;
  site_id: string;
  user_id: string;
}

/**
 * Intendants actifs du monde (en poste, payés, avec des règles) qui n'ont pas mené toutes leurs opérations du tick,
 * dans l'ordre de leur embauche. Un intendant n'agit pas pour un compte suspendu ou exclu : la même sanction que
 * le registre de l'API relit à chaque commande (13), sans refus inscrit à chaque tick.
 */
export const candidates = (db: Db, tick: StewardTick, perTick: number) =>
  db
    .selectFrom('game.stewards as s')
    .innerJoin('game.houses as h', 'h.id', 's.house_id')
    .select(['s.id', 's.house_id', 's.site_id', 'h.user_id'])
    .where('s.world_id', '=', tick.worldId)
    .where('s.dismissed_at', 'is', null)
    .where('s.unpaid_since', 'is', null)
    .where('s.rules_revision', '>', 0)
    .where(
      sql<boolean>`(select count(*) from game.steward_operations o
        where o.steward_id = s.id and o.tick_index = ${tick.index}) < ${perTick}`,
    )
    .where(
      sql<boolean>`not exists (select 1 from admin.sanctions x where x.user_id = h.user_id
        and x.kind in ('suspension', 'ban') and x.starts_at <= now()
        and (x.ends_at is null or x.ends_at > now()) and (x.kind <> 'ban' or x.validated_by is not null))`,
    )
    .orderBy('s.hired_at')
    .orderBy('s.id')
    .execute();

/**
 * Opération suivante d'un intendant, lue dans la transaction : ses règles en vigueur (les premières que la
 * configuration admet), le site et les stocks de sa maison dans la cité du site. La file repart de la règle qui suit
 * celle de sa dernière opération sous la même révision (`nextStewardOperation`).
 */
export async function plan(
  trx: Db,
  tick: StewardTick,
  steward: Steward,
  revision: number,
  now: Date,
) {
  const rows = await trx
    .selectFrom('game.steward_rules')
    .select(['position', 'kind', 'good_id', 'price_oboles', 'units'])
    .where('steward_id', '=', steward.id)
    .where('revision', '=', revision)
    .where('position', '<', stewardRulesLimit(tick.config))
    .orderBy('position')
    .execute();
  const rules: StewardPlanRule[] = rows.map((row) => {
    const [goodId, price, units] = [row.good_id ?? '', Number(row.price_oboles), Number(row.units)];
    if (row.kind === 'sell')
      return { kind: 'sell', goodId, minPriceOboles: price, keepUnits: units };
    if (row.kind === 'buy')
      return { kind: 'buy', goodId, maxPriceOboles: price, targetUnits: units };
    return { kind: 'collect' };
  });
  if (rules.length === 0) return null;
  const last = await trx
    .selectFrom('game.steward_operations')
    .select(['rules_revision', 'rule_position'])
    .where('steward_id', '=', steward.id)
    .orderBy('tick_index', 'desc')
    .orderBy('rank', 'desc')
    .limit(1)
    .executeTakeFirst();
  const start = last && last.rules_revision === revision ? last.rule_position + 1 : 0;
  const { sight, cityId } = await sightOf(trx, tick.config, steward, rules, now);
  const next = nextStewardOperation(rules, start, sight, MAX_ORDER_QUANTITY);
  const rule = next && rules[next.position];
  return next && rule ? { ...next, rule, revision, cityId } : null;
}

/**
 * Ce que voit un intendant pour ces règles, lu dans la transaction : un cycle du site est-il récoltable, et le stock
 * libre et attendu de chaque bien de ses règles pour sa maison, dans la cité du site. Partagé par l'opération du
 * moteur et la simulation à blanc des règles proposées (#280).
 */
export async function sightOf(
  trx: Db,
  config: GameConfig,
  steward: Pick<Steward, 'house_id' | 'site_id'>,
  rules: readonly StewardPlanRule[],
  now: Date,
): Promise<{ sight: StewardSight; cityId: string }> {
  const site = await trx
    .selectFrom('game.sites')
    .select(['city_id', 'recipe_id', 'cycle_started_at', 'halted_at'])
    .where('id', '=', steward.site_id)
    .executeTakeFirstOrThrow();
  const recipe = config.recipes.find((candidate) => candidate.id === site.recipe_id);
  const until = site.halted_at && site.halted_at < now ? site.halted_at : now;
  // Une recette retirée est tentée : la récolte la refuse, et le refus se lit sur la fiche du site.
  const collectable =
    !recipe ||
    accrueProduction({
      since: site.cycle_started_at,
      now: until,
      cycleMinutes: recipe.durationMinutes,
      outputPerCycle: 1,
      maxCycles: recipe.maxAccruedCycles,
    }).cycles > 0;
  const goods = [
    ...new Set(rules.flatMap((rule) => (rule.kind === 'collect' ? [] : [rule.goodId]))),
  ];
  const stocks =
    goods.length === 0
      ? []
      : await trx
          .selectFrom('game.inventories')
          .select(['good_id', 'quantity', 'reserved'])
          .where('house_id', '=', steward.house_id)
          .where('city_id', '=', site.city_id)
          .where('good_id', 'in', goods)
          .execute();
  const buying =
    goods.length === 0
      ? []
      : await trx
          .selectFrom('game.orders')
          .select(['good_id', sql<string>`sum(remaining)`.as('remaining')])
          .where('house_id', '=', steward.house_id)
          .where('city_id', '=', site.city_id)
          .where('side', '=', 'buy')
          .where('status', '=', 'open')
          .where('good_id', 'in', goods)
          .groupBy('good_id')
          .execute();
  const stockOf = (goodId: string) => stocks.find((stock) => stock.good_id === goodId);
  const sight: StewardSight = {
    collectable,
    free: (goodId) =>
      Number(stockOf(goodId)?.quantity ?? 0) - Number(stockOf(goodId)?.reserved ?? 0),
    incoming: (goodId) =>
      Number(stockOf(goodId)?.quantity ?? 0) +
      Number(buying.find((order) => order.good_id === goodId)?.remaining ?? 0),
  };
  return { sight, cityId: site.city_id };
}
