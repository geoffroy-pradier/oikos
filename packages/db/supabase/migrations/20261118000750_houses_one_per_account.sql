-- Un compte ne fonde qu'une maison dans tout le jeu, tous mondes confondus (#604, docs/specs/11-architecture.md, 11.4).
-- L'unicité par monde et par compte (`houses_one_per_user`) reste en place. Un déclencheur refuse en plus toute maison
-- nouvelle, ou passée à un autre compte, d'un compte qui en a déjà une, quel qu'en soit le monde. Il ne vérifie pas les
-- lignes déjà là : un compte qui a hérité plusieurs maisons d'avant cette règle les garde, et la migration passe
-- toujours, sans rien supprimer. Ce compte agit par la plus ancienne (création, puis identifiant), que l'API désigne.
-- Le refus prend le nom `houses_one_per_user`, que l'API traduit déjà en `HOUSE_ALREADY_EXISTS`, version précédente
-- comprise. Rejouable.

-- Au nom de l'appelant : seuls le propriétaire et le service écrivent une maison, et tous deux les lisent toutes.
create or replace function game.houses_one_per_account() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_relid <> 'game.houses'::regclass then
    raise exception '% only runs on game.houses', tg_name using errcode = 'insufficient_privilege';
  end if;
  -- Une maison qui reste à son compte, même hérité avec plusieurs maisons, n'est pas une maison nouvelle du compte.
  if tg_op = 'UPDATE' and new.user_id = old.user_id then
    return new;
  end if;
  -- Deux fondations simultanées du même compte se suivent : la seconde lit la première une fois celle-ci validée, ce
  -- qu'un instantané pris en début de transaction (REPEATABLE READ, SERIALIZABLE) ne ferait pas. Ces niveaux sont donc
  -- refusés, en échec de sérialisation, que l'appelant peut rejouer en READ COMMITTED.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'houses_one_per_account requires READ COMMITTED'
      using errcode = 'serialization_failure', schema = 'game', table = 'houses';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('game.houses_one_per_account:' || new.user_id::text, 0));
  if exists (select 1 from game.houses h where h.user_id = new.user_id and h.id <> new.id) then
    raise exception 'duplicate key value violates unique constraint "houses_one_per_user"'
      using errcode = 'unique_violation', constraint = 'houses_one_per_user', schema = 'game', table = 'houses',
            detail = 'This account already has a house, in this world or another.';
  end if;
  return new;
end;
$$;
revoke all on function game.houses_one_per_account() from public, anon, authenticated, oikos_service;

drop trigger if exists houses_one_per_account on game.houses;
create trigger houses_one_per_account
  before insert or update of user_id on game.houses
  for each row execute function game.houses_one_per_account();

-- Maison d'un compte, lue par l'API et par le déclencheur : par compte, la plus ancienne d'abord.
create index if not exists houses_user_id_idx on game.houses (user_id, created_at, id);
