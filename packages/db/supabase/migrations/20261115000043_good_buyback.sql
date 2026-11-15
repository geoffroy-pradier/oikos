-- Rachat du stock d'un bien à retirer (docs/specs/05-economie.md, 5.1 et 5.5 ; ticket 229).
-- La commande d'Olympe `admin.buyBackGood` paie chaque maison depuis un robinet dédié et retire son stock
-- de la circulation vers l'extrémité système `good_buyback` du journal des stocks.
-- Rejouable (`on conflict do nothing`, contrainte posée si absente) ; le code précédent n'écrit ni ce
-- robinet ni cette extrémité, et reste donc compatible.

-- Robinet du rachat : le catalogue crée son compte dans chaque monde existant, et dans chaque monde à venir.
insert into game.system_account_kinds (key, allow_negative)
values ('faucet_good_buyback', true)
on conflict do nothing;

-- Un stock racheté ne revient jamais : aucun mouvement ne part de l'extrémité `good_buyback`.
-- `not valid` : la contrainte vaut pour toute ligne écrite après elle, sans relire le journal entier ;
-- aucune ligne antérieure ne peut partir de cette extrémité, qu'aucun code n'écrivait.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_ledger_buyback_one_way'
                   and conrelid = 'game.stock_ledger'::regclass) then
    alter table game.stock_ledger add constraint stock_ledger_buyback_one_way
      check (from_system is distinct from 'good_buyback') not valid;
  end if;
end $$;

-- Le rachat lit deux fois les stocks non vides d'un bien, tous mondes confondus, sous le verrou d'agora de
-- chaque monde concerné : un index partiel évite de parcourir tous les stocks pendant ce temps.
create index if not exists inventories_held_by_good_idx on game.inventories (good_id) where quantity > 0;
