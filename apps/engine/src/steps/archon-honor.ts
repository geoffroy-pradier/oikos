import { recordHonorChange } from '@oikos/db';
import { honorChange } from '@oikos/sim';
import { sql } from 'kysely';
import type { CloseStep } from '../close';

/**
 * Timè d'un mandat d'archonte mené à son terme (docs/specs/04-systemes-gestion.md, 4.1 ; #704) : la clôture qui
 * atteint la fin d'un mandat, celle qui dépouille l'élection du suivant, crédite la maison qui l'a tenu du gain
 * `honor.changes.archon_term`, rogné aux bornes de la Timè. Un mandat est crédité par la clôture dont l'instant
 * est le premier à dépasser sa fin : il a pris fin depuis la clôture précédente du monde. Un mandat fini plus tôt
 * ne l'est jamais après coup, même si une configuration plus récente rend le gain non nul. La base n'admet qu'une
 * ligne par charge : rejouée, l'étape ne crédite pas deux fois. Sans section `honor` (version publiée avant la
 * Timè), ou avec un gain nul, rien n'est écrit. Ni monnaie ni stock : elle ne prend que les verrous de la Timè des
 * maisons créditées, dans l'ordre de leurs identifiants.
 */
export const archonHonor: CloseStep = {
  name: 'archonHonor',
  async run({ trx, worldId, gameDay, closeAt, config, at }) {
    const summary = { credited: 0, honorGained: 0 };
    const honor = config.honor;
    if (!honor || honor.changes.archon_term === 0) return summary;
    const previous = await trx
      .selectFrom('game.daily_closes')
      .select(sql<Date | null>`max(close_at)`.as('close_at'))
      .where('world_id', '=', worldId)
      .executeTakeFirst();
    const since = previous?.close_at ?? null;
    const ended = await trx
      .selectFrom('game.offices')
      .select(['id', 'house_id'])
      .where('world_id', '=', worldId)
      .where('ends_at', '<=', closeAt)
      .$if(since !== null, (query) => query.where('ends_at', '>', since as Date))
      .orderBy('house_id')
      .orderBy('id')
      .execute();
    for (const office of ended) {
      at?.(`office ${office.id}`);
      const written = await recordHonorChange(
        trx,
        {
          worldId,
          houseId: office.house_id,
          reason: 'archon_term',
          reference: office.id,
          gameDay,
        },
        (balance) => honorChange(balance, 'archon_term', honor),
      );
      if (!written) continue;
      summary.credited += 1;
      summary.honorGained += written.amount;
    }
    return summary;
  },
};
