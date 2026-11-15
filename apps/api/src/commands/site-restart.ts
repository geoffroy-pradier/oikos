import { cityDailyWageOboles } from '@oikos/config';
import {
  SITE_RESTART_ERROR_CODES,
  siteRestartInputSchema,
  siteRestartOutputSchema,
} from '@oikos/contracts';
import { siteDailyDue } from '@oikos/sim';
import { sql } from 'kysely';
import { defineCommand, type CommandResult } from '../registry';

const refuse = (code: string, message: string): CommandResult<never> => ({
  ok: false,
  error: { code, message },
});

/**
 * Relance un site à l'arrêt sans attendre la clôture (docs/specs/05-economie.md, 5.5) : la maison paie le
 * dû d'un jour du site, au tarif de la configuration en vigueur, en entier ou pas du tout : l'entretien,
 * détruit par le puits `sink_upkeep`, et les salaires de ses travailleurs (4.4), détruits par le puits
 * `sink_npc_wages`, chacun par sa ligne marquée de l'écriture `upkeep.restart`. Le site repart à cet
 * instant, son cycle gelé décalé de la durée de l'arrêt. La clôture suivante lui demandera son dû
 * normalement.
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
      .innerJoin('game.cities', 'game.cities.id', 'game.sites.city_id')
      .select(['game.sites.id', 'game.sites.world_id', 'game.sites.house_id', 'game.cities.slug'])
      .where('game.sites.id', '=', input.siteId)
      .where('game.sites.house_id', 'in', (houses) =>
        houses.selectFrom('game.houses').select('id').where('user_id', '=', userId),
      )
      .executeTakeFirst();
    // Le site d'un autre joueur est indiscernable d'un site inexistant.
    if (!owned) return refuse('SITE_NOT_FOUND', 'Unknown site.');
    // Ordre des verrous, le même que l'entretien à la clôture : les puits (entretien, puis salaires), la
    // trésorerie, puis le site. Dans un autre ordre, une relance et une clôture s'attendraient l'une
    // l'autre. Le verrou du premier puits met en file toutes les relances d'un monde ; quand une clôture a
    // commencé à prélever l'entretien, elles attendent la validation de toute sa transaction, puisque ce
    // verrou est tenu jusqu'au bout.
    const lockSink = async (key: 'sink_upkeep' | 'sink_npc_wages') =>
      (
        await trx
          .selectFrom('game.accounts')
          .select('id')
          .where('world_id', '=', owned.world_id)
          .where('system_key', '=', key)
          .forUpdate()
          .executeTakeFirstOrThrow()
      ).id;
    const upkeepSink = await lockSink('sink_upkeep');
    const wagesSink = await lockSink('sink_npc_wages');
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
    // Un site dont la recette n'est plus dans la configuration n'a plus de type ni de travailleurs, donc
    // pas de tarif.
    const recipe = config.recipes.find((candidate) => candidate.id === site.recipe_id);
    const { upkeepOboles, wagesOboles, oboles } = recipe
      ? siteDailyDue({
          upkeepBaseOboles: config.sites.upkeep.dailyOboles[recipe.siteType],
          coefficientBps: config.sites.upkeep.coefficientBps,
          workers: recipe.workers,
          wageOboles: cityDailyWageOboles(config, owned.slug),
        })
      : { upkeepOboles: 0, wagesOboles: 0, oboles: 0 };
    // Le prix affiché fait foi : un autre tarif (configuration activée entre-temps) n'est pas prélevé. Un
    // client qui n'annonçait que l'entretien voit son prix refusé dès qu'il y a des salaires.
    if (input.expectedUpkeepOboles !== undefined && input.expectedUpkeepOboles !== oboles)
      return refuse('PRICE_CHANGED', `Restarting now costs ${oboles} oboles.`);
    if (Number(account.balance) < oboles) return refuse('INSUFFICIENT_FUNDS', 'Not enough money.');
    if (oboles > 0) {
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
      // Une ligne de débit de la trésorerie par nature (4.1), chacune vers son puits ; une part nulle n'en a pas.
      const parts = [
        { nature: 'upkeep', sink: upkeepSink, oboles: upkeepOboles },
        { nature: 'wages', sink: wagesSink, oboles: wagesOboles },
      ] as const;
      await trx
        .insertInto('game.ledger_lines')
        .values(
          parts
            .filter((part) => part.oboles > 0)
            .flatMap((part) => [
              {
                entry_id: entry.id,
                account_id: account.id,
                amount: -part.oboles,
                nature: part.nature,
              },
              { entry_id: entry.id, account_id: part.sink, amount: part.oboles },
            ]),
        )
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
      payload: { siteId: owned.id, houseId: owned.house_id, upkeepOboles, wagesOboles },
    });
    return {
      ok: true,
      data: {
        siteId: owned.id,
        upkeepOboles,
        wagesOboles,
        cycleStartedAt: resumed.cycle_started_at.toISOString(),
      },
    };
  },
});
