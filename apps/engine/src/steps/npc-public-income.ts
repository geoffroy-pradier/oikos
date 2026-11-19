import { npcPublicIncomeBps, type GameConfig } from '@oikos/config';
import { lockNpcPurses, type Db, type NpcPurse } from '@oikos/db';
import { dailyPublicIncome, type SystemAccountKey } from '@oikos/sim';
import { sql } from 'kysely';
import type { CloseStep } from '../close';
import { lockUpkeepSinks } from './site-upkeep';

/** Robinet du revenu public des PNJ (docs/specs/05-economie.md, 5.5 ; #632). */
const FAUCET: SystemAccountKey = 'faucet_npc_public_income';
const MINUTES_PER_DAY = 1440;

/**
 * Revenu public du jour de chaque cité du monde que la configuration connaît (5.5, #632) : `dailyPublicIncome`
 * sur la population courante (celle de la configuration pour une classe que le moteur n'a pas encore fait naître)
 * et la part publique de chaque classe (`npcPublicIncomeBps`). Lecture seule ; un revenu nul n'est pas rendu.
 */
export async function publicIncomeDue(
  trx: Db,
  worldId: string,
  config: Pick<GameConfig, 'clock' | 'cities' | 'npcClasses'>,
) {
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
  return cities.flatMap((city) => {
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
}

/**
 * Verse à chaque bourse (déjà verrouillée par l'appelant) son revenu public du jour de jeu `gameDay`, sauf s'il l'a
 * déjà été : une écriture `npc.public_income` par cité et par jour de jeu, que la base tient pour unique (index
 * `ledger_entries_npc_public_income_once`, migration 1120). La clôture et le tick de demande partagent cette clé :
 * le premier des deux verse, l'autre ne fait rien, même en concurrence. Rend ce qui a été versé, par cité.
 */
export async function creditPublicIncome(
  trx: Db,
  worldId: string,
  gameDay: number,
  due: readonly { cityId: string; oboles: number }[],
  purses: ReadonlyMap<string, NpcPurse>,
) {
  const credited = new Map<string, number>();
  if (due.length === 0) return credited;
  const faucet = await trx
    .selectFrom('game.accounts')
    .select('id')
    .where('world_id', '=', worldId)
    .where('system_key', '=', FAUCET)
    .executeTakeFirstOrThrow(() => new Error(`World ${worldId} has no ${FAUCET} account`));
  for (const { cityId, oboles } of due) {
    const purse = purses.get(cityId);
    if (!purse) throw new Error(`City ${cityId} has no NPC purse`);
    const { rows } = await sql<{ id: string }>`
      insert into game.ledger_entries (world_id, kind, meta)
      values (${worldId}, 'npc.public_income', ${JSON.stringify({ cityId, gameDay })}::jsonb)
      on conflict ((meta ->> 'cityId'), (meta ->> 'gameDay')) where kind = 'npc.public_income' do nothing
      returning id`.execute(trx);
    const entry = rows[0];
    if (!entry) continue;
    await trx
      .insertInto('game.ledger_lines')
      .values([
        { entry_id: entry.id, account_id: purse.accountId, amount: oboles },
        { entry_id: entry.id, account_id: faucet.id, amount: -oboles },
      ])
      .execute();
    credited.set(cityId, oboles);
  }
  return credited;
}

/**
 * Revenu public des PNJ à la clôture (5.2, 5.5 ; #632) : chaque cité de la configuration reçoit son revenu du jour
 * qui s'ouvre (`publicIncomeDue`), sur la population que l'étape de la population vient de fixer, par le robinet
 * `faucet_npc_public_income`, si un tick de demande de ce jour ne l'a pas déjà versé (`creditPublicIncome`).
 * Verrous dans l'ordre de l'entretien : l'agora du monde, les puits de l'entretien, puis les bourses.
 */
export const npcPublicIncome: CloseStep = {
  name: 'npcPublicIncome',
  async run({ trx, worldId, gameDay, config }) {
    const due = await publicIncomeDue(trx, worldId, config);
    if (due.length === 0) return { cities: 0, oboles: 0 };
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${worldId}`}, 0))`.execute(
      trx,
    );
    await lockUpkeepSinks(trx, worldId);
    const purses = await lockNpcPurses(trx, worldId);
    const credited = await creditPublicIncome(trx, worldId, gameDay, due, purses);
    return {
      cities: credited.size,
      oboles: [...credited.values()].reduce((sum, oboles) => sum + oboles, 0),
    };
  },
};
