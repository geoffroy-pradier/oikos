-- Issue d'un voyage lue par son joueur (docs/specs/04-systemes-gestion.md, 4.6 ; 12-modele-donnees.md ; ticket 730).
-- `my_voyages` gagne `cargo_lost` : nul tant que le voyage est en mer, puis vrai si sa cargaison est perdue (migration
-- 9960), faux sinon. Le joueur ne lit pas le journal des stocks : une fonction exécutée au nom du propriétaire lit
-- l'issue des seuls voyages arrivés de ses maisons, et ne rend rien pour un autre ni avant l'arrivée.
-- L'issue ne change plus une fois le voyage arrivé : la perte et le déchargement s'écrivent dans la transaction de
-- l'arrivée (contrôle `check_voyage_settled`, migration 81 : un voyage arrivé a toute sa cargaison sortie de
-- `in_transit`), et l'index unique `stock_ledger_voyage_unloaded_idx` refuse ensuite toute seconde sortie d'un bien,
-- si bien qu'aucun déchargement ne peut s'écrire après coup sur un voyage perdu, ni une perte sur un voyage déchargé.
-- Rejouable (ADR 0006) : la colonne n'est ajoutée à la vue, en fin de liste, que si elle n'y est pas ; la fonction
-- est recréée à signature égale. Compatible avec le code précédent, qui ne lit pas la colonne.

create or replace function game.voyage_cargo_lost(voyage_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when v.arrived_at is null then null
    else exists (select 1 from game.stock_ledger l
                 where l.voyage_id = v.id and l.from_system = 'in_transit' and l.to_system = 'lost_at_sea')
  end
  from game.voyages v
  where v.id = voyage_cargo_lost.voyage_id and v.house_id in (select game.current_house_ids());
$$;
revoke all on function game.voyage_cargo_lost(uuid) from public, anon;
grant execute on function game.voyage_cargo_lost(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'my_voyages' and column_name = 'cargo_lost') then
    create or replace view public.my_voyages with (security_invoker = true) as
      select v.id, v.house_id, v.ship_id, v.from_city_id, v.to_city_id, v.departed_at, v.arrives_at, v.arrived_at,
             coalesce((select jsonb_agg(jsonb_build_object('goodId', c.good_id, 'quantity', c.quantity)
                                        order by c.good_id collate "C")
                       from game.voyage_cargo c where c.voyage_id = v.id), '[]'::jsonb) as cargo,
             game.voyage_cargo_lost(v.id) as cargo_lost
      from game.voyages v;
  end if;
end $$;
grant select on public.my_voyages to authenticated;
