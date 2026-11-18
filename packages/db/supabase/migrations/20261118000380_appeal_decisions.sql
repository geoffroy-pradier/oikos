-- Décision sur les appels, lue par le joueur (docs/specs/18-indicateurs-risques-conformite.md, contenus ; 15.4 ;
-- ticket 529). `game.my_sanctions()` a un type rendu figé (ADR 0006) : la décision passe par une fonction et une vue
-- nouvelles, une ligne par appel tranché, sans l'auteur de la décision ni celui de la levée.
-- Rejouable (`create or replace`, vue créée sous condition, droits retirés puis redonnés) ; le code précédent ne lit
-- ni cette fonction ni cette vue, et la table des sanctions ne change pas.

-- Un compte lit la décision sur ses appels : accueilli ou rejeté, et son instant. Le schéma `admin` reste fermé aux
-- joueurs : la lecture passe par cette fonction du propriétaire, qui ne rend que les lignes du compte connecté, et
-- pas une exclusion encore à valider (comme `game.my_sanctions()`).
create or replace function game.my_appeal_decisions()
returns table (sanction_id uuid, decision text, decided_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select s.id, s.appeal_decision, s.appeal_decided_at
  from admin.sanctions s
  where s.user_id = (select auth.uid()) and s.appeal_decision is not null
    and (s.kind <> 'ban' or s.validated_by is not null);
$$;
revoke all on function game.my_appeal_decisions() from public, anon, authenticated, oikos_service;
grant execute on function game.my_appeal_decisions() to authenticated;

-- Vue créée sous condition (ADR 0006).
do $$
begin
  if to_regclass('public.my_appeal_decisions') is null then
    create view public.my_appeal_decisions with (security_invoker = true) as
      select sanction_id, decision, decided_at from game.my_appeal_decisions();
  end if;
end $$;
-- Les droits par défaut de Supabase donnent tout à `service_role` sur une vue de `public` : l'API ne lit pas celle-ci.
revoke all on public.my_appeal_decisions from public, anon, authenticated, oikos_service, service_role;
grant select on public.my_appeal_decisions to authenticated;
