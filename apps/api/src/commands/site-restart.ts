import {
  SITE_RESTART_ERROR_CODES,
  siteRestartInputSchema,
  siteRestartOutputSchema,
} from '@oikos/contracts';
import { dailyUpkeep } from '@oikos/sim';
import { sql } from 'kysely';
import { defineCommand, type CommandResult } from '../registry';

const refuse = (code: string, message: string): CommandResult<never> => ({
  ok: false,
  error: { code, message },
});

/**
 * Relance un site à l'arrêt sans attendre la clôture (docs/specs/05-economie.md, 5.5) : la maison paie
 * l'entretien d'un jour, au tarif de la configuration en vigueur, détruit par le puits `sink_upkeep` ;
 * le site repart à cet instant, son cycle gelé décalé de la durée de l'arrêt. La clôture suivante lui
 * demandera l'entretien normalement.
 */
export const siteRestart = defineCommand({
  name: 'site.restart',
  input: siteRestartInputSchema,
  output: siteRestartOutputSchema,
  errors: SITE_RESTART_ERROR_CODES,
  // La base fait foi sous concurrence : le compte d'une maison ne passe jamais sous zéro.
  errorByConstraint: {
    accounts_no_overdraft: { code: 'INSUFFICIENT_FUNDS', message: 'Not enough money.' },
  },
  async handler({ trx, userId, emit, config }, input) {
    const owned = await trx
      .selectFrom('game.sites')
      .select(['id', 'world_id', 'house_id'])
      .where('id', '=', input.siteId)
      .where('house_id', 'in', (houses) =>
        houses.selectFrom('game.houses').select('id').where('user_id', '=', userId),
      )
      .executeTakeFirst();
    // Le site d'un autre joueur est indiscernable d'un site inexistant.
    if (!owned) return refuse('SITE_NOT_FOUND', 'Unknown site.');
    // Ordre des verrous, le même que l'entretien à la clôture : le puits, la trésorerie, puis le site.
    // Dans un autre ordre, une relance et une clôture s'attendraient l'une l'autre. Le verrou du puits
    // met en file toutes les relances d'un monde, et les fait attendre la fin de l'étape d'entretien
    // quand une clôture est en cours.
    const sink = await trx
      .selectFrom('game.accounts')
      .select('id')
      .where('world_id', '=', owned.world_id)
      .where('system_key', '=', 'sink_upkeep')
      .forUpdate()
      .executeTakeFirstOrThrow();
    const account = await trx
      .selectFrom('game.accounts')
      .select(['id', 'balance'])
      .where('house_id', '=', owned.house_id)
      .where('kind', '=', 'house')
      .forUpdate()
      .executeTakeFirstOrThrow();
    const site = await trx
      .selectFrom('game.sites')
      .select(['recipe_id', 'halted_at'])
      .select(sql<boolean>`halted_at > now()`.as('moved'))
      .where('id', '=', owned.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    // Relu sous verrou : la clôture ou une autre relance a pu le faire repartir entre-temps.
    if (!site.halted_at) return refuse('SITE_NOT_HALTED', 'This site is already running.');

    // Une clôture commencée après cette commande vient d'arrêter le site pendant qu'elle attendait le
    // puits : l'arrêt est postérieur à notre instant, et la reprise ferait reculer le cycle, ce que la
    // garde refuse. Conflit à rejouer, comme pour `site.setRecipe`, pas une erreur interne.
    if (site.moved) return refuse('SITE_CHANGED', 'The site just changed. Try again.');
    // Un site dont la recette n'est plus dans la configuration n'a plus de type, donc pas de tarif.
    const type = config.recipes.find((recipe) => recipe.id === site.recipe_id)?.siteType;
    const { coefficientBps, dailyOboles } = config.sites.upkeep;
    const upkeepOboles = type ? dailyUpkeep(dailyOboles[type], coefficientBps) : 0;
    if (Number(account.balance) < upkeepOboles)
      return refuse('INSUFFICIENT_FUNDS', 'Not enough money.');
    if (upkeepOboles > 0) {
      // Une autre nature d'écriture que l'entretien de la clôture, limité à une fois par jour de jeu.
      const entry = await trx
        .insertInto('game.ledger_entries')
        .values({
          world_id: owned.world_id,
          kind: 'upkeep.restart',
          meta: JSON.stringify({ houseId: owned.house_id, siteId: owned.id }),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('game.ledger_lines')
        .values([
          { entry_id: entry.id, account_id: account.id, amount: -upkeepOboles },
          { entry_id: entry.id, account_id: sink.id, amount: upkeepOboles },
        ])
        .execute();
    }
    // La même expression que la garde de la base, calculée par elle : une date calculée ici, à la
    // milliseconde et sur une autre horloge, ne pourrait pas l'égaler.
    const resumed = await trx
      .updateTable('game.sites')
      .set({
        cycle_started_at: sql<Date>`cycle_started_at + extract(epoch from now() - halted_at) * interval '1 second'`,
        halted_at: null,
      })
      .where('id', '=', owned.id)
      .returning('cycle_started_at')
      .executeTakeFirstOrThrow();
    emit({
      type: 'SiteRestarted',
      payload: { siteId: owned.id, houseId: owned.house_id, upkeepOboles },
    });
    return {
      ok: true,
      data: {
        siteId: owned.id,
        upkeepOboles,
        cycleStartedAt: resumed.cycle_started_at.toISOString(),
      },
    };
  },
});
