-- Chronique des cités (docs/specs/06-cites-politique-communaute.md, 6.6 ; 08-ia.md, 8.1 et 8.4 ; 15-back-office-olympe.md,
-- 15.2 ; ticket 271) : une chronique par cité et par clôture, écrite par le moteur après la clôture, à partir des faits
-- de la journée. Rejouable (`if not exists`, contraintes dans la création de la table, déclencheurs recréés, vue créée
-- une fois, ADR 0006) ; le code précédent ne lit ni n'écrit cette table ni cette vue.

-- Une chronique : sa cité, le jour de jeu de la clôture qui la publie, les faits qu'elle raconte (lus par le moteur
-- seul), ses textes en français et en anglais, et leur source : la réécriture de l'IA, ou le repli par gabarits.
-- Une seule par cité et par clôture : rejouer la tâche n'en écrit pas une seconde. Elle suit une clôture enregistrée.
create table if not exists game.chronicle_articles (
  id uuid primary key default game.uuid_v7(),
  world_id uuid not null references game.worlds (id),
  city_id uuid not null,
  game_day integer not null,
  facts jsonb not null,
  text_fr text not null,
  text_en text not null,
  source text not null,
  created_at timestamptz not null default now(),
  constraint chronicle_articles_once unique (city_id, game_day),
  constraint chronicle_articles_city_same_world foreign key (city_id, world_id) references game.cities (id, world_id),
  constraint chronicle_articles_played_close foreign key (world_id, game_day)
    references game.daily_closes (world_id, game_day),
  constraint chronicle_articles_facts check (jsonb_typeof(facts) = 'object'),
  -- Plafond technique : la réécriture est bornée par la configuration (au plus 4 000 caractères), le repli par
  -- le nombre de faits qu'il raconte.
  constraint chronicle_articles_texts check (length(text_fr) between 1 and 16000 and length(text_en) between 1 and 16000),
  constraint chronicle_articles_source check (source in ('ai', 'fallback'))
);
create index if not exists chronicle_articles_world_day_idx on game.chronicle_articles (world_id, game_day);

-- Une chronique publiée ne change plus : on ne réécrit pas l'histoire d'une cité.
drop trigger if exists chronicle_articles_immutable on game.chronicle_articles;
create trigger chronicle_articles_immutable before update or delete on game.chronicle_articles
  for each row execute function game.forbid_change();
drop trigger if exists chronicle_articles_no_truncate on game.chronicle_articles;
create trigger chronicle_articles_no_truncate before truncate on game.chronicle_articles
  for each statement execute function game.forbid_change();

-- Le service lit et insère, sans dater ; personne ne modifie. Les joueurs connectés lisent toutes les chroniques,
-- sans leurs faits ; un visiteur anonyme ne lit rien.
alter table game.chronicle_articles enable row level security;
revoke all on game.chronicle_articles from public, anon, authenticated, oikos_service;
grant select on game.chronicle_articles to oikos_service;
grant insert (world_id, city_id, game_day, facts, text_fr, text_en, source) on game.chronicle_articles to oikos_service;
drop policy if exists service_all on game.chronicle_articles;
create policy service_all on game.chronicle_articles for all to oikos_service using (true) with check (true);
grant select (id, world_id, city_id, game_day, text_fr, text_en, source, created_at)
  on game.chronicle_articles to authenticated;
drop policy if exists chronicle_articles_read on game.chronicle_articles;
create policy chronicle_articles_read on game.chronicle_articles for select to authenticated using (true);
do $$
begin
  if to_regclass('public.chronicle_articles') is null then
    create view public.chronicle_articles with (security_invoker = true) as
      select id, world_id, city_id, game_day, text_fr, text_en, source, created_at
      from game.chronicle_articles;
  end if;
end $$;
revoke all on public.chronicle_articles from public, anon;
grant select on public.chronicle_articles to authenticated;
