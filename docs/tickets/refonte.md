# Tickets — refonte graphique

À traiter dans l'ordre, avant les tickets de la phase 3.
Décidée par le propriétaire le 19 novembre 2026 : interface épurée et moderne, thèmes clair et sombre, actions en feuilles, icônes, vraie carte, illustrations SVG dessinées par les agents (ADR 0011).
Maquettes de référence : artefact « OIKOS — nouvelle interface » (Maison, Carte, Olympe, Maison sur téléphone, Agora sur téléphone).
Aucun de ces tickets n'est `sensible` : ils ne touchent ni la monnaie, ni les stocks, ni l'authentification, ni les règles par ligne.
Numérotation : celle des tickets GitHub, de #687 à #700.

## #687 — Refonte (1) : jetons et thèmes épurés

### Contexte

Premier ticket de la refonte décidée par le propriétaire (ADR 0011) : la palette inspirée de la céramique grecque laisse la place à une interface épurée, graphite ou claire, avec un seul accent orange.
Les écrans existants prennent les nouveaux jetons sans changer de code.
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences)

### Critères d'acceptation

- [ ] `packages/ui/src/theme.css` : fond, deux plans de surface, texte en trois niveaux, deux bordures, accent orange, succès, alerte, danger et information avec leurs fonds atténués, mer (pour la carte), dans les deux thèmes.
- [ ] Rayons, ombres et durées selon l'ADR 0011 ; Inter seule : `--font-display` et la dépendance `@fontsource-variable/fraunces` sont retirés, l'en-tête de `theme.css` décrit la nouvelle direction.
- [ ] Le composant `Frieze`, ses tests, ses usages et les utilitaires `meander` et `frieze-wave` sont retirés ; aucun écran ne garde de frise.
- [ ] Le catalogue (`catalogue.html`) montre la nouvelle palette dans les deux thèmes.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Nouveaux composants (#688, #689), refonte des écrans.

### Dépendances

Aucune.

## #688 — Refonte (2) : composants de saisie

### Contexte

Les formulaires actuels alignent des champs nus ; la refonte veut des commandes soignées et des saisies guidées (ADR 0011).
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences)

### Critères d'acceptation

- [ ] `@oikos/ui` exporte `Button` refait (principal, secondaire, discret, danger ; tailles ; icône ; chargement), `IconButton` (nom accessible obligatoire), `TextField`, `NumberField` (boutons ±, pas, bornes, raccourcis 25 %, 50 %, tout quand une borne est connue, saisie au format de la langue), `Select`, `SegmentedControl` et `PillTabs` (rôles `tablist`/`tab`, flèches du clavier), `Switch`.
- [ ] Libellé, aide et message d'erreur reliés au champ (`aria-describedby`, `aria-invalid`) ; validation à la saisie.
- [ ] Cibles tactiles de 44 px au moins sur téléphone.
- [ ] Chaque composant a ses tests (rôles, clavier, états) et sa place dans le catalogue.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Feuilles et étapes (#689), écrans.

### Dépendances

#687

## #689 — Refonte (3) : composants de structure et feuilles d'action

### Contexte

Les actions du jeu s'ouvrent dans des feuilles, par étapes, au lieu de formulaires ouverts en permanence (ADR 0011).
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences)

### Critères d'acceptation

- [ ] `Card` et `StatCard` (libellé, valeur en chiffres tabulaires, variation, icône), `Badge`, `Progress` (rôle `progressbar`), `DataTable` (en-têtes triables au clavier avec `aria-sort`, fiches sous 1 024 px), `EmptyState` avec emplacement d'illustration.
- [ ] `Sheet` : montée du bas sous 1 024 px, panneau latéral au-delà ; piège du foyer, Échap et bouton Fermer, foyer rendu au déclencheur, défilement de la page bloqué.
- [ ] `Dialog` pour une confirmation courte ; `Stepper` pour une action à plusieurs étapes (étape courante annoncée, retour sans perte de saisie, récapitulatif avant confirmation).
- [ ] `StatusRegion` : région vivante présente avant le résultat, pour annoncer le résultat près de l'action.
- [ ] Tests de clavier et de foyer pour chaque composant ; catalogue à jour.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Écrans.

### Dépendances

#687

## #690 — Refonte (4) : coquille du jeu

### Contexte

La coquille actuelle (en-tête et onglets) laisse la place à celle des maquettes : barre latérale sur ordinateur, barre d'onglets en bas sur téléphone.
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences), `docs/specs/10-ux-ui.md` (Navigation)

### Critères d'acceptation

- [ ] Barre latérale à partir de 1 024 px : marque, maison (blason, nom, cité, statut), cinq onglets avec icône et compteur de messages non lus, Réglages.
- [ ] Sous 1 024 px : en-tête compact et barre d'onglets en bas, onglet actif marqué par la couleur et un trait.
- [ ] En-tête de page commun : titre, heure de jeu et prochaine clôture, recherche si l'écran en a une, action principale.
- [ ] Réglages en feuille : thème (clair, sombre, celui de l'appareil), langue, déconnexion ; Échap rend le foyer.
- [ ] Les écrans d'erreur de lecture (`LoadProblem`) et de page introuvable (`NotFound`) prennent la nouvelle présentation, avec une illustration quand #691 est fusionné.
- [ ] Les routes ne changent pas ; les tests de bout en bout naviguent comme avant.
- [ ] Un contrôle d'accessibilité automatique (axe) tourne dans les tests de bout en bout sur la coquille, sans violation grave.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Contenu des écrans.

### Dépendances

#688, #689

## #691 — Refonte (5) : illustrations SVG originales

### Contexte

Le propriétaire veut des illustrations là où elles aident, toutes dessinées en SVG par les agents, sans image sous licence.
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences)

### Critères d'acceptation

- [ ] `packages/ui/src/illustrations` : un pictogramme pour chacun des 15 biens, un emblème pour chaque dieu de la configuration, une vignette par cité, une scène d'accueil (connexion et création de maison) et des illustrations d'états vides (pas de site, pas de navire, pas de message, pas d'ordre).
- [ ] Tout est dessiné à la main dans le dépôt : aucun fichier importé, aucune image matricielle, aucune source externe.
- [ ] Les couleurs viennent des jetons (`currentColor` et variables), et chaque dessin se lit dans les deux thèmes.
- [ ] Décoratives par défaut (`aria-hidden`) ; un composant qui porte une information reçoit un nom accessible.
- [ ] Une page du catalogue les montre toutes, dans les deux thèmes ; un test vérifie qu'aucune ne contient d'image ni de lien externe.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Carte de l'archipel (#696).

### Dépendances

#687

## #692 — Refonte (6) : connexion, accueil et création de maison

### Contexte

Premiers écrans vus par un joueur : ils donnent le ton de la refonte.
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences), `docs/specs/10-ux-ui.md` (Exigences, Accueil)

### Critères d'acceptation

- [ ] Connexion en une carte centrée avec l'illustration d'accueil ; messages d'erreur près du champ.
- [ ] Création de maison par étapes : nom, blason, cité (avec vignette, terroir et dieu protecteur de chaque cité), récapitulatif.
- [ ] Les tests de bout en bout d'inscription et de création passent avec leurs assertions.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Parcours guidé de 15 minutes (phase 4).

### Dépendances

#690, #691

## #693 — Refonte (7) : Maison, tableau de bord et sites

### Contexte

Le tableau de bord et l'écran Sites sont les plus utilisés ; l'écran Sites aligne aujourd'hui tous ses formulaires.
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences), `docs/specs/10-ux-ui.md` (écrans clés 1 et 2), `docs/specs/04-systemes-gestion.md`

### Critères d'acceptation

- [ ] Tableau de bord comme la maquette : cartes de chiffres clés, courbe de la trésorerie doublée d'un tableau, « À faire aujourd'hui » (alertes existantes), production en cours avec « Récolter » et « Tout récolter ».
- [ ] Sites : liste en cartes ou tableau ; fiche d'un site avec ses chiffres ; acquisition, changement de production, relance et intendant (embauche, règles, consigne : `SiteSteward`, `SiteStewardInstruction`) dans des feuilles, par étapes, au prix vu.
- [ ] Les tests de bout en bout `first-slice` et `alpha-journey` passent avec leurs assertions.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Personnel, immobilier, comptes (#694).

### Dépendances

#690, #691

## #694 — Refonte (8) : Personnel, Immobilier et Comptes

### Contexte

Suite de l'onglet Maison.
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences), `docs/specs/10-ux-ui.md` (écran clé 6), `docs/specs/04-systemes-gestion.md` (4.4, 4.5)

### Critères d'acceptation

- [ ] Personnel (`Staff`) et Immobilier (`Property`, `PropertyActions`) : tableaux et fiches, achat, location, rénovation, mise en vente et fin de bail dans des feuilles, au prix vu.
- [ ] Comptes : bilan en cartes, stocks valorisés et compte de résultat en `DataTable`, flux de trésorerie en barres doublées d'un tableau.
- [ ] Les tests existants passent avec leurs assertions.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Rien de plus que les critères ci-dessus.

### Dépendances

#689, #690, #691

## #695 — Refonte (9) : Agora

### Contexte

Vendre et acheter se font aujourd'hui dans des formulaires toujours ouverts ; la maquette les met dans une feuille en trois étapes.
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences), `docs/specs/05-economie.md` (5.3), `docs/specs/10-ux-ui.md` (écran clé 3)

### Critères d'acceptation

- [ ] Écran d'un bien : cours, variation, chandeliers doublés d'un tableau, carnet par niveau de prix, ordres de la maison.
- [ ] Vendre et Acheter en feuille par étapes : bien et cité, quantité (± et raccourcis bornés par le stock libre ou la trésorerie) et prix (meilleure offre proposée), récapitulatif brut, taxe et net avant confirmation.
- [ ] Les tests de bout en bout de l'agora passent avec leurs assertions.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Rien de plus que les critères ci-dessus.

### Dépendances

#690, #691

## #696 — Refonte (10) : carte de l'archipel

### Contexte

La carte actuelle place les cités sur une ellipse ; le propriétaire veut une vraie carte.
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences), `docs/specs/10-ux-ui.md` (écran clé 4), `docs/specs/04-systemes-gestion.md` (4.6)

### Critères d'acceptation

- [ ] Un dessin SVG fait main de l'archipel : côtes, îles, hauts-fonds, rose des vents et échelle en heures de mer, dans les deux thèmes.
- [ ] La position de chaque cité sur le dessin vient de la configuration, par un champ facultatif d'affichage qui ne porte aucune valeur d'équilibrage ; une cité sans position reste placée par la règle actuelle.
- [ ] Déplacement et zoom à la souris, au doigt (pincement) et au clavier, bornés au dessin ; bouton pour recentrer sur la cité de la maison.
- [ ] Routes (celles de la maison mises en avant), navires en mer à la part du trajet faite, navires à quai ; calques en pastilles.
- [ ] Panneau de la cité choisie (population, taxe, quelques cours, terroir, lien vers son agora) et de la flotte ; départ en feuille par étapes.
- [ ] Chantier naval (`Shipyard`) et fiche d'un navire (`Ship`) : achat en feuille au prix vu, voyages en tableau.
- [ ] La liste accessible des routes et des navires reste ; les tests de bout en bout du transport passent avec leurs assertions.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Parcelles et quartiers d'une cité.

### Dépendances

#690, #691

## #697 — Refonte (11) : Cité

### Contexte

L'onglet Cité empile vie politique, assemblée, trésor, événements et chronique.
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences), `docs/specs/10-ux-ui.md` (écran clé 5), `docs/specs/06-cites-politique-communaute.md`

### Critères d'acceptation

- [ ] Sous-sections en pastilles : Vie politique, Assemblée, Trésor, Événements, Chronique.
- [ ] Candidature et vote en cartes ; proposition de décret en feuille par étapes (modèle, paramètres aux bornes annoncées, récapitulatif) ; trésor en cartes et barres doublées d'un tableau.
- [ ] Les tests existants passent avec leurs assertions.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Temple (#698).

### Dépendances

#690, #691

## #698 — Refonte (12) : Temple et Messages

### Contexte

Derniers écrans du jeu.
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences), `docs/specs/10-ux-ui.md` (écrans clés 7 et 8), `docs/specs/07-dieux-faveur-evenements.md`

### Critères d'acceptation

- [ ] Temple : une carte par dieu avec son emblème, sa Charis et son déclin ; offrande et grâce en feuilles ; Pythie et oracles en fil.
- [ ] Messages : deux panneaux sur ordinateur (canaux et fil), liste puis fil sur téléphone ; compositeur fixé en bas ; signalement en feuille.
- [ ] Sanctions du joueur : avis en bandeau (`SanctionNotice`) et appel en feuille (`SanctionAppeal`), plus de formulaire ouvert en permanence.
- [ ] Les tests existants passent avec leurs assertions.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Rien de plus que les critères ci-dessus.

### Dépendances

#690, #691

## #699 — Refonte (13) : Olympe

### Contexte

Le back-office doit être aussi soigné que le jeu, avec les mêmes jetons.
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences), `docs/specs/15-back-office-olympe.md`

### Critères d'acceptation

- [ ] Coquille d'Olympe : barre latérale des modules, en-tête, onglets en pastilles ; connexion et second facteur (`SignIn`, `SecondFactor`) en carte centrée.
- [ ] Vigie et Économie comme la maquette : indicateurs en cartes, graphiques doublés de tableaux, tableaux triables.
- [ ] Paramètres : sections repliables et édition en panneau, différences avec la version en vigueur avant publication.
- [ ] Événements, Modération, Accès et Journal d'audit : listes filtrables et actions en feuilles ; double validation inchangée.
- [ ] Les tests de bout en bout d'Olympe passent avec leurs assertions.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Rien de plus que les critères ci-dessus.

### Dépendances

#688, #689, #690

## #700 — Refonte (14) : contrôle visuel et revue finale

### Contexte

La refonte se clôt sur un contrôle qui empêche les régressions visuelles.
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences)

### Critères d'acceptation

- [ ] Captures des écrans clés du jeu et d'Olympe, dans les deux thèmes, à 360 et 1 440 px, comparées par les tests de bout en bout (`toHaveScreenshot`), avec une tolérance faible et des données figées.
- [ ] Contrôle d'accessibilité automatique (axe) sur chaque écran capturé, sans violation grave.
- [ ] Une revue finale, par une session distincte, compare chaque écran aux maquettes et liste les écarts ; les écarts bloquants sont corrigés.
- [ ] `docs/etat.md` décrit la nouvelle interface.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Rien de plus que les critères ci-dessus.

### Dépendances

#692, #693, #694, #695, #696, #697, #698, #699
