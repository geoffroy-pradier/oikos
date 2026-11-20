# Tickets — refonte graphique

À traiter dans l'ordre, avant les tickets de la phase 3.
Décidée par le propriétaire le 19 novembre 2026 : interface épurée et moderne, thèmes clair et sombre, actions en feuilles, icônes, vraie carte, illustrations SVG dessinées par les agents (ADR 0011).
Maquettes de référence : artefact « OIKOS — nouvelle interface » (Maison, Carte, Olympe, Maison sur téléphone, Agora sur téléphone).
Aucun de ces tickets n'est `sensible` : ils ne touchent ni la monnaie, ni les stocks, ni l'authentification, ni les règles par ligne.
Numérotation : celle des tickets GitHub, de #687 à #700, puis de #862 à #870 pour les écarts relevés par la revue finale de #700.

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

#692, #693, #694, #695, #696, #697, #698, #699, et les écarts bloquants de la revue finale : #862, #863, #864, #865, #866, #867, #868

## #862 — Refonte (15) : onglets et navigation qui défilent à 360 px

### Contexte

À 360 px, les rangées d'onglets en pastilles (Maison, Sites, Personnel, Comptes, Cité) et la navigation du haut d'Olympe coupent leurs libellés et cachent les derniers onglets sans le signaler.
Écart relevé par la revue finale de #700, qui ne se ferme qu'une fois cet écart corrigé.
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences)

### Critères d'acceptation

- [ ] Une rangée d'onglets ou de navigation qui ne tient pas défile horizontalement, avec un fondu sur chaque bord où il reste du contenu ; aucun libellé ni icône n'est coupé au repos.
- [ ] L'onglet actif est entièrement visible à l'arrivée, pour toutes les rangées (le centrage de `HouseNav` est généralisé).
- [ ] Cité : les pastilles sont sous l'en-tête de page comme sur Maison, et le titre de section ne répète pas la pastille active.
- [ ] Un test de bout en bout à 360 px atteint chaque onglet au clavier et le trouve visible (`toBeInViewport`), côté jeu et côté Olympe.
- [ ] Références visuelles de `visual.spec.ts` regénérées dans l'image Docker de Playwright, et l'écart visible dans la demande de fusion.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Rien de plus que les critères ci-dessus.

### Dépendances

Le contrôle visuel de #700 (ses trois demandes de fusion), #707, #708.

## #863 — Refonte (16) : cartes de chiffres et montants sur une ligne

### Contexte

La carte « Trésorerie » de la Maison passe son montant sur deux lignes et empile six lignes de détail, ce qui la rend plus haute que ses voisines et écrase sa courbe à 360 px ; les cartes de chiffres n'ont pas la même grille d'un écran à l'autre.
Écart relevé par la revue finale de #700, qui ne se ferme qu'une fois cet écart corrigé.
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences)

### Critères d'acceptation

- [ ] Une carte de chiffre montre sa valeur en grand sur une seule ligne, avec un format court des montants décrit dans la spécification 10 ; le montant exact reste lisible (libellé accessible et détail).
- [ ] Une carte de chiffre a au plus une ligne secondaire ; le détail de la trésorerie (séquestre, ordres ouverts) sort de la carte, et la courbe n'est plus écrasée à 360 px.
- [ ] Les cartes d'une rangée ont la même hauteur, et un libellé sur deux lignes ne décale pas la valeur.
- [ ] Même grille de cartes sur Maison, Sites, Personnel, Vigie et Économie d'Olympe, et même écriture d'un ratio partout (« 1 sur 4 »).
- [ ] Tests unitaires du format court (bornes, arrondi, oboles) et du composant.
- [ ] Références visuelles de `visual.spec.ts` regénérées dans l'image Docker de Playwright, et l'écart visible dans la demande de fusion.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Rien de plus que les critères ci-dessus.

### Dépendances

Le contrôle visuel de #700 (ses trois demandes de fusion), #707, #708.

## #864 — Refonte (17) : actions impossibles signalées

### Contexte

Des boutons restent actifs alors que l'action est impossible et que l'écran le sait : « Récolter » quand rien n'est prêt, « Acheter » un navire ou un bien au-delà de la trésorerie ; « Récolter » n'a pas la même hiérarchie sur Maison et sur Sites.
Écart relevé par la revue finale de #700, qui ne se ferme qu'une fois cet écart corrigé.
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences)

### Critères d'acceptation

- [ ] Quand l'écran sait qu'une action est impossible (rien à récolter, trésorerie insuffisante), son bouton est inactif (`aria-disabled`, il garde le foyer) et la raison est visible à côté et liée par `aria-describedby` ; l'API reste l'arbitre et ses refus s'affichent comme avant.
- [ ] Un style inactif distinct d'un bouton secondaire actif, dans les deux thèmes.
- [ ] Une même action a la même hiérarchie (principale ou secondaire) sur tous les écrans.
- [ ] La règle est écrite dans la spécification 10, avec la liste des actions concernées.
- [ ] Tests unitaires : bouton inactif avec sa raison, et actif dès que la condition est remplie.
- [ ] Références visuelles de `visual.spec.ts` regénérées dans l'image Docker de Playwright, et l'écart visible dans la demande de fusion.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Rien de plus que les critères ci-dessus.

### Dépendances

Le contrôle visuel de #700 (ses trois demandes de fusion), #707, #708.

## #865 — Refonte (18) : tableaux larges lisibles

### Contexte

À 1 440 px, le tableau « Compte de résultat » coupe sa dernière colonne sans indice de défilement et ses en-têtes s'étalent sur cinq lignes ; d'autres tableaux ont des en-têtes en capitales sur deux lignes ou une colonne presque vide.
Écart relevé par la revue finale de #700, qui ne se ferme qu'une fois cet écart corrigé.
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences)

### Critères d'acceptation

- [ ] À 1 440 px, le compte de résultat tient sans coupure ; un tableau qui défile horizontalement le signale par un fondu sur le bord.
- [ ] Les en-têtes de tableau tiennent sur deux lignes au plus, sans capitales forcées (carnet d'ordres de l'agora compris).
- [ ] Immobilier : la colonne et la ligne « Action » ne restent plus vides, le bouton y est placé.
- [ ] Un test de bout en bout vérifie à 1 440 px que la dernière colonne du compte de résultat est visible.
- [ ] Références visuelles de `visual.spec.ts` regénérées dans l'image Docker de Playwright, et l'écart visible dans la demande de fusion.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Rien de plus que les critères ci-dessus.

### Dépendances

Le contrôle visuel de #700 (ses trois demandes de fusion), #707, #708.

## #866 — Refonte (19) : états vides illustrés et utiles

### Contexte

Chaque écran présente une liste vide à sa façon (pastille d'icône, texte dans un cadre pointillé, texte seul), aucune ne propose l'action qui la remplit, et aucune n'utilise d'illustration.
Écart relevé par la revue finale de #700, qui ne se ferme qu'une fois cet écart corrigé.
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences)

### Critères d'acceptation

- [ ] Un composant `EmptyState` de `@oikos/ui` : une illustration SVG dessinée dans le dépôt, la raison, et l'action qui remplit la liste quand elle existe.
- [ ] Tous les états vides du jeu et d'Olympe l'utilisent (Entrepôt vers l'agora, Immobilier vers l'achat, Agora, Carte, Flotte, Cité, Modération).
- [ ] Les nouvelles illustrations sont dans `packages/ui/src/illustrations`, couvertes par le test des illustrations (aucune source externe), colorées par les jetons.
- [ ] Tests unitaires du composant et de l'action proposée sur chaque écran.
- [ ] Références visuelles de `visual.spec.ts` regénérées dans l'image Docker de Playwright, et l'écart visible dans la demande de fusion.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Rien de plus que les critères ci-dessus.

### Dépendances

Le contrôle visuel de #700 (ses trois demandes de fusion), #707, #708.

## #867 — Refonte (20) : action principale dans l'en-tête de page

### Contexte

Plusieurs écrans placent leur action principale hors de `PageHeader`, à l'inverse de la spécification 10 : « Acquérir un site » flotte entre les cartes, le sélecteur de bien de l'agora décale le titre, la carte n'a pas « Faire partir un navire » dans l'en-tête, « Nouvelle conversation » est plus bas que le titre.
Écart relevé par la revue finale de #700, qui ne se ferme qu'une fois cet écart corrigé.
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences)

### Critères d'acceptation

- [ ] Sites, Carte, Agora et Messages portent leur action principale à droite de `PageHeader`, et le titre est à la même hauteur que sur les autres écrans.
- [ ] À 360 px, l'action reste dans l'en-tête sans pousser le titre sur deux lignes.
- [ ] Un test unitaire de `PageHeader` couvre l'emplacement de l'action, et chaque écran concerné a un test qui trouve l'action dans l'en-tête.
- [ ] Références visuelles de `visual.spec.ts` regénérées dans l'image Docker de Playwright, et l'écart visible dans la demande de fusion.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Rien de plus que les critères ci-dessus.

### Dépendances

Le contrôle visuel de #700 (ses trois demandes de fusion), #707, #708.

## #868 — Refonte (21) : Olympe, modération, langue et connexion

### Contexte

Olympe garde des éléments bruts : la modération aligne sept boutons secondaires sans hiérarchie ni icône, comme un formulaire ouvert, le sélecteur de langue est le contrôle natif, et la connexion n'a pas d'illustration.
Écart relevé par la revue finale de #700, qui ne se ferme qu'une fois cet écart corrigé.
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences)

### Critères d'acceptation

- [ ] Modération : une action principale par signalement, les autres gestes dans un menu ou une feuille, chacun avec son icône ; plus de liste à puces native, et les noms de canaux sont traduits.
- [ ] Un sélecteur de langue de `@oikos/ui`, stylé par les jetons, partagé par le jeu et Olympe, au même endroit sur les deux connexions.
- [ ] La connexion d'Olympe a une illustration SVG dessinée dans le dépôt.
- [ ] Les tests existants de la modération gardent leurs assertions ; des tests couvrent le menu des gestes au clavier.
- [ ] Références visuelles de `visual.spec.ts` regénérées dans l'image Docker de Playwright, et l'écart visible dans la demande de fusion.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Rien de plus que les critères ci-dessus.

### Dépendances

Le contrôle visuel de #700 (ses trois demandes de fusion), #707, #708.

## #869 — Refonte (22) : finitions du jeu

### Contexte

Petits écarts entre les écrans du jeu et les maquettes.
Points mineurs relevés par la revue finale de #700 : ils ne bloquent pas sa fermeture.
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences)

### Critères d'acceptation

- [ ] Une icône au trait sur chaque action (Récolter, Acheter, Vendre, Annuler, Continuer…) et sur chaque titre de section, ou sur aucun d'une même famille.
- [ ] Maison : pas de nom de maison répété à 360 px ; les libellés « plus haut » et « plus bas » ne chevauchent pas la courbe ; titres de section au même style ; en sombre, le plan inversé se distingue.
- [ ] Les paragraphes d'explication sous l'en-tête (Personnel, Immobilier, Carte, Temple, Comptes) sont réduits à une ligne ou passent dans une aide ; « Pas encore fixé » n'est dit qu'une fois sur Personnel.
- [ ] Sites : une barre de progression pour la production en cours ; encart Intendant resserré.
- [ ] Agora : « Continuer » sur toute la largeur de la feuille, étapes nommées, meilleur prix mis en avant ; Immobilier : liste des offres filtrable par cité.
- [ ] Temple : le texte du déclin n'est dit qu'une fois ; description des grâces plus petite que leur titre.
- [ ] Messages : zone de saisie collée en bas à 360 px ; dates au même format qu'ailleurs.
- [ ] Connexion : bloc centré verticalement à 1 440 px.
- [ ] Cité : carte « Marché du travail » à la hauteur de ses voisines ; même fond pour toutes les cartes.
- [ ] Espace insécable avant « : », « ; », « ! » et « ? » dans les textes français, vérifiée par un test sur `fr.json`.
- [ ] Carte : durées et étiquettes ne recouvrent ni une route, ni un navire, ni les boutons de zoom ; « Population — » remplacé par un texte ; options de départ sur une ligne.
- [ ] Références visuelles de `visual.spec.ts` regénérées dans l'image Docker de Playwright, et l'écart visible dans la demande de fusion.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Rien de plus que les critères ci-dessus.

### Dépendances

#862, #863, #864, #865, #866, #867, #868

## #870 — Refonte (23) : finitions d'Olympe

### Contexte

Petits écarts entre les écrans d'Olympe et les maquettes.
Points mineurs relevés par la revue finale de #700 : ils ne bloquent pas sa fermeture.
Label : `refonte`.

### Spécification liée

`docs/adr/0011-refonte-graphique.md`, `docs/specs/10-ux-ui.md` (Direction artistique, Exigences)

### Critères d'acceptation

- [ ] Économie : tableau des sept jours replié sous le graphique ; « Part de chaque puits » lisible quand les parts sont proches ; pas de titre hors carte ; même décalage de contenu que le jeu.
- [ ] Vigie : icône et couleur d'état sur les cartes « en panne » et « refusées » ; nom du monde à la place de son identifiant ; dates lisibles.
- [ ] Paramètres : la pastille « En vigueur » lisible ; un auteur absent ne s'affiche pas « par — » ; boutons de même largeur à 360 px.
- [ ] Modération : titre aligné sur celui des autres pages.
- [ ] Une icône au trait sur chaque action et chaque titre de section.
- [ ] Références visuelles de `visual.spec.ts` regénérées dans l'image Docker de Playwright, et l'écart visible dans la demande de fusion.
- [ ] Thèmes clair et sombre, contrastes AA vérifiés par `contrast.test.ts` pour tout couple nouveau.
- [ ] Utilisable à 360 px et au clavier ; foyer visible ; animations coupées sous `prefers-reduced-motion`.
- [ ] Textes en `fr` et `en`, aucun texte en dur.
- [ ] Les comportements de la spécification 10 (clés, régions vivantes, foyer, relectures) ne changent pas ; les tests existants gardent leurs assertions, un nom accessible qui change le fait dans la même demande de fusion.

### Hors périmètre

Rien de plus que les critères ci-dessus.

### Dépendances

#862, #863, #864, #865, #866, #867, #868
