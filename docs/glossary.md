# Lexique du jeu

Tous les agents utilisent ces termes, dans le code (en anglais : `house`, `city`, `favor`, `hubris`) comme dans l'interface (en français).

| Terme | Sens dans le jeu |
| --- | --- |
| Oikos | La maison du joueur : famille, domaine, affaires, trésor |
| Polis | Une cité, communauté de 100 à 400 joueurs actifs |
| Agora | Le marché de la cité, et par extension l'espace public (forum) |
| Séquestre | Monnaie qu'un achat en attente à l'agora retient hors de la trésorerie (prix limite × reste), rendue à l'annulation (`escrow`) |
| Drachme | Monnaie courante. 6 oboles = 1 drachme, 6 000 drachmes = 1 talent |
| Charis | Faveur divine d'une maison envers un dieu, entière, gagnée par les offrandes et les actes ; elle décline à chaque clôture et ne se transfère pas (`favor`) |
| Timè | Honneur, réputation publique de la maison |
| Hybris | Démesure : jauge qui monte quand une maison domine trop |
| Liturgie | Dépense publique imposée aux plus riches, source de prestige |
| Olympiade | Cycle de 16 semaines réelles, conclu par les Jeux |
| Âge | Un monde de jeu (un serveur) |
| Olympe (Olympus) | Le back-office : l'outil des administrateurs, distinct du client joueur |
| Vigie (Watch) | Module d'Olympe qui surveille joueurs, commandes, ticks et file de tâches |
| Caboteur (coaster) | Petit navire de commerce, rapide, qui longe les côtes d'une cité à l'autre (`coaster`) |
| Navire rond (round ship) | Grand navire de commerce, plus lent que le caboteur, qui porte plus de fret (`round_ship`) |
| Métèque (metic) | Maison accueillie dans une cité sans en être citoyenne : elle y travaille et commerce, mais n'y vote pas (`metic`) |
| Citoyen (citizen) | Maison citoyenne de sa cité, après quelques jours de jeu comme métèque : elle vote et peut être élue (`citizen`) |
| Archonte (archon) | Magistrat élu par les citoyens d'une cité pour une année de jeu (4 semaines) ; seul magistrat de la phase 2 (`archon`) |
| Droit de port (port dues) | Forfait par classe de navire que la cité d'arrivée perçoit d'un voyage, payé au départ ; une part est détruite, le reste va au trésor de la cité (`port dues`) |
| Désarmé (laid up) | Se dit d'un navire dont l'entretien n'a pas été payé à la clôture : il ne part plus jusqu'à une clôture qui le paie (`laid_up_at`) |
| Canal de la cité (city channel) | Discussion commune d'une cité, où écrit toute maison de la cité, citoyenne ou métèque (`channel`, de type `city`) |
| Conversation privée (direct conversation) | Discussion entre deux maisons d'un même monde (`channel`, de type `direct`) |
| Bien immobilier (property) | Logement d'une cité, d'abord détenu par elle, qu'une maison achète, rénove et entretient (`property`) |
| Maison de ville (townhouse) | Petit logement, la plus petite des deux tailles de bien immobilier (`townhouse`) ; à ne pas confondre avec la maison du joueur (oikos) |
| Immeuble de rapport (tenement) | Grand logement de plusieurs foyers, la plus grande des deux tailles de bien immobilier (`tenement`) |
| État, vétusté (condition, wear) | État d'un bien immobilier, de 0 à 10 000 (neuf) ; la vétusté lui en retire chaque jour, la rénovation le rend neuf (`condition`, `dailyWear`) |
| Offre (listing) | Mise en vente à prix affiché ou en location d'un bien immobilier par la maison qui le possède ; une seule ouverte par bien (`property_listings`) |
| Bail, loyer (lease, rent) | Location d'un bien immobilier d'une maison à une autre, sans durée ; le locataire paie au propriétaire un loyer quotidien à chaque clôture (`leases`, `lease.rent`) |
| Propriétaire, locataire (landlord, tenant) | Les deux parties d'un bail (`landlord`, `tenant`) ; à ne pas confondre avec le propriétaire de la base de données |
| Revente (resale) | Achat d'un bien immobilier mis en vente par une autre maison, taxé comme un échange de l'agora (`property.sale`) |
| Offrande (offering) | Don d'oboles, détruites, et de biens, retirés de la circulation, qu'une maison fait à un dieu pour gagner de la Charis (`offerings`, `temple.makeOffering`) |
| Déclin (decay) | Part de sa Charis qu'une maison perd envers chaque dieu à chaque clôture, arrondie vers zéro (`dailyDecayBps`) |
| Charis de cité (city Charis) | Charis des citoyens d'une cité envers son dieu protecteur, sommée et pondérée par le dieu (`city_charis`) |
| Grâce (grace) | Pouvoir actif d'un dieu qu'une maison invoque en dépensant de la Charis ; il s'applique une fois à sa prochaine action admise, puis se recharge (`graces`, `temple.invokeGrace`, `graces_used`) |
| Récolte bénie (blessed harvest) | Grâce qui ajoute un pourcentage, arrondi vers le bas, à la prochaine récolte d'un site de matière première (`blessed_harvest`) |
| Atelier inspiré (inspired workshop) | Grâce qui ajoute un pourcentage, arrondi vers le bas, à la prochaine récolte d'un atelier, sans intrant de plus (`inspired_workshop`) |
| Vent favorable (fair wind) | Grâce qui raccourcit le prochain départ d'un navire de la maison (`fair_wind`) |
| Recharge (cooldown) | Jours de jeu, comptés depuis le jour de son invocation, avant qu'une grâce consommée se réinvoque (`cooldownDays`, `ready_at`) |
| Événement du monde (world event) | Événement planifié par le moteur quelques jours à l'avance, tiré de la graine du monde ; les joueurs ne le voient qu'à son début (`world_events`) |
| Graine du monde (world seed) | Valeur secrète tirée à la création d'un monde, jamais modifiée, dont se dérive l'aléa des événements de chaque jour (`worlds.seed`) |
| Sécheresse (drought) | Événement du monde qui réduit, pendant ses jours, le rendement des champs d'une cité (`drought`) |
| Bonne année (good year) | Événement du monde qui accroît, pendant ses jours, le rendement des vergers d'une cité (`good_year`) |
| Tempête (storm) | Événement du monde qui allonge les trajets partis sur une route pendant ses jours, sans rien faire perdre (`storm`) |
| Caravane étrangère (foreign caravan) | Événement du monde qui accroît, pendant ses jours, la demande des PNJ d'une cité pour un bien (`caravan`) |
