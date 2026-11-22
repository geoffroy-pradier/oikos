-- Banques de joueurs : offres de prêt gagé (docs/specs/05-economie.md, 5.4 ; 12-modele-donnees.md ; ticket 728).
-- Le banquier offre un prêt à une maison de joueur de son monde, qui n'est pas la sienne : principal, taux, durée et
-- garantie, un stock (cité, bien, quantité) ou un logement. L'offre reste ouverte jusqu'à son retrait par le banquier ou
-- son acceptation par l'emprunteur, qui la ferme par le prêt qu'elle fait naître (migration 0301) ; ses conditions ne
-- changent jamais. La base ne juge pas la garantie à l'offre : le banquier ne sait rien du stock ni des biens de
-- l'emprunteur, et l'acceptation les vérifie.
-- Rejouable (`if not exists`, `create or replace`, déclencheurs, règles et droits recréés) ; compatible avec le code
-- précédent, qui n'écrit ni ne lit cette table.

create table if not exists game.bank_loan_offers (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  bank_id uuid not null,
  borrower_house_id uuid not null,
  -- Conditions du prêt : principal en oboles, taux annuel en points de base, durée en jours de jeu, bornés comme `loans`.
  principal bigint not null check (principal between 1 and 9007199254740991),
  rate_bps integer not null check (rate_bps between 0 and 1000000),
  term_days integer not null check (term_days between 1 and 3660),
  -- Garantie : un stock de l'emprunteur (cité, bien, quantité), ou l'un de ses logements.
  collateral_kind text not null check (collateral_kind in ('stock', 'property')),
  collateral_city_id uuid,
  collateral_good_id text check (collateral_good_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  collateral_quantity bigint check (collateral_quantity between 1 and 9007199254740991),
  collateral_property_id uuid,
  -- Ouverte, retirée par le banquier, ou acceptée par l'emprunteur ; fermée une fois, à l'instant de la transaction.
  status text not null default 'open' check (status in ('open', 'withdrawn', 'accepted')),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint bank_loan_offers_bank_same_world foreign key (bank_id, world_id) references game.banks (id, world_id),
  constraint bank_loan_offers_borrower_same_world foreign key (borrower_house_id, world_id)
    references game.houses (id, world_id),
  constraint bank_loan_offers_city_same_world foreign key (collateral_city_id, world_id)
    references game.cities (id, world_id),
  constraint bank_loan_offers_property_same_world foreign key (collateral_property_id, world_id)
    references game.properties (id, world_id),
  constraint bank_loan_offers_collateral check (
    (collateral_kind = 'stock' and collateral_city_id is not null and collateral_good_id is not null
       and collateral_quantity is not null and collateral_property_id is null)
    or (collateral_kind = 'property' and collateral_property_id is not null and collateral_city_id is null
       and collateral_good_id is null and collateral_quantity is null)),
  constraint bank_loan_offers_closed check ((status = 'open') = (closed_at is null))
);
create index if not exists bank_loan_offers_bank_idx on game.bank_loan_offers (bank_id, created_at);
create index if not exists bank_loan_offers_borrower_idx on game.bank_loan_offers (borrower_house_id, created_at);

-- Une offre naît maintenant, ouverte, pour une maison de joueur qui n'est pas celle de la banque. Ensuite elle ne change
-- qu'une fois, en se fermant à l'instant de la transaction : retirée par le service, ou acceptée par le seul déclencheur
-- du propriétaire qui fait naître son prêt (migration 0301). Ses conditions ne changent jamais.
create or replace function game.guard_bank_loan_offer() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_at is distinct from now() or new.status is distinct from 'open' or new.closed_at is not null then
      raise exception 'a loan offer is made now, open' using errcode = 'restrict_violation';
    end if;
    if not exists (select 1 from game.houses h where h.id = new.borrower_house_id and h.kind = 'player') then
      raise exception 'a loan offer goes to a player house' using errcode = 'check_violation',
        constraint = 'bank_loan_offers_borrower_player';
    end if;
    if exists (select 1 from game.banks b where b.id = new.bank_id and b.house_id = new.borrower_house_id) then
      raise exception 'a bank does not lend to its own house' using errcode = 'check_violation',
        constraint = 'bank_loan_offers_not_own_bank';
    end if;
    return new;
  end if;
  if (new.id, new.world_id, new.bank_id, new.borrower_house_id, new.principal, new.rate_bps, new.term_days,
      new.collateral_kind, new.collateral_city_id, new.collateral_good_id, new.collateral_quantity,
      new.collateral_property_id, new.created_at)
     is distinct from (old.id, old.world_id, old.bank_id, old.borrower_house_id, old.principal, old.rate_bps,
      old.term_days, old.collateral_kind, old.collateral_city_id, old.collateral_good_id, old.collateral_quantity,
      old.collateral_property_id, old.created_at) then
    raise exception 'a loan offer keeps its terms' using errcode = 'restrict_violation';
  end if;
  if old.status <> 'open' then
    raise exception 'a closed loan offer does not change' using errcode = 'restrict_violation';
  end if;
  if new.status = 'accepted' and not game.written_by_owner_trigger(tg_relid) then
    raise exception 'a loan offer is accepted only by its loan' using errcode = 'restrict_violation';
  end if;
  new.closed_at := case when new.status = 'open' then null else now() end;
  return new;
end;
$$;
revoke execute on function game.guard_bank_loan_offer() from public, anon, authenticated, oikos_service;

drop trigger if exists bank_loan_offers_guard on game.bank_loan_offers;
create trigger bank_loan_offers_guard before insert or update on game.bank_loan_offers
  for each row execute function game.guard_bank_loan_offer();
drop trigger if exists bank_loan_offers_no_delete on game.bank_loan_offers;
create trigger bank_loan_offers_no_delete before delete on game.bank_loan_offers
  for each row execute function game.forbid_change();
drop trigger if exists bank_loan_offers_no_truncate on game.bank_loan_offers;
create trigger bank_loan_offers_no_truncate before truncate on game.bank_loan_offers
  for each statement execute function game.forbid_change();

-- Le service offre sans choisir ni l'identifiant, ni la date, ni l'état, et retire une offre (droit sur `status`, que la
-- garde borne) ; rien ne se supprime. Les lectures des joueurs viennent avec la migration 0304.
alter table game.bank_loan_offers enable row level security;
revoke all on game.bank_loan_offers from public, anon, authenticated, oikos_service;
grant select on game.bank_loan_offers to oikos_service;
grant insert (world_id, bank_id, borrower_house_id, principal, rate_bps, term_days, collateral_kind, collateral_city_id,
  collateral_good_id, collateral_quantity, collateral_property_id), update (status)
  on game.bank_loan_offers to oikos_service;
drop policy if exists service_all on game.bank_loan_offers;
create policy service_all on game.bank_loan_offers for all to oikos_service using (true) with check (true);
