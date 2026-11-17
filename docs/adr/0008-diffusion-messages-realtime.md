# ADR 0008 — Diffusion des messages par Realtime, abonnements autorisés par la base

Date : 2026-11-17 · Statut : acceptée

## Contexte

Les messages de la discussion (6.6, #273) doivent arriver sans recharger la page (#274).
L'architecture retient Supabase Realtime en mode diffusion par canal (11.2).
Un client ne doit ni diffuser lui-même, ni entendre un canal qu'il ne lit pas, et le jeu doit rester utilisable quand Realtime ne répond pas.
Realtime autorise un canal privé par les règles par ligne de sa table `realtime.messages` : à l'abonnement, il essaie, au nom du joueur, de lire puis d'écrire une ligne du sujet demandé, dans une transaction qu'il annule.
Il limite aussi le nombre de canaux d'un client (100 par défaut).

## Décision

- **Seule la base diffuse.**
  Un déclencheur après insertion dans `game.messages` appelle `realtime.send` en mode privé, au nom du propriétaire.
  Realtime lit `realtime.messages` par réplication logique : seul un message validé est diffusé, jamais celui d'une transaction annulée.
  Une diffusion en échec (Realtime absent, partition manquante) n'empêche jamais d'écrire le message : `realtime.send` rend un avertissement, et le déclencheur ne fait rien si le schéma de Realtime n'existe pas.
- **Sujets.**
  Un message du canal d'une cité est diffusé sur le sujet de ce canal, `chat:<canal>`.
  Un message d'une conversation privée est diffusé sur le sujet de chacune de ses deux maisons, `house:<maison>`.
  Ainsi la première réponse d'une conversation que l'autre maison vient d'ouvrir arrive en direct, et un client tient deux abonnements quel que soit son nombre de conversations.
- **Contenu : des identifiants, jamais le texte.**
  La diffusion porte le canal et l'identifiant du message (`channel_id`, `message_id`), ni le texte ni l'auteur.
  `realtime.messages` garde ses lignes quelques jours, hors de la purge de la discussion (ADR 0002) et hors du masquage par la modération.
  Le client relit les messages par la vue `channel_messages`, sous règles par ligne : un message masqué entre-temps n'y rend pas son texte, et une diffusion forgée ne pourrait que provoquer une relecture.
- **Abonnement autorisé par une règle par ligne.**
  Sur `realtime.messages`, une règle de lecture pour `authenticated` admet les seuls sujets rendus par `game.readable_realtime_topics()` : le sujet de chaque canal que le joueur lit (`game.readable_channel_ids()`, migration 91) et celui de chacune de ses maisons.
  Elle ne vaut que pour la diffusion (`broadcast`) : la présence n'est ouverte à personne.
  `anon` n'a aucune règle : un visiteur ne s'abonne à rien.
- **Aucun client ne diffuse.**
  Des règles restrictives refusent à `anon` et `authenticated` toute insertion, modification et suppression dans `realtime.messages`, quelles que soient les règles permissives ajoutées plus tard.
  Realtime refuse donc la diffusion d'un client sur un canal privé.
- **Repli : la relecture.**
  Tant que l'abonnement n'est pas établi, ou s'il tombe, l'écran relit les messages à intervalle régulier (`CLIENT_SETTINGS.chatPollSeconds`, `packages/config`) et dit que les messages ne viennent plus en direct.
  Il relit aussi chaque fois que tous ses abonnements sont établis, la première fois comprise : un message validé entre la première lecture et l'abonnement n'a été diffusé à personne.
  En direct, une relecture de sécurité lente (`CLIENT_SETTINGS.chatSafetyRereadSeconds`) borne la durée d'une panne de la diffusion que l'abonnement ne voit pas (partition du jour manquante, fonction de Realtime changée).
- **Migration tolérante.**
  La CLI de Supabase crée le schéma de Realtime avant les migrations quand Realtime est activé (`config.toml`), au démarrage comme à `db reset`.
  Si `realtime.messages` n'existe pas encore, la migration n'écrit pas les règles et l'annonce par un avertissement.
  L'absence de règle ferme alors tous les canaux privés, ce qui est sûr : l'écran passe en relecture.
  La migration se rejoue une fois Realtime en place (`infra/README.md`).

## Conséquences

- Chaque message coûte une relecture par client abonné au sujet ; le texte ne passe que par une vue sous règles par ligne.
- Le masquage d'un message n'est pas diffusé : il apparaît à la relecture suivante.
- Un abonnement est autorisé à son établissement : une maison qui ne lit plus un canal garde son abonnement jusqu'à la reconnexion, et n'en reçoit que des identifiants.
- Les canaux publics de Realtime restent ouverts par défaut (`private_only` du locataire) : un client peut y diffuser à d'autres clients, hors de la base.
  Le jeu ne les écoute pas, et leurs sujets sont distincts des canaux privés.
  En production, le locataire doit n'admettre que les canaux privés, et sa limite de connexions simultanées (200 par défaut) être portée à la cible de 13 (`infra/README.md`).
- Les tests pgTAP passent par `realtime.authorize`, la fonction que Realtime appelle à l'abonnement dans la version épinglée par la CLI : une montée de version de Realtime refait foi en `ci`.
