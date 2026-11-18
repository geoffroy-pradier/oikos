import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { DECREE_MODELS } from '@oikos/contracts';
import { decreeVotingClosesAt } from '@oikos/sim';
import {
  appWithConfig,
  code,
  db,
  DECREES,
  eventsOf,
  newWorld,
  owner,
  propose,
  rows,
  TAX,
  works,
} from './city-decree.integration-fixtures';
import { newAccount, TEST_CONFIG } from './test-config';

// Proposition d'un décret par l'archonte en charge, contre Supabase local.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

describe('city.proposeDecree', () => {
  it('la base n’admet que les modèles du catalogue des contrats', async () => {
    const [check] = await rows(sql<{
      definition: string;
    }>`select pg_get_constraintdef(oid) as definition
      from pg_constraint where conrelid = 'game.decrees'::regclass and conname = 'decrees_model_check'`);
    expect(
      [...(check?.definition ?? '').matchAll(/'([a-z_]+)'::text/g)].map((match) => match[1]),
    ).toEqual([...DECREE_MODELS]);
  });

  it('l’archonte en charge propose ; rejouée, même réponse ; vote clos après votingDays jours pleins', async () => {
    const { alice, kalliste } = await newWorld();
    const key = randomUUID();
    const proposed = await propose(alice.user, TAX, key);
    expect(proposed).toMatchObject({
      status: 200,
      body: { data: { cityId: kalliste, model: 'market_tax_rate' } },
    });
    expect(await propose(alice.user, TAX, key)).toEqual(proposed);
    const decreeId = proposed.body.data.decreeId as string;
    const [row] = await rows(sql<{
      params: unknown;
      quorum_bps: number;
      proposed_at: Date;
      voting_closes_at: Date;
      status: string;
    }>`
      select params, quorum_bps, proposed_at, voting_closes_at, status from game.decrees where id = ${decreeId}`);
    expect(row).toMatchObject({
      params: TAX.params,
      quorum_bps: DECREES.quorumBps,
      status: 'proposed',
    });
    expect(row?.voting_closes_at).toEqual(
      decreeVotingClosesAt(
        row?.proposed_at ?? new Date(0),
        DECREES.votingDays,
        TEST_CONFIG.config.clock,
      ),
    );
    expect(proposed.body.data.votingClosesAt).toBe(row?.voting_closes_at.toISOString());
    expect(await eventsOf('DecreeProposed', decreeId)).toEqual([
      {
        decreeId,
        cityId: kalliste,
        houseId: alice.houseId,
        decree: TAX,
        votingClosesAt: proposed.body.data.votingClosesAt,
      },
    ]);
  });

  it('seul l’archonte en charge propose : ni un citoyen, ni un métèque, ni l’archonte d’un mandat fini', async () => {
    const world = await newWorld();
    const [citizen, metic, former] = [
      await world.player(),
      await world.player(world.kalliste, false),
      await world.player(),
    ];
    await world.archon(former.houseId, true);
    for (const house of [citizen, metic, former])
      expect(code(await propose(house.user, TAX))).toBe('NOT_ARCHON');
    expect(code(await propose(await newAccount(owner), TAX))).toBe('HOUSE_NOT_FOUND');
    expect(await rows(sql`select id from game.decrees where world_id = ${world.worldId}`)).toEqual(
      [],
    );
  });

  it('paramètre hors des bornes du monde, modèle fermé, configuration sans décrets', async () => {
    const { alice } = await newWorld();
    const tooHigh = await propose(alice.user, { ...TAX, params: { rateBps: 1001 } });
    expect(tooHigh.body.error).toMatchObject({
      code: 'DECREE_PARAMS_OUT_OF_BOUNDS',
      fields: ['params.rateBps'],
    });
    expect(code(await propose(alice.user, { ...TAX, params: { rateBps: 5001 } }))).toBe(
      'VALIDATION_FAILED',
    );
    const party = {
      model: 'festival',
      params: { amountOboles: 300, days: 2, goodIds: ['bread', 'salt'] },
    };
    expect((await propose(alice.user, party)).body.error).toMatchObject({
      fields: ['params.goodIds.1'],
    });
    const models = { ...DECREES.models, festival: undefined };
    const closed = appWithConfig((config) => ({ ...config, decrees: { ...DECREES, models } }));
    expect(code(await propose(alice.user, party, undefined, closed))).toBe('DECREE_MODEL_CLOSED');
    const older = appWithConfig((config) => ({ ...config, decrees: undefined }));
    expect(code(await propose(alice.user, TAX, undefined, older))).toBe('DECREE_MODEL_CLOSED');
  });

  it('une dépense ne dépasse pas la part du trésor admise, arrondie à l’obole inférieure', async () => {
    const { alice, fund } = await newWorld();
    expect(code(await propose(alice.user, works(600)))).toBe('SPENDING_CAP_EXCEEDED');
    const treasury = Math.ceil((1000 * 10_000) / DECREES.spendingCapShareBps) + 1;
    await fund(treasury);
    expect(code(await propose(alice.user, works(1001)))).toBe('SPENDING_CAP_EXCEEDED');
    expect(code(await propose(alice.user, works(1000)))).toBe('ok');
  });

  it('propositions concurrentes : jamais plus de décrets au vote que la cité n’en admet', async () => {
    const { alice, kalliste } = await newWorld();
    const replies = await Promise.all(
      Array.from({ length: DECREES.maxOpenPerCity + 2 }, () => propose(alice.user, TAX)),
    );
    expect(replies.filter((reply) => code(reply) === 'ok')).toHaveLength(DECREES.maxOpenPerCity);
    expect(replies.filter((reply) => code(reply) === 'TOO_MANY_OPEN_DECREES')).toHaveLength(2);
    const [open] = await rows(
      sql<{ n: number }>`select count(*)::int as n from game.decrees where city_id = ${kalliste}`,
    );
    expect(open?.n).toBe(DECREES.maxOpenPerCity);
  });
});
