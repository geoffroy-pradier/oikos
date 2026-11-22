import { NEMESIS_MODELS, type NemesisModel } from '@oikos/config';
import {
  nemesisAvertedSchema,
  nemesisStruckSchema,
  omenReceivedSchema,
  type DomainEvent,
} from '@oikos/contracts';
import { lockNpcPurses } from '@oikos/db';
import { dailyCloseAt, drawNemesisModel, nemesisExcess, nemesisRelief } from '@oikos/sim';
import { sql } from 'kysely';
import type { CloseStep } from '../close';
import { fallbackOmen, omenSeed } from '../nemesis/compose';
import { takeSanction } from './nemesis-sanctions';
import { lockUpkeepSinks } from './site-upkeep';

/** Modèles que la clôture tire aujourd'hui : les autres viennent avec les parties suivantes de #735. */
const DRAWN: readonly NemesisModel[] = ['lawsuit', 'warehouse_fire', 'artisan_desertion'];

/**
 * Présages et Némésis (docs/specs/07-dieux-faveur-evenements.md, 7.2 ; #735). D'abord l'échéance : chaque présage en
 * attente dont le jour d'échéance est atteint (ou passé, après une clôture manquée) se règle, une fois. Si la jauge
 * dépasse encore le seuil en vigueur, la sanction frappe : elle prend ce que dit son modèle (`takeSanction`), d'une
 * ampleur qui croît avec l'excès, puis la jauge redescend de l'excès compté (`nemesisRelief`), par une ligne `nemesis`
 * de son journal ; une maison qui n'a rien à perdre est frappée sans rien perdre. Sinon, sans règles de Némésis en
 * vigueur ou sans les bornes du modèle, la sanction est évitée. Puis les présages : chaque maison de joueur au-delà du
 * seuil sans présage en attente en reçoit un, d'un modèle tiré par sa graine parmi ceux en jeu, avec son texte de repli
 * (règle 6), échu `omenLeadDays` jours plus tard ; une jauge que la sanction laisse au-delà en reçoit donc un le jour même.
 * Rejouée dans la même transaction, l'étape ne règle ni n'adresse rien deux fois ; la base n'admet qu'un présage en
 * attente par maison, dans la transaction qui enregistre la clôture de son jour.
 * Placée après le retrait des maisons PNJ, avant le marché du travail et l'entretien, qui paie avec ce qui reste ; elle
 * lit la jauge que vient d'écrire `hubrisGauge`. Verrous, dans l'ordre de l'entretien : l'agora, les puits de
 * l'entretien, les bourses des PNJ, le puits `sink_nemesis`, puis chaque maison frappée par identifiant : sa trésorerie
 * (procès), ses sites puis son stock (incendie), ou son atelier (désertion). Sans présage échu, aucun verrou.
 */
export const nemesis: CloseStep = {
  name: 'nemesis',
  async run({ trx, worldId, gameDay, closeAt, config, at }) {
    const rules = config.hubris?.nemesis;
    const summary = { averted: 0, struck: 0, omens: 0 };
    const events: DomainEvent[] = [];
    const { rows: due } = await sql<{
      id: string;
      house_id: string;
      model: NemesisModel;
      gauge: string;
    }>`
      select o.id, o.house_id, o.model, coalesce(x.gauge, 0)::text as gauge from game.nemesis_omens o
      left join game.hubris x on x.house_id = o.house_id
      where o.world_id = ${worldId} and o.outcome is null and o.due_day <= ${gameDay}
      order by o.house_id for update of o`.execute(trx);
    if (due.length > 0) {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${worldId}`}, 0))`.execute(
        trx,
      );
      await lockUpkeepSinks(trx, worldId);
      await lockNpcPurses(trx, worldId);
      const sink = await trx
        .selectFrom('game.accounts')
        .select('id')
        .where('world_id', '=', worldId)
        .where('system_key', '=', 'sink_nemesis')
        .forUpdate()
        .executeTakeFirstOrThrow(() => new Error(`World ${worldId} has no sink_nemesis account`));
      for (const omen of due) {
        at?.(`omen ${omen.id}`);
        const excess = rules ? nemesisExcess(Number(omen.gauge), rules.threshold) : 0;
        if (!rules || excess === 0 || !rules.models[omen.model]) {
          await trx
            .updateTable('game.nemesis_omens')
            .set({ outcome: 'averted', settled_day: gameDay })
            .where('id', '=', omen.id)
            .execute();
          events.push(
            nemesisAvertedSchema.parse({
              type: 'NemesisAverted',
              payload: { omenId: omen.id, houseId: omen.house_id, model: omen.model, gameDay },
            }),
          );
          summary.averted += 1;
          continue;
        }
        const relief = nemesisRelief(excess, rules.fullExcess);
        await trx
          .insertInto('game.hubris_ledger')
          .values({
            world_id: worldId,
            house_id: omen.house_id,
            amount: -relief,
            cause: 'nemesis',
            game_day: gameDay,
          })
          .execute();
        const took = await takeSanction({
          trx,
          worldId,
          omen,
          excess,
          rules,
          sinkId: sink.id,
          closeAt,
          nextCloseAt: dailyCloseAt(gameDay + 1, config.clock),
        });
        await trx
          .updateTable('game.nemesis_omens')
          .set({
            outcome: 'struck',
            settled_day: gameDay,
            relief,
            magnitude_bps: took.magnitudeBps,
            oboles: took.oboles?.toString() ?? null,
            ledger_entry_id: took.entryId,
            inventory_id: took.inventoryId,
            quantity: took.quantity?.toString() ?? null,
            site_id: took.siteId,
            resumes_at: took.resumesAt,
            voyage_id: took.voyageId,
          })
          .where('id', '=', omen.id)
          .execute();
        await took.apply?.();
        events.push(
          nemesisStruckSchema.parse({
            type: 'NemesisStruck',
            payload: {
              omenId: omen.id,
              houseId: omen.house_id,
              model: omen.model,
              gameDay,
              magnitudeBps: took.magnitudeBps,
              oboles: took.oboles === null ? null : Number(took.oboles),
              inventoryId: took.inventoryId,
              goodId: took.goodId,
              quantity: took.quantity === null ? null : Number(took.quantity),
              siteId: took.siteId,
              resumesAt: took.resumesAt?.toISOString() ?? null,
              voyageId: took.voyageId,
            },
          }),
        );
        summary.struck += 1;
      }
    }

    const models = rules ? NEMESIS_MODELS.filter((m) => rules.models[m] && DRAWN.includes(m)) : [];
    if (rules && models.length > 0) {
      const { rows: houses } = await sql<{ id: string }>`select h.id from game.houses h
        join game.hubris x on x.house_id = h.id
        where h.world_id = ${worldId} and h.kind = 'player' and x.gauge > ${rules.threshold}::bigint
          and not exists (select 1 from game.nemesis_omens o where o.house_id = h.id and o.outcome is null)
        order by h.id`.execute(trx);
      const world = houses.length
        ? await trx
            .selectFrom('game.worlds')
            .select('seed')
            .where('id', '=', worldId)
            .executeTakeFirstOrThrow()
        : null;
      for (const house of houses) {
        at?.(`house ${house.id}`);
        const seed = omenSeed(world?.seed ?? '', house.id, gameDay);
        const model = drawNemesisModel(seed, models);
        const text = fallbackOmen(model, seed);
        const dueDay = gameDay + rules.omenLeadDays;
        const omen = await trx
          .insertInto('game.nemesis_omens')
          .values({
            world_id: worldId,
            house_id: house.id,
            model,
            text_fr: text.fr,
            text_en: text.en,
            omen_day: gameDay,
            due_day: dueDay,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        events.push(
          omenReceivedSchema.parse({
            type: 'OmenReceived',
            payload: { omenId: omen.id, houseId: house.id, model, omenDay: gameDay, dueDay },
          }),
        );
        summary.omens += 1;
      }
    }

    if (events.length > 0)
      await trx
        .insertInto('game.domain_events')
        .values(
          events.map((event) => ({
            command_id: null,
            type: event.type,
            payload: JSON.stringify(event.payload),
          })),
        )
        .execute();
    return summary;
  },
};
