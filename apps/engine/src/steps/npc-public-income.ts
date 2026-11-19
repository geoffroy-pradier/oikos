import { npcPublicIncomeBps } from '@oikos/config';
import { lockNpcPurses } from '@oikos/db';
import { dailyPublicIncome, type SystemAccountKey } from '@oikos/sim';
import { sql } from 'kysely';
import type { CloseStep } from '../close';
import { lockUpkeepSinks } from './site-upkeep';

/** Robinet du revenu public des PNJ (docs/specs/05-economie.md, 5.5 ; #632). */
const FAUCET: SystemAccountKey = 'faucet_npc_public_income';
const MINUTES_PER_DAY = 1440;

/**
 * Revenu public des PNJ (5.2, 5.5 ; #632). Chaque clôture crédite la bourse des PNJ de chaque cité de la
 * configuration de son revenu public du jour (`dailyPublicIncome`), sur la population que l'étape de la
 * population vient de fixer (celle de la configuration pour une classe que le moteur n'a pas encore fait
 * naître) et sur la part publique de chaque classe (`npcPublicIncomeBps` : celle d'une version publiée avant le
 * paramètre à défaut), par le robinet `faucet_npc_public_income` : une écriture `npc.public_income` par cité, qui nomme la
 * cité et le jour de jeu. Un revenu nul n'a pas d'écriture ; une cité absente de la configuration n'a rien.
 * Verrous dans l'ordre de l'entretien : l'agora du monde, les puits de l'entretien, puis les bourses.
 */
export const npcPublicIncome: CloseStep = {
  name: 'npcPublicIncome',
  async run({ trx, worldId, gameDay, config }) {
    const cities = await trx
      .selectFrom('game.cities')
      .select(['id', 'slug'])
      .where('world_id', '=', worldId)
      .orderBy('slug')
      .execute();
    const living = await trx
      .selectFrom('game.npc_population')
      .select(['city_id', 'class_id', 'population'])
      .where('world_id', '=', worldId)
      .execute();
    const ticksPerDay = MINUTES_PER_DAY / config.clock.tickMinutes;
    const due = cities.flatMap((city) => {
      const initial = config.cities.find((entry) => entry.id === city.slug)?.population;
      if (!initial) return [];
      const oboles = dailyPublicIncome(
        config.npcClasses.map((npcClass) => ({
          incomePerThousand: npcClass.incomePerThousand,
          publicIncomeBps: npcPublicIncomeBps(npcClass),
          population:
            living.find((row) => row.city_id === city.id && row.class_id === npcClass.id)
              ?.population ??
            initial[npcClass.id] ??
            0,
        })),
        ticksPerDay,
      );
      return oboles > 0 ? [{ cityId: city.id, oboles }] : [];
    });
    if (due.length === 0) return { cities: 0, oboles: 0 };

    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${worldId}`}, 0))`.execute(
      trx,
    );
    await lockUpkeepSinks(trx, worldId);
    const purses = await lockNpcPurses(trx, worldId);
    const faucet = await trx
      .selectFrom('game.accounts')
      .select('id')
      .where('world_id', '=', worldId)
      .where('system_key', '=', FAUCET)
      .executeTakeFirstOrThrow(() => new Error(`World ${worldId} has no ${FAUCET} account`));
    for (const { cityId, oboles } of due) {
      const purse = purses.get(cityId);
      if (!purse) throw new Error(`City ${cityId} has no NPC purse`);
      const entry = await trx
        .insertInto('game.ledger_entries')
        .values({
          world_id: worldId,
          kind: 'npc.public_income',
          meta: JSON.stringify({ cityId, gameDay }),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('game.ledger_lines')
        .values([
          { entry_id: entry.id, account_id: purse.accountId, amount: oboles },
          { entry_id: entry.id, account_id: faucet.id, amount: -oboles },
        ])
        .execute();
    }
    return { cities: due.length, oboles: due.reduce((sum, row) => sum + row.oboles, 0) };
  },
};
