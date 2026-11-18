import { decreeSpendingCapOboles, decreeVotingClosesAt } from '@oikos/sim';
import { closeOf, treasuryOf, type City } from './city';
import { atRealTime, dateDecree } from './calendar';
import type { Seller } from './strategy';
import { worldConfig } from './world';

/*
 * Stratégie d'archonte du banc (#282, docs/specs/06-cites-politique-communaute.md 6.2 et 6.3) : dans chaque cité,
 * deux maisons se portent candidates, les citoyens votent, l'archonte élu fait voter alternativement des grands
 * travaux et une fête, d'une part du plafond que le trésor de la cité permet. Les bornes (plafond, montants, jours,
 * biens de la fête, quorum, calendrier) viennent de la configuration jouée ; les constantes ci-dessous sont des
 * choix de stratégie, pas de l'équilibrage du jeu.
 */
/** Candidats par cité : les premières maisons de la cité, dans l'ordre de leur fondation. */
const CANDIDATES = 2;
/** Part du plafond de dépense que l'archonte propose, en points de base : il ne vide pas ce que le trésor permet. */
const SPEND_SHARE_BPS = 5000;
/** Un citoyen sur `DISSENT_EVERY` vote contre un décret : le vote n'est pas unanime. */
const DISSENT_EVERY = 3;
/** Jours d'une fête, au plus ceux que la configuration permet. */
const FESTIVAL_DAYS = 3;

interface Candidate {
  houseId: string;
  candidacyId: string;
  votes: number;
}
/** Élection suivie par le banc. */
interface Followed {
  cityId: string;
  candidates: Candidate[];
  voted: boolean;
}
/** Décret proposé par un archonte du banc, avec l'issue que ses votes imposent ; `closesAt` : fin du vote, à l'heure de jeu. */
export interface Proposed {
  decreeId: string;
  cityId: string;
  model: 'public_works' | 'festival';
  amountOboles: number;
  closesAt: Date;
  adopted: boolean;
}
export interface Politics {
  elections: Map<string, Followed>;
  decrees: Proposed[];
}
export const newPolitics = (): Politics => ({ elections: new Map(), decrees: [] });

/** Le candidat d'un électeur : lui-même s'il se présente, sinon la maison qui a le plus de sites (la plus ancienne d'abord). */
export function ballotOf(
  voter: { houseId: string },
  candidates: readonly { houseId: string; sites: number }[],
) {
  const own = candidates.find((candidate) => candidate.houseId === voter.houseId);
  if (own) return own;
  return candidates.reduce((best, candidate) => (candidate.sites > best.sites ? candidate : best));
}

/** Vainqueur attendu d'une élection : le plus de bulletins, la candidature la plus ancienne à égalité (6.2). */
export const winnerOf = (candidates: readonly Candidate[]) =>
  candidates.reduce((best, candidate) => (candidate.votes > best.votes ? candidate : best));

/** Issue d'un vote de décret (6.3) : le quorum de l'électorat, et strictement plus de voix pour que contre. */
export const adoptedBy = (
  votes: { for: number; against: number },
  electorate: number,
  quorumBps: number,
) => (votes.for + votes.against) * 10_000 >= quorumBps * electorate && votes.for > votes.against;

/** Les maisons d'une cité qui sont citoyennes, dans l'ordre reçu. */
const citizensOf = async (city: City, houses: readonly Seller[]) => {
  const rows = await city.db
    .selectFrom('game.citizenships')
    .select('house_id')
    .where('city_id', '=', city.cityId)
    .where('status', '=', 'citizen')
    .execute();
  const citizens = new Set(rows.map((row) => row.house_id));
  return houses.filter((house) => citizens.has(house.houseId));
};

/**
 * Vie politique de la cité à l'instant de jeu `now` : dépôt des candidatures, vote, puis, pour l'archonte en
 * charge, un décret de dépense si aucun n'est ouvert. Les commandes sont celles du jeu, jouées à l'heure réelle
 * de la base (`atRealTime`) ; seule la date du décret est ramenée à l'heure de jeu.
 */
export async function politicsMorning(
  city: City,
  houses: readonly Seller[],
  now: Date,
  politics: Politics,
) {
  const citizens = await citizensOf(city, houses);
  if (citizens.length === 0) return;
  const election = await city.db
    .selectFrom('game.elections')
    .select(['id', 'candidacy_opens_at', 'voting_opens_at', 'voting_closes_at'])
    .where('city_id', '=', city.cityId)
    .where('tallied_at', 'is', null)
    .executeTakeFirst();
  const filing = election && election.candidacy_opens_at <= now && now < election.voting_opens_at;
  const voting = election && election.voting_opens_at <= now && now < election.voting_closes_at;
  const followed = election && politics.elections.get(election.id);
  if (election && filing && !followed) {
    const candidates: Candidate[] = [];
    await atRealTime(city, now, async () => {
      for (const house of citizens.slice(0, CANDIDATES)) {
        const filed = await city.send(house.user, 'city.standForElection', {
          electionId: election.id,
        });
        if (!filed.ok) throw new Error(`city.standForElection: ${filed.error?.code}`);
        candidates.push({ houseId: house.houseId, candidacyId: filed.data.candidacyId, votes: 0 });
      }
    });
    politics.elections.set(election.id, { cityId: city.cityId, candidates, voted: false });
  }
  if (election && voting && followed && !followed.voted) {
    await atRealTime(city, now, async () => {
      for (const voter of citizens) {
        const choice = ballotOf(
          voter,
          followed.candidates.map((candidate) => ({
            ...candidate,
            sites: houses.find((house) => house.houseId === candidate.houseId)?.sites.length ?? 0,
          })),
        );
        const candidate = followed.candidates.find((each) => each.houseId === choice.houseId);
        if (!candidate) throw new Error(`No candidate ${choice.houseId}`);
        const cast = await city.send(voter.user, 'city.castVote', {
          electionId: election.id,
          candidacyId: candidate.candidacyId,
        });
        if (!cast.ok) throw new Error(`city.castVote: ${cast.error?.code}`);
        candidate.votes += 1;
      }
    });
    followed.voted = true;
  }
  await proposeDecree(city, houses, citizens, now, politics);
}

/** Décret de dépense de l'archonte en charge : le modèle suivant, d'une part du plafond que le trésor permet. */
async function proposeDecree(
  city: City,
  houses: readonly Seller[],
  citizens: readonly Seller[],
  now: Date,
  politics: Politics,
) {
  const decrees = worldConfig.decrees;
  if (!decrees) return;
  const archon = await city.db
    .selectFrom('game.offices')
    .select('house_id')
    .where('city_id', '=', city.cityId)
    .where('office', '=', 'archon')
    .where('starts_at', '<=', now)
    .where('ends_at', '>', now)
    .executeTakeFirst();
  const house = houses.find((candidate) => candidate.houseId === archon?.house_id);
  if (!house) return;
  const pending = await city.db
    .selectFrom('game.decrees')
    .select('id')
    .where('city_id', '=', city.cityId)
    .where('status', 'in', ['proposed', 'adopted'])
    .executeTakeFirst();
  if (pending) return;
  const own = politics.decrees.filter((decree) => decree.cityId === city.cityId);
  const model = own.length % 2 === 0 ? 'public_works' : 'festival';
  const bounds = decrees.models[model];
  if (!bounds) return;
  const treasury = (await treasuryOf(city)).get(city.cityId) ?? 0;
  const cap = Number(decreeSpendingCapOboles(BigInt(treasury), decrees.spendingCapShareBps));
  const amountOboles = Math.min(bounds.maxOboles, Math.floor((cap * SPEND_SHARE_BPS) / 10_000));
  if (amountOboles < bounds.minOboles) return;
  const festival = decrees.models.festival;
  const proposal =
    model === 'public_works'
      ? { model, params: { amountOboles } }
      : {
          model,
          params: {
            amountOboles,
            days: Math.min(FESTIVAL_DAYS, festival?.maxDays ?? FESTIVAL_DAYS),
            goodIds: festival?.goodIds.slice(0, festival.maxGoods) ?? [],
          },
        };
  const votes = { for: 0, against: 0 };
  const closesAt = decreeVotingClosesAt(now, decrees.votingDays, worldConfig.clock);
  const decreeId = await atRealTime(city, now, async () => {
    const proposed = await city.send(house.user, 'city.proposeDecree', proposal);
    if (!proposed.ok) throw new Error(`city.proposeDecree: ${proposed.error?.code}`);
    for (const [index, voter] of citizens.entries()) {
      const approve = index % DISSENT_EVERY !== DISSENT_EVERY - 1;
      const cast = await city.send(voter.user, 'city.voteDecree', {
        decreeId: proposed.data.decreeId,
        approve,
      });
      if (!cast.ok) throw new Error(`city.voteDecree: ${cast.error?.code}`);
      votes[approve ? 'for' : 'against'] += 1;
    }
    return proposed.data.decreeId as string;
  });
  await dateDecree(city, decreeId, now, closesAt);
  politics.decrees.push({
    decreeId,
    cityId: city.cityId,
    model,
    amountOboles,
    closesAt,
    adopted: adoptedBy(votes, citizens.length, decrees.quorumBps),
  });
}

/** Décrets réglés par une clôture jouée jusqu'au jour `lastDay` : adoptés, leur montant sort du trésor de leur cité. */
export const settled = (world: City, politics: Politics, lastDay: number) =>
  politics.decrees.filter((decree) => decree.adopted && decree.closesAt <= closeOf(world, lastDay));
