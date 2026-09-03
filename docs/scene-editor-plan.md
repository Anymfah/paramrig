# L'éditeur 3D de ParamRig : le plan

> Document maître. Les cinq prompts `docs/scene-editor-roadmap-prompt.md`, `-2-`, `-3-`, `-4-` et `-5-` le référencent ; un agent qui exécute un prompt lit d'abord ce document, puis le code. L'état de référence est toujours le code, pas ce plan.

## 1. L'intention

ParamRig a un éditeur vectoriel (`src/vector/`, 28 000 lignes, quatre prompts, livré) qui est un renderer parmi d'autres : un document vectoriel sans `rig` est un dessin, avec un `rig` c'est un rig réglé par des contrôleurs. On veut la même chose pour la 3D : un **éditeur de scène** qui reprend Blender, sa logique et ses touches, au point qu'un utilisateur de Blender s'y sente chez lui, et qu'une IA puisse écrire un rig 3D dont un humain règle les contrôleurs.

Blender, c'est : un mode objet et un mode édition (Tab), trois modes de sélection en édition (1, 2, 3 : sommets, arêtes, faces), des transformations modales (G, R, S, contraintes X/Y/Z, saisie numérique), les opérateurs de modélisation (E, I, ⌃B, ⌃R, K, J, F, M, X…), un panneau « Adjust last operation », des modificateurs, des matériaux, des lumières, des caméras, un outliner, un éditeur de propriétés, quatre modes d'ombrage. Tout cela est dans le périmètre. Le rendu final Cycles, les nœuds de géométrie, la physique, le montage vidéo et Python n'y sont pas ; l'éditeur de shader à nœuds y est, en horizon, grâce au moteur de Prismorphic ; la section 10 donne la liste exacte.

Périmètre en une phrase : **tout ce qui sert à modéliser, habiller et exposer un objet, à la fidélité de Blender, dans le navigateur, avec three.js.**

## 2. Ce qui existe déjà, et ce qu'on en fait

### ParamRig

- `three@0.180`, `@types/three`, `@react-three/fiber@9` sont installés. `RendererKind` (`src/rigs/types.ts:137`) contient déjà `'three'`, utilisé par `src/renderers/three/TidalPlanetPreview.tsx` (R3F) et par `Gizmo3DScene.tsx` (`TransformControls` + `OrbitControls` câblés sur `onGestureStart / End / Cancel`).
- Le routage passe par `/r/:rigId` → `src/workspace/WorkspacePage.tsx`, qui branche à la ligne ~69 sur `manifest.renderer === 'vector' && (mode === 'edit' || parameters.length === 0)` vers `VectorEditorPage`, sinon `WorkspaceShell` + `Inspector` + `Timeline` + `RigPreview`. `src/workspace/RigPreview.tsx` dispatche les renderers ; `three` y est câblé en dur sur `TidalPlanetPreview`, il faudra une table.
- `VectorEditorPage` réutilise `WorkspaceShell` (`src/shell/WorkspaceShell.tsx`) avec `renderNavigation` (rail gauche), `inspector`, `children` (barre + scène), `navLabel` / `mainLabel` pour le dock mobile (`width < 64em`).
- À réutiliser tel quel : le kit `src/ui/` (`Button`, `IconButton`, `Tooltip`, `NumberField`, `ColorField`, `SelectField`, `SwitchField`, `SliderField`, `GradientField`, `ContextMenu`, `ParameterField` et les contrôleurs, `hit-target.ts`, `useRovingFocus`), `src/vector/history.ts` (pur), le patron de `useVectorDocument` (gestes, libellés), `useProjectFile` (auto-save, File System Access, badge), `commands.ts` (`VectorCommand`, `filterCommands`), `VectorCommandPalette`, `VectorModal`, `VectorChip`, `inspectorPrefs.ts`, `announce.ts`, `fileHandles.ts`, la `RigSession` (`src/state/session.ts`) et `Inspector` du workbench. Les pièces génériques sont extraites dans `src/editor/` (chantier 1), l'éditeur vectoriel les ré-exporte sans changer de comportement.
- Harnais e2e : `e2e/lib.mjs` (`run`, `helpers`), Chrome headless GPU sur `9223`, `docker compose run --rm app npm run e2e`. Le fichier Compose est `compose.yml`.
- Tests : vitest + jsdom, `src/test/setup.ts` simule un contexte 2D vide pour paper.js ; **aucun mock WebGL ni `ResizeObserver`**.

### Prismorphic (`/Users/soheil/Documents/repos/prismorphic`, React 19, pnpm)

L'éditeur de matériaux à nœuds de Soheil. Deux moitiés très inégales :

- **Le moteur est pur et réutilisable** : `types/material-graph.ts` (modèle de graphe, ports typés scalaire / vecteur / couleur / shader, évaluation CPU, sanitisation, diagnostics) et `types/material-graph-glsl.ts` (compilation en GLSL avec cache LRU, budgets, stratégie de patch uniforms / recompilation), greffés sur un `MeshPhysicalMaterial` par `onBeforeCompile` dans `packages/runtime-preview/src/injectCompiledGraphShader.ts`. Aucune dépendance aux nœuds TSL ni à WebGPU : compatible avec le `WebGLRenderer` du plan.
- **L'interface ne l'est pas** : `NodeViewPane.tsx`, 3 145 lignes, nœuds positionnés en pourcentage de la scène et câbles mesurés au DOM, marges codées en dur, undo par `CustomEvent` sur `window`, 31 types de nœuds câblés dans des tables et deux `switch`, infobulles natives, ports de 20 px, couleurs hors tokens, tests qui cherchent des chaînes dans le source. Son design d'interaction (connexion au pointeur et au clavier, détachement par glisser, cadres, minimap, palette `/`) est bon et sert de cahier des charges.

**Décision** : le prompt 5 (chantier U) copie le moteur avec sa provenance, le rend pilotable par un registre de nœuds, et écrit un `NodeGraphEditor` générique dans `src/editor/` à partir du design, pas du code. Le même composant servira plus tard à l'onglet Bindings des rigs.

### Helios (`/Users/soheil/Documents/repos/helios/frontend`, Angular)

L'éditeur d'objets personnalisés est un bon prototype et un mauvais modèle :

- Il n'a pas de topologie. Le maillage est une `BufferGeometry` triangulée ; l'identité d'un sommet est une **clé de position** (`"x,y,z"` à 4 décimales), les quads sont **devinés** en appariant deux triangles dont les normales font `dot > 0.99`. Deux sommets confondus sont indiscernables, toute sélection est à re-clé après chaque transformation, les UV sont perdus à la première édition.
- Une seule opération : l'extrude (`core/services/editor/editor-extrude.service.ts`, 814 lignes), qui marche depuis des faces, des arêtes ou des sommets, avec reconstruction des boucles de bord et correction du sens des faces. C'est la partie qui vaut la peine : `extrudeNodeGeometry`, `addLoopFaces`, `buildBoundaryLoops`, `computeSelectionNormal`.
- Prélèvement CPU en O(sommets) par mouvement de souris, gizmo `TransformControls` de série, superpositions reconstruites intégralement à chaque survol, sélection dessinée avec `depthTest: false` (donc à travers l'objet).
- L'historique ne snapshote pas la géométrie : un extrude n'est pas annulable.
- Mise en page : deux panneaux fixes de 320 px, aucune media query, hauteur forcée à coups de `::ng-deep`, glyphes Unicode en guise d'icônes.

**Décision** : on reprend les idées (découpage scène / sélection / transformation / superpositions / historique / extrude, tolérances de prélèvement, boucle de bord de l'extrude, `worldToScreen`, `pointToSegmentDistance`), on ne reprend aucun code tel quel. Le cœur topologique, le prélèvement, l'historique et la mise en page sont réécrits.

## 3. Les décisions d'architecture

Elles sont tranchées ici pour ne pas être re-débattues à chaque prompt.

1. **Le module s'appelle `src/scene/`**, le renderer `'scene'`, le document `SceneDocument`, la clé de stockage `paramrig.scene-documents.v1`, la feuille `src/styles/scene.css` avec des tokens `--scene-*`. Un document de scène est un rig comme un document vectoriel : `sceneManifest(document)` est l'analogue de `vectorManifest`, listé par `src/rigs/registry.ts`, ouvert sur `/r/:id`, avec le même routage Edit / Tune que le vectoriel.
2. **Le maillage est un maillage polygonal à identifiants stables**, pas une soupe de triangles. `MeshData` (persisté) porte des sommets à `id` stable, des arêtes en paires de sommets, des faces en boucles de sommets (n-gones autorisés), et des attributs par sommet, arête et face. `EditMesh` (mémoire) reconstruit l'adjacence (sommet → arêtes, arête → faces, face → arêtes) et porte les requêtes topologiques. La triangulation ne sert qu'au rendu et au prélèvement, avec une table triangle → face.
3. **Chaque opération de maillage est un opérateur déclaré** : `{ id, label, params (schéma), defaults, run(context, params) }`, dans un registre. Les menus, la palette, les raccourcis, le panneau « Adjust last operation » (F9), les infobulles et la page de documentation se dérivent du registre. Un opérateur est une fonction pure sur le document ; le panneau F9 rejoue l'opérateur sur le document d'avant avec les nouveaux paramètres.
4. **Le viewport est du three.js sans React à l'intérieur.** Une classe `SceneViewport` possède le renderer, les caméras, la scène de rendu et la scène de superpositions ; React fournit le chrome et ne reçoit que des dérivés grossiers. Rendu à la demande (`invalidate()`), jamais de boucle continue hors amortissement, lecture ou animation. Monté une seule fois ; si Edit et Tune partagent le viewport, on déplace le nœud DOM (`appendChild` + `display: contents`), on ne le remonte pas. Rien de haute fréquence dans un contexte React.
5. **Le prélèvement est un tampon d'identifiants GPU** (faces, arêtes, sommets, gizmos, objets), lu sur une petite région autour du curseur pour le survol, sur une région entière pour boîte / lasso / cercle ; la profondeur règle l'occlusion. `three-mesh-bvh` sert au lancer de rayon (aimantation, curseur 3D, placement, sélection d'objet en repli).
6. **Une geste continue = une entrée d'undo**, avec libellé ; pendant la geste on écrit sans enregistrer ; Escape restaure. Le document est immuable et remplacé par pas ; seul l'objet modifié est cloné (partage structurel des autres). Après un undo, la sélection revient sur les éléments concernés s'ils existent encore (les ids stables le permettent).
7. **La transformation modale est un module pur** (`transform/session.ts`) : mode, contraintes, saisie numérique, précision, aimantation, édition proportionnelle, orientation, pivot ; testée sans navigateur. Les gizmos et la transformation modale partagent ce module.
8. **Les touches suivent Blender**, sur `event.code` pour les lettres et chiffres (AZERTY compris), avec les écarts documentés au chantier 1 de chaque prompt : ⌘Z / ⇧⌘Z en plus de ⌃Z, jamais de ⌘W ni ⌘T ni ⌘N, pavé numérique réel reconnu, émulation `⌥1 / ⌥3 / ⌥7` (opposé avec ⌃), émulation de la souris à trois boutons (⌥ + clic gauche orbite) activée par défaut sur trackpad.
9. **Les modificateurs sont évalués en pur**, mis en cache par empreinte (données du maillage + paramètres + entrées), et le viewport rend le résultat évalué ; le mode édition montre la cage et le résultat (option « on cage »).
10. **Les approximations sont dites** : booléens par `three-bvh-csg` (résultat triangulé puis nettoyé), décimation par effondrement d'arêtes, dépliage UV par LSCM, rendu = three.js et non Cycles. Chaque approximation est notée dans la documentation et dans le bilan.
11. **Direction artistique** : palette ParamRig, aucun contrôle natif, cibles 32 / 44 px, états hover / active / focus-visible, `user-select` maîtrisé, wording anglais sobre. La sélection 3D doit **se lire dans une capture**, dans les deux thèmes, au-dessus de l'ombrage studio.

## 4. Le modèle

Les types vivent dans `src/scene/types.ts`. Esquisse contractuelle, à préciser dans le code :

```ts
type SceneDocument = {
  version: 1
  id: string; name: string
  objects: SceneObject[]            // liste plate, hiérarchie par parentId
  collections: Collection[]         // arbre par parentId, racine implicite « Scene Collection »
  materials: Material[]
  world: World                      // couleur / environnement, force
  cursor: { position: Vec3; rotation: Vec3 }
  view: ViewState                   // caméra de vue, ombrage, superpositions (par document, mémorisés)
  units: { system: 'metric' | 'imperial' | 'none'; scale: number }
  rig?: SceneRig                    // groups, parameters, inspectorCategories, bindings (chantier 4)
  versions: Version[]
}

type SceneObject = {
  id: string; name: string
  kind: 'mesh' | 'light' | 'camera' | 'empty' | 'curve' | 'text'   // curve et text en phase 5
  parentId?: string; collectionId: string
  transform: { position: Vec3; rotation: Vec3 /* Euler XYZ degrés */; scale: Vec3; rotationMode?: 'XYZ' | 'quaternion' }
  visible: boolean; selectable: boolean; renderable: boolean
  origin?: Vec3                      // décalage d'origine, appliqué aux données
  data: MeshData | LightData | CameraData | EmptyData
  modifiers: Modifier[]
  materialSlots: string[]            // ids de matériaux
  shapeKeys?: ShapeKey[]             // phase 5, liables aux contrôleurs
  displayAs?: 'textured' | 'solid' | 'wire' | 'bounds'
}

type MeshData = {
  vertices: number[]                 // xyz plat, index = emplacement courant
  vertexIds: number[]                // id stable par emplacement, jamais réutilisé
  nextVertexId: number
  edges: [number, number][]          // emplacements, a < b, sans doublon
  faces: number[][]                  // boucles d'emplacements, sens antihoraire vu de l'extérieur
  faceIds: number[]; nextFaceId: number
  attributes: {
    face: { smooth: boolean[]; material: number[] }
    edge: { seam?: boolean[]; sharp?: boolean[]; crease?: number[]; bevelWeight?: number[] }
    vertex: { uv?: number[][]; color?: number[] }     // UV par coin de face (loop) en phase 5
  }
  autoSmooth?: { enabled: boolean; angle: number }
}
```

- Un sommet, une face ont un id stable ; une arête est identifiée par ses deux ids de sommets (`edgeKey(a, b)`, id trié). La sélection persistée en mode édition est `{ vertices: Set<id>, edges: Set<edgeKey>, faces: Set<id>, active?: { kind, id } }` ; le mode de sélection (`vertex | edge | face`, combinables avec ⇧) est dans `view`.
- `EditMesh` (`src/scene/mesh/editMesh.ts`) se construit depuis `MeshData` en O(n), expose `vertEdges(v)`, `edgeFaces(e)`, `faceEdges(f)`, `loopNext / loopPrev`, `isManifold`, `boundaryEdges`, `edgeLoop(e)`, `edgeRing(e)`, `linked(v)`, `faceNormal(f)`, `vertexNormal(v)`, `bounds`, et renvoie un `MeshData` neuf par `toData()`. Les opérateurs travaillent sur un `EditMesh` cloné et renvoient `{ mesh, selection }`.
- La triangulation (`mesh/triangulate.ts`) : éventail pour triangles et quads convexes, `THREE.ShapeUtils.triangulateShape` sur la projection dans le plan de la normale de Newell pour les n-gones ; table `triangleFace: Int32Array` ; cache par empreinte.
- `Material` : sous-ensemble du Principled BSDF → `MeshPhysicalMaterial` (base color, metallic, roughness, specular, IOR, transmission, emission + strength, alpha, normal strength, textures par ressource `src/state/resources.ts`), `backface culling`, `blend mode`.
- `LightData` : `point | sun | spot | area` avec couleur, puissance (W), rayon, angle et flou pour spot, taille pour area, ombres. `CameraData` : `perspective | orthographic`, focale ou taille ortho, capteur, clip, profondeur de champ (indicative), `active`.
- `Modifier` : `{ id, kind, name, enabled: { viewport, render, editMode, onCage }, params }`, ordre = pile.
- `SceneRig` reprend `ParamGroup`, `ParameterDef`, `InspectorCategory` de `src/rigs/` ; une `SceneBinding` cible un chemin typé (section 9).

## 5. La carte des modules

```
src/editor/                        pièces génériques extraites du vectoriel (chantier 1)
  history.ts commands.ts (types + filterCommands) chip / modal / saveBadge / commandPalette (composants)
  nodeGraph/ (NodeGraphEditor générique, prompt 5, chantier U)
src/scene/
  types.ts document.ts (sanitisation, stockage, sceneManifest, vignettes) project.ts (fichier .paramrig.json kind 'scene')
  keymap.ts (table Blender → actions, event.code, plateforme, préférences) commands.ts announce.ts prefs.ts
  icons.tsx (jeu SVG maison, section 7) SceneHints.tsx (chip de première minute, F1 keymap)
  operators/                       registre + un fichier par famille
    registry.ts types.ts object.ts (add, duplicate, delete, join, separate, apply, origin, parent, collections…)
    extrude.ts inset.ts bevel.ts loopCut.ts knife.ts subdivide.ts merge.ts dissolve.ts delete.ts fill.ts bridge.ts
    slide.ts split.ts spin.ts smooth.ts symmetrize.ts bisect.ts boolean.ts trisQuads.ts cleanup.ts hull.ts decimate.ts
    normals.ts select.ts (more/less, linked, loops, rings, similar, random, checker, traits)
  mesh/                            pur, testé
    data.ts editMesh.ts triangulate.ts normals.ts primitives.ts selection.ts fingerprint.ts
  transform/                       pur, testé
    session.ts math.ts constraints.ts numeric.ts snap.ts proportional.ts orientation.ts pivot.ts
  modifiers/                       pur, testé, cache
    stack.ts subsurf.ts mirror.ts array.ts solidify.ts bevel.ts boolean.ts decimate.ts screw.ts triangulate.ts
    weld.ts wireframe.ts smooth.ts simpleDeform.ts cast.ts edgeSplit.ts displace.ts
  io/  gltf.ts obj.ts stl.ts render.ts thumbnail.ts
  textures/procedural.ts (bruit, nuages, voronoï pour Displace)   uv/ sculpt/ curves/ shader/ (prompt 5 ; shader/prismorphic/ = moteur copié avec provenance)
  rig.ts (liaisons, résolution pure, mémoïsée)
  viewport/                        three.js, non testé en jsdom, testé en e2e
    SceneViewport.ts navigation.ts meshView.ts overlays.ts outline.ts picking.ts gizmo.ts navGizmo.ts
    shading.ts (wireframe, solid studio / matcap, material, rendered) cursor.ts lights.ts cameras.ts empties.ts
    knifeOverlay.ts measure.ts debug.ts (window.__paramrigScene en DEV)
  SceneEditorPage.tsx SceneViewportHost.tsx SceneHeader.tsx SceneToolbar.tsx SceneSidebar.tsx (N)
  SceneOutliner.tsx SceneProperties.tsx (+ panels/) SceneRedoPanel.tsx SceneStatusBar.tsx SceneAddMenu.tsx
  ScenePieMenu.tsx SceneFileMenu.tsx SceneExportMenu.tsx SceneControls.tsx useSceneDocument.ts useSceneFile.ts
src/renderers/scene/SceneRigPreview.tsx      Tune : le viewport en lecture seule
src/docs/SceneRigsPage.tsx                   /docs/scene-rigs
src/rigs/examples/<exemple>.ts               BUNDLED_SCENES
e2e/scene-*.e2e.mjs                           un script par sous-chantier, helpers 3D dans e2e/lib.mjs
```

## 6. L'interface, à la Blender, dans le shell ParamRig

- **Rail gauche** : l'**Outliner**. Arbre Scene Collection → collections → objets → (données, modificateurs, matériaux repliés). Par ligne : icône de type, nom éditable, œil (viewport), flèche (sélectionnable), appareil photo (rendu). Glisser pour ré-parenter ou changer de collection ; ⇧ / ⌃ pour étendre la sélection ; le clic sélectionne dans le viewport et réciproquement (défilement vers l'objet actif). Deuxième onglet **Assets** : matériaux, matcaps, primitives enregistrées.
- **Centre** : le **viewport** avec, dans l'ordre vertical :
  - un **en-tête** (`role="toolbar"`) : sélecteur de mode (Object, Edit, Sculpt…), en édition les trois boutons de mode de sélection, les menus **View · Select · Add · Object** (ou **Mesh · Vertex · Edge · Face · UV** en édition), à droite orientation de transformation, pivot, aimantation (icône + menu), édition proportionnelle, puis les quatre boutons d'ombrage, le bouton et menu **Overlays**, le bouton et menu **Gizmos**, X-ray ;
  - la **barre d'outils T** en surimpression à gauche (Select box / circle / lasso, Cursor, Move, Rotate, Scale, Transform, Annotate, Measure ; en édition en plus Extrude region / along normals / individual / manifold, Inset, Bevel, Loop cut / Offset edge loop, Knife / Bisect, Poly build, Spin, Smooth / Randomize, Edge slide / Vertex slide, Shrink/Fatten / Push-pull, Shear, Rip), pliable, groupes à sous-menu, raccourcis dans les infobulles ;
  - le **sidebar N** en surimpression à droite : onglets Item (transform de l'objet actif ou médiane des sommets, dimensions), Tool (options de l'outil actif), View (focale, clip, curseur 3D, verrouillage caméra) ;
  - le **gizmo de navigation** en haut à droite (axes cliquables, boutons zoom, main, ortho/persp, caméra) ;
  - le panneau **Adjust last operation** en bas à gauche, replié en une ligne titrée, déplié par F9 ou clic ;
  - le **HUD** de transformation modale (« Dx: 1.2 m Dy: 0 Dz: 0 (1.2 m) | along global X ») et le texte d'en-tête modale ;
  - la **barre d'état** en bas : indices de souris et clavier selon le contexte, statistiques (objets, sommets, arêtes, faces, triangles, sélection), version.
- **Droite** : l'**éditeur de propriétés** = l'inspecteur ParamRig avec des onglets verticaux à icônes : Scene, World, Object, Modifiers, Material, Data (maillage : normales, UV, shape keys, attributs ; lumière ; caméra), plus **Controls** et **History** comme le vectoriel. L'onglet mémorisé par document.
- **Mobile (320 px)** : dock Objects / Viewport / Properties ; la barre T devient une rangée en bas du viewport ; le sidebar N est une feuille ; navigation tactile (un doigt orbite, deux doigts pan, pincement zoom, appui long = menu contextuel) ; gizmos toujours visibles en pointeur grossier.
- **Menus contextuels** (clic droit) et **menus en camembert** (Z ombrage, ⇧S aimantation du curseur, `.` pivot, `,` orientation, ⌃Tab mode) : un composant `ScenePieMenu` positionné au curseur, navigable au clavier, avec la même liste que les menus déroulants.
- **F3 / ⌘/** : la palette de commandes générée depuis le registre d'opérateurs, avec sections et raccourcis.

## 7. Les principes de manipulation, et ce que « fini » veut dire

Un éditeur 3D se juge à la main. Ce qui suit vaut pour tous les prompts ; chaque prompt ajoute ses vérifications propres, et le bilan de chaque prompt cite ces règles une à une avec la preuve (test, script e2e, capture).

### Le pointeur

1. **Seuil de glissement** : 3 px (5 px en pointeur grossier). En dessous, c'est un clic ; un clic ne modifie jamais le document et n'écrit jamais dans l'historique. Le point de départ d'une geste est celui du `pointerdown`, pas du premier `pointermove` : rien ne saute au début d'une geste.
2. **Capture du pointeur** sur toute geste ; sortir de la fenêtre continue la geste ; `pointercancel`, perte de focus et démontage appellent `cancelGesture`.
3. **Transformation modale au clavier** (G / R / S, E, I, ⌃B, ⌃R…) : `requestPointerLock` avec un curseur dessiné dans l'overlay, pour un mouvement sans butée comme le « wrap » de Blender ; si le verrouillage est refusé, la session continue sans wrap et sans saut. Escape libère et annule ; clic gauche ou Enter confirme.
4. **Priorité de clic explicite et testée** : gizmo de navigation > gizmo de transformation > poignée d'outil > sommet > arête > face > objet > vide. Quand deux cibles se chevauchent, la plus petite gagne. Vérifiée à 4 niveaux de zoom dans un script e2e.
5. **Survol** : la réaction est visible dans la frame suivante, sans `setState` React : surbrillance des gizmos, sommets, arêtes, faces, objets ; le curseur change avec l'outil (croix pour le knife, cible pour le curseur 3D, règle pour la mesure) via des SVG data-URI dans `scene.css`.
6. **HUD en DOM**, jamais dessiné dans le canvas : valeur, unité, contrainte, aimantation, en `EditorChip`, à 24 px du curseur du côté opposé au bord le plus proche ; il ne masque jamais ce qu'on manipule et disparaît à la fin de la geste. La ligne d'en-tête modale (« Move: Dx 0.5 m … | X constrain, ⇧ precision, ⌃ snap ») remplace la barre d'état pendant la session.
7. **Rien ne bouge dans la mise en page** pendant une geste : F9, HUD, chips, barre d'état sont en surimpression ; aucune infobulle ne s'ouvre pendant une geste ; les infobulles arrivent après 400 ms et partent au premier mouvement.

### Le clavier

8. **Parité** : tout ce qui se fait à la souris se fait au clavier, et réciproquement ; tout opérateur est dans un menu, dans la palette F3, et porte une infobulle avec son raccourci. Sur tactile, tout opérateur est atteignable par un menu ou la palette.
9. **Les menus se filtrent en tapant** (type-to-search, comme Blender 4) : ⇧A, les menus de l'en-tête, le menu contextuel, les camemberts ; l'entrée en surbrillance s'exécute par Enter.
10. **⇧R répète le dernier opérateur**, F9 le règle, ⌘Z l'annule, l'historique le nomme avec ses paramètres principaux (« Bevel · 0.1 m · 3 segments »).
11. **Escape a un ordre d'arbitrage fixe** : geste de pointeur → session modale → outil modal (knife, bisect, measure…) → menu ou camembert → rien. Escape ne quitte jamais le mode édition et ne désélectionne pas ; ⌥A désélectionne.
12. **Tab change de mode, jamais de focus**, sauf quand un champ a le focus. Les touches d'outil sont ignorées dans un champ ; Escape y restaure la valeur d'avant le focus.

### La vue

13. **Le zoom suit la molette en continu**, centré sur le curseur ; jamais de zoom en escalier ; transitions de vue en 200 ms (0 en `reduced-motion`) ; orbite amortie sur 120 ms ; 60 i/s pendant toute geste, mesuré.
14. **La qualité d'image** : WebGL2 requis (message clair sinon), MSAA ×4 sur la passe principale, lignes anticrénelées (`LineSegments2` ou shader équivalent, jamais `LineBasicMaterial` à 1 px crénelé), points de taille constante à l'écran, `dpr` jusqu'à 2 ; le contexte perdu (`webglcontextlost`) est restauré et tout est ré-uploadé sans rechargement (testé avec `WEBGL_lose_context`).
15. **Ce qui est sélectionné se lit dans une capture** à 50 % de zoom, dans les deux thèmes, sur les quatre ombrages ; contraste du contour, des sommets et des arêtes sélectionnés d'au moins 3:1 contre ce qui les entoure, mesuré par script.

### Les panneaux et les champs

16. **Tout est mémorisé par document** : largeurs de panneaux, onglet, sections repliées, vue, mode, ombrage, overlays, outil ; rouvrir une scène la rend telle qu'on l'a laissée.
17. **Un champ numérique** se scrub (glisser), se tape, accepte une expression (`1/3`, `2*pi`) et une unité (`m`, `cm`, `°`), ⌥ pour le pas fin, ⇧ pour le pas large, flèches haut / bas, Escape restaure ; ⌥ glisser sur un champ vectoriel change les trois composantes ; un champ lié à un contrôleur est en lecture et le dit (◇ plein).
18. **Un état vide dit quoi faire** (« No modifiers. Add one with Add modifier ») ; **une action refusée dit pourquoi** dans un `StatusMessage` (« Bevel needs a manifold selection »), jamais en silence ; les entrées de menu non disponibles restent visibles, grisées, avec la raison en infobulle.
19. **Nommage automatique de Blender** : « Cube », « Cube.001 » ; F2 renomme partout (viewport, outliner, propriétés) ; les noms sont uniques par document.
20. **La première minute** : la scène de démarrage (cube, lumière, caméra, vue à 3/4), un chip d'indices dans le viewport (« Middle-drag or ⌥-drag to orbit · ⇧A to add · Tab to edit · F3 to search ») qui disparaît à la première action et ne revient pas ; F1 ouvre le keymap dans une feuille ; la barre d'état enseigne les gestes selon le contexte.

### Les couleurs du viewport

Tokens `--scene-*` en tête de `scene.css`, définis pour les deux thèmes, chacun avec sa raison :

- `--scene-selected` : ambre (proche de l'orange de Blender, désaturé pour la palette minérale) ; `--scene-active` : le même en plus clair ; `--scene-hover` : le même à 50 %. L'ambre est délibéré : l'accent turquoise de l'interface ne doit pas concurrencer la sélection 3D, et un utilisateur de Blender la reconnaît.
- `--scene-vertex`, `--scene-vertex-selected`, `--scene-edge`, `--scene-edge-selected`, `--scene-face-selected` (30 % d'opacité), `--scene-face-active`.
- `--scene-axis-x` rouge, `--scene-axis-y` vert, `--scene-axis-z` bleu ; `--scene-grid`, `--scene-grid-major`, `--scene-floor`.
- `--scene-cursor-ring` rouge et blanc, `--scene-gizmo-view` blanc, `--scene-snap` jaune-vert, `--scene-proportional` gris clair, `--scene-loop-cut` jaune, `--scene-knife` blanc avec points d'aimantation verts, `--scene-measure`, `--scene-face-front` bleu et `--scene-face-back` rouge (orientation), `--scene-normal` cyan, `--scene-seam` rouge, `--scene-sharp` cyan, `--scene-crease` magenta.

Chaque couleur est vérifiée en capture sur le fond de chaque ombrage, dans les deux thèmes, avec un contraste d'au moins 3:1. Le préréglage « Blender classic » du prompt 4 ne fait que remplacer ces tokens.

### Les icônes

Un jeu SVG maison `src/scene/icons.tsx` sur grille 16 px, trait 1,5 px, coins arrondis, dessiné dans le style de lucide pour tout ce que lucide n'a pas : outils (extrude, inset, bevel, loop cut, knife, bisect, poly build, spin, slide, shrink / fatten, shear), modes de sélection, types d'objet (mesh, light ×4, camera, empty, curve, text), modificateurs, ombrages, overlays, aimantation, édition proportionnelle, pivot, orientation. Jamais un glyphe Unicode, jamais une image bitmap. Chaque icône a un test qui vérifie qu'elle est référencée par au moins un bouton.

### Ce que « fini » veut dire

**Un contrôle est fini** quand : il a ses états hover, active, focus-visible, disabled ; une cible de 32 / 44 px ; une infobulle avec le raccourci ; un chemin clavier ; un chemin tactile ; un libellé en sentence case ; sa valeur est mémorisée si elle est un réglage ; il est couvert par un test React ou un script e2e ; il se voit dans une capture des deux thèmes.

**Un opérateur est fini** quand : il est dans le registre avec son schéma et ses valeurs par défaut ; il est dans un menu, dans la palette, dans le keymap ; il a un libellé d'historique ; F9 le rejoue ; ⇧R le répète ; il refuse proprement les entrées qu'il ne sait pas traiter ; il est testé sur un cas canonique par comptes topologiques et positions ; s'il est modal, il a son en-tête modal, son HUD, Escape et clic droit ; un script e2e l'exécute au clavier et à la souris ; il est documenté dans la page keymap.

**Une geste est finie** quand : une entrée d'historique, pas de saut au départ, 60 i/s mesurées, Escape restaure, le HUD est lisible, rien ne bouge dans la mise en page.

### Les budgets

- Première image du viewport sous 1,5 s sur le Chrome de test (three.js et l'éditeur dans leurs propres chunks, chargés par `lazy`), sous 3 s en 375 × 812 avec émulation mobile.
- Geste : 16 ms moyen, 33 ms p95 ; survol : sous 4 ms ; changement d'ombrage : sous 100 ms sans image noire ; Tab sur 100 000 sommets : sous 300 ms ; undo : sous 50 ms sur 100 000 sommets.
- Mémoire : historique sous 200 Mo pour 100 pas sur 100 000 sommets ; aucune fuite à la fermeture d'une scène (géométries, textures, cibles de rendu, écouteurs comptés par `debug.ts`).

## 8. Le protocole de QA

- Unitaire : tout `src/scene/mesh`, `transform`, `modifiers`, `operators`, `io`, `rig`, `document`, `keymap` est pur et testé avec vitest ; les opérateurs sont testés par comptage topologique (sommets, arêtes, faces, caractéristique d'Euler, manifold) et par positions sur des cas canoniques (cube, plan subdivisé, cylindre, monkey-like importé).
- `src/test/setup.ts` gagne un `ResizeObserver` factice et un `SceneViewport` injectable : `SceneEditorPage` reçoit une `createViewport` par défaut qui instancie three.js, les tests React passent une doublure qui enregistre les appels.
- Navigateur : Chrome headless GPU `127.0.0.1:9223` (`host.docker.internal:9223` depuis le conteneur), `chromium.connectOverCDP`, jamais `chromium.launch()`. Les scripts sont dans `e2e/`, préfixe `scene-`, exécutés par `docker compose run --rm app npm run e2e -- scene-`. `e2e/lib.mjs` gagne `helpers.newScene()`, `helpers.scene()` (document stocké), `helpers.project3d([x, y, z])` et `helpers.pick(x, y)` via `window.__paramrigScene` (exposé seulement en `import.meta.env.DEV`, avec `project`, `unproject`, `pick`, `stats`, `frame`, `setView`). Un `#main` focalisé avant toute touche. Modificateurs par `keyboard.down / up`. Zéro erreur console. 1440 px et 320 px, thèmes clair et sombre.
- Performance, mesurée par script : objet de 100 000 triangles en mode objet à 60 i/s en orbite ; maillage de 20 000 sommets en mode édition, déplacement d'un sommet à 60 i/s (16 ms moyen, 33 ms p95) ; prélèvement de survol sous 4 ms ; loop cut avec prévisualisation fluide sur 10 000 faces ; subdivision niveau 2 d'un cube de 500 faces sous 100 ms avec cache chaud.
- Captures de référence par état (vide, cube sélectionné, mode édition avec faces sélectionnées, modificateurs, 320 px, clair) dans `e2e/reference/scene/`.

## 9. Les contrôleurs sur une scène

Comme pour le vectoriel (`src/vector/rig.ts`), `SceneDocument.rig` porte `groups`, `parameters`, `inspectorCategories`, `bindings`. `SceneBinding = { id, objectId, property, parameterId, transform? }` où `property` est un chemin typé parmi :

- `transform.position.x|y|z`, `transform.rotation.x|y|z`, `transform.scale.x|y|z`, `transform.scale` (uniforme), `visible`
- `modifiers[id].<param>` (niveaux de subdivision, décompte d'array, épaisseur de solidify, largeur de bevel, angle de simple deform, facteur de displace…)
- `materials[id].baseColor|metallic|roughness|emission|emissionStrength|alpha|transmission`
- `lights[id].color|power|radius|spotAngle|spotBlur`, `cameras[id].focalLength|orthoScale`
- `shapeKeys[name].value` (phase 5 : la façon propre de déformer une géométrie par un contrôleur)
- `materials[id].nodes[nodeId].<setting>` (phase 5 : un réglage d'un nœud de shader)
- `mesh.vertices[id].x|y|z` (déformation directe, pour les petits rigs)
- `world.color|strength`, `cursor.position.x|y|z`

`resolveSceneValues(document, values)` est pure et mémoïsée ; le viewport, les vignettes, l'export et le mode Tune rendent le document résolu ; l'édition écrit dans le document brut. Un champ lié se montre « driven » (badge ◇ plein, menu Edit binding / Unbind / Go to control). Le bouton ◇ existe sur chaque champ exposable des propriétés et du sidebar N. En mode Tune, `SceneRigPreview` rend le même viewport en lecture seule (orbite libre, pas de sélection) branché sur `session.previewValues()`.

## 10. L'inventaire Blender, et où chaque chose tombe

Colonnes : fonctionnalité · touche Blender · prompt. « — » = hors périmètre, avec la raison.

**Navigation et vue**
- Orbite / pan / zoom (MMB, ⇧MMB, ⌃MMB, molette), turntable ou trackball · P1
- Vues pavé numérique 1/3/7 (+⌃ opposé), 5 ortho/persp, 0 caméra, `.` cadrer la sélection, Home tout, `/` vue locale, 2/4/6/8 pas de 15° · P1
- Gizmo de navigation cliquable, perspective automatique, zoom vers le curseur, orbite autour de la sélection · P1
- Quad view (⌃⌥Q) · P4
- Verrouiller la caméra sur la vue, « Align active camera to view » ⌃⌥0 · P3
- Vue depuis la caméra active avec passe-partout · P3

**Mode objet**
- Ajouter (⇧A) : plane, cube, circle, UV sphere, ico sphere, cylinder, cone, torus, grid ; empty ; light ×4 ; camera · P1 (le singe de Blender n'est pas repris : primitive « ParamRig mark » embarquée à la place)
- Sélection : clic, ⇧ étendre, boîte (B ou glisser), cercle (C), lasso (⌃ glisser), A / ⌥A / ⌃I, sélection par type / collection / pattern, ⇧G similaire · P1
- G / R / S, contraintes X Y Z, XX local, ⇧X exclusion, saisie numérique, ⌃ aimantation, ⇧ précision, clic droit / Esc annule, R R trackball · P1
- Gizmos Move / Rotate / Scale / Transform ; pivot (`.`) : bounding box center, 3D cursor, individual origins, median, active ; orientation (`,`) : global, local, normal, gimbal, view, cursor · P1
- Curseur 3D (⇧ clic droit, ⇧S menu snap, ⇧C reset) · P1
- ⇧D dupliquer, ⌥D dupliquer lié (données partagées), X / Delete, ⌃J joindre, P séparer (en édition), ⌃A appliquer (position, rotation, échelle, tout), ⌃P parenter / ⌥P détacher, M déplacer dans une collection, H / ⌥H / ⇧H, ⌃L lier données et matériaux, définir l'origine (géométrie, curseur, centre de masse), ⌃C / ⌃V copier-coller les objets · P1
- Collections : créer, imbriquer, exclure, masquer, instances de collection · P1
- Ombrage lisse / plat, auto smooth par angle · P2
- Snap pendant la transformation (incrément, sommet, arête, face, volume ; cible closest / center / median / active ; « project individual elements ») · P2
- Édition proportionnelle en mode objet · P2

**Mode édition**
- Tab, 1 / 2 / 3 avec ⇧ pour combiner, ⌃Tab camembert · P2
- Sélection : ⌥ clic boucle d'arêtes, ⌃⌥ clic anneau, ⌃ clic plus court chemin, L / ⇧L lié, ⌃L tout lié, ⌃+ / ⌃- plus / moins, boucle de bord, ⇧G similaire, aléatoire, checker, par trait (non manifold, loose, interior, by sides), tous / aucun / inverser, boîte / cercle / lasso, ⌃] / ⌃[ côté actif · P2
- Extrude : E région, ⌥E menu (along normals, individual, manifold, edges only, vertices only, repeat), extrude vers le curseur en ⌃ clic droit · P2
- I inset (épaisseur, profondeur, individual, even offset, relative, edge rail, outset) · P2
- ⌃B bevel arêtes / ⇧⌃B sommets (width, segments, profile, clamp overlap, affect, miter) · P2
- ⌃R loop cut (nombre, lissage, glissement), ⇧⌃R offset edge loop · P2
- K knife (⌃ milieu, ⇧ ignorer l'aimantation, Z couper à travers, C angle), ⇧K knife project, bisect (fill, clear inner / outer) · P2
- Subdivide (cuts, smoothness, quad / tri), un-subdivide, poke, triangulate ⌃T, tris to quads ⌥J · P2
- M fusionner (at center, cursor, collapse, first, last, by distance), ⌥M split, V rip, ⌥V rip fill, ⌃V vertex slide, G G edge slide, ⌥S shrink / fatten, ⇧⌃⌥S shear · P2
- F face / edge, ⌥F beauty fill, grid fill, bridge edge loops, ⌃E rotate edge, ⌃F face menu complet (solidify, wireframe, intersect knife, intersect boolean, weld edges into faces, split, separate) · P2
- X / Delete : vertices, edges, faces, only edges & faces, only faces, dissolve vertices / edges / faces, limited dissolve, edge collapse, edge loops · P2
- ⌃N normales, ⇧N recalculer intérieur, flip, set from faces, marquer sharp / seam, crease ⇧E, bevel weight ⌃⇧E · P2
- Smooth vertices, randomize, symmetrize, snap to symmetry, mirror ⌃M, O édition proportionnelle avec falloff et connectés seulement · P2
- Spin (⌥R dans l'outil), screw · P2
- Convex hull, decimate, fill holes, degenerate dissolve, merge by distance, make planar faces, split non-planar · P2
- Séparer (selection, by material, by loose parts) · P2
- Statistiques et overlays d'édition (normales, orientation des faces, indices, poids de crease) · P2

**Modificateurs** (P3) : Subdivision surface (Catmull-Clark, simple, creases), Mirror (axes, bisect, merge, clipping, mirror object), Array (count, fit length, relative / constant offset, merge, object offset), Solidify (épaisseur, offset, even, rim), Bevel, Boolean (union / difference / intersect, objet ou collection), Decimate, Screw, Triangulate, Weld, Wireframe, Smooth, Simple deform (twist, bend, taper, stretch), Cast, Edge split, Displace (texture procédurale ou image, strength, midlevel). Apply, dupliquer, ordre, activation viewport / edit / on cage, copier vers la sélection. Hors périmètre : lattice, shrinkwrap, geometry nodes, particules, cloth, fluid, ocean, remesh voxel (P5 pour remesh).

**Matériaux, lumières, caméras, rendu** (P3) : slots de matériaux, assignation par face, Principled subset, textures depuis les ressources, world (couleur, HDRI depuis ressource, force), quatre ombrages (wireframe, solid avec studio light / matcap / flat et options cavité, outline, couleur objet / matériau / aléatoire / attribut ; material preview avec environnement ; rendered avec les lumières et le monde), X-ray ⌥Z, overlays complets, lumières avec ombres, caméra avec focale et profondeur de champ indicative, export d'image PNG à la résolution de la caméra (F12) et export glTF / OBJ / STL, import glTF / OBJ / STL. Hors périmètre : Cycles, EEVEE tels quels, compositor. Les nœuds de shader arrivent en horizon (P5, chantier U).

**Rigs et finitions** (P4) : liaisons et mode Tune, ◇ partout, documentation `/docs/scene-rigs`, exemple embarqué, vignettes, palette F3, camemberts, préférences (émulation 3 boutons, pavé numérique, clic droit pour sélectionner, thème de sélection), quad view, mobile, accessibilité (clavier, `aria-live`, contraste), performance mesurée, cohérence des panneaux.

**Horizon** (P5) : édition UV (seams, unwrap LSCM et angle-based, projection cube / cylinder / sphere / from view, éditeur UV 2D, pack, pin, live unwrap), mode Sculpt (draw, clay, smooth, grab, inflate, flatten, crease, pinch, mask, symétrie, dyntopo non : remesh voxel à la place), shape keys et animation sur la `Timeline` ParamRig, objets courbe et texte (Bézier, extrude / bevel vers maillage, texte par `opentype.js` déjà présent), peinture de sommets, éditeur de shader à nœuds (moteur de Prismorphic, `NodeGraphEditor` générique, « Use nodes » par matériau, liaisons de rig sur les réglages des nœuds, glTF avec le Principled équivalent). Hors périmètre définitif : armatures et skinning, grease pencil, VSE, physique, Python, rendu Cycles, geometry nodes, texture painting (revisitable).

## 11. Les cinq prompts

1. **Fondations** (`docs/scene-editor-roadmap-prompt.md`) : extraction `src/editor/`, modèle et stockage, bibliothèque et routage, viewport et navigation, mode objet complet, transformations modales et gizmos, outliner, propriétés objet, sidebar N, registre d'opérateurs et panneau F9, historique, fichiers, harnais e2e 3D.
2. **Le mode édition** (`-2-`) : `EditMesh`, trois modes de sélection et toutes les sélections, extrude, inset, bevel, loop cut, knife, subdivide, merge, dissolve, delete, fill, bridge, slide, normales, édition proportionnelle, aimantation, symétrie, overlays d'édition.
3. **Modificateurs, matériaux, éclairage, ombrage, fichiers** (`-3-`) : pile de modificateurs, matériaux et slots, monde, lumières, caméras, quatre ombrages, overlays, rendu d'image, import / export.
4. **Contrôleurs, finitions et mobile** (`-4-`) : rig et liaisons, Tune, documentation, exemple, palette et camemberts, préférences, accessibilité, mobile, performance, rangement.
5. **Horizon** (`-5-`) : UV, sculpt, shape keys et animation, courbes et texte, peinture de sommets, éditeur de shader.

Chaque prompt est autonome, indique l'état de départ à vérifier, ses chantiers dans l'ordre, ses tests et ses scripts e2e, et exige un bilan honnête : fait et vérifié, partiel, laissé de côté et pourquoi.
