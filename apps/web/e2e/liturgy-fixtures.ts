import { createDb, type GameDatabase } from '@oikos/db';
import { sql, type Transaction } from 'kysely';
import { KALLISTE_ID } from './helpers';

/**
 * Jeu d'essai des liturgies et de l'ostracisme (#723), dans Kallistè : posé comme le moteur l'écrirait, sous les gardes
 * levées le temps d'une transaction (une liturgie ne naît qu'à une clôture, un règlement veut son écriture du grand
 * livre). Les autres maisons sont fixes et réutilisées d'un passage à l'autre ; chaque maison d'essai a la sienne.
 * La saison posée, 9001, est plus récente que toute saison réelle : c'est celle que l'onglet Cité montre.
 */
const WORLD_ID = '01900000-0000-7000-8000-000000000001';
const SEASON = 9001;
const OTHERS = [
  [
    '01900000-0000-7000-8000-00000000e723',
    '01900000-0000-7000-8000-00000000e72a',
    'Philaïdes',
    'levied',
    'trierarchy',
  ],
  [
    '01900000-0000-7000-8000-00000000e724',
    '01900000-0000-7000-8000-00000000e72b',
    'Alcméonides',
    'assigned',
    'choregia',
  ],
] as const;
type Trx = Transaction<GameDatabase>;

let current: ReturnType<typeof createDb> | undefined;
export const closeLiturgyDb = async () => {
  const closing = current;
  current = undefined;
  await closing?.destroy();
};
const inTransaction = <T>(run: (trx: Trx) => Promise<T>) =>
  (current ??= createDb(process.env['DATABASE_URL'] ?? '')).transaction().execute(run);

const houseId = async (trx: Trx, name: string) => {
  const house = (
    await sql<{ id: string }>`select id from game.houses where name = ${name}`.execute(trx)
  ).rows[0];
  if (!house) throw new Error(`Maison ${name} introuvable`);
  return house.id;
};

/** Pose une liturgie désignée (puis prélevée d'office si `levied`) de la maison, sans rien payer. */
async function liturgy(trx: Trx, house: string, genre: string, due: number, levied: boolean) {
  const days = levied ? sql`now() - interval '1 day'` : sql`now() + interval '3 days'`;
  const { rows } = await sql<{
    id: string;
  }>`insert into game.liturgies (world_id, city_id, house_id, season, genre, due, designated_day, due_day, due_at)
    values (${WORLD_ID}, ${KALLISTE_ID}, ${house}, ${SEASON}, ${genre}, ${due}, 1, 4, ${days})
    on conflict (house_id, season) do nothing returning id`.execute(trx);
  const id = rows[0]?.id;
  if (id && levied) {
    await sql`update game.liturgies set status = 'levied', splendor = 0, paid = 0, settled_day = 5, settled_at = now() where id = ${id}`.execute(
      trx,
    );
    await sql`insert into game.honor_ledger (world_id, house_id, amount, reason, reference, game_day)
      values (${WORLD_ID}, ${house}, -90, 'liturgy_evaded', ${id}, 5)`.execute(trx);
  }
  return id;
}

async function withGuardsLifted<T>(trx: Trx, run: () => Promise<T>): Promise<T> {
  const lifted = [
    'game.liturgies disable trigger liturgies_guard',
    'game.liturgies disable trigger liturgies_on_close',
    'game.liturgies disable trigger liturgies_settle',
    'game.liturgies disable trigger liturgies_levy_on_close',
    'game.honor_ledger disable trigger honor_ledger_guard',
    'game.honor_ledger disable trigger honor_ledger_on_close',
  ];
  for (const change of lifted) await sql.raw(`alter table ${change}`).execute(trx);
  try {
    return await run();
  } finally {
    for (const change of lifted)
      await sql.raw(`alter table ${change.replace(' disable ', ' enable ')}`).execute(trx);
  }
}

/**
 * La scène des liturgies de Kallistè : deux autres maisons désignées (l'une déjà prélevée d'office, l'autre à accomplir),
 * et la maison nommée, désignée à son tour : à accomplir (`assigned`, un dû de 600 oboles, 100 drachmes) ou déjà
 * prélevée d'office (`levied`, la Timè perdue est au journal). Se rejoue sans rien doubler.
 */
export const setUpLiturgies = (houseName: string, own: 'assigned' | 'levied') =>
  inTransaction(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext('e2e:liturgies'))`.execute(trx);
    for (const [id, user, name] of OTHERS) {
      await sql`insert into auth.users (id, email) values (${user}, ${`e2e-${id}@example.test`}) on conflict do nothing`.execute(
        trx,
      );
      await sql`insert into game.houses (id, world_id, user_id, name, blazon)
        values (${id}, ${WORLD_ID}, ${user}, ${name}, '{"shape":"hoplon","tincture":"aegean","emblem":"owl"}') on conflict do nothing`.execute(
        trx,
      );
      await sql`insert into game.citizenships (house_id, city_id) values (${id}, ${KALLISTE_ID}) on conflict do nothing`.execute(
        trx,
      );
    }
    const mine = await houseId(trx, houseName);
    await withGuardsLifted(trx, async () => {
      for (const [id, , , state, genre] of OTHERS)
        await liturgy(trx, id, genre, 900, state === 'levied');
      await liturgy(trx, mine, 'festival', 600, own === 'levied');
    });
  });

const ELAIA_ID = '01900000-0000-7000-8000-000000000103';
const ELAIA_HOUSES = [
  ['01900000-0000-7000-8000-00000000e725', '01900000-0000-7000-8000-00000000e72c', 'Étéoboutades'],
  ['01900000-0000-7000-8000-00000000e726', '01900000-0000-7000-8000-00000000e72d', 'Kérykes'],
] as const;

/** Maison, citoyenne de sa cité, posée pour le jeu d'essai. */
async function citizenHouse(trx: Trx, id: string, user: string, name: string, city: string) {
  await sql`insert into auth.users (id, email) values (${user}, ${`e2e-${id}@example.test`}) on conflict do nothing`.execute(
    trx,
  );
  await sql`insert into game.houses (id, world_id, user_id, name, blazon)
    values (${id}, ${WORLD_ID}, ${user}, ${name}, '{"shape":"hoplon","tincture":"aegean","emblem":"owl"}') on conflict do nothing`.execute(
    trx,
  );
  await sql`insert into game.citizenships (house_id, city_id) values (${id}, ${city}) on conflict do nothing`.execute(
    trx,
  );
  await sql`update game.citizenships set status = 'citizen', since = now() where house_id = ${id} and status = 'metic'`.execute(
    trx,
  );
}

/** Décret d'ostracisme adopté et vote qu'il ouvre, posés gardes levées (un décret de la charge d'archonte de la scène de Kallistè). */
async function ostracism(
  trx: Trx,
  city: string,
  tallied: boolean,
  named?: string,
  voters: readonly string[] = [],
) {
  const office = (
    await sql<{
      id: string;
    }>`select o.id from game.offices o join game.houses h on h.id = o.house_id
    where h.name = 'Acropole' order by o.starts_at desc limit 1`.execute(trx)
  ).rows[0]?.id;
  const proposer = await houseId(trx, 'Acropole');
  if (!office) throw new Error('Charge d’archonte de la scène de Kallistè introuvable');
  const decree = (
    await sql<{
      id: string;
    }>`insert into game.decrees (world_id, city_id, model, params, office_id, proposed_by,
      proposed_at, voting_closes_at, quorum_bps, status, tallied_at, electorate, votes_for, votes_against)
    values (${WORLD_ID}, ${city}, 'ostracism', '{}', ${office}, ${proposer}, now() - interval '9 days', now() - interval '7 days', 0,
      'adopted', now() - interval '7 days', 1, 1, 0) returning id`.execute(trx)
  ).rows[0]?.id;
  const closes = tallied ? sql`now() - interval '1 day'` : sql`now() + interval '1 year'`;
  const vote = (
    await sql<{
      id: string;
    }>`insert into game.ostracisms (world_id, city_id, decree_id, opened_at, voting_closes_at,
      quorum_bps, ostracism_days, tallied_at, electorate, ballots, outcome, ostracized_house_id, ends_at)
    values (${WORLD_ID}, ${city}, ${decree}, now() - interval '4 days', ${closes}, 2000, 7,
      ${tallied ? sql`now() - interval '1 day'` : null}, ${tallied ? voters.length : null}, ${tallied ? voters.length : null},
      ${tallied ? 'ostracized' : null}, ${tallied ? named : null}, ${tallied ? sql`now() + interval '30 days'` : null})
    returning id`.execute(trx)
  ).rows[0]?.id;
  for (const voter of voters)
    await sql`insert into game.ostraca (ostracism_id, house_id, target_house_id) values (${vote}, ${voter}, ${named})`.execute(
      trx,
    );
}

/** Lève, le temps de `run`, les gardes des décrets d'ostracisme, des votes et des bulletins. */
async function withVoteGuardsLifted<T>(trx: Trx, run: () => Promise<T>): Promise<T> {
  const lifted = [
    'game.decrees disable trigger decrees_guard',
    'game.decrees disable trigger decrees_guard_ostracism',
    'game.ostracisms disable trigger ostracisms_guard',
    'game.ostraca disable trigger ostraca_guard',
  ];
  for (const change of lifted) await sql.raw(`alter table ${change}`).execute(trx);
  try {
    return await run();
  } finally {
    for (const change of lifted)
      await sql.raw(`alter table ${change.replace(' disable ', ' enable ')}`).execute(trx);
  }
}

/**
 * Un vote d'ostracisme au vote à Kallistè (ouvert un an, jamais dépouillé), pour les citoyens de la scène (Acropole,
 * Philaïdes, Alcméonides), et un vote dépouillé à Elaia : Étéoboutades ostracisée, nommée par ses deux citoyens.
 * Se rejoue sans rien doubler ; `setUpCity` doit avoir posé la charge d'archonte de Kallistè.
 */
export const setUpOstracism = () =>
  inTransaction(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext('e2e:ostracism'))`.execute(trx);
    for (const [id, user, name] of OTHERS) await citizenHouse(trx, id, user, name, KALLISTE_ID);
    for (const [id, user, name] of ELAIA_HOUSES) await citizenHouse(trx, id, user, name, ELAIA_ID);
    await withVoteGuardsLifted(trx, async () => {
      const open =
        await sql`select 1 from game.ostracisms where city_id = ${KALLISTE_ID} and tallied_at is null`.execute(
          trx,
        );
      if (open.rows.length === 0) await ostracism(trx, KALLISTE_ID, false);
      const done = await sql`select 1 from game.ostracisms where city_id = ${ELAIA_ID}`.execute(
        trx,
      );
      if (done.rows.length === 0)
        await ostracism(
          trx,
          ELAIA_ID,
          true,
          ELAIA_HOUSES[0][0],
          ELAIA_HOUSES.map(([id]) => id),
        );
    });
  });
