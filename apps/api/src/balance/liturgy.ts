import { sql } from 'kysely';
import { cash, recipeOf, setOwedToLevy, wageOf, worstLodging, type City, type House } from './city';
import { upkeepOf } from './strategy';

/*
 * Liturgies de la stratégie scriptée (#721, docs/specs/06-cites-politique-communaute.md 6.4 et 5.5) : une maison que la
 * clôture a désignée accomplit sa liturgie (`liturgy.perform`) si sa trésorerie, hors séquestre, couvre le dû et garde
 * `RESERVE_DAYS` jours de ses dépenses courantes ; sinon, ou si la maison est de celles qui se dérobent toujours
 * (`EVADE_EVERY`), elle s'y dérobe, et la clôture de l'échéance prélève d'office ce que la trésorerie couvre
 * (`liturgy.levy`). Le seuil et la part des maisons qui se dérobent sont des choix de stratégie, pas de l'équilibrage
 * du jeu.
 */
/** Jours d'entretien, de salaires et d'hébergement (au pire prix) qu'une maison garde après avoir accompli une liturgie. */
const RESERVE_DAYS = 3;
/** Faste ajouté au dû : aucun, le banc ne joue pas la surenchère. */
const SPLENDOR = 0;
/** Une maison sur `EVADE_EVERY`, dans l'ordre des maisons du banc, s'est donné pour règle de se dérober toujours. */
export const EVADE_EVERY = 4;

/** Ce que les maisons du banc ont payé aux liturgies, par voie. */
export interface Liturgies {
  performed: number;
  /** Oboles payées par les liturgies accomplies (dû et faste). */
  performedOboles: number;
  /** Liturgies auxquelles une maison s'est dérobée, réglées par le prélèvement d'office de leur échéance. */
  evaded: number;
  /** Oboles que le prélèvement d'office a prises, d'après le résumé de l'étape de la clôture. */
  leviedOboles: number;
  /** Liturgies prélevées en partie seulement : la trésorerie ne couvrait pas le dû. */
  partial: number;
}
export const newLiturgies = (): Liturgies => ({
  performed: 0,
  performedOboles: 0,
  evaded: 0,
  leviedOboles: 0,
  partial: 0,
});

/** Résumé de l'étape `liturgyLevy` d'une clôture jouée. */
export function countLevy(liturgies: Liturgies, summary: Record<string, unknown>) {
  const levy = summary['liturgyLevy'] as { leviedOboles?: number; partial?: number } | undefined;
  liturgies.leviedOboles += levy?.leviedOboles ?? 0;
  liturgies.partial += levy?.partial ?? 0;
}

/**
 * L'échéance d'une liturgie ramenée à l'instant réel, le temps de `body` : les commandes jugent l'échéance à l'heure de
 * la base, alors que la clôture désigne et prélève à l'heure de jeu (comme `atRealTime`). La garde de règlement est
 * levée pour cette seule écriture.
 */
async function atRealTime<T>(city: City, liturgyId: string, now: Date, body: () => Promise<T>) {
  const gap = Date.now() - now.getTime();
  const shift = (sign: 1 | -1) =>
    city.owner.transaction().execute(async (trx) => {
      await sql`alter table game.liturgies disable trigger liturgies_settle`.execute(trx);
      await sql`update game.liturgies set due_at = due_at + ${sign * gap}::float8 * interval '1 millisecond'
        where id = ${liturgyId}`.execute(trx);
      await sql`alter table game.liturgies enable trigger liturgies_settle`.execute(trx);
    });
  await shift(1);
  try {
    return await body();
  } finally {
    await shift(-1);
  }
}

/** Matinée d'une maison : ses liturgies désignées, accomplies ou laissées au prélèvement d'office. */
export async function liturgyMorning(
  city: City,
  house: House,
  now: Date,
  liturgies: Liturgies,
  known: Set<string>,
  evades: boolean,
) {
  const open = await city.db
    .selectFrom('game.liturgies')
    .select(['id', 'due'])
    .where('house_id', '=', house.houseId)
    .where('status', '=', 'assigned')
    .orderBy('due_at')
    .execute();
  for (const liturgy of open) {
    if (known.has(liturgy.id)) continue;
    known.add(liturgy.id);
    const due = Number(liturgy.due);
    const perWorker = wageOf(city) + worstLodging(city);
    const reserve =
      RESERVE_DAYS *
      house.sites.reduce(
        (sum, site) => sum + upkeepOf(site.recipeId) + recipeOf(site.recipeId).workers * perWorker,
        0,
      );
    if (evades || (await cash(city, house.houseId)) < due + SPLENDOR + reserve) {
      liturgies.evaded += 1;
      continue;
    }
    const done = await atRealTime(city, liturgy.id, now, () =>
      city.send(house.user, 'liturgy.perform', {
        liturgyId: liturgy.id,
        expectedDue: due,
        splendor: SPLENDOR,
      }),
    );
    if (!done.ok) throw new Error(`liturgy.perform: ${done.error?.code}`);
    liturgies.performed += 1;
    liturgies.performedOboles += due + SPLENDOR;
  }
  // Ce qui reste désigné est éludé : le prélèvement d'office le prendra à l'échéance, la maison ne le dépense pas.
  const left = await city.db
    .selectFrom('game.liturgies')
    .select('due')
    .where('house_id', '=', house.houseId)
    .where('status', '=', 'assigned')
    .execute();
  setOwedToLevy(
    house.houseId,
    left.reduce((sum, liturgy) => sum + Number(liturgy.due), 0),
  );
}
