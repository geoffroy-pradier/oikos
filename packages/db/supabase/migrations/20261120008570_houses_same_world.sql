-- Maisons lisibles du seul monde du joueur (docs/specs/12-modele-donnees.md ; docs/specs/06-cites-politique-communaute.md,
-- 6.6 ; ticket 857). La règle `houses_read` de la migration 2 (`using (true)`) laissait un joueur connecté lire, par
-- `public.houses`, le nom, le blason et la cité des maisons de tous les mondes.
--
-- Une règle restrictive s'ajoute à la règle permissive, sans la remplacer : la migration 2, rejouée, recrée
-- `houses_read` sans condition (ADR 0004 : elle ne se modifie plus), mais ne touche pas à cette règle-ci, qui reste
-- donc en place pendant tout le rejeu. Une ligne de `game.houses` n'est lisible par un joueur connecté que si son monde
-- est celui d'une de ses maisons ; un compte sans maison n'en lit aucune, un visiteur anonyme n'a toujours aucun droit.
-- Décision (ambiguïté du ticket, « le monde du joueur ») : un compte qui a hérité des maisons de plusieurs mondes,
-- d'avant la règle d'une maison par compte (#604), lit les maisons de chacun de ces mondes, les siennes comprises.
--
-- Colonnes de `public.houses` inchangées (ADR 0006), vue non recréée : le code précédent lit les mêmes colonnes et ne
-- recevait d'un autre monde que des lignes qu'il écartait. Toute lecture de `game.houses` au nom d'un joueur connecté
-- suit la règle, `public.house_honor` comprise ; le service (`service_all`) et les fonctions exécutées au nom du
-- propriétaire ne sont pas concernés. Rejouable.

-- Mondes des maisons du compte connecté. Au nom du propriétaire, comme `current_house_ids()` : une règle de
-- `game.houses` ne peut relire `game.houses` sans s'appeler elle-même. Elle ne rend que des identifiants de monde, déjà
-- lisibles par `public.worlds`, et ne prend aucun paramètre.
create or replace function game.current_world_ids() returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select distinct world_id from game.houses where user_id = (select auth.uid());
$$;
revoke all on function game.current_world_ids() from public, anon, oikos_service;
grant execute on function game.current_world_ids() to authenticated;

drop policy if exists houses_same_world on game.houses;
create policy houses_same_world on game.houses as restrictive for select to authenticated
  using (world_id in (select game.current_world_ids()));
