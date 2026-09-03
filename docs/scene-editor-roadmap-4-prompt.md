# Prompt 4 : les contrôleurs sur une scène, les finitions, le mobile

> Document autonome : un agent qui démarre sans contexte doit pouvoir l'exécuter de bout en bout. Le plan maître est `docs/scene-editor-plan.md` ; les prompts 1 à 3 (`docs/scene-editor-roadmap-prompt.md`, `-2-`, `-3-`) ont été livrés : leurs règles, leur protocole de QA et leur architecture s'appliquent ici intégralement. L'état de référence est le code. Le prompt 4 du vectoriel (`docs/vector-editor-roadmap-4-prompt.md`, chantier N) et `src/vector/rig.ts` sont le modèle exact de ce que ce prompt fait pour la scène.

Dépôt : `/Users/soheil/Documents/repos/paramrig`, branche `main`, éditeur de scène dans `src/scene/`, servi sur `http://localhost:5174`. Ce prompt fait d'un document de scène un rig comme les autres, puis finit l'éditeur : palette, camemberts, préférences, accessibilité, mobile, performance, cohérence. Même exigence : un commit par sous-chantier, `typecheck`, `lint`, `test`, `e2e -- scene-` et `git diff --check` avant chaque commit, bilan honnête.

## 0. État de départ (à vérifier, pas à supposer)

- L'éditeur de scène complet en modes objet et édition, modificateurs, matériaux, lumières, caméras, ombrages, import / export. `sceneManifest` produit `parameters: []`. `WorkspacePage` branche `scene` vers `SceneEditorPage` ; `RigPreview` affiche un `StatusMessage` pour `scene` en mode Tune. `src/vector/rig.ts` : `VectorBinding`, `parseBindableProperty`, `resolveRigValues` mémoïsée, `applyBinding`, `currentValue`, `parameterForProperty` ; `src/vector/VectorControls.tsx`, `exposeContext.ts`, le bouton ◇ et son popover ; `src/renderers/vector/VectorRigPreview.tsx` ; `src/docs/VectorRigsPage.tsx` ; `src/rigs/examples/aperture-mark.ts` (`BUNDLED_DOCUMENTS`).
- Prends des captures de l'état de départ (1440 px : vide, cube sélectionné, mode édition, onglet Modifiers ; 320 px) dans `e2e/reference/scene/before/` ; le bilan les compare aux captures finales.

## Chantier M · Le rig d'une scène

### M1 · Modèle
- `SceneDocument.rig?: { groups: ParamGroup[]; parameters: ParameterDef[]; inspectorCategories?: InspectorCategory[]; bindings: SceneBinding[] }` avec les types de `src/rigs/types.ts` et `src/rigs/extended-types.ts`, sans duplication. `SceneBinding = { id, objectId?, materialId?, property, parameterId, transform?: BindingTransform }` où `property` est un chemin typé parmi ceux de la section 9 du plan : `transform.position.x|y|z`, `transform.rotation.x|y|z`, `transform.scale.x|y|z`, `transform.scale`, `visible`, `modifiers[id].<param>`, `materials[id].baseColor|metallic|roughness|emission|emissionStrength|alpha|transmission`, `light.color|power|radius|spotAngle|spotBlend`, `camera.focalLength|orthoScale`, `mesh.vertices[id].x|y|z`, `world.color|strength`, `cursor.position.x|y|z`, et `shapeKeys[name].value` réservé au prompt 5 (refusé tant qu'il n'existe pas). `parseSceneProperty` refuse un chemin inconnu, jamais deviné. `BindingTransform` identique au vectoriel, évalué par `src/state/expression.ts`.
- Correspondance paramètre → propriété : `number` → numérique, `color` → couleur, `switch` → booléen, `select` → option (par exemple le type de falloff d'un modificateur), `vector` → position / rotation / échelle (trois composantes), `gizmo3d` (`Gizmo3DValue`) → transform complet d'un objet, `camera` (`CameraValue`) → caméra, `text` → nom. Une propriété peut recevoir plusieurs liaisons (la dernière gagne), un paramètre peut piloter plusieurs propriétés.
- Sanitisation (paramètres par la validation des manifestes, liaisons vers des objets, matériaux, modificateurs et sommets existants), presse-papiers (une copie d'objet emporte ses liaisons si le paramètre existe dans le document cible), fichier projet, export glTF du document résolu.

### M2 · Résolution
- `src/scene/rig.ts` : `resolveSceneValues(document, values)` pure, mémoïsée sur la dernière empreinte, renvoie le document à rendre. Le viewport, les vignettes, le rendu d'image, l'export et le mode Tune rendent le document résolu ; l'édition écrit dans le document brut. Un champ lié se montre « driven » : valeur résolue en lecture, badge ◇ plein, menu ⋯ (Edit binding, Unbind, Go to control). Le cache des modificateurs et des matériaux est indexé par l'empreinte résolue, donc un contrôleur qui bouge une valeur ne réévalue que ce qui en dépend.
- `sceneManifest` expose `groups`, `parameters`, `inspectorCategories` du rig. `WorkspacePage` : un document de scène **sans** `rig` ouvre l'éditeur ; **avec** `rig`, l'éditeur par défaut, et le mode Tune rend `WorkspaceShell` avec `Inspector` et `src/renderers/scene/SceneRigPreview.tsx` (branché dans `RigPreview.tsx`, chargé par `lazy`, dans `RendererErrorBoundary`) : le même `SceneViewport` en lecture seule (orbite, zoom, cadrage, ombrage mémorisé, pas de sélection ni de gizmo), branché sur `session.previewValues()` et sur `session.previewNumber()` dans la boucle de lecture d'animation. Le viewport est monté une fois et déplacé entre Edit et Tune (`appendChild`, `display: contents`), jamais remonté ; mesure : zéro contexte WebGL recréé à la bascule (compteur dans `debug.ts`).
- La `RigSession` (snapshots, historique, pistes, macros, expressions) fonctionne sans modification.

### M3 · Interface
- ◇ sur chaque champ exposable : onglets Object, Modifiers, Material, Data (lumière, caméra), World, Scene (curseur), sidebar N > Item, et en mode édition sur la position d'un sommet unique. Popover « Expose as control » : nom prérempli (« Cube · Subdivision levels »), genre déduit, groupe (`SelectField` + « New group »), min / max / step pour les nombres (déduits du schéma de l'opérateur ou du modificateur), puis « Expose ». Un ◇ plein ouvre le menu de la liaison. Une propriété vectorielle propose « as three numbers » ou « as vector ».
- Onglet **Controls** des propriétés : `Inspector` du workbench réutilisé, branché sur une `RigSession` du document (persistance de valeurs `src/state/persistence.ts`), interrupteur **Edit / Tune** en tête (Tune : viewport en lecture seule, gizmos et outils masqués, contrôleurs seuls actifs), « Add control » (paramètre sans liaison), menu ⋯ par paramètre (Rename, Move to group, Bindings…, Delete). Glisser un paramètre sur un champ crée la liaison ; glisser sur un objet du viewport ouvre le choix de la propriété.
- En mode Tune sur `/r/:id`, l'inspecteur du workbench affiche Controls, Snapshots, History, Bindings, plus « Edit » ; mode mémorisé par document. La bibliothèque (`LibraryPage`, branche `renderer === 'scene'`) montre la vignette rendue avec les valeurs par défaut.
- Le `gizmo3d` du catalogue (`Gizmo3DController`) pilote un objet lié : la valeur est un transform, le contrôleur l'affiche dans sa propre scène miniature (existant) ; un bouton « Edit in viewport » sélectionne l'objet et lance le gizmo du viewport.

### M4 · Pour l'IA qui construit un rig
- Page `/docs/scene-rigs` (`src/docs/SceneRigsPage.tsx`, routée dans `App.tsx`, liée depuis `DocsPage`) : le format de projet, le schéma de `rig.parameters` et `rig.bindings` avec toutes les propriétés liables (tabulées depuis `parseSceneProperty`, donc jamais en décalage), un exemple complet (un objet dont la subdivision, l'épaisseur de solidify, la couleur du matériau et la rotation sont exposées), les contraintes (ids stables, min / max, groupes, unités), et les approximations connues.
- Un exemple embarqué dans `src/rigs/examples/` (`BUNDLED_SCENES`, servi par `listSceneDocuments` / `getSceneDocument` tant qu'il n'est pas édité, rangé dans `Examples/Scene`), listé dans la bibliothèque avec sa vignette.
- Import : déposer un `.paramrig.json` de scène contenant `rig` crée le document et son rig d'un coup ; `importProject` valide les liaisons et rapporte les erreurs dans un `StatusMessage`.
- Tests : résolution pour chaque genre de paramètre et chaque famille de chemins, transformation avec expression, sanitisation des liaisons orphelines, manifeste dérivé, rendu de `SceneRigPreview` avec des valeurs de session (viewport doublé), cache des modificateurs sous un contrôleur ; e2e `scene-rig` : exposer le niveau de subdivision, le régler dans Controls, voir les comptes changer dans `stats()`, basculer en Tune, prendre un snapshot dans le workbench, revenir, aucun contexte WebGL recréé.

## Chantier N · Palette, camemberts, favoris, préférences

- Palette F3 / ⌘/ : toutes les commandes du registre, sections Blender (Object, Mesh, Vertex, Edge, Face, Select, View, Add, File), recherche floue, raccourci affiché, exécution au clavier, dernier choix en tête.
- Camemberts : Z (ombrage), ⇧S (curseur), `.` (pivot), `,` (orientation), ⌃Tab (mode), `~` (vues) ; Overlays et Gizmos restent des menus. Chaque camembert a des positions stables, le relâchement de la touche sur une entrée l'active, navigation aux flèches et chiffres.
- **Quick favorites** Q : menu contextuel « Add to quick favorites » sur toute entrée de menu ou d'opérateur, menu Q au curseur, mémorisé dans les préférences.
- Préférences (`src/scene/prefs.ts`, dialogue Edit > Preferences en `EditorModal`, mémorisé dans `paramrig.scene-prefs.v1`) : Navigation (orbit method turntable / trackball, orbit around selection, auto perspective, zoom to mouse, smooth view ms, émulation 3 boutons, émulation pavé), Input (select with left / right, invert zoom wheel, trackpad natural), Editing (undo steps, cancel removes extrusion, auto merge default), Interface (resolution scale, tooltips delay, pie animation), Themes (selection preset : ParamRig / Blender classic orange / high contrast ; matcap par défaut), Keymap (table `describeKeymap()` en lecture avec recherche, et « emulate numpad », « spacebar action : play / tools / search »).
- `docs/scene-editor-keymap.md` régénéré et complété.
- Tests : palette sur le registre, favoris persistés, préférences sanitisées et appliquées (keymap résolu avec émulation), camembert navigable au clavier ; e2e `scene-menus` : Z relâché sur Wireframe, ⇧S cursor to selected, Q favori, préférence trackball.

## Chantier O · Accessibilité, mobile, performance, cohérence

### O1 · Clavier et lecteur d'écran
- Parcours complet au clavier : en-tête (`role="toolbar"`, roving tabindex), barre T, sidebar N, outliner (flèches, Enter renomme, Espace sélectionne, ⇧ étend), propriétés, palette, camemberts ; aucun piège de focus ; Escape ferme toujours le dernier calque ouvert.
- Zone `aria-live="polite"` du viewport : sélection (« Cube, 8 vertices, at 0, 0, 0 »), mode, mode de sélection, outil, opérateur exécuté, entrées d'historique ; débouncée à 300 ms.
- Chaque objet est atteignable au clavier via l'outliner ; déplacer, tourner, mettre à l'échelle par G / R / S puis flèches (1 unité, ⇧ 0,1, ⌃ 10) sans souris ; les vues par touches ; les opérateurs par palette.
- Contraste vérifié en clair et sombre sur le contour de sélection, les sommets, les arêtes, les faces, le curseur 3D, les gizmos, les HUD ; `prefers-reduced-motion` coupe les transitions de vue et les animations de camembert ; `forced-colors` garde le chrome cohérent (le viewport reste tel quel).

### O2 · Mobile (320 px et tactile)
- Dock Objects / Viewport / Properties ; barre T en rangée en bas du viewport (défilement horizontal, 44 px), sidebar N en feuille, en-tête en deux lignes (mode et menus, puis ombrage et overlays), panneau F9 en feuille.
- Tactile : un doigt orbite (turntable), deux doigts pan, pincement zoom, appui long menu contextuel, tap sélectionne, tap sur un gizmo puis glisser transforme ; en édition les cibles de sommets et d'arêtes passent à 44 px (rayon de prélèvement 22 px), boîte de sélection par l'outil ; Tab, 1 / 2 / 3, G / R / S et X ont des boutons dans une barre d'édition (« Mode », « Select mode », « Move », « Rotate », « Scale », « Extrude », « Delete », « More… »).
- Performance mobile : `dpr` borné à 1,5, ombres coupées en pointeur grossier par défaut, mesure sur le Chrome de test en 375 × 812 avec émulation tactile.

### O3 · Performance
- Cibles mesurées par `e2e/scene-reference.e2e.mjs` : orbite à 100 000 triangles 16 ms moyen / 33 ms p95 dans chaque ombrage ; G sur 100 sommets d'un maillage de 20 000 sommets 16 / 33 ms ; survol sous 4 ms ; Tab sur 100 000 sommets sous 300 ms ; subsurf niveau 2 sur 500 faces sous 100 ms à cache chaud ; bascule Edit / Tune sans contexte WebGL neuf ; `invalidateCount` stable au repos ; mémoire de l'historique sous 200 Mo pour 100 pas sur 100 000 sommets.
- Profil avant / après avec le `Profiler` CDP sur une orbite et un déplacement de sommets ; les cinq fonctions les plus chères dans le bilan, et ce qui a été fait pour chacune.

### O4 · Cohérence
- Passer chaque contrôle, opérateur et geste au crible de la section 7 du plan (définition de « fini ») : un tableau dans le bilan liste chaque règle avec sa preuve ; ce qui n'est pas prouvé est dit.
- Passer chaque panneau, popover, dialogue, camembert et chip au crible des principes du prompt 4 vectoriel (section 1) : une seule échelle d'espacement, un seul en-tête de section, aucun libellé dupliqué, états vides écrits (« No modifiers. Add one with Add modifier »), aucun bouton pleine largeur hors formulaires, un mot pour une chose (Object, Mesh, Modifier, Material, Light, Camera, Controls).
- Curseurs dédiés (knife, cursor, measure, bevel, loop cut, pan, orbite, zoom) en SVG data-URI dans `scene.css`, et le curseur dessiné des sessions en Pointer Lock.
- Tune : le viewport n'est pas figé, l'orbite reste libre, un contrôleur qui bouge se voit dans la frame suivante ; la bascule Edit / Tune ne perd ni la vue ni la sélection.
- Infobulles avec raccourci sur tous les boutons de l'en-tête, de la barre T, des propriétés et du gizmo de navigation ; infobulles après 400 ms, disparaissent à la première geste.
- Captures finales dans `e2e/reference/scene/after/` aux mêmes états que celles du départ, et un tableau dans le bilan : contrôles visibles dans l'en-tête, sections dépliées par onglet, hauteur de l'onglet Object pour un cube, i/s par ombrage, avant et après.

## Livraison

1. Un commit par sous-chantier (M1 à M4, N, O1 à O4), messages qui décrivent le comportement.
2. Tests unitaires pour `rig.ts`, la sanitisation, les préférences, le keymap ; tests React pour les panneaux par contexte, le ◇ et le popover ; `renderHook` pour les transactions ; e2e pour le rig, les menus, le mobile, la performance.
3. Captures avant et après, tableau de mesures, profil.
4. Un bilan honnête : fait et vérifié, partiel, laissé de côté et pourquoi.
