import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { closeWorld } from '../scheduler';
import { archonTally } from './archon-tally';
import {
  at,
  config,
  db,
  eventsOf,
  newWorld,
  opened,
  ostracism,
  owner,
  step,
  TODAY,
} from './ostracism.integration-fixtures';
import { ostracismTally } from './ostracism-tally';

// Dépouillement de l'ostracisme à la clôture (6.4, #722), contre Supabase local : issue, saison, charge quittée.
describe('dépouillement de l’ostracisme', () => {
  it('le plus nommé, seul en tête, est ostracisé une saison ; une seule fois même rejoué', async () => {
    // Quatre citoyens : la maison 1 nommée deux fois, la 2 une fois ; 3 sur 4 bulletins, quorum de 30 %.
    const world = await newWorld(4, {
      closesAt: at(TODAY),
      quorumBps: 3000,
      ostraca: [
        [0, 1],
        [1, 1],
        [2, 2],
      ],
    });
    const runs = await Promise.all(
      [1, 2, 3].map(() =>
        closeWorld(db, { worldId: world.worldId, now: at(TODAY), config, steps: [ostracismTally] }),
      ),
    );
    expect(runs.flat()).toEqual([TODAY]);
    expect(await ostracism(world.ostracismId)).toEqual({
      outcome: 'ostracized:3:4',
      house: world.houseIds[1],
      ends_at: at(TODAY + 7),
    });
    expect((await eventsOf(world.ostracismId)).map((event) => event.payload)).toEqual([
      {
        ostracismId: world.ostracismId,
        cityId: world.cityId,
        outcome: 'ostracized',
        ballots: 3,
        electorate: 4,
        quorumReached: true,
      },
      {
        ostracismId: world.ostracismId,
        cityId: world.cityId,
        houseId: world.houseIds[1],
        ostraca: 2,
        endsAt: at(TODAY + 7).toISOString(),
        vacatedOfficeId: null,
      },
    ]);
    expect(await step(world, ostracismTally)).toEqual({ tallied: 0, ostracized: 0, vacated: 0 });
    // Fin après une saison : ostracisée jusqu'à la clôture du septième jour, exclue.
    const [season] = (
      await sql<{
        during: boolean;
        after: boolean;
      }>`select game.house_ostracized(${world.houseIds[1]}, ${new Date(at(TODAY + 7).getTime() - 1)}) as during,
        game.house_ostracized(${world.houseIds[1]}, ${at(TODAY + 7)}) as after`.execute(owner)
    ).rows;
    expect(season).toEqual({ during: true, after: false });
  });

  it('égalité en tête ou quorum manqué : personne n’est ostracisé', async () => {
    const tie = await newWorld(4, {
      closesAt: at(TODAY),
      quorumBps: 0,
      ostraca: [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
    });
    const missed = await newWorld(4, { closesAt: at(TODAY), quorumBps: 5000, ostraca: [[0, 1]] });
    expect(await step(tie, ostracismTally)).toEqual({ tallied: 1, ostracized: 0, vacated: 0 });
    expect(await step(missed, ostracismTally)).toEqual({ tallied: 1, ostracized: 0, vacated: 0 });
    expect(await ostracism(tie.ostracismId)).toEqual({
      outcome: 'tie:3:4',
      house: null,
      ends_at: null,
    });
    expect(await ostracism(missed.ostracismId)).toEqual({
      outcome: 'no_quorum:1:4',
      house: null,
      ends_at: null,
    });
    expect(
      (await eventsOf(missed.ostracismId)).map((event) => [
        event.type,
        event.payload['quorumReached'],
      ]),
    ).toEqual([['OstracismTallied', false]]);
  });

  it('archonte ostracisé : il quitte sa charge à cette clôture, et l’élection dépouillée ensuite l’écarte', async () => {
    const world = await newWorld(3, {
      closesAt: at(TODAY),
      quorumBps: 0,
      ostraca: [
        [1, 0],
        [2, 0],
      ],
    });
    // Élection du mandat suivant, close à cette clôture : l'archonte, candidat le premier, a deux bulletins.
    const electionId = randomUUID();
    await owner.transaction().execute(async (trx) => {
      for (const name of ['elections', 'candidacies', 'ballots'])
        await sql`alter table ${sql.table(`game.${name}`)} disable trigger ${sql.ref(`${name}_guard`)}`.execute(
          trx,
        );
      await sql`insert into game.elections (id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at)
        values (${electionId}, ${world.worldId}, ${world.cityId}, 'archon', now() - interval '8 days', now() - interval '4 days', ${at(TODAY)}, ${at(TODAY + 28)})`.execute(
        trx,
      );
      for (const [rank, house] of [0, 1].entries())
        await sql`insert into game.candidacies (election_id, house_id, created_at)
          values (${electionId}, ${world.houseIds[house]}, now() - interval '7 days' + ${`${rank} hours`}::interval)`.execute(
          trx,
        );
      for (const [voter, house] of [
        [0, 0],
        [1, 0],
        [2, 1],
      ] as const)
        await sql`insert into game.ballots (election_id, house_id, candidacy_id, cast_at)
          select ${electionId}, ${world.houseIds[voter]}, id, now() - interval '3 days' from game.candidacies
          where election_id = ${electionId} and house_id = ${world.houseIds[house]}`.execute(trx);
      for (const name of ['elections', 'candidacies', 'ballots'])
        await sql`alter table ${sql.table(`game.${name}`)} enable trigger ${sql.ref(`${name}_guard`)}`.execute(
          trx,
        );
    });
    const runs = await closeWorld(db, {
      worldId: world.worldId,
      now: at(TODAY),
      config,
      steps: [ostracismTally, archonTally],
    });
    expect(runs).toEqual([TODAY]);
    const offices = (
      await sql<{
        id: string;
        house_id: string;
        vacated: boolean;
        in_office: boolean;
      }>`select o.id, o.house_id,
        o.vacated_at is not null as vacated, v.in_office from game.offices o join public.offices v on v.id = o.id
        where o.city_id = ${world.cityId} order by o.starts_at`.execute(owner)
    ).rows;
    expect(offices).toEqual([
      { id: world.officeId, house_id: world.houseIds[0], vacated: true, in_office: false },
      expect.objectContaining({ house_id: world.houseIds[1], vacated: false }),
    ]);
    expect((await eventsOf(world.ostracismId)).at(-1)?.payload).toMatchObject({
      houseId: world.houseIds[0],
      vacatedOfficeId: world.officeId,
    });
  });
});

describe('dépouillement et bulletins concurrents', () => {
  it('un bulletin déposé avant la fin du vote et validé pendant le dépouillement est attendu et compté', async () => {
    const world = await newWorld(2, {
      closesAt: new Date(Date.now() + 1_500),
      quorumBps: 0,
      ostraca: [],
    });
    const ballot = await db.startTransaction().execute();
    await sql`insert into game.ostraca (ostracism_id, house_id, target_house_id)
      values (${world.ostracismId}, ${world.houseIds[1]}, ${world.houseIds[0]})`.execute(ballot);
    await new Promise((resolve) => setTimeout(resolve, 1_600));
    const state = { settled: false };
    const tally = db
      .transaction()
      .execute((trx) =>
        ostracismTally.run({
          trx,
          worldId: world.worldId,
          gameDay: TODAY,
          closeAt: new Date(),
          config: opened,
        }),
      )
      .finally(() => (state.settled = true));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(state.settled).toBe(false);
    await ballot.commit().execute();
    expect(await tally).toEqual({ tallied: 1, ostracized: 1, vacated: 1 });
    expect(await ostracism(world.ostracismId)).toMatchObject({
      outcome: 'ostracized:1:2',
      house: world.houseIds[0],
    });
  });
});

describe('clôture rattrapée longtemps après', () => {
  it('l’ostracisme est daté par le jour de la clôture : déjà fini, il n’écarte personne, et le monde avance', async () => {
    // Vote clos il y a dix jours, dépouillé maintenant par la clôture de ce jour-là : fin à son septième jour.
    const world = await newWorld(3, {
      closesAt: at(TODAY - 10),
      quorumBps: 0,
      ostraca: [
        [1, 0],
        [2, 0],
      ],
    });
    const late = await db.transaction().execute((trx) =>
      ostracismTally.run({
        trx,
        worldId: world.worldId,
        gameDay: TODAY - 10,
        closeAt: at(TODAY - 10),
        config: opened,
      }),
    );
    expect(late).toEqual({ tallied: 1, ostracized: 1, vacated: 0 });
    expect(await ostracism(world.ostracismId)).toMatchObject({
      house: world.houseIds[0],
      ends_at: at(TODAY - 3),
    });
    expect((await eventsOf(world.ostracismId)).at(-1)?.payload).toMatchObject({
      endsAt: at(TODAY - 3).toISOString(),
      vacatedOfficeId: null,
    });
    const [state] = (
      await sql<{ ostracized: boolean; vacated: boolean }>`select
        game.house_ostracized(${world.houseIds[0]}, now()) as ostracized,
        (select vacated_at is not null from game.offices where id = ${world.officeId}) as vacated`.execute(
        owner,
      )
    ).rows;
    expect(state).toEqual({ ostracized: false, vacated: false });
    // La clôture du jour passe, l'archonte reste en charge et peut être élu.
    expect(
      await closeWorld(db, {
        worldId: world.worldId,
        now: at(TODAY),
        config,
        steps: [ostracismTally, archonTally],
      }),
    ).toEqual([TODAY]);
  });
});
