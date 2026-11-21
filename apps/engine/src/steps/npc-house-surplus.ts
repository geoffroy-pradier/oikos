import { lockNpcPurses } from '@oikos/db';
import { sql } from 'kysely';
import type { CloseStep } from '../close';
import { lockUpkeepSinks } from './site-upkeep';

/** Ce qu'une maison PNJ verse au puits : sa trésorerie au-delà du plafond, rien en dessous. Sans entrée-sortie. */
export const npcHouseSurplus = (balance: number, capOboles: number) =>
  Math.max(0, balance - capOboles);

/**
 * Surplus des maisons PNJ de secours (docs/specs/08-ia.md, 8.3 ; 05-economie.md, 5.5 ; #716). Chaque maison PNJ du monde
 * dont la cité a un plafond de trésorerie dans la configuration (`npcHouses.<cité>.treasuryCapOboles`) verse ce qui le
 * dépasse au puits `sink_npc_house_surplus`, par une écriture `npc_house.surplus` : une maison PNJ ne thésaurise pas et
 * ne gonfle pas la masse. Seule sa trésorerie compte : le séquestre de ses achats en attente reste à l'agora.
 * Une cité que la configuration ne nomme plus n'a pas de plafond, et ses maisons PNJ ne versent rien.
 * Jouée juste avant l'entretien, dans la transaction de la clôture, qui ne se joue qu'une fois par jour : rejouée,
 * elle ne verse rien de plus. Ordre des verrous de l'entretien (agora, puits de l'entretien, bourses des PNJ, puis les
 * trésoreries), avec ce puits avant les trésoreries : une opération des règles d'une maison PNJ (agora, trésorerie)
 * attend la clôture.
 */
export const npcHouseSurplusStep: CloseStep = {
  name: 'npcHouseSurplus',
  async run({ trx, worldId, gameDay, config, at }) {
    const summary = { houses: 0, oboles: 0 };
    const capOf = (slug: string) =>
      Object.hasOwn(config.npcHouses, slug) ? config.npcHouses[slug]?.treasuryCapOboles : undefined;
    const houses = (
      await trx
        .selectFrom('game.npc_houses as n')
        .innerJoin('game.cities as c', 'c.id', 'n.city_id')
        .innerJoin('game.accounts as a', (join) =>
          join.onRef('a.house_id', '=', 'n.house_id').on('a.kind', '=', 'house'),
        )
        .select(['n.house_id', 'n.city_id', 'c.slug', 'a.id as account_id'])
        .where('n.world_id', '=', worldId)
        .orderBy('n.house_id')
        .execute()
    ).flatMap((row) => {
      const cap = capOf(row.slug);
      return cap === undefined ? [] : [{ ...row, cap }];
    });
    if (houses.length === 0) return summary;
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${worldId}`}, 0))`.execute(
      trx,
    );
    await lockUpkeepSinks(trx, worldId);
    await lockNpcPurses(trx, worldId);
    const sink = await trx
      .selectFrom('game.accounts')
      .select('id')
      .where('world_id', '=', worldId)
      .where('system_key', '=', 'sink_npc_house_surplus')
      .forUpdate()
      .executeTakeFirstOrThrow(() => new Error(`World ${worldId} has no sink_npc_house_surplus`));
    for (const house of houses) {
      at?.(`house ${house.house_id}`);
      const { balance } = await trx
        .selectFrom('game.accounts')
        .select('balance')
        .where('id', '=', house.account_id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const surplus = npcHouseSurplus(Number(balance), house.cap);
      if (surplus === 0) continue;
      const entry = await trx
        .insertInto('game.ledger_entries')
        .values({
          world_id: worldId,
          kind: 'npc_house.surplus',
          meta: JSON.stringify({
            houseId: house.house_id,
            cityId: house.city_id,
            capOboles: house.cap,
            gameDay,
          }),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('game.ledger_lines')
        .values([
          { entry_id: entry.id, account_id: house.account_id, amount: -surplus },
          { entry_id: entry.id, account_id: sink.id, amount: surplus },
        ])
        .execute();
      summary.houses += 1;
      summary.oboles += surplus;
    }
    return summary;
  },
};
