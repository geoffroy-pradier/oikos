# ADR 0010 — Système de design : jetons, composants, mouvement

Date : 2026-11-18 · Statut : acceptée, remplacée en partie par l'ADR 0011 (palette, polices, ornements)

## Contexte

Le propriétaire juge l'interface très en deçà et veut une interface moderne et dynamique (#574).
La direction artistique de la spécification 10 reste : céramique grecque à figures noires et rouges, terre cuite, noir, ocre, bleu égéen, frises, icônes au trait.
Les écrans existants composent `@oikos/ui` (`Button`, `Card`, `Field`) et des classes Tailwind ; leur refonte viendra écran par écran, dans des tickets suivants.

## Décision

- Toute valeur visuelle est un jeton de `packages/ui/src/theme.css`, défini pour le thème clair (`:root`) et le thème sombre (`[data-theme='dark']`), puis exposé à Tailwind par `@theme`.
- Couleurs : fond, trois plans de surface (`surface`, `surface-raised`, `muted`), texte et texte atténué, deux bordures (`border`, à 3:1, pour les commandes ; `border-subtle`, décorative, pour les surfaces).
- Teintes : terre cuite (`primary`), ocre (`accent`), bleu égéen (`aegean`), olive (`success`), rouge (`danger`), chacune avec une variante `-subtle` pour les fonds de pastille.
- Chaque couple texte/fond employé par un composant est déclaré dans `contrast.ts` et vérifié AA dans les deux thèmes par `contrast.test.ts` ; un couple nouveau s'y ajoute avec le composant qui l'emploie.
- Profondeur : trois élévations (`shadow-sm`, `shadow-md`, `shadow-lg`), ombres brunes en clair, ombres noires et reflet intérieur en sombre ; rayons `md`, `lg`, `xl` plus ronds que ceux de Tailwind.
- Typographie : Fraunces (titres, chiffres clés) et Inter (interface), polices variables auto-hébergées par `@fontsource-variable`, servies par l'application et jamais par un service tiers.
  Les tailles restent en `rem` : la police suit le réglage du navigateur.
- Icônes : lucide-react, au trait, réexportées par `packages/ui/src/icons.ts` ; une icône nouvelle s'y ajoute.
  Une icône est décorative (`aria-hidden`) : un texte porte toujours l'information.
- Mouvement : trois durées (`--motion-fast`, `--motion-base`, `--motion-slow`) et une courbe amortie (`ease-out`).
  Il signale une réponse (survol, appui, apparition d'un panneau, chargement), jamais un décor qui boucle sans raison.
  Sous `prefers-reduced-motion`, toute transition et toute animation sont coupées.
- Composants de `@oikos/ui` : `Button` (variantes, tailles, icône, chargement), `Card` (élévation), `Field`, `Badge`, `Stat`, `Tabs`, `Skeleton`, `EmptyState`, `Frieze`.
  Ils sont accessibles au clavier et testés ; leur API ne change que par ajout, pour garder les écrans existants.
- La page `apps/web/catalogue.html` montre chaque composant dans les deux thèmes ; elle n'est servie qu'en développement.

## Conséquences

- Les écrans existants prennent la palette, les polices, les rayons et les ombres sans changer de code ; leurs rôles et leurs textes ne changent pas.
- Le premier affichage charge deux polices (environ 85 ko en latin) ; le texte s'affiche aussitôt dans la police de repli (`font-display: swap`).
  Les polices ne sont pas mises en cache hors ligne : sans réseau, une page neuve s'affiche dans la police de repli.
- Une couleur de la palette par défaut de Tailwind reste possible mais doit être justifiée en relecture : les jetons sont la règle.
