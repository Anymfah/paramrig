# Prompt 5 : l'horizon, UV, sculpt, shape keys et animation, courbes et texte

> Document autonome : un agent qui démarre sans contexte doit pouvoir l'exécuter de bout en bout. Le plan maître est `docs/scene-editor-plan.md` ; les prompts 1 à 4 (`docs/scene-editor-roadmap-prompt.md`, `-2-`, `-3-`, `-4-`) ont été livrés : leurs règles, leur protocole de QA et leur architecture s'appliquent ici intégralement. L'état de référence est le code.

Dépôt : `/Users/soheil/Documents/repos/paramrig`, branche `main`, éditeur de scène dans `src/scene/`, servi sur `http://localhost:5174`. Ce prompt ajoute les modes et les objets de Blender qui ne sont pas de la modélisation polygonale pure. Chaque chantier est indépendant des autres et va du plus utile au plus spécialisé ; livre-les dans l'ordre et dis clairement où tu t'arrêtes. Même exigence : un commit par sous-chantier, `typecheck`, `lint`, `test`, `e2e -- scene-` et `git diff --check` avant chaque commit, bilan honnête avec les limites de chaque approximation.

## 0. État de départ (à vérifier, pas à supposer)

- Modes objet et édition complets, modificateurs, matériaux avec textures par ressource (mapping UV quand `attributes.vertex.uv` existe, sinon triplanaire), rig et Tune, préférences, mobile. `MeshData.attributes.edge.seam` existe (marqué par Mark seam). La `Timeline` du workbench (`src/workspace/Timeline.tsx`, `RigSession` : pistes, keyframes, lecture, `previewNumber`) anime les paramètres numériques d'un rig. `opentype.js` et la police Public Sans sont dans le dépôt (`src/vector/textOutline.ts`, `public/fonts/`).

## Chantier P · Les UV

### P1 · Modèle et dépliage
- `MeshData.attributes.loop.uv: number[]` (deux flottants par coin de face, dans l'ordre des boucles ; « loop » rejoint les attributs, la sanitisation vérifie la longueur), plusieurs cartes UV (`uvMaps: Array<{ name, data }>`, active), conservées par tous les opérateurs du prompt 2 (interpolation aux coupes, copie aux extrusions, fusion aux merges ; c'est le gros du travail : chaque opérateur a un test UV), par les modificateurs (subsurf avec UV smooth, mirror avec mirror U / V, array), par l'import et l'export glTF / OBJ.
- `src/scene/uv/unwrap.ts` : **Unwrap** (U) par LSCM (moindres carrés conformes, système creux résolu par gradient conjugué, deux sommets épinglés par îlot, îlots délimités par les seams), **angle based** (ABF++ simplifié, ou LSCM itéré avec correction d'angles ; l'écart est dit), options fill holes, correct aspect, margin ; **Smart UV project** (angle limit, island margin, area weight), **Cube / Cylinder / Sphere projection**, **Project from view** (et bounds), **Reset**, **Lightmap pack** (par faces), **Pack islands** (rotation, marge, tri par aire, empaquetage en étagère puis affinage), **Average island scale**, **Minimize stretch**, **Mark seam** / **Clear seam** (déjà), **Seams from islands**, **Live unwrap** pendant l'édition des seams.
- Tests : LSCM d'une grille plane = identité à l'échelle près, cube avec seams standards → six îlots carrés, cylindre avec un seam → rectangle, sphère smart project → n îlots sans chevauchement, pack sans chevauchement et dans [0, 1], conservation des UV par chaque opérateur (extrude, loop cut, knife, bevel, subdivide, merge).

### P2 · L'éditeur UV
- Un second espace `SceneUVEditor.tsx` ouvert par un bouton de l'en-tête ou l'onglet UV du rail (à 1440 px il partage l'écran avec le viewport, séparateur redimensionnable ; à 320 px il remplace le viewport) : canvas 2D (SVG ou `<canvas>` ; reprends le patron de zoom / pan et de sélection du vectoriel), image de fond (texture du matériau actif, damier), grille, îlots, sélection par sommet / arête / face / îlot synchronisée avec le viewport (« UV sync selection »), sticky selection, G / R / S / contraintes / saisie numérique via `transform/session.ts` en 2D, pin P / ⌥P, weld, stitch (V), align, straighten, split, mirror, snap to pixels, « constrain to image bounds », menu UV complet, overlays stretch (angle / area).
- Onglet Data > UV maps : liste, ajouter, renommer, actif, supprimer.
- e2e `scene-uv` : mark seam sur une boucle d'arêtes, U unwrap, capture de l'éditeur UV, déplacer un îlot, la texture suit dans le viewport en material preview.

## Chantier Q · Le mode Sculpt

- Mode Sculpt (⌃Tab ou sélecteur de mode) sur l'objet actif : pinceaux Draw, Draw sharp, Clay, Clay strips, Inflate, Blob, Crease, Smooth (⇧ temporaire), Flatten, Fill, Scrape, Pinch, Grab, Elastic deform (approximation par falloff), Snake hook, Thumb, Nudge, Rotate, Mask (M), Box / lasso mask, Annotate ; rayon F, force ⇧F, inverser ⌃, symétrie X / Y / Z, falloff (courbe `CurveField`), auto-smooth, front faces only, dyntopo **non** (dit) ; **Remesh voxel** (Data > Remesh : taille de voxel, adaptativité non, préserve le volume, via un champ de distance signé sur grille et marching cubes, puis quadrangulation par « tris to quads » ; approximation dite) et **Remesh quadriflow non** (dit).
- Implémentation : un `SculptSession` qui travaille sur un `Float32Array` de positions (pas d'`EditMesh`) avec une grille spatiale pour les requêtes de voisinage, pinceau appliqué par `pointermove` coalescé par frame, une entrée d'historique par trait (delta de positions compressé), normales recalculées par zone ; prélèvement du point de contact par `three-mesh-bvh` (rafraîchi par zone modifiée, `refit`) ; masque comme attribut de sommet affiché en gris dans l'overlay ; « Face sets » non (dit).
- Barre T de sculpt, sidebar N > Tool avec les options du pinceau, en-tête avec rayon, force, symétrie, remesh. Le curseur de pinceau est un cercle posé sur la surface (orienté par la normale), F et ⇧F règlent rayon et force par un glisser avec HUD, le trait ne saute pas au premier mouvement, les tablettes envoient la pression (`pointerEvent.pressure`) pour la force.
- Performance : trait de Draw sur un maillage de 200 000 sommets (remeshé) à 16 / 33 ms, mesuré.
- Tests : chaque pinceau sur une grille plane (déplacement au centre selon le falloff, nul au-delà du rayon), symétrie, masque qui annule, remesh d'un cube (fermé, volume à 5 %). e2e `scene-sculpt` : remesh à 0,05, Draw en glissant, capture, undo d'un trait.

## Chantier R · Shape keys et animation

- `SceneObject.shapeKeys: { basis: number[]; keys: Array<{ name, positions: number[] (delta ou absolu), value, min, max, relativeTo }> }` ; onglet Data > Shape keys : liste, ajouter (depuis la forme courante ou « from mix »), valeur (`SliderField`), min / max, relative, « edit mode » sur une clé (les modifications en édition écrivent la clé active), blend from shape, « apply as shape key » depuis un modificateur (réservé au prompt 3, activé ici), suppression. Les opérateurs topologiques sur un objet à shape keys les mettent à jour (les sommets nouveaux copient leur voisinage) ou refusent avec message quand ce n'est pas possible.
- Liaison `shapeKeys[name].value` du rig (le chemin réservé au prompt 4 s'active) : la manière propre d'exposer une déformation à un contrôleur. Le rendu applique les clés dans `evaluateObject` avant les modificateurs.
- Animation : les paramètres numériques d'un rig s'animent déjà par la `Timeline` ; ce chantier ajoute I « Insert keyframe » sur la position / rotation / échelle d'un objet et sur une valeur de shape key, qui crée à la volée un paramètre du rig et une piste, comme Blender crée une action ; le panneau F9 et le sidebar N montrent les champs animés en couleur d'animation ; lecture par Espace (préférence) ; export glTF avec animations (les pistes de transform → `AnimationClip`).
- Tests : évaluation des clés (mix de deux clés à 0,5), édition d'une clé, mise à jour à l'extrude, liaison et résolution, insertion de keyframe qui crée piste et paramètre, export glTF avec animation lu par `GLTFLoader`. e2e `scene-shape-keys` : créer une clé, déformer, régler la valeur dans Controls, keyframes et lecture.

## Chantier S · Courbes et texte

- `kind: 'curve'` : splines Bézier (poignées free / aligned / vector / auto, comme le mode nœuds du vectoriel : réutilise ses idées, pas son réseau planaire), poly, NURBS **non** (dit) ; 2D / 3D, résolution, fill (front / back / both / none en 2D), extrude, bevel (depth, resolution, profil ou objet), taper, offset ; mode édition des courbes (Tab) avec sélection de points et poignées, G / R / S, extrude E, subdivide, cyclic ⌥C, switch direction, handle type V, tilt ⌃T, radius ⌥S, smooth ; conversion en maillage (Object > Convert) ; primitives Bézier / cercle / path.
- `kind: 'text'` : texte (édition en mode édition : saisie clavier, curseur, sélection, ⌘V), police (Public Sans par défaut, polices du document via le registre du vectoriel `src/vector/fonts.ts` généralisé dans `src/editor/`), taille, extrude, bevel, alignement, espacement, offset ; contours par `opentype.js` (réutilise `textOutline.ts`), triangulation par `ShapeUtils` avec trous, extrusion en maillage ; conversion en courbe puis en maillage.
- Rendu : les courbes et textes produisent un `MeshData` évalué (mis en cache) qui traverse la pile de modificateurs et les matériaux comme un maillage ; les liaisons du rig acceptent `curve.extrude|bevelDepth|bevelResolution|resolution` et `text.text|size|extrude|bevelDepth`.
- Tests : longueur d'une Bézier, échantillonnage à résolution donnée, extrude + bevel d'un cercle (comptes, fermé), texte « A » (deux contours, un trou, extrudé fermé), conversion en maillage identique à l'évalué. e2e `scene-curves-text` : ajouter un cercle Bézier, bevel, éditer un point, texte « ParamRig » extrudé en capture.

## Chantier T · Peinture de sommets

- Attribut couleur par coin ou par sommet (`attributes.vertex.color` ou `loop.color`, domaine choisi), mode Vertex paint : pinceau (couleur, force, rayon, blend mode mix / add / multiply / lighten / darken, falloff), Fill (⇧K), Smooth, symétrie ; le matériau peut lire l'attribut (« Color attribute » dans le mapping de base color), l'ombrage solid en mode « attribute » le montre, l'export glTF l'emporte (`COLOR_0`).
- Tests : peinture au centre d'une grille (couleur au centre, dégradée au rayon), fill, export ; e2e `scene-vertex-paint` : peindre, capture en solid attribute.

## Finition exigée pour ce prompt, vérifiée avant livraison

- L'éditeur UV a le même toucher que le viewport : seuils, capture, HUD en DOM, G / R / S avec Pointer Lock, priorité de clic, sélection synchronisée dans la frame suivante ; les îlots se lisent sur le damier et sur la texture dans les deux thèmes.
- Sculpt : 60 i/s pendant un trait sur 200 000 sommets, curseur de pinceau sur la surface, pression de tablette, un pas d'historique par trait, undo sous 50 ms.
- Shape keys : la valeur se scrub avec aperçu vivant ; en Tune, un contrôleur lié à une clé bouge la géométrie dans la frame suivante.
- Courbes et texte : les poignées de Bézier ont les mêmes cibles et la même priorité que les sommets ; la saisie de texte en édition a un curseur clignotant et une sélection visibles ; la conversion en maillage est réversible par undo.
- Chaque nouveau mode a sa barre T, son en-tête, sa barre d'état contextuelle, son entrée dans le camembert ⌃Tab, ses icônes maison et sa page keymap à jour.

## Livraison

1. Un commit par sous-chantier (P1, P2, Q, R, S, T), messages qui décrivent le comportement.
2. Tests unitaires pour chaque module pur (unwrap, pack, sculpt, shape keys, courbes, texte, peinture) ; tests React pour les panneaux ; e2e exécutés, sortie réelle, captures.
3. Le tableau de performance (sculpt, remesh, unwrap d'un maillage de 20 000 faces).
4. Un bilan honnête : fait et vérifié, partiel, laissé de côté et pourquoi, avec les limites de chaque approximation (ABF simplifié, remesh par marching cubes, elastic deform, pas de NURBS, pas de dyntopo, pas de quadriflow).
