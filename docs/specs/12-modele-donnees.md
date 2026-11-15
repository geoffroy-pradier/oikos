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
| Maison | `houses`, `house_members`, `skills`, `reputation`, `titles` |
| Sites | `sites`, `buildings`, `recipes_running`, `workers`, `artisans`, `stewards`, `steward_rules` |
| Stocks | `inventories`, `stock_ledger`, `warehouses` |
| Monnaie | `accounts`, `ledger_entries`, `ledger_lines` |
| Marchés | `orders`, `trades`, `price_candles`, `contracts`, `auctions`, `bids`, `tenders` |
| Logistique | `ships`, `voyages`, `voyage_cargo`, `freight_offers` |
| Immobilier | `properties`, `leases`, `renovations` |
| Finance | `banks`, `deposits`, `loans`, `collaterals`, `companies`, `shares` |
| Cité | `citizenships`, `offices`, `elections`, `ballots`, `decrees`, `city_budget`, `public_works`, `leagues` |
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
- Débits que la base accepte hors d'un échange (décision du ticket 205) : la trésorerie d'une maison qui paie celle d'une autre, un séquestre alimenté par la trésorerie d'une autre maison, et le robinet des achats des PNJ débité par une écriture sans échange.
  La base ne les refuse pas ; seul le code des commandes et du moteur les exclut, comme l'antidatage des activations avant le ticket 130.
  Raisons : les transferts entre maisons seront des mécaniques du jeu (contrats, prêts, banque, 5.4), et la base ne peut pas en tenir la liste sans devenir un second moteur de règles ;
  un séquestre payé par une autre maison revient au même transfert, puisqu'il ne rend qu'à la trésorerie de sa propre maison, et ses deux contrôles (montant retenu, à qui il paie) tiennent ;
  aucun robinet n'est lié en base à sa mécanique, et les jeux d'essai de la base se servent de celui-ci comme d'un robinet ordinaire.
  Aucun de ces débits ne crée ni ne détruit de monnaie hors des comptes système, et chacun reste dans le grand livre, avec sa nature, pour le tableau de bord (5.5) et la détection des transferts (13).
  Lier chaque compte système aux natures d'écriture qui le mouvementent serait le durcissement suivant, pour tous les robinets et puits à la fois.
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
- Citoyenneté (3, 6.2, #260) : `citizenships` porte la maison, sa cité, son statut (métèque ou citoyen) et la date de ce statut.
  La base garantit qu'une citoyenneté naît métèque, qu'elle ne change ni de maison ni de cité, que son statut ne fait que passer de métèque à citoyen, daté de la transaction qui l'écrit, et que sa date ne change qu'avec lui.
  Le service n'écrit à la fondation que la maison et la cité, et à la promotion que le statut et la date ; c'est la clôture qui promeut.
  Les joueurs connectés lisent le statut de toute maison (`houses.citizenship_status`).
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
- Voyages (4.6, #252) : `voyages` porte le navire, sa maison, les cités de départ et d'arrivée, le départ, l'arrivée prévue et l'arrivée ; `voyage_cargo` une ligne par bien et sa quantité.
  La base garantit qu'un voyage part à l'instant de sa transaction, en mer, de la cité où son navire armé est à quai, qu'un navire n'a qu'un voyage en mer à la fois (index unique), que seule l'arrivée s'écrit ensuite, une fois, ni avant l'arrivée prévue ni dans le futur, et que la cargaison s'écrit dans la transaction du départ puis ne change plus.
  Journal des stocks : l'extrémité système `in_transit` est rattachée à un voyage (`stock_ledger.voyage_id`, contrainte `stock_ledger_in_transit_voyage`).
  Un voyage charge au départ, depuis le stock de sa maison dans la cité de départ, exactement sa cargaison, et ne décharge qu'une fois arrivé, vers le stock de sa maison dans la cité d'arrivée, exactement ce qu'il a chargé ; chaque bien est chargé une fois et déchargé une fois (index uniques).
  À la validation (contrôle différé), un voyage en mer a toute sa cargaison chargée et son navire n'est à quai nulle part, et un voyage arrivé a tout déchargé et son navire est à quai dans la cité d'arrivée (ou en est reparti).
  Ces gardes s'exécutent au nom du propriétaire de la base.
  Le service fait partir un voyage sans en choisir l'identifiant ni la date de départ, et n'en écrit ensuite que l'arrivée ; un joueur lit ses voyages et leur cargaison par `my_voyages`, sous règle par ligne.
- Discussion (6.6, #273) : `channels` (le canal d'une cité, ou la conversation privée de deux maisons d'un même monde), `channel_members` (les deux maisons d'une conversation privée) et `messages` (canal, maison, texte, date, masquage).
  Le canal d'une cité naît avec elle (déclencheur exécuté au nom du propriétaire, comme son trésor) ; le service ne crée que des conversations privées, dont la base inscrit elle-même les deux membres.
  Les deux maisons d'une conversation sont rangées dans l'ordre (`house_low` < `house_high`) : une paire n'a qu'une conversation, quel que soit qui l'ouvre, et une maison ne converse pas avec elle-même.
  La base garantit qu'un message est écrit maintenant, non masqué, par une maison de la cité du canal (métèque ou citoyenne) ou par un membre de la conversation, avec un texte non blanc d'au plus 2 000 caractères (plafond technique ; la longueur de jeu est `chat.maxMessageLength`).
  Ensuite seul son masquage change, une fois, daté de la transaction ; il ne se supprime que par la purge de la conservation.
  `visible_body`, colonne générée, rend le texte tant que le message n'est pas masqué, et rien ensuite : c'est la seule colonne de texte accordée aux joueurs, si bien qu'un message masqué ne rend plus son texte qu'à l'administration.
- Migrations SQL versionnées dans le dépôt, jamais de modification manuelle en production. Chaque migration appliquée est enregistrée dans `supabase_migrations.schema_migrations` et n'est plus rejouée au déploiement (14.4). Une migration publiée sur `main` est donc immuable (ni modifiée, ni supprimée, ni renommée) : on corrige par une migration nouvelle, ce que vérifie `ci`.
