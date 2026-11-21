import { randomInt } from 'node:crypto';
import { stewardLimit, stewardRulesLimit } from '@oikos/config';
import {
  STEWARD_DISMISS_ERROR_CODES,
  STEWARD_HIRE_ERROR_CODES,
  STEWARD_SET_RULES_ERROR_CODES,
  stewardDismissInputSchema,
  stewardDismissOutputSchema,
  stewardHireInputSchema,
  stewardHireOutputSchema,
  stewardSetRulesInputSchema,
  stewardSetRulesOutputSchema,
  type DomainEvent,
  type StewardRule,
} from '@oikos/contracts';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';
import { defineCommand, type CommandResult } from '../registry';
import { accountHouseId, cancelLockedOrders, lockAgora } from '@oikos/operations';

const refuse = (code: string, message: string): CommandResult<never> => ({
  ok: false,
  error: { code, message },
});

/**
 * Embauche un intendant pour un site de la maison (docs/specs/04-systemes-gestion.md, 4.4) : un par site, au plus
 * les postes du siège (`stewards.limitByHeadquartersLevel`, premier niveau). Son nom est tiré de la liste de la
 * configuration, parmi ceux que ses intendants en poste ne portent pas quand il en reste. L'embauche ne coûte
 * rien : son salaire est payé à chaque clôture, et il n'agit qu'une fois payé (#278, #279).
 */
export const stewardHire = defineCommand({
  name: 'steward.hire',
  input: stewardHireInputSchema,
  output: stewardHireOutputSchema,
  errors: STEWARD_HIRE_ERROR_CODES,
  // La base fait foi sous concurrence : un seul intendant en poste par site.
  errorByConstraint: {
    stewards_one_per_site_idx: { code: 'SITE_HAS_STEWARD', message: 'This site has a steward.' },
  },
  async handler({ trx, userId, emit, config }, input) {
    // Verrou de la maison : deux embauches simultanées se suivent, et la seconde compte la première.
    // `FOR NO KEY UPDATE` et non `FOR UPDATE` : une récolte verrouille le site puis écrit au stock, dont la clé
    // étrangère demande `FOR KEY SHARE` sur la maison, quand l'embauche, maison tenue, demande `FOR KEY SHARE` sur
    // le site (`stewards_site`). Avec `FOR UPDATE`, les deux commandes s'attendraient l'une l'autre (interblocage).
    const house = await trx
      .selectFrom('game.houses')
      .select('id')
      .where('id', '=', accountHouseId(userId))
      .forNoKeyUpdate()
      .executeTakeFirst();
    const site =
      house &&
      (await trx
        .selectFrom('game.sites')
        .select(['id', 'world_id'])
        .where('id', '=', input.siteId)
        .where('house_id', '=', house.id)
        .executeTakeFirst());
    // Le site d'un autre joueur est indiscernable d'un site inexistant.
    if (!house || !site) return refuse('SITE_NOT_FOUND', 'Unknown site.');
    const posted = await trx
      .selectFrom('game.stewards')
      .select(['site_id', 'name'])
      .where('house_id', '=', house.id)
      .where('dismissed_at', 'is', null)
      .execute();
    if (posted.some((steward) => steward.site_id === site.id))
      return refuse('SITE_HAS_STEWARD', 'This site has a steward.');
    if (posted.length >= stewardLimit(config))
      return refuse('STEWARD_LIMIT_REACHED', 'Every steward post is taken.');
    // Des postes ouverts supposent la section des intendants, et sa liste de noms n'est jamais vide.
    const names = config.stewards?.names ?? [];
    const unused = names.filter((name) => !posted.some((steward) => steward.name === name));
    const pool = unused.length > 0 ? unused : names;
    const name = pool[randomInt(pool.length)];
    if (name === undefined) throw new Error('Steward posts without names');
    const hired = await trx
      .insertInto('game.stewards')
      .values({ world_id: site.world_id, house_id: house.id, site_id: site.id, name })
      .returning(['id', 'hired_at'])
      .executeTakeFirstOrThrow();
    emit({
      type: 'StewardHired',
      payload: { stewardId: hired.id, houseId: house.id, siteId: site.id, name },
    });
    return {
      ok: true,
      data: { stewardId: hired.id, siteId: site.id, name, hiredAt: hired.hired_at.toISOString() },
    };
  },
});

/** Intendant en poste de la maison du compte, verrouillé : ses commandes se suivent, et suivent son renvoi. */
export async function lockSteward(trx: Db, userId: string, stewardId: string) {
  return trx
    .selectFrom('game.stewards')
    .select(['id', 'house_id', 'site_id', 'rules_revision'])
    .where('id', '=', stewardId)
    .where('dismissed_at', 'is', null)
    .where('house_id', '=', accountHouseId(userId))
    .forUpdate()
    .executeTakeFirst();
}

/**
 * Intendant en poste de la maison du compte, verrouillé après le verrou d'agora de son monde, pour annuler ses ordres
 * ouverts (#562). L'ordre des verrous est celui de l'opération du moteur, de la clôture et de l'exclusion (agora
 * d'abord) : une opération déjà sous ce verrou finit, et l'ordre qu'elle pose est lu ici ; une opération qui l'attend
 * relit ensuite l'intendant, renvoyé ou sous ses règles nouvelles. Le monde est lu sans verrou : il ne change pas.
 */
async function holdSteward(trx: Db, userId: string, stewardId: string) {
  const seen = await trx
    .selectFrom('game.stewards')
    .select('world_id')
    .where('id', '=', stewardId)
    .where('dismissed_at', 'is', null)
    .where('house_id', '=', accountHouseId(userId))
    .executeTakeFirst();
  if (!seen) return undefined;
  await lockAgora(trx, seen.world_id);
  return lockSteward(trx, userId, stewardId);
}

/**
 * Annule les ordres ouverts que l'intendant a posés (#562), comme `market.cancelOrder` : réservation levée, séquestre
 * rendu à la trésorerie par le grand livre (écriture marquée de l'intendant et de la cause), un `OrderCancelled` par
 * ordre.
 */
async function cancelStewardOrders(
  trx: Db,
  stewardId: string,
  cause: 'steward.setRules' | 'steward.dismiss',
  emit: (event: DomainEvent) => void,
): Promise<void> {
  const orders = await trx
    .selectFrom('game.orders')
    .select(['id', 'world_id', 'house_id', 'city_id', 'good_id', 'side', 'price', 'remaining'])
    .where('steward_id', '=', stewardId)
    .where('status', '=', 'open')
    .orderBy('id')
    .forUpdate()
    .execute();
  await cancelLockedOrders(trx, orders, emit, (houseId) => ({ houseId, stewardId, cause }));
}

/**
 * Donne ses règles à un intendant (4.4) : elles remplacent toutes les précédentes, dans l'ordre reçu, par une
 * révision nouvelle (rien n'est effacé). La grammaire et ses bornes sont celles du contrat ; la configuration
 * en vigueur borne leur nombre, et chaque bien doit en être connu ; un rachat ne vise qu'un intrant de la
 * recette du site. Aucune liste vide n'est refusée : un intendant sans règle ne fait rien.
 */
export const stewardSetRules = defineCommand({
  name: 'steward.setRules',
  input: stewardSetRulesInputSchema,
  output: stewardSetRulesOutputSchema,
  errors: STEWARD_SET_RULES_ERROR_CODES,
  async handler({ trx, userId, emit, config }, input) {
    const steward = await holdSteward(trx, userId, input.stewardId);
    if (!steward) return refuse('STEWARD_NOT_FOUND', 'Unknown steward.');
    if (input.rules.length > stewardRulesLimit(config))
      return refuse('TOO_MANY_RULES', `At most ${stewardRulesLimit(config)} rules.`);
    const site = await trx
      .selectFrom('game.sites')
      .select('recipe_id')
      .where('id', '=', steward.site_id)
      .executeTakeFirstOrThrow();
    const goods = new Set(config.goods.map((good) => good.id));
    const inputs = new Set(
      config.recipes
        .find((recipe) => recipe.id === site.recipe_id)
        ?.inputs.map((stack) => stack.goodId) ?? [],
    );
    for (const rule of input.rules) {
      if (rule.kind === 'collect') continue;
      if (!goods.has(rule.goodId)) return refuse('GOOD_NOT_FOUND', `Unknown good ${rule.goodId}.`);
      if (rule.kind === 'buy' && !inputs.has(rule.goodId))
        return refuse('NOT_AN_INPUT', `${rule.goodId} is not an input of this site.`);
    }
    // Les ordres des règles précédentes ne leur survivent pas (#562) : prix ou quantités d'avant, séquestre retenu.
    await cancelStewardOrders(trx, steward.id, 'steward.setRules', emit);
    const { rules_revision: revision } = await trx
      .updateTable('game.stewards')
      .set({ rules_revision: sql<number>`rules_revision + 1` })
      .where('id', '=', steward.id)
      .returning('rules_revision')
      .executeTakeFirstOrThrow();
    if (input.rules.length > 0)
      await trx
        .insertInto('game.steward_rules')
        .values(
          input.rules.map((rule, position) => ({
            steward_id: steward.id,
            revision,
            position,
            ...row(rule),
          })),
        )
        .execute();
    emit({
      type: 'StewardRulesSet',
      payload: {
        stewardId: steward.id,
        houseId: steward.house_id,
        siteId: steward.site_id,
        rules: input.rules,
      },
    });
    return { ok: true, data: { stewardId: steward.id, rules: input.rules } };
  },
});

/** Une règle de la grammaire dans les colonnes de `game.steward_rules`. */
function row(rule: StewardRule) {
  switch (rule.kind) {
    case 'collect':
      return { kind: rule.kind, good_id: null, price_oboles: null, units: null };
    case 'sell':
      return {
        kind: rule.kind,
        good_id: rule.goodId,
        price_oboles: rule.minPriceOboles,
        units: rule.keepUnits,
      };
    case 'buy':
      return {
        kind: rule.kind,
        good_id: rule.goodId,
        price_oboles: rule.maxPriceOboles,
        units: rule.targetUnits,
      };
  }
}

/**
 * Renvoie un intendant (4.4) : il quitte son poste, ses règles cessent avec lui, et ses ordres ouverts sont annulés
 * (#562) ; rien n'est remboursé.
 */
export const stewardDismiss = defineCommand({
  name: 'steward.dismiss',
  input: stewardDismissInputSchema,
  output: stewardDismissOutputSchema,
  errors: STEWARD_DISMISS_ERROR_CODES,
  async handler({ trx, userId, emit }, input) {
    const steward = await holdSteward(trx, userId, input.stewardId);
    if (!steward) return refuse('STEWARD_NOT_FOUND', 'Unknown steward.');
    await cancelStewardOrders(trx, steward.id, 'steward.dismiss', emit);
    const { dismissed_at: dismissedAt } = await trx
      .updateTable('game.stewards')
      .set({ dismissed_at: sql<Date>`now()` })
      .where('id', '=', steward.id)
      .returning('dismissed_at')
      .executeTakeFirstOrThrow();
    if (!dismissedAt) throw new Error('The steward was not dismissed');
    emit({
      type: 'StewardDismissed',
      payload: { stewardId: steward.id, houseId: steward.house_id, siteId: steward.site_id },
    });
    return {
      ok: true,
      data: {
        stewardId: steward.id,
        siteId: steward.site_id,
        dismissedAt: dismissedAt.toISOString(),
      },
    };
  },
});
