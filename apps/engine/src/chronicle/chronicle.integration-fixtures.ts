import { randomUUID } from 'node:crypto';
import { INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import type { Db } from '@oikos/db';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';

/**
 * Monde d'essai de la chronique (#271), posé par le propriétaire de la base : deux cités, une maison, ses deux
 * dernières clôtures et les événements de sa journée, daté d'un an plus tôt.
 */
export const initial = INITIAL_CONFIG as GameConfig;
export const DAY = gameDayAt(new Date(), initial.clock) - 365;
export const CLOSE = dailyCloseAt(DAY, initial.clock);
/** Fin de la clôture du jour, puis de la précédente. */
export const FINISHED = new Date(CLOSE.getTime() + 60_000);
export const PREVIOUS = new Date(dailyCloseAt(DAY - 1, initial.clock).getTime() + 30_000);
const at = (offsetMs: number, from = PREVIOUS) => new Date(from.getTime() + offsetMs);

/**
 * `previous` : version de configuration lue par la clôture précédente (la même que celle du jour par défaut) ;
 * `null` : la clôture du jour est la première du monde.
 */
export async function chronicleWorld(
  owner: Db,
  configVersionId: string,
  previous: string | null = configVersionId,
) {
  const [worldId, userId, uuid] = [randomUUID(), randomUUID(), randomUUID];
  const ids = { kalliste: uuid(), elaia: uuid(), house: uuid() };
  const world = { id: worldId, slug: `ch-${worldId.slice(0, 12)}`, name: 'Chronique' };
  await owner.insertInto('game.worlds').values(world).execute();
  const cities = [
    { id: ids.kalliste, world_id: worldId, slug: 'kalliste', name: 'Kallistè' },
    { id: ids.elaia, world_id: worldId, slug: 'elaia', name: 'Elaia' },
  ];
  await owner.insertInto('game.cities').values(cities).execute();
  const user = { id: userId, email: `${userId}@example.test` };
  await owner
    .insertInto('auth.users' as never)
    .values(user as never)
    .execute();
  const house = { id: ids.house, world_id: worldId, user_id: userId, name: 'Alcméonides' };
  await owner
    .insertInto('game.houses')
    .values({ ...house, blazon: '{}' })
    .execute();
  const classes = [{ city: 'kalliste', classId: 'thetes', before: 1203, after: 1191 }];
  const close = (game_day: number, finished_at: Date, version: string, summary: object = {}) => ({
    world_id: worldId,
    game_day,
    close_at: dailyCloseAt(game_day, initial.clock),
    config_version_id: version,
    summary: JSON.stringify(summary),
    finished_at,
  });
  const closes = [close(DAY, FINISHED, configVersionId, { npcPopulation: { classes } })];
  if (previous) closes.unshift(close(DAY - 1, PREVIOUS, previous));
  await owner
    .insertInto('game.daily_closes')
    .values(closes as never)
    .execute();

  const order = { goodId: 'wheat', sellOrderId: uuid(), buyOrderId: null };
  const trade = (cityId: string, price: number, quantity: number) =>
    ['TradeExecuted', { ...order, tradeId: uuid(), cityId, price, quantity }] as const;
  const route = { fromCityId: ids.elaia, toCityId: ids.kalliste, houseId: ids.house };
  const voyage = { ...route, voyageId: uuid(), shipId: uuid(), cargo: [] };
  const arrival = {
    ...voyage,
    arrivesAt: at(4000).toISOString(),
    arrivedAt: at(4000).toISOString(),
  };
  const term = { termStartsAt: CLOSE.toISOString(), termEndsAt: FINISHED.toISOString() };
  const elected = {
    ...term,
    electionId: uuid(),
    cityId: ids.kalliste,
    houseId: ids.house,
    votes: 3,
  };
  const tally = {
    model: 'festival',
    votesFor: 4,
    votesAgainst: 1,
    electorate: 5,
    quorumReached: true,
  };
  const events: (readonly [Date, string, object])[] = [
    [at(-1000), ...trade(ids.kalliste, 99, 1000)], // avant la fin de la clôture précédente
    [at(1000), ...trade(ids.kalliste, 6, 10)],
    [at(2000), ...trade(ids.kalliste, 7, 5)],
    [at(3000), ...trade(uuid(), 50, 50)], // une cité d'un autre monde
    [at(3500), 'ArchonElected', { ...elected, houseId: uuid() }], // une maison introuvable
    [at(4000), 'VoyageArrived', arrival],
    // Sa cargaison perdue en mer (#730) : la chronique compte la perte, sans lire la maison.
    [
      at(4000),
      'CargoLostAtSea',
      {
        ...route,
        voyageId: voyage.voyageId,
        shipId: voyage.shipId,
        arrivedAt: arrival.arrivedAt,
        lossRiskBps: 1_500,
        cargo: [{ goodId: 'wheat', quantity: 30 }],
      },
    ],
    [at(4500), 'CargoLostAtSea', { ...route, cargo: [] }], // illisible : ignoré
    [at(5000), 'VoyageArrived', { cargo: [] }], // illisible : ignoré
    // Écrits par la clôture du jour, avant sa fin : ses résultats sont de cette journée.
    [at(1000, CLOSE), 'ArchonElected', elected],
    [at(2000, CLOSE), 'DecreeAdopted', { ...tally, decreeId: uuid(), cityId: ids.elaia }],
    [at(0, FINISHED), ...trade(ids.kalliste, 8, 8)], // après la fin de la clôture : la journée suivante
  ];
  const rows = events.map(([created_at, type, payload]) => ({
    type,
    payload: JSON.stringify(payload),
    created_at,
  }));
  await owner.insertInto('game.domain_events').values(rows).execute();
  return { worldId, ids, cities };
}
