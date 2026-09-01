# Prompt : amener l'éditeur vectoriel ParamRig au niveau « productif comme Figma »

Tu travailles dans le dépôt `/Users/soheil/Documents/repos/paramrig` (branche `main`). L'éditeur vectoriel vit dans `src/vector/` et tourne à `http://localhost:5174` via Docker Compose. Ton objectif : livrer les dix chantiers ci-dessous, dans l'ordre indiqué, chacun commité séparément, chacun vérifié par des tests unitaires et une QA navigateur réelle. Ne livre rien de décoratif : chaque contrôle visible doit fonctionner. Si un chantier ne peut pas être terminé, dis-le explicitement plutôt que de laisser une fonctionnalité à moitié branchée.

## 1. Règles non négociables

- **Runtime** : uniquement `docker compose` depuis la racine. Jamais `npm run dev` ni Vite sur macOS. Le stack `paramrig` est en général déjà lancé (`docker compose ls` avant tout `up`) ; si `stellary`, `helios` ou `site-anym` tournent, n'en démarre et n'en arrête aucun. Port fixe 5174.
- **Commandes de vérification**, toutes obligatoires avant chaque commit :
  ```bash
  docker compose run --rm app npm run typecheck
  docker compose run --rm app npm run lint
  docker compose run --rm app npm test
  git diff --check
  ```
- **Git** : commits fréquents sur `main`, messages descriptifs, pas de push, pas de branche, pas de stash. D'autres agents peuvent partager le working tree : ne fais pas de `git checkout` destructif.
- **Direction artistique** : palette ParamRig (mineral, bleu-vert sombre, tokens dans `src/styles/tokens.css` et `--vector-*` en tête de `src/styles/vector.css`). Pas de bleu Figma, pas de style « dashboard ». Aucun contrôle natif du navigateur (pas de `title`, `alert`, `confirm`, `<input type=range>` non stylé, `<select>` natif). Réutilise `Button`, `IconButton`, `Tooltip`, `NumberField`, `ColorField`, `SelectField`, `SwitchField`, `SliderField`, `GradientField`, `ContextMenu` de `src/ui/`. Tout élément interactif a des états hover, active et focus-visible. Cibles de pointeur d'au moins 32 px (44 px en pointeur grossier) avec un glyphe visuel plus petit (voir `src/ui/hit-target.ts`).
- **Texte** : `user-select: none` sur le chrome, `user-select: text` dans les champs, valeurs, identifiants, contenus éditables.
- **Wording produit** en anglais, sobre, sans tics (« real », « true », « no fake »).

## 2. Architecture actuelle (à lire avant de coder)

Modèle (`src/vector/types.ts`) : un `VectorDocument` contient `elements: VectorElement[]` (liste plate, groupes via `parentId` avec invariant de contiguïté, voir `src/vector/tree.ts`), `guides`, `versions`. Un `VectorElement` est `rectangle | ellipse | path | group` avec `x y width height rotation`, `fill/stroke` (résumé) et `fills/strokes: VectorPaint[]` (uni, dégradé linéaire/radial, image), propriétés de contour (`strokeAlign`, `strokeCap`, `strokeJoin`, `strokeDash`, `strokeArrowStart/End`, `strokeSides`), `cornerRadius`, `cornerSmoothing`, et surtout `network: VectorNetwork` = `{ nodes, segments }` en coordonnées normalisées dans la boîte, plus `regionsOff` (clés de faces éteintes).

Modules purs, tous testés avec vitest + jsdom :
- `network.ts` : conversions locales/monde, opérations (`moveNodes`, `moveHandle`, `toggleNodeSmooth`, `setHandleMode`, `insertNodeOnSegment`, `bendSegment`, `deleteNodes`, `deleteSegments`, `connectNodes`, `extendNetwork`, `chains`, `networkFromRuns`, `mergeNetworks`, `normalizeWorld`, `commitWorld`, `sanitizeNetwork`).
- `planar.ts` : `computeFaces` (faces bornées de l'arrangement planaire, croisements détectés par échantillonnage de 24 pas par courbe, trous, clé stable par face), `loopToRun`, `faceContainsPoint`.
- `render.ts` : `renderModel(element, prefix)` → couches de fill (faces allumées, even-odd) et de stroke (chaînes), defs (dégradés, motifs, clip/mask pour l'alignement du contour, marqueurs de flèches), `outlinePathData`, `worldFaces`, `layersToSvg`, `defsToSvg`.
- `pen.ts` (session plume sur une copie monde du réseau), `pencil.ts`, `corners.ts`, `paints.ts`, `booleans.ts` (paper.js, `paper/dist/paper-core`, contexte 2D factice dans `src/test/setup.ts`), `affine.ts`, `snapping.ts`, `align.ts`, `guides.ts`, `svgImport.ts`, `clipboard.ts`, `geometry.ts`, `directTransform.ts`, `transform.ts`, `hitTest.ts`, `document.ts` (sanitisation, sérialisation SVG, persistance `localStorage['paramrig.vector-documents.v1']`).

UI :
- `useVectorDocument.ts` : état, sélection, groupe entré, historique. **Une geste continue = une entrée d'undo** via `beginGesture / endGesture / cancelGesture` ; les écritures pendant la geste passent `record = false`. `editElements(fn)` fait une édition arbitraire en une entrée. `duplicateElements` renvoie `{ ids, idMap }` et se fond dans une geste ouverte.
- `VectorCanvas.tsx` : machine d'interaction (`interaction` ref), outils `select | transform | node | pen | pencil | lasso | bucket | rectangle | ellipse`, aimantation, guides, HUD, pivot, minimap, mesures Alt. Le double-clic est traité au niveau du `<svg>` avec `elementsFromPoint` car la capture de pointeur détourne l'événement. Le listener clavier du canvas est enregistré avant celui de la page et arrête la propagation des touches qu'il possède (Escape, Enter, Backspace, flèches).
- `VectorEditorPage.tsx` : barre d'outils, raccourcis globaux, presse-papiers, import, zoom, versions. `VectorInspector.tsx` (contextuel : page / un objet / plusieurs), `VectorPaintPanel.tsx`, `VectorLayers.tsx` (arbre, drag avant/après/dedans).

Raccourcis existants : V, Q, P, ⇧P, B, R, O, Enter (nœuds), Esc (arbitrage geste → plume → outil nœuds → guide → groupe → désélection), ⌘Z/⇧⌘Z, ⌘D, ⌘A, ⌘G/⇧⌘G, ⇧⌘L, ⇧⌘H, ⌘E (combiner), ⌘J (connecter), ⌘C/X/V, ⇧H/⇧V, ⌥R, ⇧0/⇧1/⇧2, ⌥A/D/W/S/H/V (aligner), G/R/S (transformations modales dans l'outil Transform).

## 3. QA navigateur (obligatoire)

Un Chrome headless GPU écoute sur `http://127.0.0.1:9223` ; connecte-toi avec `chromium.connectOverCDP` depuis `/Users/soheil/Documents/repos/site-anym/node_modules/playwright-core/index.mjs`. Jamais `chromium.launch()` (ouvre une fenêtre au premier plan). Conventions apprises :
- Nouveau document : page `/`, bouton « New vector document ». Lire l'état dans `localStorage['paramrig.vector-documents.v1']` après ~60 ms.
- Convertir document → client via `document.querySelector('.vector-world').getScreenCTM()`.
- `page.mouse.dblclick`, jamais `click({ clickCount: 2 })` ; modificateurs via `keyboard.down/up`, pas `click({ modifiers })`.
- Un tracé plume sans fill se sélectionne en cliquant son trait, pas son intérieur. La plume n'étend que l'objet sélectionné.
- Les anneaux de rotation entourent les coins sélectionnés : cliquer un objet voisin à plus de 40 px d'un coin.
- Les touches d'outil sont ignorées quand un champ a le focus : `page.locator('#main').focus()` avant.
- Sélecteurs utiles : `.vector-canvas[data-tool]`, `[data-vector-element][data-selected]`, `.vector-multi-selection`, `.vector-nodes__point` (cercle = lisse, rectangle = coin), `[data-vector-node=id]`, `[data-vector-segment=id]`, `.vector-hud`, `.vector-smart-guide`.
- Vérifie à 1440 px, à 320 px (bascule Layers / Canvas / Inspector), en thème clair et sombre, et exige zéro erreur console.

## 4. Les dix chantiers, dans l'ordre

### Chantier 1 · Fichiers et sauvegarde fiable
- Introduire un format de projet `.paramrig.json` (document + versions + métadonnées), avec `exportProject()` / `importProject()` sanitisés par `sanitizeVectorDocument`.
- Sauvegarde sur disque avec l'API File System Access quand elle existe (`showSaveFilePicker`, handle conservé, écriture différée 800 ms après chaque changement, indicateur d'état « Saved · 12:04 » dans l'en-tête de l'inspecteur), repli sur téléchargement et `localStorage` sinon. Aucun bouton « Enregistrer » manuel comme geste principal : auto-save avec badge, plus « Save as… » et « Open… » dans un menu Fichier de la barre d'outils (Radix DropdownMenu stylé `menu`).
- Liste « Recent » sur la page bibliothèque (nom, date, vignette) à partir des handles persistés dans IndexedDB.
- `beforeunload` seulement quand des modifications ne sont pas encore écrites.
- Limite d'images : compresser toute image de fill au-delà de 512 Ko côté client (canvas → WebP) avant stockage.
- Tests : round-trip export/import, refus d'un fichier corrompu, quota `localStorage` dépassé sans perte silencieuse (message d'état `StatusMessage`).

### Chantier 2 · Performance à l'échelle
- Mémoïser `computeFaces` et `renderModel` par empreinte du réseau et des propriétés de peinture (cache LRU dans le module, clé = JSON stable ou hash rapide). Pendant une geste (`interaction.current` non nul), ne recalculer les faces que de l'objet édité et pas plus d'une fois par frame (`requestAnimationFrame` + dernier état).
- Remplacer la boucle O(n²) d'intersections par un balayage sur boîtes englobantes triées (ou grille uniforme) ; conserver l'échantillonnage adaptatif : 8 pas pour une courbe presque plate, 32 pour une courbe serrée (mesure de platitude sur le polygone de contrôle).
- Dans le canvas, mémoïser `VectorShape` (`React.memo` + props stables), ne rendre les compagnons de hit et les contours de survol que pour les objets visibles dans le viewport (test de boîte contre la vue).
- Cible mesurée : 300 segments avec croisements, déplacement d'un nœud à 60 i/s sur un Mac récent ; ajoute un script de QA qui charge un tel document et mesure le temps de frame via `performance.now()` autour de dix `pointermove`.

### Chantier 3 · Texte
- Nouveau `kind: 'text'` avec `text`, `fontFamily` (Public Sans par défaut, liste de polices système sûres), `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `align`, `fills/strokes` comme les autres. Boîte à largeur fixe ou auto.
- Outil T : clic crée un texte, glisser crée une boîte, double-clic édite en place avec un `contenteditable` superposé, aligné au zoom, sans contrôle natif visible.
- Rendu SVG `<text>` avec `tspan` par ligne ; export identique ; « Outline text » qui convertit en réseau via la mesure de glyphes (utiliser `opentype.js` avec la police Public Sans du dépôt `public/fonts/PublicSans.woff2` ; pour les polices système non chargeables, désactiver la commande avec une infobulle explicite).
- Inspecteur : section Text (famille, taille, graisse, interligne, approche, alignement), aimantation aux boîtes de texte, groupes et transformations compatibles.

### Chantier 4 · Frames et export
- `kind: 'frame'` : un conteneur avec fond, `clipContent`, taille prédéfinie (iPhone, Desktop, A4…) via `SelectField`. Les enfants passent par `parentId` comme les groupes ; l'export d'une frame utilise ses dimensions.
- Export : menu « Export » avec sélection (document, frame, objets sélectionnés), format SVG ou PNG (1×, 2×, 3×, fond transparent), via un `<canvas>` hors écran et `Image` sur le SVG sérialisé ; les fills image doivent être inlinés. Presets sauvegardés dans le document.
- Tests : rendu PNG d'un carré rouge 10×10 à 2× = 20×20 pixels rouges (vérifier les octets avec `canvas.getImageData` sous jsdom impossible : faire ce test dans la QA navigateur).

### Chantier 5 · Gestes rapides
- Ordre : ⌘] / ⌘[ (un cran), ⌥⌘] / ⌥⌘[ (tout devant / derrière), aussi dans le menu contextuel du canvas.
- Menu contextuel du canvas (`ContextTarget`) : Group, Ungroup, Bring forward/backward, Flip, Booleans, Flatten, Outline stroke, Lock, Hide, Copy, Paste, Delete, Edit nodes.
- Tab / ⇧Tab parcourent les objets frères ; Enter entre dans un groupe ou en édition, ⇧Enter remonte.
- Touches 1 à 0 : opacité 10 % à 100 % sur la sélection (deux chiffres rapides = valeur précise, comme Figma).
- ⌥⌘C / ⌥⌘V : copier-coller les propriétés d'apparence (fills, strokes, propriétés de contour, coins, opacité) ; ⇧⌘R « Paste to replace » optionnel.
- « Select all with same fill / stroke / stroke width » dans le menu contextuel.
- Renommage en série des calques (dialogue stylé : motif `Name $n`, avec aperçu).
- Palette de commandes ⌘/ : liste filtrable de toutes les commandes avec leurs raccourcis, exécution au clavier, aussi utilisable comme documentation vivante.
- Chaque nouveau raccourci apparaît dans l'infobulle du contrôle correspondant.

### Chantier 6 · Styles et couleurs
- Couleurs récentes (dernières 12 par document) et nuancier de document dans `ColorField` (rangée de pastilles cliquables, ajout depuis la couleur courante).
- Styles nommés de couleur et de contour stockés dans le document, appliqués par référence (un objet lié à un style se met à jour quand le style change ; « Detach »).
- Pipette qui prélève sur le canvas (rendu de la scène dans un canvas hors écran et lecture du pixel) en plus de l'`EyeDropper` système.
- Tests : application d'un style à plusieurs objets, modification du style, détachement, sanitisation.

### Chantier 7 · Précision en mode nœuds
- Aligner et distribuer les nœuds sélectionnés (mêmes six modes, section « Nodes » de l'inspecteur).
- Aimantation angulaire à 15° pendant le glissement d'une poignée avec Shift, aimantation aux autres nœuds pendant le glissement d'une poignée ou d'un nœud (déjà partielle : vérifier les poignées).
- Saisie numérique de la longueur et de l'angle de chaque poignée du nœud actif.
- Clic sur une face en mode nœuds avec ⌥ : sélectionne les nœuds de son contour.
- HUD pendant le glissement d'un nœud : coordonnées et delta ; pendant une poignée : longueur · angle.

### Chantier 8 · Objets image
- `kind: 'image'` : glisser-déposer ou coller un fichier image crée un objet image (data URL compressé, dimensions naturelles), redimensionnable avec ratio verrouillé par défaut, recadrage par double-clic (cadre de crop avec poignées), opacité, mode de rendu (`smooth` / `pixelated`).
- Rendu `<image>` avec `preserveAspectRatio`, export SVG inliné, PNG via le chantier 4.

### Chantier 9 · Historique lisible
- Chaque entrée d'undo porte un libellé (« Move 3 objects », « Add node », « Change fill ») : ajouter un paramètre `label` à `replace` / `endGesture`, renseigné par les appelants.
- Panneau History (inspecteur, aucune sélection) listant les étapes, clic pour revenir à une étape (undo/redo multiples), étape courante mise en évidence, fusion des versions nommées dans la même liste.

### Chantier 10 · Finitions qui usent
- Curseurs dédiés (plume, plume + fermeture, seau, courbure) en SVG data-URI, comme `--cursor-rotate` dans `vector.css`.
- Indicateur d'angle pendant la rotation (arc + valeur près du pivot).
- Survol d'un nœud ou d'un segment en mode nœuds : mise en évidence et infobulle légère avec l'index ou la longueur.
- Infobulles avec raccourci sur tous les boutons de la barre d'outils et de l'inspecteur.
- Bascule des panneaux (⌘\ pour masquer l'UI), plein écran du canvas.

## 5. Livraison attendue par chantier

1. Un commit par chantier (ou par sous-étape cohérente), message qui décrit le comportement, pas la liste de fichiers.
2. Tests unitaires pour tout module pur nouveau ou modifié ; tests `renderHook` sur `useVectorDocument` pour toute nouvelle transaction d'historique.
3. Un script de QA navigateur par chantier dans le scratchpad, exécuté et dont tu rapportes la sortie réelle ; captures pour ce qui est visuel.
4. Un bilan final honnête : ce qui est fait et vérifié, ce qui est partiel, ce qui est laissé de côté et pourquoi.
