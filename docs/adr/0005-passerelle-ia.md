# ADR 0005 — Passerelle IA

Date : 2026-11-15 · Statut : acceptée

## Contexte

La phase 2 introduit trois usages d'un modèle de langage : oracles de la Pythie, chronique des cités, consignes d'intendant.
La règle 6 de `CLAUDE.md` et la spécification 8 imposent qu'un modèle ne décide d'aucun chiffre, n'écrive jamais en base, et que le jeu reste entièrement jouable IA coupée.
Il faut aussi tenir un coût : moins de 0,10 € par joueur actif et par mois (8.5).
Aucun fournisseur n'est encore choisi ni payé : le propriétaire a reporté tout compte tiers (#269, `needs-human`).

## Décision

- **Une seule passerelle**, `packages/ai` (`createGateway`), appelée par le seul moteur (11).
  Elle reçoit un usage, des consignes écrites dans le code, des données, un schéma Zod de sortie et un repli.
- **Fournisseur interchangeable** : une interface `AiProvider` (`complete(request, signal)`).
  Le fournisseur factice et déterministe (`fakeProvider`) sert aux tests et au jeu en local ; le vrai fournisseur arrivera avec #269, derrière la même interface.
- **Jamais d'erreur rendue au jeu** : usage coupé, plafond du mois atteint, délai dépassé, réponse qui n'est pas du JSON conforme au schéma, réponse illisible, erreur du fournisseur, réglages ou schéma qui lèvent, lecture du journal en échec donnent le repli, écrit à la main ou par gabarit, développé avec l'usage.
  Une écriture du journal en échec ne prive pas le jeu du texte : l'appel est seulement perdu pour la Vigie.
- **Texte de joueur = donnée** : il ne va que dans un bloc `<donnees>…</donnees>`, encodé en JSON, chevrons échappés, si bien qu'il ne peut pas fermer le bloc.
  La vraie garantie reste le schéma de sortie : une réponse détournée par une injection n'est pas acceptée.
  Une injection qui reste dans le schéma (un oracle au texte détourné) passe, par construction : chaque usage borne donc son schéma au strict nécessaire.
- **Obligations des tickets d'usage** : consignes constantes, écrites dans le code de l'usage, jamais construites avec un texte de joueur ; aucun chiffre que le jeu appliquerait dans le schéma de sortie (règle 6) ; un repli développé en même temps.
- **Dérogation de l'usage `steward` (#280)** : sa sortie porte des prix et des quantités, ceux des règles qu'il propose, à ces conditions toutes réunies.
  Le modèle ne fait que recopier les nombres écrits en chiffres dans la consigne du joueur, avec l'unité écrite à côté de chaque prix (obole ou drachme).
  Le code lit lui-même ces paires (nombre, unité) et ces quantités dans le texte, et rejette toute réponse dont un prix n'est pas l'une de ces paires, valeur et unité, ou dont une quantité n'y figure pas (seule une réserve de 0 peut manquer).
  Un nombre décimal ou un prix composé de drachmes et d'oboles rend la consigne ambiguë : le code la refuse sans appel.
  La conversion en oboles est faite par le code, jamais par le modèle.
  Les règles proposées sont simulées à blanc et montrées au joueur avec leurs montants convertis.
  Rien n'est appliqué sans la commande `steward.setRules` du joueur, qui refait toutes ses vérifications : la proposition seule ne change ni règle, ni stock, ni trésorerie.
  Aucun autre usage ne profite de cette dérogation sans un ADR qui la reprenne.
- **Plafond mensuel par usage**, calculé depuis la configuration (`ai`) : budget par joueur actif et par mois (au plus 0,10 €), nombre de joueurs actifs attendu, part de chaque usage.
  Le mois est le mois civil UTC.
  Un usage qui atteint son plafond est coupé jusqu'au mois suivant.
  Un appel ne part que si son coût de sortie le plus cher (`maxOutputTokens`, demandé au fournisseur) tient sous ce qui reste du plafond.
  Le coût d'entrée n'est connu qu'après l'appel et n'est pas réservé : un appel peut dépasser le plafond de son coût d'entrée, que les consignes constantes et des données bornées par chaque usage gardent petit.
  Des appels simultanés d'un même usage peuvent le dépasser ensemble, d'au plus un appel chacun : la dépense est lue avant l'appel et écrite après.
- **Coût estimé** à partir des jetons et des prix par millier de jetons de la configuration, en millionièmes d'euro entiers, arrondi à l'unité supérieure.
  Une réponse rejetée coûte ses jetons ; une réponse aux jetons illisibles coûte sa sortie la plus chère ; une erreur ou un délai ne coûte rien.
  Un fournisseur réel peut facturer les jetons produits avant un abandon : #269 revoit ce point avec la facturation réelle.
- **Journal des appels** : usage, modèle, jetons, coût estimé, issue, durée et date ; jamais les consignes, les données ni la réponse.
- **Neutre au départ** : tous les usages sont coupés dans la configuration initiale.

## Conséquences

- Couper un usage ou son plafond se fait par une version de configuration, sans patch.
- Le coût réel facturé peut différer de l'estimation : la Vigie montre l'estimation, la facture du fournisseur reste la référence.
- Le cache et les files d'attente de 8.4 ne sont pas encore faits : les tickets d'usage génèrent chronique et oracles par lots, à la clôture.
- Les clés et l'adresse du fournisseur seront des variables d'environnement documentées dans `.env.example`, sans valeur dans le dépôt.
