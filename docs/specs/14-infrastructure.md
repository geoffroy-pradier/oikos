# 14. Infrastructure

Oui, Supabase auto-hébergé sur un VPS OVH convient, à condition de prendre au moins 8 Go de mémoire et d'accepter d'en assurer soi-même l'exploitation. La documentation de Supabase donne 4 Go et 2 cœurs comme minimum et recommande 8 Go et 4 cœurs ou plus ([source](https://supabase.com/docs/guides/self-hosting/docker)) ; le jeu ajoute l'API, le moteur et la supervision par-dessus.

## 14.1 Dimensionnement

| Environnement | Machine | Usage |
| --- | --- | --- |
| Développement et alpha | VPS OVH de 12 Go environ | Supabase allégé, API, moteur, jusqu'à quelques centaines de joueurs |
| Production (bêta et lancement) | VPS OVH 8 vCores, 24 Go, 200 Go NVMe | Cible de 5 000 joueurs actifs par jour |
| Préproduction | Petit VPS séparé, ou le VPS d'alpha recyclé | Tests de migration et de charge |

OVH affiche la configuration 8 vCores, 24 Go et 200 Go NVMe à partir de 19,96 € HT par mois, avec sauvegarde quotidienne incluse et montée en gamme en un clic ([source](https://www.ovhcloud.com/fr/vps/)). Les tarifs VPS ont augmenté en 2026 et le prix plancher dépend de la durée d'engagement : à vérifier dans le panier au moment de commander.

## 14.2 Composition du serveur

Tout tourne en conteneurs Docker Compose derrière un proxy Caddy qui gère le HTTPS.

| Service | Rôle | Mémoire indicative |
| --- | --- | --- |
| Postgres (Supabase) | Base unique | 8 à 10 Go |
| Kong, Auth, PostgREST, Realtime, Storage, Studio, pooler | Services Supabase conservés | 2 à 3 Go |
| API de jeu (2 instances) | Commandes | 1 Go |
| Moteur | Ticks, tâches, IA | 1 Go |
| Caddy | HTTPS, fichiers statiques du client et du back-office | 0,2 Go |
| Prometheus, Grafana, Loki | Métriques et journaux | 1,5 Go |
| Uptime Kuma, GlitchTip | Disponibilité, erreurs applicatives | 1 Go |

Les services Supabase inutiles au jeu (analytique Logflare, transformation d'images, fonctions Edge) sont désactivés pour économiser la mémoire. La logique métier vit dans l'API de jeu, pas dans des fonctions Edge.

## 14.3 Ce que l'auto-hébergement vous laisse à charge

- **Sauvegardes** : la sauvegarde OVH du disque ne suffit pas. Archivage continu des journaux Postgres avec pgBackRest vers un stockage objet OVH, pour restaurer à la minute près, et test de restauration mensuel automatisé.
- **Mises à jour** : versions Supabase épinglées, montées de version d'abord en préproduction.
- **Redémarrage de la base** : une session fermée par Postgres pendant une commande ou un tick (mise à jour, bascule, `pg_terminate_backend`) ne fait échouer que ce travail.
  L'API répond `INTERNAL` et écrit sa trace d'audit par une autre connexion ;
  la clé d'idempotence reste réutilisable. Le moteur rejoue le tick ou la clôture au passage suivant, une seule fois.
  Ni l'API ni le moteur ne s'arrêtent : chaque connexion du pool a un écouteur d'erreur.
  Dans l'API, une annulation impossible sur une connexion morte est ignorée (la base a déjà tout annulé) ;
  dans le moteur, elle fait échouer le passage, qui sera rejoué.
- **Sécurité** : pare-feu limité aux ports 80, 443 et SSH par clé, Studio et Grafana accessibles uniquement par VPN (WireGuard ou Tailscale), secrets hors dépôt, rotation des clés, fail2ban.
- **En-têtes de sécurité** : Caddy sert le client joueur et Olympe avec une politique de contenu stricte (fichiers du domaine, API de jeu sous ce même domaine, Supabase sous `supabase.<domaine>` ;
  aucun script ni style en ligne hors empreinte déclarée, aucune inclusion dans une autre page), sans détection du type de contenu, en HTTPS seul.
  Olympe ne transmet aucune adresse aux autres sites. Ces en-têtes accompagnent toute réponse, erreurs produites par Caddy comprises (fichier absent, API injoignable) ;
  l'en-tête `Server` n'est pas retiré. Le contrôle des clients statiques de `ci` compare la politique servie à l'attendu, vérifie ces en-têtes sur les réponses 200, 404 et 502, et que les pages servies les respectent.
- **Protection** : Cloudflare en façade (offre gratuite) pour le cache, le pare-feu applicatif et les attaques par saturation.
- **E-mails** : envoi transactionnel par un service spécialisé (Brevo ou équivalent), pas depuis le VPS.

Pour le prototype, un projet Supabase Cloud gratuit reste une option pour avancer avant d'installer le serveur : le schéma et les migrations sont identiques.

## 14.4 Déploiement

GitHub Actions construit les images, les publie sur le registre GitHub et déploie par SSH : préproduction à chaque fusion, production sur étiquette de version, après validation humaine.
Les migrations sont appliquées avant le basculement des conteneurs et doivent rester compatibles avec la version précédente du code.
Seules les migrations absentes de `supabase_migrations.schema_migrations` (la table de la CLI Supabase) sont appliquées, chacune en une transaction avec son enregistrement ;
une migration en échec arrête le déploiement sans être enregistrée.
Une base déployée avant cette table est reconnue à ce qu'aucune migration n'y est enregistrée alors que le schéma `game` existe : les migrations de la version précédente y sont enregistrées sans être rejouées (`infra/README.md`).
La suite entière reste rejouable, vérifiée en `ci`.

## 14.5 Trajectoire de montée en charge

1. Monter le VPS en gamme.
2. Sortir Postgres sur une machine dédiée.
3. Ajouter une réplique en lecture pour les vues du client et le back-office.
4. Ouvrir un nouvel Âge (un monde = une base) plutôt que de grossir indéfiniment un monde.

## 14.6 Budget mensuel indicatif

| Poste | Estimation |
| --- | --- |
| VPS de production | 20 à 30 € HT |
| VPS de préproduction | 5 à 12 € HT |
| Stockage objet des sauvegardes | 2 à 5 € |
| Nom de domaine, e-mails transactionnels | 5 à 15 € |
| API de modèles d'IA | Variable, plafonnée dans le back-office |

Ces montants sont des ordres de grandeur à confirmer sur les grilles en vigueur.
