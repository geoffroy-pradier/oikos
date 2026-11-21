# 12. Modèle de données

La base est découpée en cinq schémas Postgres, et seuls des vues et des canaux en lecture sont exposés au client. Deux journaux en partie double, l'un pour la monnaie, l'autre pour les stocks, font foi : les soldes ne sont que des cumuls vérifiables.

| Schéma | Rôle | Accès |
| --- | --- | --- |
| `game` | Tables de vérité du jeu | Écriture : API de jeu et moteur uniquement. Lecture cliente : seulement à travers les vues de `public`, sur des colonnes accordées une à une et sous règles par ligne ; le schéma n'est jamais exposé par l'API de Supabase |
| `public` | Vues de lecture pour le client | Joueurs, filtré par règles par ligne |
| `config` | Paramètres d'équilibrage versionnés | Lecture par l'API de jeu et le moteur, écriture par le back-office. Les valeurs utiles aux joueurs seront exposées par des vues de `public` quand un écran en aura besoin |
| `telemetry` | Événements et agrégats, partitionnés par jour | Moteur en écriture, back-office en lecture |
| `admin` | Sanctions, audit, tickets, rôles | Back-office uniquement |

## Tables principales

| Domaine | Tables |
| --- | --- |
| Monde | `worlds`, `cities`, `districts`, `parcels`, `routes`, `calendar` |
| Maison | `houses`, `house_members`, `skills`, `honor`, `honor_ledger`, `titles` |
| Sites | `sites`, `buildings`, `recipes_running`, `workers`, `labor_market`, `artisans`, `stewards`, `steward_rules` |
| Stocks | `inventories`, `stock_ledger`, `warehouses` |
| Monnaie | `accounts`, `ledger_entries`, `ledger_lines` |
| Marchés | `orders`, `trades`, `price_candles`, `contracts`, `auctions`, `bids`, `tenders` |
| Logistique | `ships`, `voyages`, `voyage_cargo`, `freight_offers` |
| Immobilier | `properties`, `leases`, `renovations` |
| Finance | `banks`, `deposits`, `loans`, `collaterals`, `companies`, `shares` |
| Cité | `citizenships`, `offices`, `elections`, `ballots`, `decrees`, `ostracisms`, `ostraca`, `city_budget`, `public_works`, `leagues` |
| Sacré | `favor`, `offerings`, `graces_used`, `hubris`, `oracles`, `festivals` |
| Événements | `world_events`, `event_effects`, `quests`, `domain_events` |
| IA | `npcs`, `npc_memories`, `ai_calls`, `prompts` |
| Social | `channels`, `messages`, `reports`, `friendships`, `chronicle_articles` |
| Commerce réel | `purchases`, `subscriptions`, `entitlements` |

## Règles de conception

- Identifiants UUID v7, horodatages en UTC, montants en entiers (oboles) pour éviter les arrondis.
- Toute écriture de monnaie crée une écriture équilibrée : la somme des lignes vaut zéro, contrôlée par contrainte.
  La création et la destruction de monnaie passent par des comptes système nommés (un par robinet et par puits), créés avec le monde à partir d'un catalogue ;
  le service de jeu ne peut pas en créer. Chaque maison a une trésorerie et, dès son premier achat en attente à l'agora, un compte de séquestre : la base contrôle à chaque validation que ce compte retient exactement la somme des restes à payer (prix × reste) des achats ouverts de la maison.
  Ce contrôle, comme les deux suivants, s'exécute au nom du propriétaire de la base : ce que le rôle appelant peut lire n'y change rien.
  Un séquestre ne paie que deux choses : un échange dont l'ordre d'achat est de sa maison, ou un retour à la trésorerie de cette même maison (écriture dont toutes les autres lignes créditent cette trésorerie).
  Chaque échange est réglé par sa propre écriture, qui ne règle que lui (index unique sur `trades.ledger_entry_id` : deux transactions concurrentes ne rattachent pas chacune un échange à la même écriture), de nature `market.trade` entre joueurs et `npc.purchase` pour un achat des PNJ ;
  la règle de son montant est en 5.3. Ces contrôles portent, à la validation, sur l'échange comme sur toute ligne ajoutée à son écriture.
  Le contrôle complet d'un échange tourne à l'insertion de l'échange et à celle de chaque ligne de son écriture, soit au plus cinq fois par échange (quatre lignes) : c'est une décision (ticket 205), pas une limite à lever.
  Éviter le contrôle d'une ligne écrite avant l'échange supposerait de savoir dans quel ordre l'une et l'autre ont été écrites ;
  ni le rang de commande ni la date ne le disent (une instruction peut appeler une fonction qui insère l'échange, puis écrire ses lignes après son contrôle), et un tel saut laissait des lignes ajoutées sans contrôle.
  Le coût reste borné par échange.
- Débits que la base accepte hors d'un échange (décision du ticket 205) : la trésorerie d'une maison qui paie celle d'une autre, un séquestre alimenté par la trésorerie d'une autre maison, et le robinet des achats des PNJ débité par une écriture sans échange (la bourse des PNJ, elle, ne paie que des échanges, #632).
  La base ne les refuse pas ; seul le code des commandes et du moteur les exclut, comme l'antidatage des activations avant le ticket 130.
  Raisons : les transferts entre maisons seront des mécaniques du jeu (contrats, prêts, banque, 5.4), et la base ne peut pas en tenir la liste sans devenir un second moteur de règles ;
  un séquestre payé par une autre maison revient au même transfert, puisqu'il ne rend qu'à la trésorerie de sa propre maison, et ses deux contrôles (montant retenu, à qui il paie) tiennent ;
  aucun robinet n'est lié en base à sa mécanique, et les jeux d'essai de la base se servent de celui-ci comme d'un robinet ordinaire.
  Aucun de ces débits ne crée ni ne détruit de monnaie hors des comptes système, et chacun reste dans le grand livre, avec sa nature, pour le tableau de bord (5.5) et la détection des transferts (13).
  Lier chaque compte système aux natures d'écriture qui le mouvementent serait le durcissement suivant, pour tous les robinets et puits à la fois.
- Bourse des PNJ (#632, 5.2 et 5.5) : chaque cité a, en plus de son trésor, un compte de cité marqué `npc_purse`, créé avec elle (et par la migration pour les cités existantes), jamais débiteur.
  Ce n'est pas un compte système : il compte dans la masse monétaire.
  Décision : une marque sur un compte de cité plutôt qu'une nature de compte nouvelle, que la migration 20, rejouée, refuserait (ADR 0004).
  La règle par ligne du service lui cache les bourses : le code d'avant, qui cherche le trésor d'une cité par sa seule cité, n'en trouve toujours qu'un.
  Le code les lit et les verrouille par deux fonctions au nom du propriétaire (`game.npc_purses()`, `game.lock_npc_purses(monde, cité)`), et les mouvemente par les journaux.
  Les comptes publics du trésor (`city_treasury`, `city_treasury_flows`) n'en montrent rien, et le contrôle d'équilibre d'une écriture s'exécute au nom du propriétaire, pour voir aussi les bourses.
  La bourse ne paie que des achats des PNJ de sa cité : une écriture `npc.purchase` qui règle un échange de son marché (garde `check_treasury_debit` et contrôle du règlement) ; elle ne reçoit jamais la taxe d'un échange.
  Elle ne reçoit que les salaires (`upkeep.daily`, `upkeep.restart`), l'hébergement (`lodging.daily`, `lodging.restart`) et le revenu public de sa cité (`npc.public_income` dont `meta.cityId` la désigne) : garde `check_npc_purse_credit` (#651), à l'insertion de la ligne, sans report possible, quel que soit le rôle.
  Qui paie ce crédit est vérifié à la validation, sur l'écriture entière (`check_npc_purse_payer`, #655) : un salaire ou un hébergement (`upkeep.*`, `lodging.*`) n'est débité que d'un seul compte, la trésorerie d'une maison qui a un site dans la cité de chaque bourse créditée ; un revenu public (`npc.public_income`) n'est débité que du robinet `faucet_npc_public_income` de son monde.
  Un intendant est sur un site de sa maison et l'hébergement va à la bourse de la cité du site : le site suffit.
  Pour le code précédent, le contrôle du règlement admet encore le robinet `faucet_npc_purchases` comme payeur d'un achat des PNJ ; une migration ultérieure pourra le retirer quand plus aucun moteur déployé ne l'écrira.
- Rachat du stock d'un bien à retirer (#229, 5.1) : le robinet `faucet_good_buyback` paie, par une écriture `admin.good_buyback` par maison, le stock qui part vers l'extrémité système `good_buyback` du journal des stocks, chaque mouvement rattaché à l'écriture de sa maison.
  Cette extrémité est à sens unique : la base refuse tout mouvement qui en part (contrainte `stock_ledger_buyback_one_way`), si bien qu'un stock racheté ne revient jamais en circulation.
  Les stocks non vides d'un bien se lisent par un index partiel (`inventories_held_by_good_idx`), que le rachat parcourt sous le verrou d'agora de chaque monde concerné.
  Comme pour les autres robinets (décision du ticket 205 ci-dessus), la base ne lie pas ce robinet au rachat ni ne contrôle son prix, qu'elle ne lit pas : seule la commande d'Olympe l'écrit.
- Règles de sécurité par ligne activées sur toutes les tables exposées, testées en pgTAP : un joueur lit ses données privées et les données publiques, rien d'autre.
- L'API et le moteur se connectent sous un rôle de service (`oikos_service`) qui ne possède aucune table du jeu : il lit, insère dans les journaux et les tables de jeu, mais ne peut ni supprimer ni vider, ni modifier un solde, un stock ou une réservation autrement que par les journaux.
  Les gardes de la base n'acceptent ces modifications que d'un déclencheur exécuté au nom du propriétaire des tables.
  Le service ne modifie que quelques colonnes (nom d'une maison, cycle et arrêt d'un site, quai et désarmement d'un navire, arrivée d'un voyage, annulation d'un ordre, report de la demande, valeurs d'un chandelier de prix ou d'un prix observé), n'exécute aucune fonction de déclencheur du jeu et ne possède que le schéma de sa file de tâches.
  Il garde le droit, accordé à tous par Postgres, de créer des tables temporaires : elles sont sans effet sur le jeu.
- Les données privées d'un concurrent (stocks, trésorerie, règles d'intendant) ne quittent jamais le serveur.
- Maisons (#857) : un joueur connecté ne lit une ligne de `houses` que si son monde est celui d'une de ses maisons (règle restrictive `houses_same_world`, par `game.current_world_ids()`, exécutée au nom du propriétaire).
  Un compte sans maison n'en lit aucune, un visiteur anonyme ne lit rien ; un compte qui a hérité des maisons de plusieurs mondes (#604) lit celles de chacun.
  La règle vaut pour toute lecture de `game.houses` au nom d'un joueur, `public.houses` et `public.house_honor` comprises (pgTAP 857).
- Nature d'une maison (#718) : `houses.kind` vaut `player`, ou `npc` pour une maison PNJ de secours (8.3, #715), que les classements de fortune écartent.
  Une maison fondée sans la nommer est une maison de joueur ; le service la choisit à l'insertion et ne la change jamais, et un joueur connecté ne la lit pas.
- Fortune d'une maison (4.1, #718) : `game.house_wealth(p_world)`, au nom du propriétaire, est exécutable par le seul service ; aucune vue lisible par un joueur ou un visiteur ne l'appelle ni n'a de colonne de fortune (pgTAP 718).
- Comptes de la maison (4.1) : un joueur lit les lignes du grand livre de ses propres comptes, trésorerie et séquestre (compte, montant, nature de la ligne), la nature et la date des écritures où il a une ligne, et le prix et la quantité des échanges dont il est le vendeur, pour séparer le brut de la taxe.
  Il ne lit ni les autres lignes de ces écritures (contrepartie, taxe), ni leur détail (`meta`), ni les échanges où il achète.
  Les vues `my_cash_flows`, `my_valued_stocks` et `my_balance_sheet` en sont des agrégats calculés à la lecture, et le compte de résultat (`my_income_statement`, `my_income_statement_by_season`) un agrégat de `my_cash_flows`, sans droit supplémentaire ;
  leur horloge (heure de clôture, fuseau, durée de la saison) vient de `game.clock_rules()`, seul extrait de la section `clock` de la configuration rendu aux joueurs.
  Cette fonction rend un fuseau nul quand Postgres ne le connaît pas (le schéma de configuration valide le fuseau avec `Intl`, dont la liste n'est pas celle de la base) : les vues restent lisibles, sans jour de jeu.
  Pour que ce cas ne se produise pas en silence, la publication d'une version (`publishVersion`) refuse un fuseau absent de `pg_timezone_names` (casse ignorée, comme le fait la base), sauf s'il est celui de la version en vigueur (`CONFIG_TIMEZONE_UNKNOWN`, 3).
  Par l'API, le changement d'horloge est refusé avant lui (`CONFIG_CLOCK_CHANGED`) et aucune commande ne produit ce code : le seul refus effectif est celui de la configuration initiale, publiée sans version en vigueur au démarrage sur une base vide (`ensureInitialConfig` lève alors une `ConfigError`).
  La garde de la fonction reste pour une version en vigueur publiée avant ce contrôle ou un monde dont le fuseau a quitté depuis la liste de la base ;
  ce cas est signalé dans la Vigie (3, 15). La durée de saison est bornée par le schéma (au plus 366 jours) : au-delà des entiers de la base, la fonction échouerait, et avec elle les cinq vues de comptes de tous les joueurs.
- Tables volumineuses partitionnées par mois (`trades`, `ledger_lines`, `messages`, `domain_events`), agrégats en vues matérialisées rafraîchies par le moteur.
  Les messages ne le sont pas : leur conservation, en jours de la configuration (`chat.retentionDays`), se purge ligne à ligne par `game.purge_messages` (ADR 0002).
  Dans la première version, les chandeliers de prix (`price_candles`) sont une table ordinaire que le moteur remplit, de clé cité, bien, durée et début de période : un recalcul remplace la ligne, il ne l'ajoute pas.
  Chaque échange porte un rang d'exécution (`trades.seq`), donné par la base : l'horodatage d'un échange est celui du début de sa transaction et ne départage pas les échanges d'un même appariement.
  Ce rang est unique, et le service n'écrit ni le rang ni la date d'un échange.
- Lectures des clients : les rôles `authenticated` et `anon` n'utilisent pas la compilation à la volée (`jit = off`, migration 40).
  PostgREST lit ce réglage à son démarrage ou à un rechargement de son cache de schéma ou de sa configuration (selon sa version), pas à chaque requête : la migration demande les deux rechargements (`notify pgrst, 'reload schema'` puis `'reload config'`), et `public.client_jit()`, exécutable par les seuls clients, rend le réglage de la requête en cours pour le vérifier par PostgREST lui-même (infra/README.md).
  Les règles par ligne du grand livre donnent aux flux de trésorerie un coût estimé qui la déclencherait, pour un surcoût de plusieurs fois la lecture elle-même ;
  une lecture de joueur est courte et n'y gagne jamais. Les règles ne sont pas réécrites pour baisser l'estimation : elle remonterait avec le volume.
  Mesure reproductible : `pnpm --filter @oikos/db bench:cash-flows`, dans une base neuve désignée par `BENCH_DATABASE_URL` (40 maisons, 40 000 écritures, moins de 50 ms exigés).
- Clôtures quotidiennes : une ligne par monde et par jour de jeu (`daily_closes` : instant de jeu de la clôture, version de configuration lue, résumé), en ajout seul, écrite dans la transaction qui applique la clôture ;
  sa clé garantit qu'une clôture n'est appliquée qu'une fois. Le service n'écrit pas l'heure réelle d'une clôture (`finished_at`, toujours l'horloge de la base) : il ne peut donc pas enregistrer une clôture avant son heure.
  En plus, la base refuse une seconde écriture d'entretien (`upkeep.daily`) pour la même maison et le même jour de jeu ;
  cette écriture porte l'identifiant de la maison et le jour de jeu sous une seule forme admise (identifiant en minuscules, jour entier), pour que la même clé ne s'écrive pas de deux façons.
  Le détail d'une écriture `upkeep.daily` (`meta.sites`) donne, pour chaque site payé, son dû (`oboles`) et ses parts : entretien (`upkeepOboles`) et salaires (`wagesOboles`).
  L'hébergement d'un site payé n'y figure pas : il est dans l'écriture `lodging.daily` de la même clôture (`meta.sites` : site, non logés, hébergement).
  La relance d'un site par sa maison est une écriture d'une autre nature (`upkeep.restart`), que cette unicité ne concerne pas.
  Les joueurs ne lisent pas la table des clôtures.
- Nature d'une ligne du grand livre (`ledger_lines.nature`, migration 60) : marqueur facultatif, pris dans une liste fermée tenue par la base (`upkeep`, `wages` ; `LEDGER_LINE_NATURES` dans `packages/sim`), écrit à l'insertion et jamais modifié, puisque le grand livre est en ajout seul.
  Les lignes d'avant le marqueur n'en ont pas ; les comptes de la maison les classent par la nature de leur écriture (4.1).
  Une nature nouvelle recrée la contrainte `ledger_lines_nature_known` avec la liste étendue, par une migration nouvelle.
- Une vue de `public` (ou sa fonction) créée par un `create or replace` sans condition ne gagne pas de colonne : sa migration la recrée telle quelle quand la suite est rejouée (`pnpm test:db:replay`), et échouerait sur une colonne de plus.
  Une donnée nouvelle passe par une vue nouvelle, ou par une colonne `jsonb` existante (ainsi le salaire du jour, rendu dans la colonne `sites` de `site_rules`) : voir l'ADR 0006.
- Activations de configuration (`config.activations`, en ajout seul) : la date de création est toujours l'heure de la transaction, posée par une garde de la base pour tout appelant, et le service n'écrit ni cette date ni le rang (`seq`) ;
  la base refuse une échéance antérieure à cette heure. Une programmation est refusée à moins d'une minute de son échéance, puis contrôlée de nouveau à la validation (déclencheur différé) : validée après son échéance, elle est refusée.
  Une activation immédiate (sans échéance, réservée en pratique à la configuration initiale) prend effet à l'heure de sa transaction : elle est refusée si cette transaction est validée plus de cinq secondes après son début, si bien que son effet ne couvre jamais plus de ces cinq secondes de passé.
  Ces contrôles à la validation ne tiennent que si l'appelant ne force pas ses contrôles différés (`SET CONSTRAINTS … IMMEDIATE`) avant de valider tard : limite assumée, le tick et la clôture ne verrouillant pas les activations (13, décision du ticket 208).
- Arrêt d'un site : `sites.halted_at` porte l'instant de l'arrêt, nul pour un site qui tourne.
  La base garantit qu'un site naît en marche, qu'il s'arrête dans la transaction qui l'écrit (entre son début et l'heure réelle : une clôture date l'arrêt du début du cycle quand une récolte validée pendant elle l'a avancé au-delà du sien), que cet instant ne change pas ensuite, que le cycle d'un site à l'arrêt ne dépasse pas l'instant de l'arrêt (il ne peut donc pas changer de recette) et qu'à la reprise le début du cycle avance exactement de la durée de l'arrêt : le temps passé à l'arrêt n'est jamais récolté.
  Cette durée est comptée en secondes, indépendamment du fuseau de la session.
  L'arrêt est daté de la transaction qui l'écrit, pas de l'instant de jeu de la clôture : si la clôture est jouée en retard, le site a produit jusqu'à son arrêt réel.
  Elle ne relie pas la reprise à un paiement : c'est la commande ou la clôture qui le garantit.
- Marché du travail (4.4, #258) : `labor_market` porte, par cité et par jour de jeu, l'offre de travail (nulle : sans limite), les employés, les non logés, le salaire et le prix de l'hébergement du jour.
  Une ligne naît une fois par cité et par jour, datée par la base, dans la transaction qui enregistre la clôture de son jour (même garde que la population), et ne change plus.
  Le service la crée et la lit ; tout joueur connecté lit la dernière de chaque cité par la vue `labor_market`, et ses travailleurs par `my_workforce` (`game.my_workforce()`, au nom du propriétaire, type de retour figé par l'ADR 0006).
  Écritures de l'hébergement : `lodging.daily` (maison et jour de jeu typés, une par maison et par jour) et `lodging.restart` (maison et site).
- Intendants (4.4, #278) : `stewards` porte la maison, le site, le nom, l'embauche, l'impayé, le renvoi et la révision en vigueur des règles ; `steward_rules` porte les règles de chaque révision, dans leur ordre.
  La base garantit un seul intendant en poste par site, de la maison du site, qu'il naît maintenant et impayé, que son identité ne change plus, que son impayé et son renvoi sont datés de la transaction qui les écrit, et qu'un intendant renvoyé ne change plus.
  Les règles s'écrivent dans la révision en vigueur d'un intendant en poste, révision qui n'avance que d'un pas à la fois et que la même transaction a ouverte (`rules_revised_at`) ; le service ne les modifie ni ne les supprime.
  Un joueur lit ses intendants en poste et leurs règles en vigueur par `my_stewards` et `my_steward_rules`, jamais ceux d'une autre maison (pgTAP 230).
- Timè (4.1, #704) : `honor` porte la Timè entière d'une maison, dans les entiers sûrs des clients ; elle n'est que le cumul d'un journal en ajout seul, `honor_ledger`, appliqué par un déclencheur du propriétaire, et une maison sans ligne a une Timè nulle.
  Une ligne porte la maison, une variation non nulle, un motif d'une liste fermée, une référence et un jour de jeu ; un index unique n'en admet qu'une par motif et par référence, si bien qu'un crédit rejoué ne s'écrit pas deux fois.
  Une ligne `archon_term` est un gain, pour une charge (`offices`) de la même maison dont le mandat a pris fin.
  La garde ne refuse pas une charge quittée par un archonte ostracisé (#722) : seul le moteur l'écarte du gain.
  À son insertion, aucune clôture de son jour ou d'un jour postérieur n'est enregistrée pour le monde (verrou de la clôture du monde) ; à la validation, la clôture de son jour l'est (déclencheur différé `honor_ledger_on_close`) : elle est donc écrite dans la transaction qui enregistre cette clôture, comme le déclin de la Charis.
  Tout autre motif est refusé : chaque mécanique qui touche la Timè remplace la garde pour y ajouter le sien.
  La base ne lit pas les bornes de la configuration : qui écrit prend le verrou consultatif `honor:<maison>` de sa transaction, lit la Timè et la tient dans ses bornes (`honorChange`).
  Le service écrit au journal sans en choisir ni l'identifiant ni la date, et ne modifie jamais la Timè ; aucun joueur n'écrit ni l'une ni l'autre.
  Tout joueur connecté lit la Timè de chaque maison de son monde par `public.house_honor` (une ligne par maison, #857), et les seules lignes du journal de sa maison par `public.my_honor_entries` ; un visiteur anonyme ne lit rien (pgTAP 704).
- Charis (7.1, #265) : `favor` porte la Charis entière d'une maison envers un dieu, de 0 au plus grand entier sûr des clients ; elle n'est que le cumul d'un journal en ajout seul, `favor_ledger`, appliqué par un déclencheur du propriétaire.
  Une ligne d'offrande (`offering`) porte la Charis d'une offrande de la même transaction, de la même maison et du même dieu, une fois par offrande.
  Une ligne de déclin (`decay`) est négative, datée d'un jour de jeu, écrite dans la transaction qui enregistre la clôture de ce jour (même garde que la population), une fois par maison, dieu et jour.
  Une ligne de grâce (`grace`, #266) est négative : la Charis dépensée par une invocation de la même transaction, de la même maison et envers le même dieu, une fois par invocation.
  Toute autre nature est refusée : chaque mécanique qui touche la Charis y ajoute la sienne, et aucune ne prend de Charis à une maison pour la donner à une autre.
- Offrandes (7.1, #265) : `offerings` garde chaque offrande, immuable : sa maison, la cité de sa maison, son dieu, ses oboles, sa Charis et, s'il y a des oboles, son écriture `temple.offering`.
  À la validation, la base contrôle que cette écriture a deux lignes, la trésorerie de la maison débitée des oboles et le puits `sink_offerings` crédité d'autant, qu'une offrande sans oboles donne des biens, et que sa Charis est au journal.
  Les biens offerts vont du stock de la maison dans sa cité vers l'extrémité système `offering` du journal des stocks, rattachés à leur offrande (`stock_ledger.offering_id`), un mouvement par bien ; rien ne revient de cette extrémité (contrainte `stock_ledger_offering_one_way`).
  La base ne recalcule pas la Charis d'une offrande, qu'elle ne lit pas dans la configuration : l'API la calcule, comme le montant de l'entretien.
- Grâces (7.1, #266) : `graces_used` garde chaque invocation : sa maison, sa grâce, son dieu, son effet, son ampleur et sa Charis dépensée, lus dans la configuration en vigueur à l'invocation, son instant et la fin de sa recharge, calculée par l'API.
  Elle naît maintenant, en attente ; la base refuse une invocation d'une grâce dont une invocation de la même maison se recharge encore, ou attend encore (index unique, qui tient sous concurrence).
  Sa Charis dépensée est au journal de la Charis, dans la même transaction ; une grâce gratuite n'y a pas de ligne (contrôle à la validation).
  Elle ne change ensuite qu'une fois : consommée maintenant par une récolte d'un site de sa maison (`site_id`), qui n'en consomme qu'une, ou par le départ, à cet instant, d'un voyage de sa maison (`voyage_id`, avec les secondes gagnées).
  Une récolte qui la consomme rend son surplus : des mouvements `grace.surplus` de l'extrémité `production` vers le stock de sa maison dans la cité du site, rattachés à elle (`stock_ledger.grace_use_id`), un par bien (contrôle à la validation).
  La base ne vérifie ni l'ampleur ni la durée de la recharge, qu'elle ne lit pas dans la configuration, ni que l'effet convient au site (champ ou atelier) : l'API le fait.
  Le service l'écrit sans en choisir ni l'identifiant ni l'instant ; elle ne se supprime pas.
  Les joueurs connectés lisent les invocations de leur maison, sous règles par ligne et sans l'action qui les a consommées, par `public.my_graces` (en attente ou en recharge), et les grâces de la configuration par la colonne `graces` de `public.temple_rules`.
- Population des PNJ (5.2) : une ligne par cité et par classe (`npc_population` : habitants entiers, jour de jeu de la dernière clôture qui l'a fait évoluer, couverture retenue), créée par le service sans clôture ni couverture, dont il ne modifie que ces trois valeurs.
  La base n'accepte une modification que si elle avance le jour de clôture de la ligne et si, à cet instant, aucune clôture de ce jour ou d'un jour postérieur n'est enregistrée pour le monde ;
  elle vérifie à la validation que la clôture de ce jour l'est (référence différée).
  La ligne de clôture doit donc apparaître entre la modification et la validation : une population n'évolue que dans la transaction qui enregistre la clôture de son jour — elle l'écrit en dernier —, une fois par jour de jeu, et jamais sur une clôture déjà enregistrée.
  La garde prend d'abord le verrou des clôtures du monde, celui du moteur, pour qu'aucune autre transaction ne valide cette clôture entre la modification et la validation.
  En contrepartie, la table des clôtures, référencée, ne se vide plus qu'en cascade, ce que sa garde refuse.
  La mesure du jour (`npc_vital_coverage` : unités servies et demandées, nombres réels finis et positifs, par cité, classe et jour de jeu) est un état interne du moteur, qui en remplace les deux valeurs ;
  ce n'est ni de la monnaie ni du stock, et rien ne garantit en base qu'elle ne fait que croître.
  Les joueurs connectés lisent la première par la vue `city_population`, sans le monde ;
  la seconde n'est pas exposée.
- Navires (4.6, #251) : `ships` porte la maison, la classe (identifiant de la configuration), la cité où le navire est à quai (nulle en mer) et l'instant de son désarmement (nul s'il est armé).
  La base garantit qu'un navire naît à l'instant de sa création, à quai dans une cité de son monde (clé étrangère) et armé, puis qu'il ne change ni d'identifiant, ni de monde, ni de maison, ni de classe, ni de date de naissance.
  Le service crée un navire sans choisir son identifiant, sa date ni son désarmement, ne le supprime pas, et n'en modifie que le quai et le désarmement (#252).
  La base garantit qu'un navire ne quitte le quai que par un voyage qui part dans la même transaction, de la cité où il est à quai, qu'il n'accoste qu'une fois son voyage arrivé, dans la cité d'arrivée, et qu'il ne passe jamais d'un quai à un autre ; son désarmement est daté de la transaction qui l'écrit et ne change plus, et se lève sans que la base le relie à un paiement (la clôture le garantit).
  Un joueur lit ses propres navires par `my_ships`, sous règle par ligne, et les classes et tarifs par `ship_rules`, extrait public de la configuration en vigueur rendu par `game.ship_rules()`, exécutée au nom du propriétaire comme `site_rules`.
- Immobilier (4.5, #256) : `properties` porte la cité, la taille (identifiant de la configuration), le numéro du bien dans le parc de sa cité et de sa taille, la maison propriétaire (nulle tant que la cité le détient) et l'instant de son achat, l'état (de 0 à 10 000), le jour de jeu de sa dernière usure et l'instant où l'entretien a été trouvé impayé.
  Le moteur crée le parc au premier tick qui connaît la cité, puis le complète jusqu'au nombre de la configuration ; le numéro est unique par cité et par taille, si bien que deux moteurs ne créent pas deux fois le même bien.
  La base garantit qu'un bien naît maintenant, neuf et détenu par sa cité, puis ne change ni de cité, ni de taille, ni de numéro.
  Il ne quitte la cité que par une écriture `property.buy` de la même transaction (datée de son début), qui le désigne (`meta.propertyId`) et débite la trésorerie de l'acheteur ; il ne revient jamais à la cité, et l'instant de l'achat est posé par la base.
  Il passe d'une maison à une autre (#257) seulement par une écriture `property.sale` de la même transaction, qui le désigne, débite la trésorerie de l'acheteur, ne débite pas le vendeur et règle l'offre de vente du vendeur, fermée vendue dans cette transaction ; jamais tant qu'un bail est actif ou qu'une offre reste ouverte.
  Un index unique sur l'identifiant typé du bien (`ledger_entries_property_bought_once`) n'admet qu'une écriture d'achat par bien.
  Son état ne remonte que jusqu'au maximum, par une écriture `property.renovate` de la même transaction qui le désigne et débite la trésorerie de son propriétaire.
  Il ne baisse que par l'usure, une fois par jour de jeu, dans la transaction qui enregistre la clôture de ce jour : même montage que la population des PNJ (jour qui avance, aucune clôture de ce jour déjà enregistrée, référence différée vers `daily_closes`).
  L'impayé est daté de la transaction qui l'écrit et ne change plus ; il se lève sans que la base le relie à un paiement (la clôture le garantit).
  Ces gardes s'exécutent au nom du propriétaire de la base ; elle ne lit pas la configuration et ne contrôle donc ni le prix, ni le coût, ni les biens consommés : la commande les garantit.
  Cet index, et un index partiel pour les rénovations, retrouvent ces écritures sans parcourir le grand livre.
  Le service crée un bien sans en choisir l'identifiant, la date ni l'état, n'en modifie que le propriétaire, l'état, le jour d'usure et l'impayé, et ne le supprime pas.
  Les joueurs connectés lisent les règles par `property_rules` (section `properties` de la configuration en vigueur, rendue par `game.property_rules()`), le parc de toutes les cités par `city_properties` (une ligne par bien : sa taille, son numéro, s'il est encore à vendre par la cité et, seulement alors, son état ; jamais le propriétaire, l'état ni l'impayé d'un bien détenu par une maison ; rendu par `game.city_properties()`, exécutée au nom du propriétaire, dont le type de retour est figé par l'ADR 0006) et les biens de leur maison par `my_properties`, sous règle par ligne ;
  un visiteur anonyme ne lit rien.
- Offres et baux (4.5, #257) : `property_listings` porte le bien, la maison qui l'offre, la nature (vente ou location), le prix ou le loyer quotidien en oboles, sa date, sa fermeture (date et issue : retirée, vendue, louée) et l'écriture qui l'a vendue ; `leases` le bien, l'offre dont il vient, le propriétaire, le locataire, le loyer, le début, la demande de fin (date et partie) et la fin (date, jour de jeu de la clôture et raison : demandée ou impayé).
  La base garantit qu'une offre naît maintenant, ouverte, par la maison qui possède un bien non loué, une seule ouverte par bien (index unique partiel), et qu'elle ne change ensuite qu'en se fermant, une fois, datée de la transaction.
  Elle n'est vendue que par une écriture `property.sale` de la même transaction qui la désigne, débite une autre maison du prix exact et ne débite pas le vendeur ; comme pour un échange (5.3), la base ne lit pas la taxe et ne borne pas le net du vendeur.
  Elle n'est louée que par un bail de la même transaction.
  À la validation, des déclencheurs différés vérifient la suite : une offre fermée vendue a cédé son bien à la maison que son écriture débite du prix, et un bail créé a fermé son offre louée ; l'acheteur ne paie donc jamais sans recevoir le bien, et un bail ne laisse pas son offre ouverte ni ne la ferme retirée.
  Un bail naît maintenant, d'une offre de location ouverte, au loyer de l'offre, entre la maison qui possède le bien et une autre ; un seul bail actif par bien (index unique partiel), et ses termes ne changent plus.
  Sa fin se demande une fois, datée par la base ; elle ne prend effet que dans la transaction qui enregistre la clôture de son jour (même montage que l'usure d'un bien : jour qui avance, aucune clôture de ce jour déjà enregistrée, référence différée vers `daily_closes`), et un bail dont le loyer de ce jour est payé ne prend pas fin faute de loyer.
  Une écriture `property.sale` désigne le bien et l'offre sous une seule forme et n'existe qu'une fois par offre ; une écriture `lease.rent` porte le bail et le jour de jeu sous une seule forme, une seule par bail et par jour (index unique sur la clé typée).
  Le service n'écrit ni identifiant ni date de ces tables, ne modifie que la fermeture d'une offre et la demande de fin et la fin d'un bail, et ne supprime rien ; ces gardes s'exécutent au nom du propriétaire de la base.
  Une maison lit ses propres offres (le vendeur y lit le brut de sa vente pour ses comptes, 4.1) et les baux dont elle est partie, sous règles par ligne ; tout joueur connecté lit les offres ouvertes par `property_offers`, rendue par `game.property_offers()`, exécutée au nom du propriétaire, sans la maison qui offre ; un visiteur anonyme ne lit rien.
  Tout joueur connecté lit aussi ces offres avec l'impayé de leur bien (#403) par `property_offers_upkeep`, rendue par `game.property_offers_upkeep()`, exécutée au nom du propriétaire : les colonnes de `property_offers`, puis l'impayé (oui ou non) et son jour de jeu, calculé à l'horloge en vigueur comme les autres lectures datées (nul sans horloge).
  Ni la maison qui offre, ni l'instant exact de l'impayé ; un visiteur anonyme ne lit rien, et `property_offers` garde ses colonnes (ADR 0006).
- Citoyenneté (3, 6.2, #260) : `citizenships` porte la maison, sa cité, son statut (métèque ou citoyen) et la date de ce statut.
  La base garantit qu'une citoyenneté naît métèque, qu'elle ne change ni de maison ni de cité, que son statut ne fait que passer de métèque à citoyen, daté de la transaction qui l'écrit, et que sa date ne change qu'avec lui.
  Le service n'écrit à la fondation que la maison et la cité, et à la promotion que le statut et la date ; c'est la clôture qui promeut.
  Les joueurs connectés lisent le statut de toute maison de leur monde (`houses.citizenship_status`, #857).
  Un joueur lit aussi la citoyenneté de ses seules maisons avec sa date par `my_citizenships` (#420), vue `security_invoker` créée une fois : maison, cité, statut, instant du statut et son jour de jeu, calculé à l'horloge en vigueur comme les autres lectures datées (nul sans horloge ou pour un fuseau inconnu de la base).
  La date d'une autre maison n'en sort pas, un visiteur anonyme ne lit rien, et `houses` garde ses colonnes (ADR 0006).
- Élection de l'archonte (6.2, #260) : `elections` (cité, charge `archon`, ouverture du dépôt des candidatures, ouverture et fin du vote, fin du mandat, dépouillement), `candidacies` (élection, maison, dépôt, retrait), `ballots` (élection, maison qui vote, candidature choisie) et `offices` (cité, maison, charge, élection, début et fin du mandat).
  La base garantit qu'une élection naît non dépouillée, que son calendrier se suit dans l'ordre et ne change plus, qu'une cité n'a qu'une élection ouverte par charge, et qu'une élection n'est dépouillée qu'une fois, après la fin du vote, à la date de la transaction.
  Une candidature est déposée par un citoyen de la cité pendant le dépôt, une seule par maison et par élection ; elle ne change que par son retrait, définitif, pendant le dépôt et avant tout bulletin.
  Un bulletin est déposé par un citoyen de la cité pendant le vote, pour une candidature maintenue de la même élection, un seul par maison et par élection, et il ne change plus.
  Le bulletin prend un verrou partagé sur l'élection et sur la candidature : le dépouillement et le retrait l'attendent, ou il les attend et relit ce qu'ils ont validé.
  Une charge est pourvue par le dépouillement de son élection, dans sa transaction, aux dates du mandat, et va à la candidature maintenue qui a le plus de bulletins, la plus ancienne en cas d'égalité : la base recompte elle-même les bulletins pour le vérifier.
  Le service n'écrit ni identifiant ni date que la garde fixe, et ne supprime rien.
  Les joueurs connectés lisent le calendrier de chaque cité (`public.elections`), les candidatures et leurs retraits (`election_candidates`), les charges, mandats passés compris (`offices`, avec `in_office`), et les règles en vigueur (`politics_rules`, extrait public de la section `politics`, rendu par `game.politics_rules()`).
  Les résultats (`election_results` : bulletins par candidature maintenue, et l'élu) ne sont rendus qu'après le dépouillement, par `game.election_results()`, exécutée au nom du propriétaire et seule à compter les bulletins pour eux.
  D'un bulletin, un joueur ne lit que celui de sa maison, et seulement son élection et sa date (`my_ballots`, « j'ai voté ») : jamais la candidature choisie, la sienne comprise, ni le bulletin d'une autre maison.
  Une charge ne change plus, sauf pour être quittée (`vacated_at`, #722) : une fois, pendant son mandat, à la date de la transaction d'un dépouillement d'ostracisme de sa cité qui ostracise sa maison ; `offices.in_office` est alors faux.
- Décrets (6.3, #261) : `decrees` (cité, modèle du catalogue fermé, paramètres, charge et maison de l'archonte qui propose, état `proposed`, `adopted`, `rejected`, `applied` ou `lapsed`, proposition, fin du vote, quorum, dépouillement, citoyens à la fin du vote, votes pour et contre) et `decree_votes` (décret, maison, pour ou contre, date).
  La base garantit qu'un décret est proposé maintenant, au vote, par la maison qui tient à cet instant la charge d'archonte de sa cité, que son vote finit après la proposition, et qu'il ne change ensuite que par son dépouillement, une fois, après la fin du vote, à la date de la transaction.
  Le quorum est fixé à la proposition ; les paramètres sont un objet que l'API valide contre les bornes de la configuration en vigueur, la base ne lisant pas la configuration.
  Au dépouillement, la base recompte elle-même les votes et les citoyens de la cité devenus citoyens avant la fin du vote, et n'admet que l'issue qui en découle : adopté si les votes exprimés atteignent le quorum et que les pour l'emportent strictement, rejeté sinon.
  Un vote est déposé par un citoyen de la cité pendant le vote, un seul par maison et par décret, et il ne change plus ; il prend un verrou partagé sur le décret, que le dépouillement verrouille avant de compter.
  Un décret adopté de taux (taxe de marché, droit de port) passe une fois à `applied` (#262), à la date de la transaction (`applied_at`), sans que rien d'autre ne change ; `applied` est un état final.
  Un décret adopté de dépense (grands travaux, fête) est réglé une fois (#263) : il passe à `applied`, daté de la transaction, s'il a son écriture de paiement, ou à `lapsed` (caduc) s'il n'en a pas.
  Son règlement porte le jour de jeu d'une clôture que la même transaction enregistre (`settled_day`) : aucune clôture de ce jour ou d'après n'est déjà écrite, et un déclencheur différé exige qu'elle le soit à la validation (une clé étrangère différée mettrait en attente chaque insertion de décret).
  `applied` et `lapsed` sont finaux ; un décret de taux ne devient pas caduc et n'a pas de jour de règlement.
  Un seul événement `DecreeApplied` ou `DecreeLapsed` par décret (index uniques sur `domain_events`).
- Trésor d'une cité (5.6, #263) : il ne paie que la dépense d'un décret de sa cité appliqué dans la transaction, par une écriture `city.public_works` ou `city.festival` qui le désigne (`meta.decreeId`), dont les autres lignes créditent le puits du modèle (`sink_public_works`, `sink_festivals`), pour au plus le montant voté.
  Ce contrôle tourne au nom du propriétaire, à la validation ; une seule écriture de dépense par décret (index unique sur `ledger_entries`), et le trésor n'est jamais débiteur (contrainte du compte).
  Le plafond de dépense, part du trésor que la base ne lit pas dans la configuration, est contrôlé par le moteur sous le verrou du trésor.
  Comptes publics (5.6) : `public.city_treasury` (solde du trésor de chaque cité) et `public.city_treasury_flows` (flux par cité, jour de jeu et nature) sont rendus aux joueurs connectés par `game.city_treasuries()` et `game.city_treasury_flows()`, exécutées au nom du propriétaire, qui n'en rendent que ces agrégats ; le compte et ses lignes restent fermés.
  La lecture des flux parcourt toutes les lignes des trésors (index sur le compte) : à surveiller avec le volume, comme les comptes de la maison.
  Taux en vigueur d'une cité : `game.city_rates(monde, règles)` est le seul calcul, pour le service (qui lui passe la configuration qu'il a lue) comme pour les joueurs.
  Il rend, pour chaque cité du monde, la valeur du dernier décret appliqué, ramenée dans les bornes du modèle, sinon celle de la configuration, que ces bornes ne touchent pas ; un modèle que la configuration ne borne pas rend la valeur de la configuration.
  Dernier appliqué : le plus récemment appliqué, puis, à la même clôture, celui dont le vote a fini le plus tard, puis l'identifiant le plus grand.
  Le service n'écrit ni identifiant, ni date, ni état à la proposition, et ne supprime rien.
  Les joueurs connectés lisent les décrets de toutes les cités (`public.decrees` : paramètres, auteur, état, calendrier, quorum, et le décompte, nul avant le dépouillement) et les règles en vigueur (`decree_rules` : une ligne par modèle ouvert, avec les bornes de ses paramètres et les règles du vote, rendue par `game.decree_rules()`).
  D'un vote, un joueur ne lit que celui de sa maison, et seulement son décret et sa date (`my_decree_votes`, « j'ai voté ») : jamais son choix, ni le vote d'une autre maison.
  Les vues des décrets sont créées sous condition, pour que les tickets suivants puissent les étendre (ADR 0006) ; `public.decrees` rend aussi la date d'application et le jour du règlement d'une dépense.
  Les joueurs connectés lisent les taux en vigueur de chaque cité (`public.city_rates` : taux de la taxe de marché et coefficient du droit de port, sous la version en vigueur, par `game.city_rates_in_force()`), sans pouvoir calculer des taux sous d'autres règles.
- Ostracisme (6.4, #722) : `ostracisms` (cité, décret `ostracism` adopté qui l'ouvre, ouverture, fin du vote, quorum et durée fixés à l'ouverture, dépouillement, citoyens à la fin du vote, bulletins, issue `ostracized`, `tie` ou `no_quorum`, maison ostracisée et fin de son ostracisme) et `ostraca` (vote, maison qui vote, maison nommée, date).
  La base garantit qu'un vote naît maintenant, non dépouillé, d'un décret d'ostracisme adopté de sa cité, un seul par décret et un seul non dépouillé par cité, et qu'il ne change ensuite que par son dépouillement, une fois, après la fin du vote, à la date de la transaction.
  Au dépouillement, elle recompte les bulletins et les citoyens devenus citoyens avant la fin du vote, et n'admet que l'issue qui en découle : quorum manqué si les bulletins n'atteignent pas `quorum_bps` des citoyens, égalité si aucune maison n'est seule en tête (aucun bulletin compris), sinon la maison la plus nommée est ostracisée.
  Le moteur fixe la fin de l'ostracisme à la clôture `ostracism_days` jours de jeu après celle qui dépouille, par son jour de jeu et non par l'heure où elle est jouée, la base ne lisant pas l'horloge.
  La base exige seulement une fin après la fin du vote, et au plus `ostracism_days` jours après le dépouillement : une clôture rattrapée en retard peut écrire un ostracisme déjà fini, qui n'écarte personne.
  Une charge n'est quittée que si l'ostracisme de son titulaire court encore à l'instant du dépouillement.
  Un bulletin est déposé pendant le vote par un citoyen de la cité, au nom d'un citoyen de la même cité, un seul par maison et par vote, et il ne change plus ; il prend un verrou partagé sur le vote, que le dépouillement verrouille avant de compter.
  `game.house_ostracized(maison, instant)` dit si une maison est ostracisée, du dépouillement inclus à la fin exclue ; une maison ostracisée ne dépose aucune candidature, ne propose aucun décret, et la garde des charges l'écarte de l'élu.
  Le service n'écrit ni identifiant ni date d'ouverture ou de bulletin, et ne supprime rien ; l'écart entre deux ostracismes d'une cité (`intervalDays`), qui dépend de la configuration, est contrôlé par l'API sous le verrou des décrets de la cité.
  Les joueurs connectés lisent les votes des cités de leur monde (`public.ostracisms`, avec `in_force` : l'ostracisme court encore), leur décompte nul avant le dépouillement, et les voix de chaque maison nommée après lui seulement (`ostracism_results`, par `game.ostracism_results()`, exécutée au nom du propriétaire).
  D'un bulletin, un joueur ne lit que celui de sa maison, et seulement son vote et sa date (`my_ostraca`) : jamais le nom inscrit, ni le bulletin d'une autre maison.
- Voyages (4.6, #252) : `voyages` porte le navire, sa maison, les cités de départ et d'arrivée, le départ, l'arrivée prévue et l'arrivée ; `voyage_cargo` une ligne par bien et sa quantité.
  La base garantit qu'un voyage part à l'instant de sa transaction, en mer, de la cité où son navire armé est à quai, qu'un navire n'a qu'un voyage en mer à la fois (index unique), que seule l'arrivée s'écrit ensuite, une fois, ni avant l'arrivée prévue ni dans le futur, et que la cargaison s'écrit dans la transaction du départ puis ne change plus.
  Journal des stocks : l'extrémité système `in_transit` est rattachée à un voyage (`stock_ledger.voyage_id`, contrainte `stock_ledger_in_transit_voyage`).
  Un voyage charge au départ, depuis le stock de sa maison dans la cité de départ, exactement sa cargaison, et ne décharge qu'une fois arrivé, vers le stock de sa maison dans la cité d'arrivée, exactement ce qu'il a chargé ; chaque bien est chargé une fois et déchargé une fois (index uniques).
  À la validation (contrôle différé), un voyage en mer a toute sa cargaison chargée et son navire n'est à quai nulle part, et un voyage arrivé a tout déchargé et son navire est à quai dans la cité d'arrivée (ou en est reparti).
  Un index partiel porte les voyages en mer par monde et par échéance (`voyages_due_idx`, #253) : l'arrivée jouée à chaque tick et la Vigie ne parcourent qu'eux.
  Ces gardes s'exécutent au nom du propriétaire de la base.
  Le service fait partir un voyage sans en choisir l'identifiant ni la date de départ, et n'en écrit ensuite que l'arrivée ; un joueur lit ses voyages et leur cargaison par `my_voyages`, sous règle par ligne.
- Discussion (6.6, #273) : `channels` (le canal d'une cité, ou la conversation privée de deux maisons d'un même monde), `channel_members` (les deux maisons d'une conversation privée) et `messages` (canal, maison, texte, date, masquage).
  Le canal d'une cité naît avec elle (déclencheur exécuté au nom du propriétaire, comme son trésor) ; le service ne crée que des conversations privées, dont la base inscrit elle-même les deux membres.
  Les deux maisons d'une conversation sont rangées dans l'ordre (`house_low` < `house_high`) : une paire n'a qu'une conversation, quel que soit qui l'ouvre, et une maison ne converse pas avec elle-même.
  La base garantit qu'un message est écrit maintenant, non masqué, par une maison de la cité du canal (métèque ou citoyenne) ou par un membre de la conversation, avec un texte non blanc d'au plus 2 000 caractères (plafond technique ; la longueur de jeu est `chat.maxMessageLength`).
  Ensuite seul son masquage change, une fois, daté de la transaction ; il ne se supprime que par la purge de la conservation.
  `visible_body`, colonne générée, rend le texte tant que le message n'est pas masqué, et rien ensuite : c'est la seule colonne de texte accordée aux joueurs, si bien qu'un message masqué ne rend plus son texte qu'à l'administration.
  Les joueurs connectés lisent, sous règles par ligne, le canal de la cité de leur maison et leurs conversations privées (`my_channels`, avec l'autre maison d'une conversation), et leurs messages (`channel_messages`, dont le texte est `visible_body`) ; ni les membres, ni un autre canal.
  Les canaux lisibles se calculent par `game.readable_channel_ids()`, exécutée au nom du propriétaire comme `current_house_ids`.
  Diffusion (#274, ADR 0008) : un déclencheur après insertion d'un message le diffuse par `realtime.send`, au nom du propriétaire, en canal privé, sur `chat:<canal>` (cité) ou `house:<maison>` pour chacune des deux maisons (conversation), avec ses seuls identifiants ; une diffusion en échec n'empêche pas d'écrire le message.
  Sur `realtime.messages`, une règle de lecture admet pour `authenticated` les seuls sujets de `game.readable_realtime_topics()` (canaux lisibles et maisons du compte), en diffusion et non en présence ; des règles restrictives y refusent toute écriture à `anon` et `authenticated`.
- Modération (15.1, 18, #275) : `game.reports` (message, maison qui l'a écrit, maison qui le signale, motif, état) et `admin.sanctions` (compte, type, début, fin, motif, auteur, validé par, appel et son instant).
  La base garantit qu'un signalement naît maintenant, ouvert, sur un message existant et non masqué d'une autre maison, par une maison qui lit son canal, et qu'il désigne la maison qui a écrit le message ; un seul par maison et par message (contrainte unique).
  À la purge du message, le signalement reste, sans son message (`message_id` nul) : la maison signalée est gardée.
  Une sanction naît maintenant, sans appel ; un avertissement, un silence et une suspension ont une fin, après leur début, une exclusion n'en a pas ; nul ne se sanctionne lui-même, et une exclusion est validée par une autre personne que son auteur et que le compte sanctionné.
  Ensuite seul l'appel s'y ajoute, une fois, sur une sanction pas encore finie, daté par la base de la transaction qui l'écrit.
  Le service écrit un signalement sans en choisir l'état ni la date, lit les sanctions et n'y écrit que le texte d'un appel.
  Un joueur lit ses signalements par `my_reports`, sous règle par ligne, sans la maison signalée ; un compte lit ses sanctions par `my_sanctions`, sans leur auteur ni leur validation, et pas une exclusion encore à valider.
  Le schéma `admin` reste fermé aux joueurs : cette lecture passe par `game.my_sanctions()`, exécutée au nom du propriétaire, qui ne rend que les lignes du compte connecté.
  Tout joueur connecté lit les motifs de signalement de la configuration en vigueur (`moderation_rules`), jamais les termes interdits.
  Administration (#276, migration 260) : une sanction porte aussi sa levée (instant, compte) et la décision sur son appel (accueilli ou rejeté, compte, instant), un signalement son traitement (écarté ou retenu, compte, instant).
  Le service prononce une sanction qui commence maintenant ; il valide une exclusion, une fois, qui commence alors ; il tranche un appel, une fois, par un autre compte que l'auteur et que le sanctionné ; accueilli, l'appel lève dans la même écriture, et seul il lève, une sanction pas encore finie, dont la fin devient l'instant de la levée (une exclusion levée prend une fin) ; il traite un signalement ouvert, une fois, par un autre compte que ceux de la maison signalée et de la maison qui l'a fait ; il masque un message.
  La base date chacun de ces changements et n'en admet qu'un par écriture, la levée allant avec l'appel accueilli.
  La file de la modération se compose par `admin.moderation_queue`, accordée au seul service (#276, migration 261).
- Migrations SQL versionnées dans le dépôt, jamais de modification manuelle en production. Chaque migration appliquée est enregistrée dans `supabase_migrations.schema_migrations` et n'est plus rejouée au déploiement (14.4). Une migration publiée sur `main` est donc immuable (ni modifiée, ni supprimée, ni renommée) : on corrige par une migration nouvelle, ce que vérifie `ci`.
  Une contrainte de vérification nouvelle sur une table déjà grosse, comme le grand livre, s'ajoute `not valid` puis se valide par `validate constraint` (verrou plus léger, lignes existantes relues sans bloquer les écritures) ; un déclencheur ne relit pas l'existant (#655).
- Événements du monde (7.3, 7.4, #267) : `worlds.seed` est la graine du monde, tirée par la base à sa création (deux `gen_random_uuid`, 244 bits de son générateur sûr) sauf graine donnée à l'insertion (le banc fixe la sienne), et jamais modifiée ensuite, même par le propriétaire (déclencheur).
  Les mondes créés avant le ticket ont reçu la leur à la migration, une fois.
  Les joueurs ne la lisent pas : leur lecture de `worlds` passe à une liste de colonnes, sans elle.
  `world_events` porte un événement planifié : son modèle (catalogue fermé : `drought`, `good_year`, `storm`, `caravan`), sa portée (une cité ; une route, entre `city_id` et `other_city_id` ; une cité et un bien), le jour de la clôture qui l'a planifié, ses jours de jeu (`start_day` compris, `end_day` exclu) et leurs instants, son ampleur en points de base et la graine de son jour.
  La base garantit qu'un événement est planifié maintenant, par la clôture de son jour de planification (aucune clôture de ce jour ou d'après n'est encore écrite, et une clé étrangère différée exige qu'elle le soit à la validation), qu'il commence un jour plus tard et à un instant futur, qu'un seul événement d'un modèle commence un jour donné (contrainte unique : rejouer une planification ne double rien), et qu'il ne change plus ensuite.
  `event_effects` explique l'effet appliqué d'un événement : l'écart de rendement d'un extrant à une récolte (`site_yield`, en unités, signé) ou le retard d'un départ (`voyage_delay`, en secondes).
  La base vérifie qu'un effet est écrit maintenant, dans le monde de son événement, par le modèle qui le produit et sur sa portée : une récolte d'un site de la cité, du signe du modèle ; un départ sur la route, pendant la tempête.
  La quantité récoltée passe par le journal des stocks, qui fait foi ; la demande relevée par une caravane n'a pas de ligne d'effet, ses achats étant des échanges.
  Le service insère sans choisir ni identifiant ni date, et ne modifie ni ne supprime rien.
  Les joueurs connectés lisent les événements commencés (`starts_at` atteint), de tous les mondes, par `public.world_events`, sans graine ni jour de planification ; un événement à venir ne leur est pas lisible, et les effets non plus.
- Pythie (7.3, #270) : `oracles` garde l'oracle de chaque événement, un par événement : ses textes `fr` et `en`, leur source (`fallback` ou `ai`) et l'essai de réécriture (son instant et son issue).
  La base garantit qu'un oracle naît en repli, dans la transaction qui planifie son événement et dans son monde, qu'il ne change ensuite qu'une fois, par l'essai de réécriture, daté de sa transaction, avant que l'événement commence, que ses textes ne changent que si l'essai réussit, et qu'il ne se supprime pas.
  Son identifiant est aléatoire, et non horodaté : il ne dit pas le jour de la planification.
  `oracle_consultations` garde chaque consultation, immuable : sa maison, la cité de sa maison, l'offrande qui la paie (une par consultation) et les oracles qu'elle a rendus.
  La base garantit qu'elle naît maintenant, avec une offrande de monnaie de la même maison, de la même cité et de la même transaction, qu'elle ne rend que des oracles distincts, de son monde, d'événements de sa cité (une tempête sur une de ses routes comprise) qui n'ont pas commencé, et, à la validation, que son offrande est payée par une écriture `temple.oracle` et sans bien ; une écriture `temple.oracle` ne paie qu'une consultation.
  La base ne lit pas la configuration : le prix et le dieu de la Pythie sont vérifiés par l'API, comme la Charis d'une offrande.
  Les joueurs connectés lisent leurs consultations et les oracles qu'elles ont rendus, sous règles par ligne et sans l'événement ni l'essai de réécriture, par `public.my_oracles`.
