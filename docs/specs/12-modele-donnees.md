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
| Logistique | `ships`, `voyages`, `cargo`, `freight_offers` |
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
- Toute écriture de monnaie crée une écriture équilibrée : la somme des lignes vaut zéro, contrôlée par contrainte. La création et la destruction de monnaie passent par des comptes système nommés (un par robinet et par puits), créés avec le monde à partir d'un catalogue ; le service de jeu ne peut pas en créer. Chaque maison a une trésorerie et, dès son premier achat en attente à l'agora, un compte de séquestre : la base contrôle à chaque validation que ce compte retient exactement la somme des restes à payer (prix × reste) des achats ouverts de la maison.
- Règles de sécurité par ligne activées sur toutes les tables exposées, testées en pgTAP : un joueur lit ses données privées et les données publiques, rien d'autre.
- L'API et le moteur se connectent sous un rôle de service (`oikos_service`) qui ne possède aucune table du jeu : il lit, insère dans les journaux et les tables de jeu, mais ne peut ni supprimer ni vider, ni modifier un solde, un stock ou une réservation autrement que par les journaux. Les gardes de la base n'acceptent ces modifications que d'un déclencheur exécuté au nom du propriétaire des tables. Le service ne modifie que quelques colonnes (nom d'une maison, cycle et arrêt d'un site, annulation d'un ordre, report de la demande, valeurs d'un chandelier de prix ou d'un prix observé), n'exécute aucune fonction de déclencheur du jeu et ne possède que le schéma de sa file de tâches. Il garde le droit, accordé à tous par Postgres, de créer des tables temporaires : elles sont sans effet sur le jeu.
- Les données privées d'un concurrent (stocks, trésorerie, règles d'intendant) ne quittent jamais le serveur.
- Comptes de la maison (4.1) : un joueur lit les lignes du grand livre de ses propres comptes, trésorerie et séquestre (compte, montant), la nature et la date des écritures où il a une ligne, et le prix et la quantité des échanges dont il est le vendeur, pour séparer le brut de la taxe. Il ne lit ni les autres lignes de ces écritures (contrepartie, taxe), ni leur détail (`meta`), ni les échanges où il achète. Les vues `my_cash_flows`, `my_valued_stocks` et `my_balance_sheet` en sont des agrégats calculés à la lecture, et le compte de résultat (`my_income_statement`, `my_income_statement_by_season`) un agrégat de `my_cash_flows`, sans droit supplémentaire ; leur horloge (heure de clôture, fuseau, durée de la saison) vient de `game.clock_rules()`, seul extrait de la section `clock` de la configuration rendu aux joueurs. Cette fonction rend un fuseau nul quand Postgres ne le connaît pas (la configuration est validée par le moteur, dont la liste de fuseaux n'est pas celle de la base) : les vues restent lisibles, sans jour de jeu.
- Tables volumineuses partitionnées par mois (`trades`, `ledger_lines`, `messages`, `domain_events`), agrégats en vues matérialisées rafraîchies par le moteur. Dans la première version, les chandeliers de prix (`price_candles`) sont une table ordinaire que le moteur remplit, de clé cité, bien, durée et début de période : un recalcul remplace la ligne, il ne l'ajoute pas. Chaque échange porte un rang d'exécution (`trades.seq`), donné par la base : l'horodatage d'un échange est celui du début de sa transaction et ne départage pas les échanges d'un même appariement. Ce rang est unique, et le service n'écrit ni le rang ni la date d'un échange.
- Clôtures quotidiennes : une ligne par monde et par jour de jeu (`daily_closes` : instant de jeu de la clôture, version de configuration lue, résumé), en ajout seul, écrite dans la transaction qui applique la clôture ; sa clé garantit qu'une clôture n'est appliquée qu'une fois. Le service n'écrit pas l'heure réelle d'une clôture (`finished_at`, toujours l'horloge de la base) : il ne peut donc pas enregistrer une clôture avant son heure. En plus, la base refuse une seconde écriture d'entretien (`upkeep.daily`) pour la même maison et le même jour de jeu ; cette écriture porte l'identifiant de la maison et le jour de jeu sous une seule forme admise (identifiant en minuscules, jour entier), pour que la même clé ne s'écrive pas de deux façons. La relance d'un site par sa maison est une écriture d'une autre nature (`upkeep.restart`), que cette unicité ne concerne pas. Les joueurs ne lisent pas la table des clôtures.
- Arrêt d'un site : `sites.halted_at` porte l'instant de l'arrêt, nul pour un site qui tourne. La base garantit qu'un site naît en marche, qu'il s'arrête dans la transaction qui l'écrit (entre son début et l'heure réelle : une clôture date l'arrêt du début du cycle quand une récolte validée pendant elle l'a avancé au-delà du sien), que cet instant ne change pas ensuite, que le cycle d'un site à l'arrêt ne dépasse pas l'instant de l'arrêt (il ne peut donc pas changer de recette) et qu'à la reprise le début du cycle avance exactement de la durée de l'arrêt : le temps passé à l'arrêt n'est jamais récolté. Cette durée est comptée en secondes, indépendamment du fuseau de la session. L'arrêt est daté de la transaction qui l'écrit, pas de l'instant de jeu de la clôture : si la clôture est jouée en retard, le site a produit jusqu'à son arrêt réel. Elle ne relie pas la reprise à un paiement : c'est la commande ou la clôture qui le garantit.
- Population des PNJ (5.2) : une ligne par cité et par classe (`npc_population` : habitants entiers, jour de jeu de la dernière clôture qui l'a fait évoluer, couverture retenue), créée par le service sans clôture ni couverture, dont il ne modifie que ces trois valeurs. La base n'accepte une modification que si elle avance le jour de clôture, et vérifie à la validation que ce jour est celui d'une clôture enregistrée du même monde : une population n'évolue donc que dans la transaction d'une clôture, une fois par jour de jeu. En contrepartie, la table des clôtures, référencée, ne se vide plus qu'en cascade, ce que sa garde refuse. La mesure du jour (`npc_vital_coverage` : unités servies et demandées, nombres réels finis et positifs, par cité, classe et jour de jeu) est un état interne du moteur, qui en remplace les deux valeurs ; ce n'est ni de la monnaie ni du stock, et rien ne garantit en base qu'elle ne fait que croître. Les joueurs connectés lisent la première par la vue `city_population`, sans le monde ; la seconde n'est pas exposée.
- Migrations SQL versionnées dans le dépôt, jamais de modification manuelle en production.
