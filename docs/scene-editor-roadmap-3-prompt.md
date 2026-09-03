# Prompt 3 : modificateurs, matériaux, lumières, caméras, ombrage, fichiers

> Document autonome : un agent qui démarre sans contexte doit pouvoir l'exécuter de bout en bout. Le plan maître est `docs/scene-editor-plan.md` ; les prompts 1 et 2 (`docs/scene-editor-roadmap-prompt.md`, `-2-`) ont été livrés : leurs règles, leur protocole de QA et leur architecture s'appliquent ici intégralement. L'état de référence est le code.

Dépôt : `/Users/soheil/Documents/repos/paramrig`, branche `main`, éditeur de scène dans `src/scene/`, servi sur `http://localhost:5174`. Ce prompt donne à la scène ce qui l'habille : la pile de modificateurs, les matériaux, le monde, les lumières, les caméras, les quatre modes d'ombrage et leurs overlays, le rendu d'image, l'import et l'export. Même exigence : rien de décoratif, un commit par sous-chantier, `typecheck`, `lint`, `test`, `e2e -- scene-` et `git diff --check` avant chaque commit, bilan honnête.

## 0. État de départ (à vérifier, pas à supposer)

- Modes objet et édition complets, opérateurs dans `src/scene/operators/`, `EditMesh` et `mesh/normals.ts`, `three-mesh-bvh` et `three-bvh-csg` installés, booléens dans `operators/boolean.ts`, `meshView` avec mise à jour incrémentale, ombrage « solid » provisoire, `Material` / `LightData` / `CameraData` dans les types mais sans panneau ni rendu complet, `Modifier[]` sur les objets sans évaluation.
- Toute nouvelle propriété passe par la sanitisation, le fichier projet, le presse-papiers ; tout nouvel opérateur par le registre.

## Chantier H · La pile de modificateurs

### H1 · Évaluation
- `src/scene/modifiers/stack.ts` : `evaluateObject(document, object) → EvaluatedMesh` applique la pile dans l'ordre sur un `EditMesh` cloné, en sautant les modificateurs désactivés pour le viewport ; cache par empreinte (`fingerprint` du maillage + JSON des paramètres + empreintes des objets d'entrée) avec LRU ; en mode édition, `onCage` décide si la cage montrée est la sortie d'un modificateur ; `editMode` décide s'il s'applique pendant l'édition. Le viewport rend le résultat évalué et, en édition, la cage par-dessus. Un modificateur en erreur (entrée manquante) est marqué rouge, ignoré, et le message est dans le panneau.
- Chaque modificateur est un module pur `{ kind, label, defaults, schema, apply(mesh, params, inputs) }` dans `src/scene/modifiers/` ; les paramètres partagent le `ParamSchema` des opérateurs, donc le panneau se génère.

### H2 · Les modificateurs
- **Subdivision surface** (`subsurf.ts`) : Catmull-Clark avec creases (attribut d'arête), levels viewport / render (1 à 6, borné par le nombre de faces résultantes : 2 M), « simple », « optimal display » (ne montre que les arêtes d'origine), boundary smooth (all / keep corners), UV smooth (prompt 5). Cache par niveau (le niveau 2 réutilise le 1).
- **Mirror** (`mirror.ts`) : axes X / Y / Z, bisect et flip par axe, mirror object, clipping (les sommets ne traversent pas le plan pendant la transformation : branché dans `transform/session.ts`), merge distance, mirror U / V.
- **Array** (`array.ts`) : fit type (fixed count, fit length, fit curve réservé), relative offset, constant offset, object offset (transformation d'un objet), merge (first / last, distance), start / end caps (objets).
- **Solidify** (`solidify.ts`) : thickness, offset, even thickness, rim (fill, only rim), flip normals, material offset, crease.
- **Bevel** (`bevel.ts`) : réutilise `operators/bevel.ts` par angle limite ou poids d'arête, width, segments, profile, limit method (none, angle, weight, vertex group réservé), clamp overlap, harden normals.
- **Boolean** (`boolean.ts`) : union / difference / intersect, objet ou collection, solver « fast » (three-bvh-csg) ; l'objet opérande peut être caché ; approximation dite.
- **Decimate** : collapse (ratio, symétrie, triangulate), planar (angle limit), un-subdivide (iterations).
- **Screw** : angle, screw, iterations, axis, axis object, steps viewport / render, merge, smooth shading, calculate order.
- **Triangulate**, **Weld** (distance, mode all / connected), **Wireframe** (thickness, even, relative, boundary, replace original, material offset), **Smooth** (factor, repeat, axes), **Simple deform** (twist, bend, taper, stretch ; angle ou factor, axis, origin object, limits), **Cast** (sphere, cylinder, cuboid ; factor, radius, size, axes), **Edge split** (angle, sharp edges), **Displace** (direction X / Y / Z / normal / RGB to XYZ, strength, midlevel, texture procédurale : noise / clouds / voronoi / wood-like implémentées en `src/scene/textures/procedural.ts`, ou image d'une ressource par UV ou projection locale / global).
- Tests : chaque modificateur sur un cas canonique (subsurf niveau 1 d'un cube : 26 sommets, 24 faces quads, positions du point central d'une face ; niveau 2 comptes ; crease 1 conserve l'arête ; mirror + merge d'un demi-cube = cube fermé ; array 3 avec merge = comptes ; solidify d'un plan = boîte fermée ; boolean modifier entre cubes ; screw d'un profil ; simple deform twist 90° positions), cache (deuxième évaluation sans appel à `apply`), invalidation quand un objet d'entrée bouge.

### H3 · Le panneau Modifiers
- Onglet **Modifiers** des propriétés : bouton « Add modifier » (menu par catégories Modify / Generate / Deform), liste de panneaux repliables, chacun avec icône, nom éditable, boutons edit mode / on cage / viewport / render, menu ⋯ (Apply, Apply as shape key réservé, Duplicate, Copy to selected, Move to first / last), poignée de glisser pour réordonner, ⌃X supprime ; les paramètres par `ParameterField` ; « Apply » (⌃A dans le panneau) écrit le résultat dans le maillage et retire le modificateur. Les objets d'entrée se choisissent par un `SelectField` listant les objets compatibles, avec pipette (clic dans le viewport ou l'outliner).
- L'outliner liste les modificateurs sous l'objet ; le raccourci ⌃1 à ⌃5 en mode objet met le niveau de subdivision (ajoute le modificateur s'il manque), comme Blender.
- Statistiques et vignettes utilisent le maillage évalué.
- Tests React : ajout, réordonnancement, activation, apply ; e2e `scene-modifiers` : ⌃2 sur le cube, mirror avec clipping en édition (le sommet ne passe pas), array de 3 dans une capture, apply puis comptes dans le document.

## Chantier I · Matériaux et monde

- `Material` : name, base color, metallic, roughness, specular IOR level, IOR, transmission, emission color + strength, alpha, blend mode (opaque / clip / blend), backface culling, normal map (ressource, strength), textures par ressource pour base color, roughness, metallic, emission, alpha (`src/state/resources.ts`, images du projet ou data URL, `Texture.dispose` avec `image` annulée), mapping (UV quand elles existent, sinon box projection triplanaire côté three via un matériau personnalisé léger). Rendu en `MeshPhysicalMaterial` mis en cache par empreinte du matériau ; un matériau partagé entre objets n'est instancié qu'une fois.
- Slots : `materialSlots` par objet, attribut face `material` ; onglet **Material** des propriétés : liste des slots (+ / −, réordonner), matériau du slot (`SelectField` des matériaux du document, « New », dupliquer, renommer, « users » compteur, supprimer un matériau orphelin), en mode édition les boutons Assign / Select / Deselect, puis les champs du matériau en sections (Surface, Emission, Transparency, Settings), avec pastille d'aperçu (sphère rendue par le viewport hors écran, 64 px, mise à jour débouncée). Les onglets **Assets** du rail gauche listent les matériaux avec la même pastille, glisser sur un objet dans le viewport l'assigne (au slot actif ou à la face survolée avec ⇧).
- Couleur d'objet (`Object > Viewport display > Color`) et couleur de matériau pour l'ombrage solid.
- **World** : couleur de fond (avec la grille et le brouillard réglable), environnement HDRI depuis une ressource (PMREM, force, rotation), « use for lighting » et « visible as background » séparés ; en material preview un environnement de studio intégré (RoomEnvironment de three) est utilisé quand le monde n'en a pas.
- Tests : sanitisation des matériaux et slots (indices bornés), assign / select par matériau, empreinte et cache, suppression d'un matériau qui réinitialise les faces à 0 ; e2e `scene-materials` : nouveau matériau rouge, assign à la face du dessus en édition, ombrage material preview, capture, HDRI depuis une ressource.

## Chantier J · Lumières et caméras

- Lumières : `point` (color, power W, radius, shadow), `sun` (strength, angle, shadow avec cascade simple), `spot` (spot size, blend, show cone), `area` (shape square / rectangle / disk / ellipse, size, power). Onglet **Data** pour une lumière ; glyphes dans l'overlay avec poignées (rayon du spot, taille de l'area) glissables ; ombres au rendu « rendered » (`PCFSoft`, résolution 2048, bornée à 4 lumières projetant à la fois, préférence).
- Caméras : `perspective` (focal length mm ou FOV, sensor width, shift X / Y, clip start / end), `orthographic` (ortho scale), profondeur de champ indicative (focus object ou distance, f-stop ; affichée par un flou de post-traitement léger en rendered, désactivable), « Camera to view » ⌃⌥0, `0` entre dans la vue caméra avec passe-partout (opacité réglable) et cadre du capteur, « Lock camera to view » (sidebar N > View) qui fait suivre la caméra à la navigation, une seule caméra active (Scene > Camera), résolution de rendu dans Scene > Output (largeur, hauteur, pourcentage, transparence).
- Overlays des objets : relationship lines (parent, contraintes réservées), extras (glyphes), motion paths réservé, bones réservé.
- Tests : conversion focale ↔ FOV avec le capteur, matrices ortho, sanitisation ; e2e `scene-lights-cameras` : ajouter un spot, régler l'angle par la poignée (document mis à jour), `0` vue caméra avec passe-partout en capture, ⌃⌥0.

## Chantier K · Ombrage et overlays

- `src/scene/viewport/shading.ts` : quatre modes, camembert Z et boutons de l'en-tête :
  - **Wireframe** : arêtes de tous les objets (ou seulement sélectionnés), couleur par objet / aléatoire / thème, X-ray par défaut, « wireframe threshold » (pour cacher les arêtes coplanaires).
  - **Solid** : lighting studio (trois lumières fixes à la caméra avec « world space lighting » toggle), matcap (six matcaps embarqués en PNG 512 px, générés par un script du dépôt ou CC0 avec attribution dans `public/matcaps/README.md`, pas de dépendance réseau ; menu à vignettes ; « flip »), flat ; color : material / object / attribute / single / random / texture ; background : theme / world / viewport ; options : backface culling, X-ray (alpha), shadow (une ombre douce depuis la lumière de studio), cavity (screen space ridge / valley, via profondeur et normales en post-traitement léger), depth of field non, outline (contour des objets, épaisseur), specular lighting.
  - **Material preview** : `MeshPhysicalMaterial` avec l'environnement de studio ou celui du monde, lumières de scène désactivées, background world ou viewport, « render pass » non.
  - **Rendered** : lumières de scène avec ombres, monde, matériaux, tonemapping ACES avec exposition et gamma dans Scene > Color management, brouillard du monde. C'est aussi ce qui rend l'image finale.
- **Overlays** (menu et bouton, ⇧⌥Z) : grille et axes (échelle, subdivisions), floor, text info, statistics, 3D cursor, annotations, outline selected, object origins (all), extras, relationship lines, bones réservé, motion tracking non ; wireframe (opacité, threshold), face orientation ; en édition les overlays du prompt 2.
- **Gizmos** menu : navigate, active tools, active object (move, rotate, scale), light, camera, empty ; opacité ; taille.
- Le viewport garde la profondeur cohérente entre les passes (objets, overlays avec `polygonOffset`, contour), le tout rendu à la demande ; `invalidateCount` stable au repos dans chaque mode (mesuré). Performance : matcap et studio sur 100 000 triangles à 60 i/s ; rendered avec 4 lumières et ombres à 30 i/s minimum, mesuré.
- Tests : la partie pure (sélection du mode, options, tonemapping en fonction) ; e2e `scene-shading` : les quatre modes en capture (clair et sombre), matcap, cavity, X-ray, overlays face orientation, `invalidateCount` stable.

## Chantier L · Rendu d'image, import, export

- **Render image** F12 (`src/scene/io/render.ts`) : rendu hors écran à la résolution de Scene > Output depuis la caméra active en mode rendered (ou le mode courant, option), transparence, tonemapping, PNG téléchargé ou enregistré par File System Access, aperçu dans un dialogue `EditorModal` avec zoom et « Save » ; « Render viewport » (⇧F12 non, bouton) rend la vue courante. Progression et annulation pour les grandes tailles (tuiles de 1024 px).
- **Export** (`SceneExportMenu.tsx`, menu Export de l'en-tête) : glTF / GLB (`GLTFExporter` de three, sur le maillage évalué ou la cage au choix, matériaux, lumières, caméras, hiérarchie, « selection only », « apply modifiers »), OBJ + MTL (n-gones conservés, normales, UV si présentes, matériaux), STL (binaire, évalué), fichier projet. Les booléens d'export sont rappelés par document.
- **Import** (menu File > Import et dépôt de fichier sur le viewport) : glTF / GLB (`GLTFLoader`, `DRACOLoader` non chargé sans besoin, hiérarchie → objets, matériaux → `Material`, triangles → « tris to quads » optionnel à l'import, textures → ressources), OBJ (n-gones, groupes → objets, matériaux MTL), STL (soudure par distance à l'import). L'objet importé est placé au curseur, sélectionné et actif ; les gros fichiers passent par un `Worker` pour le parsing.
- Vignette de bibliothèque : rendu par le viewport hors écran en solid studio, 256 px, remplaçant la vignette isométrique provisoire.
- Tests : round-trip OBJ d'un cube et d'un n-gone (topologie identique), STL binaire (comptes), glTF d'un cube avec matériau (relu par `GLTFLoader` sous jsdom : au moins la structure JSON) ; e2e `scene-io` : F12 sur la scène de démarrage produit un PNG de la bonne taille (lu via `captureExport`), export GLB et ré-import dans une scène neuve (comptes identiques), import OBJ déposé.

## Finition exigée pour ce prompt, vérifiée avant livraison

- Panneaux de modificateurs : réordonner par glisser avec fantôme et indicateur, plier / déplier mémorisé, aperçu vivant pendant le scrub d'un paramètre (une entrée d'historique par geste), état d'erreur écrit dans le panneau, « Apply » confirmé par la barre d'état.
- Matériaux : pastille d'aperçu sur chaque matériau, glisser sur un objet avec indicateur de dépôt et surbrillance de la face visée, « Assign » visible seulement en édition, couleur du solid qui suit le matériau sans changer d'ombrage.
- Ombrage : la bascule entre les quatre modes se fait sous 100 ms sans image noire ni flash ; les vignettes de matcap se lisent ; la cavité ne scintille pas en orbite ; X-ray sans z-fighting ; `invalidateCount` stable dans chaque mode.
- Lumières et caméras : poignées à 32 px et occultées, glyphes lisibles dans les deux thèmes, entrée en vue caméra animée, passe-partout doux, « Lock camera to view » sans saut.
- Fichiers : dépôt avec zone de dépôt surlignée, progression et annulation pour les gros fichiers (worker), nom de fichier proposé à l'export, rendu F12 avec progression, aperçu et sauvegarde.
- Contraste de la sélection vérifié sur les quatre ombrages et les deux thèmes, à 3:1.

## Livraison

1. Un commit par sous-chantier (H1 à H3, I, J, K, L), messages qui décrivent le comportement.
2. Tests unitaires pour chaque modificateur, matériau, conversion et format ; tests React pour les panneaux ; e2e exécutés, sortie réelle, captures des quatre ombrages.
3. Le tableau de performance (solid, matcap, rendered à 100 000 triangles ; subsurf niveau 2 sur 500 faces sous 100 ms avec cache chaud).
4. Un bilan honnête : fait et vérifié, partiel, laissé de côté et pourquoi, avec les limites de chaque approximation (booléen triangulé, décimation, profondeur de champ indicative, ombres bornées).
