-- Refus avant exécution et lectures du back-office (docs/specs/13-moteur-anti-triche.md ; ticket 65).
-- Le journal des commandes ne voit qu'une commande authentifiée, connue et admise par la limite de débit.
-- Ce qui est refusé avant (jeton absent ou invalide, corps trop gros, débit dépassé, accès refusé à une
-- lecture d'administration) est compté ici, par heure, sans aucun contenu de requête ni identité : un
-- visiteur anonyme ne doit pas pouvoir remplir une table en écrivant ce qu'il veut.

create table if not exists telemetry.api_refusals (
  -- Début de l'heure (UTC) où les refus ont eu lieu.
  bucket timestamptz not null check (bucket = date_trunc('hour', bucket, 'UTC')),
  kind text not null check (kind in ('command', 'admin_read')),
  reason text not null check (reason in ('unauthenticated', 'payload_too_large', 'rate_limited', 'forbidden')),
  count bigint not null check (count > 0),
  primary key (bucket, kind, reason)
);

-- Un compteur ne fait que croître ; son heure, sa nature et sa raison ne changent pas.
create or replace function telemetry.guard_api_refusal() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.bucket, new.kind, new.reason) is distinct from (old.bucket, old.kind, old.reason) then
    raise exception 'a refusal counter keeps its hour, kind and reason' using errcode = 'restrict_violation';
  end if;
  if new.count < old.count then
    raise exception 'a refusal counter only grows' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists api_refusals_guard on telemetry.api_refusals;
create trigger api_refusals_guard before update on telemetry.api_refusals
  for each row execute function telemetry.guard_api_refusal();
drop trigger if exists api_refusals_no_delete on telemetry.api_refusals;
create trigger api_refusals_no_delete before delete on telemetry.api_refusals
  for each row execute function game.forbid_change();
drop trigger if exists api_refusals_no_truncate on telemetry.api_refusals;
create trigger api_refusals_no_truncate before truncate on telemetry.api_refusals
  for each statement execute function game.forbid_change();

-- Lectures du back-office par un compte admis (second facteur et rôle) : qui a lu quoi, et l'issue.
-- La route est un gabarit (identifiants remplacés), jamais l'adresse complète ni ses paramètres.
create table if not exists telemetry.admin_reads (
  id uuid primary key default game.uuid_v7(),
  user_id uuid not null,
  admin_role text not null check (admin_role ~ '^[a-z][a-z_]{1,31}$'),
  route text not null check (route ~ '^/api/admin/[a-z0-9/:_-]{1,80}$'),
  status integer not null check (status between 100 and 599),
  created_at timestamptz not null default now()
);
create index if not exists admin_reads_user_idx on telemetry.admin_reads (user_id, id desc);
drop trigger if exists admin_reads_immutable on telemetry.admin_reads;
create trigger admin_reads_immutable before update or delete on telemetry.admin_reads
  for each row execute function game.forbid_change();
drop trigger if exists admin_reads_no_truncate on telemetry.admin_reads;
create trigger admin_reads_no_truncate before truncate on telemetry.admin_reads
  for each statement execute function game.forbid_change();

alter table telemetry.api_refusals enable row level security;
alter table telemetry.admin_reads enable row level security;
revoke all on telemetry.api_refusals, telemetry.admin_reads from public, anon, authenticated;
revoke execute on function telemetry.guard_api_refusal() from public, anon, authenticated, oikos_service;

-- Le service compte et trace ; il ne supprime rien et ne réécrit pas une trace.
grant select, insert on telemetry.api_refusals, telemetry.admin_reads to oikos_service;
grant update (count) on telemetry.api_refusals to oikos_service;
drop policy if exists service_all on telemetry.api_refusals;
create policy service_all on telemetry.api_refusals for all to oikos_service using (true) with check (true);
drop policy if exists service_all on telemetry.admin_reads;
create policy service_all on telemetry.admin_reads for all to oikos_service using (true) with check (true);
