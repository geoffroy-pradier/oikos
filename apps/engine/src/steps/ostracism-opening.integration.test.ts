import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import {
  at,
  db,
  decrees,
  eventsOf,
  newWorld,
  opened,
  step,
  TODAY,
} from './ostracism.integration-fixtures';
import { ostracismOpening } from './ostracism-opening';

// Ouverture du vote d'ostracisme à la clôture (6.4, #722), contre Supabase local.
describe('ouverture du vote d’ostracisme', () => {
  it('modèle fermé : le décret attend ; ouvert : un vote, clos après votingDays jours, une seule fois', async () => {
    const world = await newWorld(2);
    expect(await step(world, ostracismOpening, { ...opened, decrees })).toEqual({
      opened: 0,
      waiting: 1,
    });
    expect(await step(world, ostracismOpening)).toEqual({ opened: 1, waiting: 0 });
    expect(await step(world, ostracismOpening)).toEqual({ opened: 0, waiting: 0 });
    const [vote] = (
      await sql<{ id: string; voting_closes_at: Date; quorum_bps: number; ostracism_days: number }>`
        select id, voting_closes_at, quorum_bps, ostracism_days from game.ostracisms where decree_id = ${world.decreeId}`.execute(
        db,
      )
    ).rows;
    expect(vote).toMatchObject({
      voting_closes_at: at(TODAY + 3),
      quorum_bps: 3000,
      ostracism_days: 7,
    });
    expect(await eventsOf(vote?.id ?? '')).toEqual([
      {
        type: 'OstracismOpened',
        payload: {
          ostracismId: vote?.id,
          decreeId: world.decreeId,
          cityId: world.cityId,
          votingClosesAt: at(TODAY + 3).toISOString(),
          quorumBps: 3000,
          ostracismDays: 7,
        },
      },
    ]);
  });
});
