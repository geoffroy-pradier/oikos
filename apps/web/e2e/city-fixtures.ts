import { createConfigLoader } from '@oikos/config';
import { createDb, type GameDatabase } from '@oikos/db';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { sql, type Transaction } from 'kysely';
import { KALLISTE_ID } from './helpers';

/**
 * Jeu d'essai de l'onglet Cité (#264), dans le monde du seed : une élection d'archonte de Kallistè en dépôt
 * des candidatures, et un décret au vote proposé par la maison Acropole, posée en base, qui tient la charge
 * d'archonte. L'écran ne lit que les maisons qu'il cite (#441) : son nom n'a plus à passer en tête de l'ordre
 * alphabétique, même dans une base locale de plus de 1 000 maisons. Les deux formats tournent en même temps
 * sur une base gardée d'un passage à l'autre : la mise en place est sérialisée par un verrou et réutilise ce
 * qui existe. Les fenêtres durent un an, pour qu'un passage suivant les trouve encore ouvertes.
 */
export const db = createDb(process.env['DATABASE_URL'] ?? '');
const WORLD_ID = '01900000-0000-7000-8000-000000000001';
const ARCHON_USER = '01900000-0000-7000-8000-00000000e264';
const ARCHON = '01900000-0000-7000-8000-00000000e265';
export const ARCHON_NAME = 'Acropole';
type Trx = Transaction<GameDatabase>;

/** La maison passe citoyenne de Kallistè, comme à la clôture qui la promeut. */
const naturalize = (trx: Trx, houseId: string) =>
  sql`update game.citizenships set status = 'citizen', since = now()
    where house_id = ${houseId} and status = 'metic'`.execute(trx);

/**
 * Charge d'archonte de Kallistè pour la maison, depuis `since` et jusqu'à `until` : une charge ne naît que
 * d'un dépouillement, on pose donc une élection déjà dépouillée et sa charge, gardes levées le temps de la
 * transaction. Deux charges posées dans une transaction ont chacune leur `since` : une élection par mandat.
 */
async function archon(trx: Trx, houseId: string, since: string, until: string) {
  await sql`alter table game.elections disable trigger elections_guard`.execute(trx);
  await sql`alter table game.offices disable trigger offices_guard`.execute(trx);
  await sql`with e as (insert into game.elections (world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at, tallied_at)
      values (${WORLD_ID}, ${KALLISTE_ID}, 'archon', now() - ${since}::interval - interval '2 days',
        now() - ${since}::interval - interval '1 day', now() - ${since}::interval, now() + ${until}::interval, now())
      returning *)
    insert into game.offices (world_id, city_id, office, house_id, election_id, starts_at, ends_at)
    select world_id, city_id, office, ${houseId}, id, voting_closes_at, term_ends_at from e`.execute(
    trx,
  );
  await sql`alter table game.elections enable trigger elections_guard`.execute(trx);
  await sql`alter table game.offices enable trigger offices_guard`.execute(trx);
}

/** Élection ouverte et décret au vote de Kallistè, posés une fois et réutilisés ensuite. */
async function scene(trx: Trx) {
  await sql`select pg_advisory_xact_lock(hashtext('e2e:city-scene'))`.execute(trx);
  // Une élection ouverte au dépôt des candidatures (la base n'en admet qu'une par cité).
  await sql`insert into game.elections (world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at)
    select ${WORLD_ID}, ${KALLISTE_ID}, 'archon', now() - interval '1 hour', now() + interval '1 year',
      now() + interval '1 year 1 day', now() + interval '1 year 30 days'
    where not exists (select 1 from game.elections
      where city_id = ${KALLISTE_ID} and office = 'archon' and tallied_at is null)`.execute(trx);
  // La maison Acropole : citoyenne de Kallistè, archonte en charge.
  await sql`insert into auth.users (id, email) values (${ARCHON_USER}, 'e2e-acropole@example.test')
    on conflict do nothing`.execute(trx);
  await sql`insert into game.houses (id, world_id, user_id, name, blazon)
    values (${ARCHON}, ${WORLD_ID}, ${ARCHON_USER}, ${ARCHON_NAME},
      '{"shape":"hoplon","tincture":"aegean","emblem":"owl"}') on conflict do nothing`.execute(trx);
  await sql`insert into game.citizenships (house_id, city_id) values (${ARCHON}, ${KALLISTE_ID})
    on conflict do nothing`.execute(trx);
  await naturalize(trx, ARCHON);
  const office = async () =>
    (
      await sql<{ id: string }>`select id from game.offices where house_id = ${ARCHON}
        and starts_at <= now() and ends_at > now() + interval '1 day' limit 1`.execute(trx)
    ).rows[0]?.id;
  if (!(await office())) await archon(trx, ARCHON, '1 day', '2 years');
  // Un décret de taux au vote, dans les bornes et au quorum de la configuration en vigueur.
  const { config } = await createConfigLoader(trx).at(new Date());
  const decrees = config.decrees;
  const tax = decrees?.models.market_tax_rate;
  if (!decrees || !tax)
    throw new Error('decrees.models.market_tax_rate attendu dans la configuration');
  await sql`insert into game.decrees (world_id, city_id, model, params, office_id, proposed_by, voting_closes_at, quorum_bps)
    select ${WORLD_ID}, ${KALLISTE_ID}, 'market_tax_rate', ${JSON.stringify({ rateBps: tax.maxRateBps })}::jsonb,
      ${await office()}, ${ARCHON}, now() + interval '1 year', ${decrees.quorumBps}
    where not exists (select 1 from game.decrees where proposed_by = ${ARCHON}
      and status = 'proposed' and voting_closes_at > now() + interval '1 day')`.execute(trx);
}

/** Pose la scène de Kallistè ; la maison nommée devient citoyenne, ou archonte en charge pour un jour. */
export const setUpCity = (houseName: string, role: 'metic' | 'citizen' | 'archon') =>
  db.transaction().execute(async (trx) => {
    await scene(trx);
    const house = (
      await sql<{ id: string }>`select id from game.houses where name = ${houseName}`.execute(trx)
    ).rows[0];
    if (!house) throw new Error(`Maison ${houseName} introuvable`);
    if (role !== 'metic') await naturalize(trx, house.id);
    if (role === 'archon') await archon(trx, house.id, '1 hour', '1 day');
  });

/**
 * Deux chroniques de Kallistè (#271), écrites comme par le moteur, sous le rôle de service et dans une
 * transaction : celle de la veille, réécrite par l'IA, et celle de l'avant-veille, de repli. Chacune suit une
 * clôture enregistrée de son jour, posée si elle manque. Rien n'est remplacé d'un passage à l'autre : une
 * chronique ne change plus une fois écrite. Rend les deux jours de jeu.
 */
export const setUpChronicles = () =>
  db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext('e2e:city-chronicle'))`.execute(trx);
    const { id: versionId, config } = await createConfigLoader(trx).at(new Date());
    const { clock } = config;
    const latest = gameDayAt(new Date(), clock) - 1;
    const earlier = latest - 1;
    await sql`set local role oikos_service`.execute(trx);
    for (const [day, source, fr, en] of [
      [earlier, 'fallback', 'Avant-veille E2E : journée calme.', 'Day before E2E: a quiet day.'],
      [latest, 'ai', 'Veille E2E : la gazette.\n\nUn navire au port.', 'Eve E2E: the gazette.'],
    ] as const) {
      await sql`insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
        values (${WORLD_ID}, ${day}, ${dailyCloseAt(day, clock)}, ${versionId})
        on conflict do nothing`.execute(trx);
      await sql`insert into game.chronicle_articles (world_id, city_id, game_day, facts, text_fr, text_en, source)
        values (${WORLD_ID}, ${KALLISTE_ID}, ${day}, '{}', ${fr}, ${en}, ${source})
        on conflict do nothing`.execute(trx);
    }
    return { latest, earlier };
  });
