import { randomUUID } from 'node:crypto';
import type { GameConfig } from '@oikos/config';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appWithConfig,
  code,
  db,
  eventsOf,
  hire,
  newPlayer,
  owner,
  send,
} from './steward.integration-fixtures';

// Consignes d'intendant (#280), contre Supabase local. Chaque test fonde sa maison : un champ de blé et un moulin.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/** Usage `steward` ouvert, plafond large (ou nul), `quota` consignes par maison et par jour de jeu. */
const aiOn = (quota: number, budget = 100_000) =>
  appWithConfig((config): GameConfig => ({
    ...config,
    ai: {
      ...config.ai,
      budgetMicroEurosPerActivePlayerMonth: budget,
      expectedActivePlayers: 1_000_000,
      stewardDailyQuotaPerHouse: quota,
      usages: {
        ...config.ai.usages,
        steward: { ...config.ai.usages.steward, enabled: true, model: 'small' },
      },
    },
  }));
const [open, single] = [aiOn(10), aiOn(1)];
// Plafond d'un millionième d'euro : la sortie la plus chère d'un appel ne tient jamais dessous.
const capped = appWithConfig((config) => ({
  ...config,
  ai: {
    ...config.ai,
    budgetMicroEurosPerActivePlayerMonth: 1,
    expectedActivePlayers: 1,
    stewardDailyQuotaPerHouse: 10,
    usages: {
      ...config.ai.usages,
      steward: {
        ...config.ai.usages.steward,
        enabled: true,
        capShareBps: 10_000,
        outputMicroEurosPerThousandTokens: 1_000,
      },
    },
  },
}));

const TEXT = 'vends la farine au-dessus de 3 drachmes, garde 20 sacs';
const submit = (
  user: string,
  stewardId: string,
  via: typeof open,
  text = TEXT,
  key = randomUUID(),
) => send(user, 'steward.submitInstruction', { stewardId, text }, key, via);
const instructionsOf = (stewardId: string) =>
  db
    .selectFrom('game.steward_instructions')
    .select(['id', 'rules_revision', 'text', 'status'])
    .where('steward_id', '=', stewardId)
    .orderBy('created_at')
    .execute();
/** Répond à la consigne en attente, comme le moteur, pour libérer l'intendant. */
const answer = (stewardId: string) =>
  owner.transaction().execute(async (trx) => {
    await sql`insert into game.steward_proposals (instruction_id, refusal)
      select id, 'AMBIGUOUS' from game.steward_instructions where steward_id = ${stewardId} and status = 'pending'`.execute(
      trx,
    );
    await sql`update game.steward_instructions set status = 'answered'
      where steward_id = ${stewardId} and status = 'pending'`.execute(trx);
  });

describe('steward.submitInstruction', () => {
  it('IA coupée, refuse sans rien écrire : le formulaire reste la voie du jeu', async () => {
    const player = await newPlayer();
    const stewardId = await hire(player.user, player.mill);
    // La configuration de test garde tous les usages coupés, comme la configuration initiale.
    expect(code(await submit(player.user, stewardId, appWithConfig()))).toBe('AI_UNAVAILABLE');
    expect(code(await submit(player.user, stewardId, capped))).toBe('AI_UNAVAILABLE');
    expect(await instructionsOf(stewardId)).toEqual([]);
    expect(code(await send(player.user, 'steward.setRules', { stewardId, rules: [] }))).toBe('ok');
  });

  it('met la consigne en file, une seule en attente ; rejouée, rien de plus ; le texte reste hors du journal', async () => {
    const player = await newPlayer();
    const stewardId = await hire(player.user, player.mill);
    const key = randomUUID();
    const first = await submit(player.user, stewardId, open, `  ${TEXT}\n`, key);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ stewardId, instructionId: expect.any(String) });
    expect(await submit(player.user, stewardId, open, `  ${TEXT}\n`, key)).toEqual(first);
    const rows = await instructionsOf(stewardId);
    expect(rows).toEqual([
      { id: first.body.data.instructionId, rules_revision: 0, text: TEXT, status: 'pending' },
    ]);
    expect(code(await submit(player.user, stewardId, open, 'récolte'))).toBe('INSTRUCTION_PENDING');
    const logged = await sql<{ input: Record<string, unknown> }>`select input from game.command_log
      where user_id = ${player.user} and command = 'steward.submitInstruction'`.execute(db);
    // La consigne et son refus : l'une et l'autre sans texte.
    expect(logged.rows).toEqual(
      [1, 2].map(() => ({ input: expect.objectContaining({ redacted: true }) })),
    );
    const leaked = await sql`select 1 from game.command_log c where c.user_id = ${player.user}
      and (c.input::text || c.response::text) like ${'%drachmes%'}`.execute(db);
    expect(leaked.rows).toEqual([]);
    const events = (await eventsOf(player.houseId)).filter(
      (event) => event.type === 'StewardInstructionSubmitted',
    );
    expect(events.map((event) => event.payload)).toEqual([
      {
        stewardId,
        houseId: player.houseId,
        siteId: player.mill,
        instructionId: first.body.data.instructionId,
      },
    ]);
    // Répondue, la consigne en laisse passer une autre, à la révision en vigueur.
    await answer(stewardId);
    await send(player.user, 'steward.setRules', { stewardId, rules: [] });
    expect(code(await submit(player.user, stewardId, open, 'récolte'))).toBe('ok');
    expect((await instructionsOf(stewardId)).map((row) => row.rules_revision)).toEqual([0, 1]);
  });

  it('borne le texte en caractères, pas en unités de code ; refuse un texte blanc', async () => {
    const player = await newPlayer();
    const stewardId = await hire(player.user, player.mill);
    expect(code(await submit(player.user, stewardId, open, ' \n\t '))).toBe('VALIDATION_FAILED');
    expect(code(await submit(player.user, stewardId, open, 'a'.repeat(501)))).toBe(
      'VALIDATION_FAILED',
    );
    expect(code(await submit(player.user, stewardId, open, '🫒'.repeat(500)))).toBe('ok');
  });

  it('compte les consignes du jour de la maison, intendants renvoyés compris', async () => {
    const player = await newPlayer();
    const mill = await hire(player.user, player.mill);
    expect(code(await submit(player.user, mill, single))).toBe('ok');
    await answer(mill);
    expect(code(await submit(player.user, mill, single))).toBe('AI_UNAVAILABLE');
    await send(player.user, 'steward.dismiss', { stewardId: mill });
    const field = await hire(player.user, player.field);
    expect(code(await submit(player.user, field, single))).toBe('AI_UNAVAILABLE');
    expect(code(await submit(player.user, field, aiOn(2)))).toBe('ok');
  });

  it('l’intendant d’une autre maison, ou renvoyé, est inconnu', async () => {
    const [alice, bob] = [await newPlayer(), await newPlayer()];
    const stewardId = await hire(alice.user, alice.mill);
    expect(code(await submit(bob.user, stewardId, open))).toBe('STEWARD_NOT_FOUND');
    expect(code(await submit(alice.user, randomUUID(), open))).toBe('STEWARD_NOT_FOUND');
    await send(alice.user, 'steward.dismiss', { stewardId });
    expect(code(await submit(alice.user, stewardId, open))).toBe('STEWARD_NOT_FOUND');
    expect(await instructionsOf(stewardId)).toEqual([]);
  });

  it('sous concurrence : une seule consigne en attente par intendant, et le quota tient', async () => {
    const player = await newPlayer();
    const mill = await hire(player.user, player.mill);
    const same = await Promise.all([1, 2, 3].map(() => submit(player.user, mill, open)));
    expect(same.map(code).sort()).toEqual(['INSTRUCTION_PENDING', 'INSTRUCTION_PENDING', 'ok']);
    const other = await newPlayer();
    const stewards = [await hire(other.user, other.mill), await hire(other.user, other.field)];
    const raced = await Promise.all(stewards.map((id) => submit(other.user, id, single)));
    expect(raced.map(code).sort()).toEqual(['AI_UNAVAILABLE', 'ok']);
  });
});
