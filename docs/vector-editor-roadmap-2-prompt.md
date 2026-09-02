# Prompt 2 : outils manquants, effets et rendu, finition sensorielle

Tu travailles dans `/Users/soheil/Documents/repos/paramrig` (branche `main`), éditeur vectoriel dans `src/vector/`, servi sur `http://localhost:5174` par Docker Compose. Le premier prompt (`docs/vector-editor-roadmap-prompt.md`) a été entièrement livré : lis-le d'abord, ses règles, son architecture et son protocole de QA s'appliquent intégralement ici. Ce document ajoute trois chantiers : les outils qui manquent encore, les effets et le rendu, la finition sensorielle. Même exigence : rien de décoratif, chaque contrôle fonctionne, un commit par sous-chantier, vérification complète avant chaque commit, bilan honnête à la fin.

## 0. Rappels courts

- `docker compose run --rm app npm run typecheck`, `npm run lint`, `npm test`, puis `git diff --check`, avant chaque commit. Jamais Vite hors Docker. Ne touche pas aux autres stacks Compose.
- Palette ParamRig et tokens `--vector-*`, composants de `src/ui/`, aucun contrôle natif, cibles 32 px / 44 px, états hover / active / focus-visible partout.
- Une geste continue = une entrée d'undo (`beginGesture` / `endGesture` / `cancelGesture`, écritures `record = false` pendant la geste), libellé d'historique sur chaque entrée (`history.ts`).
- QA navigateur sur le Chrome headless `127.0.0.1:9223` avec `chromium.connectOverCDP` et le `playwright-core` de `/Users/soheil/Documents/repos/site-anym/node_modules`. Jamais `chromium.launch()`. `mouse.dblclick`, modificateurs au clavier, `#main` focalisé avant les touches d'outil, zéro erreur console, 1440 px et 320 px, thèmes clair et sombre.
- État actuel des modules : `network.ts` (réseau), `planar.ts` (faces, cache LRU dans `cache.ts`, échantillonnage adaptatif dans `sampling.ts`), `render.ts` (modèle de rendu mis en cache, texte et image compris), `text.ts` / `textOutline.ts`, `frames.ts`, `images.ts` / `crop.ts`, `export.ts` (SVG et PNG), `project.ts` / `fileHandles.ts` / `useProjectFile.ts` (fichiers), `styles.ts`, `history.ts`, `commands.ts` (palette ⌘/), `nodeEdit.ts`. Genres d'éléments : `rectangle | ellipse | path | group | text | frame | image`. Outils : `select | transform | node | pen | pencil | lasso | bucket | rectangle | ellipse | text | frame`.
- Toute nouvelle commande va dans `commands.ts` (elle apparaît alors dans la palette et dans les infobulles) et toute nouvelle propriété passe par la sanitisation de `document.ts` et par l'export SVG / PNG.

## Chantier A · Outils manquants

### A1 · Formes : ligne, polygone, étoile, arc
- **Ligne (L)** : glisser crée un réseau à deux nœuds (`kind: 'path'`), Shift contraint à 45°, clic simple crée une ligne horizontale de 100 px. Sans fill, contour hérité du dernier contour utilisé.
- **Polygone (⇧P est pris, utiliser ⌥P)** : `kind: 'polygon'` avec `sides` (3 à 60) et `innerRatio` (0 = polygone, sinon étoile) ; `defaultNetwork` produit le réseau, un `network` posé par une édition fige la forme (comme rectangle / ellipse). Poignée sur le canvas : un point sur le sommet supérieur qui, tiré horizontalement, change `sides`, et un point sur un sommet interne qui règle `innerRatio`. Section « Polygon » dans l'inspecteur.
- **Arc** sur l'ellipse : `arcStart`, `arcSweep` (degrés), `arcRatio` (anneau, 0 à 1). Rendu par un chemin (secteur ou anneau), `defaultNetwork` mis à jour pour que l'édition de nœuds parte de la bonne géométrie. Poignées sur le canvas : deux points sur le bord pour le début et la fin, un point radial pour le ratio ; section « Arc » dans l'inspecteur.
- **Flèche** : commande « Line with arrowhead » dans la palette et dans le menu contextuel de la ligne, qui met `strokeArrowEnd: 'triangle'` ; pas un outil séparé.
- Tests : géométrie des polygones et des arcs (sommets, aires), sanitisation, export SVG identique au rendu du canvas.

### A2 · Manipulation directe sur le canvas
- **Rayon d'angle** : sur un rectangle sélectionné, un petit disque près de chaque coin (visible seulement en sélection simple, 32 px de cible, glyphe 6 px) ; glisser vers l'intérieur augmente le rayon ; avec ⌥ on règle un seul coin (`cornerRadius` en tableau). HUD avec la valeur.
- **Éditeur de dégradé** : quand le fill actif est un dégradé et que l'objet est seul sélectionné, afficher sur le canvas la ligne du dégradé avec ses deux extrémités déplaçables (linéaire) ou le centre et le rayon (radial), et les arrêts glissables le long de la ligne ; clic sur la ligne ajoute un arrêt, glisser un arrêt hors de la ligne le supprime (même geste que `GradientField`). L'angle et l'étendue se stockent en coordonnées normalisées : ajouter `from` et `to` au `VectorPaint` linéaire, `center` et `radius` au radial, avec repli sur `angle` si absent.
- **Placement d'un fill image** : `imageOffset` et `imageScale` sur le `VectorPaint` image en mode `fill`, réglés par un glisser sur le canvas en mode « Edit image » (double-clic sur un objet dont le fill actif est une image).

### A3 · Édition de tracé
- **Ciseaux (C, mode nœuds)** : un clic sur un segment le coupe au point exact en deux nœuds superposés non reliés ; sur un nœud, le détache en autant de nœuds que de segments incidents. Une seule entrée d'undo.
- **Outil d'échelle (K)** : comme le redimensionnement, mais en mettant aussi à l'échelle `strokeWidth`, `strokeDash`, `cornerRadius`, les rayons de nœuds et la taille du texte, proportionnellement au facteur uniforme (Shift force l'uniforme ; sinon on utilise la moyenne géométrique des deux facteurs pour les épaisseurs).
- **Booléens non destructifs** : `kind: 'boolean'` avec `operation` et des enfants (`parentId`) ; le rendu calcule le résultat avec `booleans.ts` à la volée, mis en cache par empreinte des enfants ; les enfants restent éditables (double-clic entre dans le groupe booléen) ; « Flatten » remplace le groupe par le chemin résultat ; export SVG du résultat. Les quatre boutons Union / Subtract / Intersect / Exclude créent ce groupe ; la palette garde une variante « … (flatten) » destructive.
- **Masque** : `mask: true` sur le premier enfant (le plus bas) d'un groupe : les autres enfants sont découpés par sa forme (`clipPath` en SVG, alpha en PNG). Commande ⌃⌘M « Use as mask » / « Remove mask », icône de masque dans les calques, contour en pointillé sur le canvas.
- **Lisser et gommer** au crayon : avec ⇧ le crayon passe en mode lisser (les nœuds survolés sont refaits par `pencilNodes` sur la portion) ; avec ⌥ il gomme (segments traversés supprimés, nœuds orphelins retirés).

### A4 · Navigation et mesure
- **Main (H)** et **zoom (Z)** comme outils : Z clic zoome par paliers, ⌥Z dézoome, glisser en Z zoome sur la zone. Espace reste la main temporaire.
- **Règle de mesure (⇧M)** : glisser entre deux points affiche longueur et angle, aimanté aux nœuds et aux bords ; les mesures posées restent visibles jusqu'à Escape ; aucune écriture dans le document.

### A5 · Répétition et transformations numériques
- **⌘D répété** reproduit la dernière transformation (déplacement, rotation, échelle) sur la copie, comme Figma ; l'état « dernière transformation » vit dans le hook et se réinitialise à la première autre action.
- **Rotation en copies** : commande avec dialogue (`VectorModal`) : nombre de copies, angle total, autour du pivot courant.
- **Transformation numérique** : dialogue « Transform » avec déplacement, échelle, rotation, retournement, appliqué en une entrée d'undo ; ⌘⇧T le rouvre avec les dernières valeurs.

## Chantier B · Effets et rendu

### B1 · Modèle
- `effects: VectorEffect[]` par élément, dans l'ordre d'application : `dropShadow` (offset, blur, spread, colour, opacity), `innerShadow`, `layerBlur` (radius), `backgroundBlur` (radius, seulement sur les frames et les fills semi-transparents), chacun avec `visible`.
- `blendMode` par élément : `normal | multiply | screen | overlay | darken | lighten | colorDodge | colorBurn | hardLight | softLight | difference | exclusion | hue | saturation | color | luminosity`.
- Filtres d'image sur `kind: 'image'` et sur les fills image : `exposure`, `contrast`, `saturation`, `temperature`, `highlights`, `shadows` (de −1 à 1).
- Sanitisation, presse-papiers, styles (un style d'effets nommé, comme les styles de couleur), copier-coller des propriétés.

### B2 · Rendu SVG
- Effets via `<filter>` dans les defs (`feDropShadow` ou `feGaussianBlur` + `feOffset` + `feFlood` + `feComposite` pour le spread ; ombre interne par composition `in`/`arithmetic`), `filterUnits="userSpaceOnUse"` avec une région calculée depuis la boîte et les rayons pour ne rien tronquer. Blend modes via `mix-blend-mode` en style et `isolation: isolate` sur les groupes qui le demandent. Filtres d'image via `feComponentTransfer`, `feColorMatrix` (saturation, teinte) et une courbe pour hautes lumières / ombres.
- Le cache de `renderModel` inclut effets et blend mode dans sa clé. Les defs d'effets sont partagées entre canvas, vignettes et export.
- Export PNG : `export.ts` doit rendre les filtres (le rendu via `<img>` d'un SVG sérialisé conserve les filtres SVG natifs ; vérifier `mix-blend-mode` et compenser la marge des flous dans la taille du bitmap).

### B3 · Inspecteur et canvas
- Section « Effects » : liste réordonnable avec visibilité, type via `SelectField`, champs numériques et couleur avec `ColorField`, ajout par `IconButton`, ombres avec aperçu en direct pendant le scrub (`NumberField` gère déjà la geste). Section « Blend » avec le mode et l'opacité. Section « Adjustments » sur les images.
- Les flous sont coûteux : pendant un glissement, rendre l'objet sans filtre puis réappliquer à la fin de la geste ; mesurer que 50 objets avec ombre restent fluides au déplacement.
- Tests : construction des filtres, régions de filtre, sanitisation ; QA : capture avant / après pour ombre, flou, multiply, masque + flou, export PNG d'un objet flouté sans bord coupé.

## Chantier C · Finition sensorielle

### C1 · Latence et fluidité
- Toutes les mises à jour de position pendant une geste passent par un seul `requestAnimationFrame` par frame (dernier événement gagne) ; pas de `setState` par `pointermove` brut. Mesurer avec un script de QA : 200 `pointermove` sur un déplacement de 50 objets, temps de frame moyen et p95 en console, cible 16 ms moyen, 33 ms p95 sur le Chrome de test.
- Le survol (`hoveredId`) et les contours de survol ne doivent jamais faire recalculer un modèle de rendu ; vérifier avec le compteur du cache de faces.
- Curseurs sans latence : les curseurs custom sont des data-URI dans `vector.css`, pas des états React.

### C2 · Précision du survol et des poignées
- À tout zoom, les poignées gardent 32 px de cible et 8 px de glyphe (`/ zoom` partout où ce n'est pas déjà le cas) ; vérifier à 10 %, 100 %, 400 %, 1600 % qu'aucune poignée ne « colle » à une autre : quand deux poignées se chevauchent à l'écran, la priorité va à la plus petite cible (coin avant bord, nœud avant segment, poignée de courbe avant nœud).
- Le survol d'un nœud, d'un segment, d'une poignée et d'un guide change le curseur et l'épaisseur du trait survolé (CSS `:hover` sur les couches de hit, pas de state).
- Priorité de clic explicite et testée : poignées de transformation > pivot > nœuds > poignées de courbe > segments > objets > guides > canvas.

### C3 · Zoom et navigation au trackpad
- Zoom pincé fluide centré sur le curseur (déjà), avec inertie douce sur le défilement à deux doigts (`overscroll` interne : conserver la vitesse deux à trois frames), et ⌘0 pour 100 %, ⌘1 pour ajuster, ⌘2 pour la sélection (en plus des variantes Shift existantes), `+` / `-` par paliers autour du curseur.
- Rotation du canvas non requise. Pas de zoom « en escalier » : le facteur suit le geste en continu, l'affichage du pourcentage arrondit.

### C4 · Accessibilité clavier et lecteur d'écran
- Parcours complet au clavier : barre d'outils (flèches gauche / droite dans un `role="toolbar"` avec roving tabindex), calques (flèches, Enter pour renommer, Espace pour sélectionner, ⇧ pour étendre), inspecteur, palette de commandes. Aucun piège de focus ; Escape ferme toujours le dernier calque ouvert.
- Le canvas expose un résumé vivant : `aria-live="polite"` sur une zone masquée qui annonce la sélection (« Rectangle, 200 × 120 at 100, 100 »), le nombre de nœuds sélectionnés, les changements d'outil, les entrées d'historique. Le HUD reste visuel ; l'annonce est débouncée à 300 ms.
- Chaque objet est atteignable au clavier via les calques ; déplacer, redimensionner (⌥ + flèches change la taille de 1 px, ⌥⇧ de 10), tourner (⌥⌘ + flèches gauche / droite de 1° / 15°) fonctionnent sans souris.
- Contraste vérifié en thème clair et sombre sur les poignées, guides, HUD, guides intelligentes ; `prefers-reduced-motion` désactive les transitions ; `forced-colors` gardé cohérent.

### C5 · Détails qui trahissent un outil jeune
- Le pointeur ne saute jamais au début d'une geste : la position de départ est celle du `pointerdown`, pas du premier `pointermove`.
- Un clic sans mouvement n'écrit jamais dans l'historique (vérifier chaque interaction : nœud, segment, poignée, pivot, guide).
- Après un undo, la sélection revient sur les objets concernés s'ils existent encore.
- Les infobulles apparaissent après 400 ms, disparaissent au premier mouvement de geste, et ne masquent jamais un handle.
- Double-clic sur le nom de l'onglet / du document renomme ; Enter valide ; Escape annule, y compris dans les champs numériques (rétablit la valeur d'avant le focus).

## Livraison

1. Un commit par sous-chantier (A1 à A5, B1 à B3, C1 à C5) avec un message qui décrit le comportement.
2. Tests unitaires pour chaque module pur ; tests `renderHook` pour chaque nouvelle transaction ; tests de rendu pour chaque nouveau def ou attribut SVG.
3. Un script de QA par chantier, exécuté, avec sa sortie réelle et des captures pour les effets et les poignées à 1600 %.
4. Un bilan final qui distingue ce qui est fait et vérifié, ce qui est partiel, ce qui est laissé de côté et pourquoi.
