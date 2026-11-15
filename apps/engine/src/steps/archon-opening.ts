import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import type { CloseStep } from '../close';

/**
 * Ouverture de l'élection de l'archonte (6.2), après le dépouillement : dans chaque cité sans élection en
 * cours, celle du mandat suivant, qui commence à la fin du mandat de la dernière élection (pourvu ou
 * vacant). Elle s'ouvre `candidacyDays + votingDays` jours avant lui. Sans élection passée, ou si les
 * clôtures ont manqué le début du vote (moteur arrêté), elle s'ouvre à cette clôture et le mandat commence
 * d'autant plus tard ; une ouverture seulement retardée écourte le dépôt des candidatures. Le calendrier,
 * en instants de clôture, est fixé à l'ouverture : une configuration publiée ensuite ne le change pas. La
 * base n'admet qu'une élection ouverte par cité : rejouée, l'étape n'en ouvre pas une seconde. Sans section
 * `politics` (version publiée avant la citoyenneté), rien ne s'ouvre.
 */
export const archonOpening: CloseStep = {
  name: 'archonOpening',
  async run({ trx, worldId, gameDay, closeAt, config, at }) {
    const summary = { opened: 0 };
    const politics = config.politics;
    if (!politics) return summary;
    const { candidacyDays, votingDays, termDays } = politics.archon;
    const lead = candidacyDays + votingDays;
    const cities = await trx
      .selectFrom('game.cities')
      .select('id')
      .where('world_id', '=', worldId)
      .orderBy('id')
      .execute();
    for (const { id: cityId } of cities) {
      at?.(`city ${cityId}`);
      const last = await trx
        .selectFrom('game.elections')
        .select(['term_ends_at', 'tallied_at'])
        .where('city_id', '=', cityId)
        .where('office', '=', 'archon')
        .orderBy('voting_closes_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      if (last && last.tallied_at === null) continue;
      // Premier jour du mandat à pourvoir.
      let start = gameDay + lead;
      if (last) {
        const next = gameDayAt(last.term_ends_at, config.clock);
        if (gameDay < next - lead) continue;
        if (gameDay < next - votingDays) start = next;
      }
      await trx
        .insertInto('game.elections')
        .values({
          world_id: worldId,
          city_id: cityId,
          office: 'archon',
          candidacy_opens_at: closeAt,
          voting_opens_at: dailyCloseAt(start - votingDays, config.clock),
          voting_closes_at: dailyCloseAt(start, config.clock),
          term_ends_at: dailyCloseAt(start + termDays, config.clock),
        })
        .execute();
      summary.opened += 1;
    }
    return summary;
  },
};
