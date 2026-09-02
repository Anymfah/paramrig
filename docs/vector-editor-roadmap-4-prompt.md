# Prompt 4 : remettre de l'ordre dans l'interface, et donner sa place aux contrôleurs

> Document autonome : un agent qui démarre sans contexte doit pouvoir l'exécuter de bout en bout.

Tu es un agent qui démarre sans aucun contexte. Tout ce dont tu as besoin est ici ou dans le dépôt ; ne suppose rien, vérifie dans le code.

Dépôt : `/Users/soheil/Documents/repos/paramrig`, branche `main`. ParamRig est un « workbench » où une IA construit des rigs paramétrés (`src/rigs/`, `src/workspace/`) qu'un humain règle avec des contrôleurs. L'éditeur vectoriel (`src/vector/`) est l'un des renderers ; il est servi sur `http://localhost:5174` par Docker Compose. Trois prompts l'ont construit (`docs/vector-editor-roadmap-prompt.md`, `-2-`, `-3-`) ; ils décrivent des fonctions déjà livrées, lis-les pour le contexte mais l'état de référence est le code.

## Règles, toutes obligatoires

- **Runtime** : uniquement `docker compose` depuis la racine du dépôt. Jamais `npm run dev`, jamais Vite sur macOS. Avant tout `docker compose up`, lance `docker compose ls` ; si `stellary`, `helios`, `site-anym` ou un autre stack de développement tourne, n'en démarre et n'en arrête aucun (`stellary-ci` peut rester). Le stack `paramrig` est en général déjà lancé et recharge à chaud. Port fixe 5174 ; s'il est occupé, identifie l'occupant, ne change pas de port.
- **Vérification avant chaque commit**, dans cet ordre, toutes vertes :
  ```bash
  docker compose run --rm app npm run typecheck
  docker compose run --rm app npm run lint
  docker compose run --rm app npm test
  docker compose run --rm app npm run e2e
  git diff --check
  ```
- **Git** : commits fréquents sur `main`, messages qui décrivent le comportement, pas de push, pas de branche, pas de stash, pas de `git checkout` destructif (d'autres agents partagent le working tree). Termine chaque message de commit par `Co-Authored-By: <ton nom de modèle> <noreply@anthropic.com>`.
- **Direction artistique** : palette ParamRig (`src/styles/tokens.css`, tokens `--vector-*` en tête de `src/styles/vector.css`), bleu-vert minéral sombre, thème clair équivalent. Pas de bleu Figma, pas de style « dashboard ». Aucun contrôle natif du navigateur : pas d'attribut `title`, pas d'`alert` / `confirm`, pas de `<select>` ni de `<input type=range>` non stylés. Réutilise les composants de `src/ui/` : `Button`, `IconButton`, `Tooltip`, `NumberField`, `ColorField`, `SelectField` (segmenté jusqu'à 4 options, sinon liste Radix), `SwitchField`, `SliderField`, `GradientField`, `ContextMenu` (`ContextMenuRoot` + `ContextTarget`), Radix `DropdownMenu` / `Popover` avec les classes `menu`, `menu__item`, `popover`. Tout élément interactif a des états hover, active et focus-visible (`--focus-ring`). Cibles de pointeur d'au moins 32 px, 44 px en pointeur grossier (`src/ui/hit-target.ts`, `.cursor/rules/controller-hit-targets.mdc`), glyphe visuel plus petit.
- **Texte** : `user-select: none` sur le chrome, `user-select: text` dans les champs, valeurs, identifiants et contenus éditables. Wording produit en anglais, en « sentence case », sans point d'exclamation, sans « real / true / no fake ».
- **Historique** : une geste continue de pointeur = une entrée d'undo. Le hook `src/vector/useVectorDocument.ts` expose `beginGesture` / `endGesture` / `cancelGesture` ; pendant la geste on écrit avec `record = false` (`updateElement(id, patch, false)`, `updateElements(updates, false)`) ; `editElements(fn, label)` fait une édition arbitraire en une entrée ; chaque entrée porte un libellé (`src/vector/history.ts`). Escape pendant une geste restaure l'état de départ.
- **Modèle** (`src/vector/types.ts`) : `VectorDocument` = `elements` (liste plate, groupes et frames par `parentId` avec contiguïté, helpers dans `src/vector/tree.ts`), `guides`, `versions`, `styles`, `fonts`, `colorSpace`. `VectorElement.kind` ∈ `rectangle | ellipse | path | group | text | frame | image | polygon | boolean | component | instance`, avec `x y width height rotation`, `fill / stroke` (résumé) et `fills / strokes: VectorPaint[]`, `effects`, `blendMode`, propriétés de contour, `cornerRadius`, `cornerSmoothing`, et `network: { nodes, segments }` en coordonnées normalisées ; les régions remplissables sont les faces du graphe (`src/vector/planar.ts`), éteintes via `regionsOff`. Toute nouvelle propriété passe par la sanitisation de `src/vector/document.ts`, le rendu `src/vector/render.ts`, l'export `src/vector/export.ts`, le presse-papiers `src/vector/clipboard.ts` et le fichier projet `src/vector/project.ts`. Toute nouvelle commande passe par `src/vector/commands.ts` (palette ⌘/ et infobulles).
- **Interface** : `src/vector/VectorEditorPage.tsx` (barre d'outils, raccourcis, presse-papiers, import, zoom, versions), `VectorCanvas.tsx` (machine d'interaction dans une ref `interaction`, outils `select | transform | node | pen | pencil | lasso | bucket | rectangle | ellipse | text | frame | line | polygon | scissors | scale | hand | zoom | measure`, le double-clic est traité au niveau du `<svg>` avec `elementsFromPoint` parce que la capture de pointeur détourne l'événement, le listener clavier du canvas est enregistré avant celui de la page et arrête la propagation des touches qu'il possède), `VectorInspector.tsx`, `VectorPaintPanel.tsx`, `VectorEffectsPanel.tsx`, `VectorLayers.tsx`, `VectorCommandPalette.tsx`, `VectorFileMenu.tsx`, `VectorExportMenu.tsx`, `VectorModal.tsx`, `VectorTextEditor.tsx`. Le workbench des rigs : `src/workspace/WorkspacePage.tsx`, `Inspector.tsx` (onglets Controls / Snapshots / History / Bindings, `ParameterField` de `src/ui/`), `src/state/session.ts` (`RigSession`, `drivenValues`, snapshots, animation), `src/state/expression.ts`, `src/state/drivers.ts`, `src/rigs/types.ts` (`RigManifest`, `ParameterDef`, `ParamGroup`, `InspectorCategory`), `src/rigs/extended-types.ts` (`ValueSource`, paramètres étendus), `src/rigs/registry.ts`, `src/rigs/controller-catalog.ts`.

## Protocole de QA navigateur, obligatoire

- Un Chrome headless GPU écoute sur `http://127.0.0.1:9223` (vérifie avec `curl -s http://127.0.0.1:9223/json/version`). Connecte-toi avec `chromium.connectOverCDP('http://127.0.0.1:9223')` depuis `/Users/soheil/Documents/repos/site-anym/node_modules/playwright-core/index.mjs`. Jamais `chromium.launch()` : cela ouvre une fenêtre au premier plan sur le bureau de Soheil.
- Les scripts vivent dans `e2e/` du dépôt (lis `e2e/README.md` et `e2e/run.mjs` ; `npm run e2e` les exécute, l'hôte 9223 est atteignable depuis le conteneur via `host.docker.internal`). Chaque sous-chantier ajoute son script, exécuté, dont tu rapportes la sortie réelle.
- Pièges connus : nouveau document via la page `/` et le bouton « New vector document » ; l'état persiste dans `localStorage['paramrig.vector-documents.v1']` (attends ~60 ms avant de le lire) et dans le fichier projet ; convertis document → client via `document.querySelector('.vector-world').getScreenCTM()` ; `page.mouse.dblclick`, jamais `click({ clickCount: 2 })` ; modificateurs via `keyboard.down/up`, jamais `click({ modifiers })` ; un tracé plume sans fill se sélectionne par son trait ; les anneaux de rotation entourent les coins d'une sélection, clique un objet voisin à plus de 40 px d'un coin ; les touches d'outil sont ignorées quand un champ a le focus, fais `page.locator('#main').focus()` avant.
- Couvre 1440 px et 320 px, thèmes clair et sombre (`data-theme` sur `<html>` ou `colorScheme` du contexte), et exige zéro erreur console.

## 0. Diagnostic de départ (mesuré, pas supposé)

- Barre d'outils : 32 boutons sur une ligne (File, Undo, Redo, Select, Selection tools, Edit nodes, Pen, Pencil, Scissors, Width, Scale, Hand, View tools, Lasso, Paint bucket, Frame, Text, Ellipse, Shape tools, Zoom out, Reset view, Zoom in, Full screen, Commands, View options, Export, Group, Flip H, Flip V, Rotate 90, Lock, Delete). Outils, actions et navigation sont mélangés, sans hiérarchie.
- Inspecteur, un rectangle sélectionné : dix sections dépliées à la suite (Geometry, Align, Appearance, Brush, Effects, Blend, Stroke properties, Corners, Path, State), chaque couche de peinture est une carte de six lignes avec un contrôle segmenté de type, le mot « Fill » apparaît trois fois, des boutons « Create style » en pleine largeur flottent entre les cartes. En mode nœuds, la section Node s'ajoute au lieu de remplacer.
- Rail gauche : Layers seulement ; composants, styles, pinceaux, motifs et polices sont dispersés dans l'inspecteur.
- Aucune notion de contrôleur : le document vectoriel est un renderer `vector` avec `parameters: []` dans son `RigManifest` (`vectorManifest` dans `document.ts`), donc rien à régler dans le workbench.

Prends des captures de cet état avant de commencer (1440 px, sélection simple, mode nœuds, rien de sélectionné) et garde-les dans `e2e/reference/before/` : le bilan final les compare aux captures finales.

## 1. Principes de rangement

- **Trois zones, trois rôles** : le rail gauche liste (calques, assets), le canvas montre, l'inspecteur décrit la sélection. Rien d'autre ne flotte, sauf la barre d'actions de sélection et le HUD.
- **Un en-tête de section unique** : titre en `--text-xs` 600, à droite un bouton `+` quand la section est une liste, un menu `⋯` pour les actions rares (Create style, Reset, Detach). Les sections sont repliables (état mémorisé par section dans `localStorage`), chevron à gauche du titre, 32 px de hauteur.
- **Des lignes, pas des cartes** : une couche de peinture, un effet, un style, un paramètre = une ligne de 32 px (pastille ou icône, libellé ou valeur, contrôle secondaire, œil, moins). Le détail s'ouvre dans un popover ancré à la ligne (`Popover` Radix, classe `popover`), jamais en carte dépliée.
- **Une seule échelle** : espacements `--space-2` dans les lignes, `--space-3` entre sections, `--space-4` de marge de panneau ; aucune autre valeur. Texte : `--text-sm` pour les valeurs, `--text-xs` pour les libellés et métadonnées, `--text-muted` pour les secondaires. Aucun `!important` nouveau.
- **États vides écrits** : « No effects. Add one with + », « No controls yet. Expose a property with ◇ », en anglais, sans point d'exclamation.
- **Un mot pour une chose** : Fill, Stroke, Effects, Corners, Position, Layer, Node, Text, Export, Controls. Pas de « Appearance » qui contient Fill qui contient Fill.

## Chantier J · La barre d'outils

- Six groupes, chacun un bouton principal qui montre l'outil courant du groupe et un déclencheur de menu (pattern `SelectionToolMenu` existant, généralisé en `ToolGroup`) : **Select** (select, transform, lasso), **Frame**, **Shapes** (rectangle, ellipse, line, polygon, star), **Draw** (pen, pencil, scissors, width, bucket), **Text**, **Navigate** (hand, zoom, measure). Le dernier outil choisi dans un groupe devient le principal. Les raccourcis apparaissent dans les menus et les infobulles.
- Sortent de la barre : File (devient un bouton logo / nom de document à gauche ouvrant le menu Fichier, avec Undo et Redo dans ce menu, et les raccourcis conservés), Commands (⌘/ reste, plus une entrée « Commands… » dans le menu Fichier), Group, Flip, Rotate, Lock, Delete (vers la barre d'actions de sélection, chantier K), Full screen (options de vue).
- Centre : nom du document éditable et badge de sauvegarde (`VectorSaveBadge`). Droite : zoom (−, pourcentage cliquable avec menu 25 / 50 / 100 / 200 / Fit / Selection, +), View options, Export.
- Cible : au plus 14 contrôles visibles à 1440 px. À 320 px : les groupes restent, le centre passe sous la barre, la barre défile horizontalement comme aujourd'hui.

## Chantier K · La barre d'actions de sélection et le canvas

- `VectorSelectionBar` : chip flottante centrée au-dessus de la boîte de sélection (ou sous elle quand le haut sort du viewport), 36 px, `--vector-hud-bg`, 32 px par bouton : Group / Ungroup, Booleans (menu), Flip H, Flip V, Rotate 90, Lock, Hide, Delete, et un menu `⋯` avec le reste du menu contextuel. Masquée pendant toute geste et en mode nœuds ; en mode nœuds, une variante avec Connect, Scissors, Smooth, Corner, Delete nodes.
- Le HUD, les infobulles et la barre d'actions partagent le même composant de chip (`VectorChip`) pour la police, le fond, la bordure et le rayon.
- Les curseurs, poignées et guides ne changent pas.

## Chantier L · L'inspecteur

- Trois onglets en tête (`role="tablist"`, pattern de `src/workspace/Inspector.tsx`) : **Design**, **Controls**, **History**. L'onglet mémorisé par document. Sur 320 px, l'inspecteur est une feuille inférieure avec les mêmes onglets.
- **Design, rien de sélectionné** : Page (taille, fond, espace colorimétrique), Guides, Export du document.
- **Design, un objet** : Position (X, Y, W, H, rotation, avec pour les rectangles rayon et lissage sur la ligne suivante, pour les polygones côtés et ratio, pour les ellipses arc), Layer (opacité, mode de fusion, visible, verrouillé, mask), Text (texte seulement), Fill (lignes), Stroke (lignes, puis une ligne repliée « Width · Align · Cap · Join · Dash · Arrows » avec les champs), Effects (lignes), Image (image seulement : ajustements, recadrage), Component / Instance (le cas échéant), Export (presets de l'objet). Align devient une rangée d'icônes dans l'en-tête de Position, pas une section.
- **Design, plusieurs objets** : Position (boîte commune), Align + Distribute, Layer, Fill / Stroke / Effects partagés avec état « Mixed » sur les lignes, Boolean, Combine.
- **Design, mode nœuds** : Node remplace Position (coordonnées, poignées, mode de miroir, rayon, longueur et angle des poignées), puis Network (nœuds, segments, régions, parties, Separate), puis Fill / Stroke / Effects inchangés.
- Le popover d'une ligne de peinture contient : type (Solid, Linear, Radial, Mesh, Pattern, Image) en segmenté, l'éditeur du type, l'opacité de couche, et le bouton « Create style » ; une ligne liée à un style montre le nom du style et un menu ⋯ (Detach, Edit style).
- Le bouton `◇` du chantier N apparaît sur chaque champ exposable.
- Tests : rendu des sections par contexte (`@testing-library/react`), persistance de l'onglet et des sections repliées, aucun libellé dupliqué dans une section (test qui compte les occurrences de « Fill » dans la section Fill).

## Chantier M · Le rail gauche

- Deux onglets : **Layers** (inchangé) et **Assets**. Assets liste par groupe : Components, Styles (couleur, contour, effets), Brushes, Patterns, Fonts, avec vignette 40 px, nom éditable, menu ⋯ (Rename, Duplicate, Delete, Select users) et glisser-déposer sur le canvas pour les composants et les motifs, clic pour appliquer un style à la sélection.
- Les sections d'assets disparaissent de l'inspecteur ; il n'y reste que l'application (ligne de peinture liée, instance).

## Chantier N · Les contrôleurs

### N1 · Modèle
- `VectorDocument` gagne `rig?: { groups: ParamGroup[]; parameters: ParameterDef[]; inspectorCategories?: InspectorCategory[]; bindings: VectorBinding[] }`, en réutilisant les types de `src/rigs/types.ts` et `src/rigs/extended-types.ts` sans les dupliquer.
- `VectorBinding = { id: string; elementId: string; property: VectorBindableProperty; parameterId: string; transform?: BindingTransform }` où `property` est un chemin typé parmi : `x`, `y`, `width`, `height`, `rotation`, `opacity`, `visible`, `fill`, `stroke`, `strokeWidth`, `strokeDash`, `cornerRadius`, `cornerSmoothing`, `fills[i].color`, `fills[i].opacity`, `strokes[i].color`, `effects[i].<champ>`, `text`, `fontSize`, `fontWeight`, `letterSpacing`, `sides`, `innerRatio`, `arcStart`, `arcSweep`, `blendMode`, `regionsOff` (booléen par clé), `network.nodes[id].x` / `.y` (nœuds, pour les rigs qui déforment une forme). `BindingTransform = { min?: number; max?: number; scale?: number; offset?: number; expression?: string }` évalué par `evaluateExpression` de `src/state/expression.ts`.
- Correspondance paramètre → propriété : `number` → numérique, `color` → couleur, `switch` → booléen, `select` → texte ou option, `gradient` → stops d'un dégradé, `curve` → courbe appliquée à une expression, `vector` → x/y ou w/h, `text` → texte. Une propriété peut recevoir plusieurs liaisons (la dernière gagne), un paramètre peut piloter plusieurs propriétés.
- Sanitisation dans `document.ts` (paramètres via la validation existante des manifestes, liaisons vers des éléments et paramètres existants), presse-papiers (une copie d'objet emporte ses liaisons si le paramètre existe dans le document cible), export SVG du rendu résolu.

### N2 · Résolution
- `resolveRigValues(document, values)` dans `src/vector/rig.ts` : applique les liaisons aux éléments (fonction pure, mise en cache par empreinte des valeurs) et renvoie le document à rendre. Le canvas, les vignettes et l'export rendent le document résolu ; l'édition écrit toujours dans le document brut. Un champ lié se montre « driven » : valeur résolue en lecture, badge ◇ plein, menu ⋯ (Edit binding, Unbind, Go to control).
- `vectorManifest(document)` expose `groups`, `parameters` et `inspectorCategories` du rig, si bien que le workbench (`/r/:id`) et sa session (`src/state/session.ts`, `drivenValues`, `animationFrom`) fonctionnent sans changement : un document vectoriel paramétré devient un rig comme les autres, avec snapshots, historique et pistes d'animation.
- Le renderer `vector` du workspace (`src/renderers/`) rend le document résolu avec les valeurs de session.

### N3 · Interface
- `◇` sur chaque champ exposable de l'inspecteur Design (32 px de cible, visible au survol de la ligne et toujours quand lié). Clic : popover « Expose as control » avec nom (prérempli « Rectangle · Width »), genre déduit, groupe (`SelectField` des groupes existants + « New group »), min / max / step pour les nombres, puis « Expose ». Un clic sur un ◇ plein ouvre le menu de la liaison.
- Onglet **Controls** de l'inspecteur : le panneau Controls du workbench, réutilisé tel quel (`ParameterField`, `controller-catalog`, catégories), branché sur une session du document courant ; en tête, un interrupteur **Edit / Tune** : Tune rend le canvas en lecture seule avec les contrôleurs seuls actifs et masque poignées et outils d'édition ; Edit revient à l'éditeur. Un bouton « Add control » crée un paramètre sans liaison (pour les macros et expressions), un menu ⋯ par paramètre (Rename, Move to group, Bindings…, Delete).
- Glisser un paramètre de l'onglet Controls sur un champ Design crée une liaison ; glisser sur le canvas, sur un objet, ouvre le choix de la propriété.
- Sur `/r/:id`, l'inspecteur du workbench affiche Controls, Snapshots, History, Bindings comme pour tout rig, plus un bouton « Open in editor » vers l'éditeur vectoriel ; réciproquement, l'éditeur a « Open in workbench ».

### N4 · Pour l'IA qui construit un rig
- Documentation dans `/docs` (nouvelle page « Vector rigs ») : le format de projet, le schéma des `rig.parameters` et `rig.bindings` avec toutes les propriétés liables, un exemple complet (un logo dont la couleur, le rayon et l'ouverture d'arc sont exposés), et les contraintes (ids stables, min / max, groupes).
- Un exemple de rig vectoriel dans `src/rigs/examples/` (collection `examples`) qui charge un document vectoriel embarqué avec ses liaisons, listé dans la bibliothèque comme les autres.
- Import : déposer un `.paramrig.json` contenant `rig` dans la bibliothèque crée le document et son rig d'un coup ; l'API `importProject` valide les liaisons et rapporte les erreurs dans un `StatusMessage`.
- Tests : résolution de liaisons pour chaque genre de paramètre, transformation avec expression, sanitisation des liaisons orphelines, manifeste dérivé, rendu du renderer vector avec des valeurs de session ; e2e : exposer une largeur, la régler dans Controls, voir le rectangle changer, ouvrir le workbench, y prendre un snapshot, revenir.

## Chantier O · Cohérence et mobile

- Passer chaque panneau, popover, dialogue et chip au crible de la section 1 : une seule échelle d'espacement, un seul en-tête de section, aucun libellé dupliqué, états vides écrits, aucun bouton pleine largeur hors formulaires.
- 320 px : rail et inspecteur en feuilles, barre d'actions de sélection en barre du bas, onglets Design / Controls / History conservés, seau et outils de dessin accessibles.
- Captures finales dans `e2e/reference/after/` aux mêmes états que les captures de départ, et un tableau dans le bilan : nombre de contrôles visibles dans la barre, nombre de sections dépliées par contexte, hauteur de l'inspecteur pour un rectangle, avant et après.

## Livraison

1. Un commit par sous-chantier (J, K, L, M, N1 à N4, O), messages qui décrivent le comportement.
2. Tests unitaires pour `rig.ts` et les sanitisations ; tests React pour l'inspecteur par contexte ; tests `renderHook` pour les transactions ; e2e pour la barre, la sélection, les contrôleurs et le mobile.
3. Captures avant et après, et le tableau de mesures.
4. Un bilan honnête : fait et vérifié, partiel, laissé de côté et pourquoi.
