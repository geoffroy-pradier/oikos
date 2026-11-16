import { charisDecay } from '@oikos/sim';
import { sql } from 'kysely';
import type { CloseStep } from '../close';

/**
 * Déclin de la Charis (docs/specs/07-dieux-faveur-evenements.md, 7.1) : à chaque clôture, la Charis de chaque
 * maison du monde envers chaque dieu perd le déclin quotidien de ce dieu, arrondi vers zéro (`charisDecay`),
 * par une ligne `decay` du journal de la Charis. Un dieu sans déclin, ou absent de la configuration en
 * vigueur, ne fait rien perdre ; une Charis trop petite pour perdre une unité non plus. La base n'accepte
 * qu'un déclin par Charis et par jour de jeu, dans la transaction qui enregistre la clôture de ce jour : une
 * clôture rejouée ne fait pas décliner deux fois.
 * Ni monnaie ni stock : l'étape ne prend pas l'agora. Elle verrouille les Charis du monde dans l'ordre des
 * maisons et des dieux ; une offrande verrouille la sienne avant l'agora, si bien qu'aucune des deux
 * n'attend l'autre en tenant ce que l'autre attend.
 */
export const favorDecay: CloseStep = {
  name: 'favorDecay',
  async run({ trx, worldId, gameDay, config, at }) {
    const decayOf = new Map(config.gods.map((god) => [god.id, god.dailyDecayBps]));
    const declining = [...decayOf].filter(([, bps]) => bps > 0).map(([godId]) => godId);
    if (declining.length === 0) return { decayed: 0, charisLost: 0 };
    const favors = await trx
      .selectFrom('game.favor')
      .select(['house_id', 'god_id', 'charis'])
      .where('world_id', '=', worldId)
      .where('god_id', 'in', declining)
      .where('charis', '>', sql<string>`0`)
      .orderBy('house_id')
      .orderBy('god_id')
      .forUpdate()
      .execute();
    const lines = favors
      .map((favor) => {
        at?.(`house ${favor.house_id}`);
        return {
          world_id: worldId,
          house_id: favor.house_id,
          god_id: favor.god_id,
          amount: -charisDecay(Number(favor.charis), decayOf.get(favor.god_id) ?? 0),
          kind: 'decay' as const,
          game_day: gameDay,
        };
      })
      .filter((line) => line.amount < 0);
    // Par paquets : une instruction garde un nombre borné de paramètres.
    for (let start = 0; start < lines.length; start += 1_000)
      await trx
        .insertInto('game.favor_ledger')
        .values(lines.slice(start, start + 1_000))
        .execute();
    return {
      decayed: lines.length,
      charisLost: lines.reduce((sum, line) => sum - line.amount, 0),
    };
  },
};
