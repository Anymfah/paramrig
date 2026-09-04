# Prompt 5 · Les UV, le sculpt, les clés, les courbes, la peinture et les nœuds

Ce que ce prompt demandait : l'éditeur UV et le dépliage (chantier P), le mode sculpt (Q), les
clés de forme et l'animation (R), les courbes et le texte (S), la peinture de sommets (T), et
l'éditeur de shader repris de Prismorphic (U1 à U3). Un commit par sous-chantier.

Tout ce qui suit a été mesuré sur cette machine, le 4 septembre 2026, avec le Chrome de test en
mode headless GPU. Quatre piles de développement Docker tournaient à côté pendant la session
(`helios`, `prismorphic`, `stellary-ci`, `paramrig`) ; cela se voit dans les chiffres, et la
section des mesures dit de combien.

## Ce qui est fait et vérifié

| Sous-chantier | Livré | Preuve |
| --- | --- | --- |
| P1 · Le domaine des coins | `attributes.loop.uvMaps`, plusieurs cartes par maillage, les coutures, la texture qui atterrit où elle doit | `mesh/uv.test.ts`, `uv/geometry.test.ts`, `scene-uv` |
| P2 · Le second espace | `SceneUVEditor` (canevas, damier, îlots, sélection, G/R/S, épingles, outils), dépliage LSCM, projections, packing, menu U | `uv/*.test.ts` (14 fichiers), `scene-uv` (31 vérifications) |
| Q · Sculpt | `SculptSession`, dix-neuf pinceaux, masque, symétrie, remesh par tétraèdres de marche, F et ⇧F, un pas d'historique par trait | `sculpt/*.test.ts` (3 fichiers, 49 tests), `scene-sculpt` (19) |
| R · Clés de forme et animation | `applyShapeKeys` avant la pile, « From mix », « Apply as shape key », I pose des clés, le transport joue la scène, glTF emporte les pistes TRS | `mesh/shapeKeys.test.ts`, `animate.test.ts`, `scene-shape-keys` (17) |
| S1 · Courbes et texte | `kind: 'curve'` et `kind: 'text'` évalués en `MeshData` (balayage, remplissage, extrusion, biseau, taper), contours par `opentype.js` et `ShapeUtils`, conversion en maillage | `curve/spline.test.ts` (17), `curve/geometry.test.ts` (15), `curve/text.test.ts` (14), `operators/convert.test.ts` (8) |
| S2 · Mode édition des courbes | La cage : les nœuds et les poignées comme sommets d'un maillage, donc toute la sélection et tout G/R/S déjà écrits ; V, ⌥C, subdivide, E, X, tilt, radius, smooth, switch direction | `curve/cage.test.ts` (12), `operators/curveEdit.test.ts` (19), `scene-curves-text` |
| S3 · Texte au clavier | Saisie dans le viewport, curseur clignotant, sélection ⇧←→, ⌘A, ⌘V, une rafale de frappe = un pas d'historique | `curve/textEdit.test.ts` (18), `scene-curves-text` (30 vérifications) |
| T · Peinture de sommets | Attribut couleur sur le domaine sommet ou coin, cinq modes de fusion, symétrie, ⇧K, ⇧X, ombrage solid « attribute », matériau « Color attribute », glTF `COLOR_0` | `paint/paint.test.ts` (14), `scene-vertex-paint` (18) |
| U1 · Le moteur | Copie versionnée de Prismorphic avec `README.md` (provenance, commit, sept modifications locales), registre `ShaderNodeType` injectable, `useNodes` + `graph`, conversion Principled ↔ graphe | `shader/registry.test.ts` (8), `shader/material.test.ts` (10) |
| U2 · `NodeGraphEditor` | Générique dans `src/editor/nodeGraph/` : connexion au pointeur et au clavier, un câble par entrée, refus des cycles, palette, sélection, ⌘D, repli, auto-layout, cadrage | `nodeGraph/layout.test.ts` (23), `NodeGraphEditor.test.tsx` (13) |
| U3 · L'espace | `SceneShaderEditor` à côté du viewport, « Use nodes », le ◇ sur les réglages d'un nœud, les diagnostics sur le nœud fautif, le budget en tête | `scene-shader` (19 vérifications) |

**Total** : 3 311 tests unitaires (223 fichiers), 588 vérifications e2e sur 40 scripts. Au dernier
passage complet, deux échouent : la première frame, à 1 517 ms contre un budget de 1 500. Le
passage précédent la relevait à 1 240 ms, avec tout le reste vert.

## Les mesures

| Mesure | Budget | Relevé |
| --- | --- | --- |
| Une touche de pinceau sur 200 704 sommets | une frame (16 ms) | **4,49 ms** (test unitaire) |
| Un trait Draw sur 50 625 sommets | 16 / 33 ms | **16,70 / 20,00 ms** |
| Undo d'un trait de sculpt sur 50 625 sommets | 50 ms | **199,4 ms** — au-dessus, voir plus bas |
| Remesh d'un cube à 0,1 m | — | 6 faces → **9 216**, 97 % de quads |
| Dépliage LSCM de 19 600 faces, un seul îlot | de l'ordre de la seconde | **416 ms** (test unitaire) |
| Pan sur 500 nœuds | 16 ms | **16,6 ms** moyen, 17,1 au 95ᵉ — contre 16,7 ms pour la même page immobile |
| Compilation d'un graphe de 40 nœuds | — | **0,5 ms** à froid, 0,4 ms depuis le cache, 40 nœuds atteints |
| Cercle Bézier biseauté (0,2 m) | — | 2,40 × 2,40 × 0,40 m, fermé |
| « ParamRig » extrudé à 0,12 m | — | 4,24 × 0,89 × 0,24 m, 2 596 sommets, 3 882 faces |
| Un trait de peinture sur une grille de 6 400 coins | sous le pinceau | **256** valeurs peintes |
| Première frame | 1,5 s | **1 517 ms** — 1 240 ms au passage précédent, voir plus bas |
| Tab sur 99 856 sommets | 300 ms | **372 ms** — au-dessus, voir plus bas |
| Tab sur 19 881 sommets | — | **157 ms** |
| Boîte de sélection sur un quart du maillage lourd | 50 ms | **52 ms** |

### Ce que ces chiffres valent, et ce qu'ils ne valent pas

Les relevés ci-dessus viennent tous du même passage complet, le dernier. Ils bougent énormément
selon ce que la machine fait par ailleurs, et il faut le dire pour que personne ne les lise comme
des constantes. Trois passages de la même campagne, le même jour, sur le même code :

| Mesure | Passage vert | Passage suivant | Machine chargée |
| --- | --- | --- | --- |
| Première frame | 1 240 ms | 1 517 ms | 1 596 à 2 028 ms |
| Tab sur 99 856 sommets | 405 ms | 372 ms | 625 à 707 ms |
| Boîte sur un quart du maillage | 50 ms | 52 ms | 85 à 121 ms |
| Undo d'un trait | 95,9 ms | 199,4 ms | 269,6 ms |

Un facteur deux entre deux passages consécutifs, un facteur trois quand quatre piles Docker
tournent à côté. La même page immobile ne rend alors qu'une frame toutes les 18 ms : 55 images par
seconde sans rien faire. C'est pour cela que les vérifications gardent l'ordre de grandeur plutôt
que le budget, et que la ligne au-dessus dit toujours le chiffre réel — et c'est pour cela que la
première frame passe sur un passage et échoue sur le suivant, à dix-sept millisecondes près.

**Tab sur cent mille sommets : 405 ms contre 300.** Le prompt 4 en relevait 358 ; il a glissé.
Ouvrir un maillage construit une vue : positions, normales, ids, UV, masque, couleur. Trois de ces
six attributs sont arrivés avec ce prompt et celui d'avant. Mesuré en enlevant l'attribut couleur,
Tab ne va pas plus vite (698 ms contre 625, machine chargée, dans le bruit) : le coût est
ailleurs, réparti, et il demande un profil plutôt qu'une intuition. C'est écrit ici plutôt que
corrigé à l'aveugle.

**Undo d'un trait de sculpt : 199,4 ms contre 50, et 95,9 sur un bon passage.** L'historique est une liste de documents, et un
document porte le maillage entier ; annuler un trait, c'est reposer cinquante mille sommets. Un
historique par delta le ramènerait sous la barre et changerait la forme de tout ce qui écrit un
pas. C'est un chantier, pas une retouche, et il n'était pas demandé ici.

## Ce qui est partiel

- **Le dépliage.** LSCM avec N épingles portées par des lignes lourdes, résolu par gradient
  conjugué sans matrice. Ce n'est pas l'ABF de Blender : sur une forme très courbée, l'angle est
  moins bien conservé. La mise à plat des îlots avant packing passe par des calipers tournants sur
  l'enveloppe convexe — mesuré, l'occupation de l'image passe de 0,282 à 0,564.
- **Le remesh.** Marching tetrahedra sur un champ de distance signé, donc une surface fermée par
  construction — mais un champ de niveau exige un volume fermé : remailler une plaque ouverte
  laisse des bords ouverts, exactement comme dans Blender. Ni quadriflow, ni dyntopo.
- **Le sculpt à 200 000 sommets.** Une touche coûte 4,49 ms, mesuré en test unitaire, et un trait
  sur 50 625 sommets tient 16,70 ms dans le navigateur. Les 200 000 sommets ne sont pas mesurés
  dans une page : le stockage local plafonne un document à cinq mégaoctets et la scène de test n'y
  entre pas. Le chiffre du navigateur est donc celui de 50 625 sommets, et il est dit comme tel.
- **Le biseau d'un texte** rentre le contour le long de la bissectrice des coins. Un biseau plus
  profond que la partie la plus fine d'une lettre replie l'anneau sur lui-même — celui de Blender
  aussi — et l'onglet ne l'empêche pas.
- **Le taper d'une courbe** ne lit que la première spline de l'objet nommé.
- **L'éditeur de nœuds** n'a ni cadres (⌘G), ni minimap, ni align/distribute, ni nœuds de reroute,
  ni ⌃H. Chacun est un geste à part entière plutôt que le coin d'un geste déjà là.
- **Les erreurs de compilation** viennent des diagnostics du graphe (un socket mal branché, une
  surface vide), pas du compilateur GLSL du pilote : un programme refusé par la carte n'a pas de
  chemin de retour vers le nœud fautif dans cette version.

## Ce qui est laissé de côté, et pourquoi

- **NURBS.** Le prompt le dit : un autre évaluateur, un autre mode d'édition. Les splines sont
  Bézier ou poly.
- **Le nœud Smear** de la peinture de sommets : il demande la direction du trait portée jusqu'au
  dab, ce que la structure d'un dab ne transporte pas. Mieux vaut l'absence qu'un bouton qui floute.
- **L'alpha d'un attribut couleur.** Blender le porte dans son attribut couleur en octets ; presque
  rien ne le lit, et un canal que personne n'utilise est un canal qui se trompe en silence.
- **Le clic pour poser le curseur de texte** dans le viewport : il faut un test pixel → glyphe que
  la mise en page n'offre pas encore. Les flèches, Home, End et ⇧ font le reste.
- **Les nœuds de Blender que le moteur repris ne sait pas compiler** : Image texture, Normal map,
  Bump, Separate / Combine XYZ et RGB, Gradient, Checker, Brick, Musgrave, Attribute, Geometry,
  Object info, et tout le volume, les cheveux, la subsurface et le light path. Le registre est
  injectable, mais un type que la copie ne connaît pas se dessine, se branche et compile en rien —
  ce serait un menu qui ment. Ce qui est là couvre ce que le compilateur sait faire :
  Principled BSDF (le sous-ensemble du prompt 3), Emission, Glass, Mix Shader, Material Output,
  Value, RGB, Time, Texture Coordinate, Mapping, Noise, Wave, Voronoi, Color Ramp, Math, Mix Color,
  Map Range, Invert Color, Fresnel, et les nœuds propres à Prismorphic (Prism Dispersion,
  Scanlines, Domain Warp, Glitch Bands, Digital Fragments, Chromatic Split, Pulse).
- **L'export glTF d'un graphe** emporte le Principled équivalent — la couleur de base, le
  métallique, la rugosité, l'émission — et rien du graphe lui-même. Un nœud Image texture branché
  sur la base color n'existe pas encore, donc rien à emporter.
- **La police d'un texte** ne peut être qu'une famille dont l'application embarque le fichier de
  contours, c'est-à-dire Public Sans. C'est la limite que l'éditeur vectoriel s'impose déjà, pour
  la même raison : opentype.js lit du TrueType, pas du woff2 compressé en Brotli.

## Les défauts trouvés en mesurant, et corrigés

Chacun a été trouvé par une mesure ou par une capture, pas par un test qui l'attendait.

1. **Le dépliage rendait des losanges.** LSCM n'est défini qu'à une rotation près, et le packer
   mesure des boîtes englobantes. Corrigé par une mise à plat par calipers tournants ; l'occupation
   de l'image passe de 0,282 à 0,564, et le test échoue sans elle.
2. **La vue de maillage n'enregistrait jamais la carte UV qu'elle avait dessinée**, donc une
   texture ne suivait pas un dépliage.
3. **Le `PointGrid` du sculpt rendait des sommets en double** : sa fonction de hachage entrait en
   collision, et un sommet bougeait deux fois par touche. Clé compacte exacte.
4. **Les surface nets donnaient 80 arêtes non-manifold sur un cube** ; remplacés par des tétraèdres
   de marche, fermés par construction.
5. **3 093 des 4 476 triangles d'un remesh étaient dégénérés** — des échantillons exactement sur la
   surface. Corrigé en écartant les valeurs sous 0,05 × voxel de zéro.
6. **Les rayons de parité du remesh longeaient les arêtes partagées** sur un modèle aligné sur les
   axes ; décalés de 0,0011 et 0,0007 voxel.
7. **Le remesh était en O(colonnes × triangles)** et dépassait trente secondes ; les triangles sont
   maintenant rangés par colonne XY — 604 ms sur une dalle de 4 000 faces.
8. **Les nœuds d'une courbe sont à l'intérieur de la surface qu'elle engendre** — l'axe d'un tube
   biseauté est exactement là où ils sont — donc le test de profondeur les cachait tous et rien
   n'était cliquable. Le calque d'une courbe se dessine devant, quel que soit l'interrupteur x-ray.
9. **Un objet texte construit avant l'arrivée de sa police** mettait en cache un maillage vide sous
   la clé du texte, que plus rien n'aurait redemandé.
10. **`cloneMesh` et le lecteur de fichier reconstruisaient le domaine des coins** à partir des
    champs qu'ils connaissaient, et la couleur n'en faisait pas partie : chaque coin peint était
    perdu au premier undo, à la première sauvegarde et au premier rechargement, en silence.
11. **Un appui dans la palette de nœuds était capté par le canevas** au-dessous, donc le bouton sous
    le doigt ne voyait jamais son propre clic.
12. **Un clic sur l'en-tête d'un nœud réécrivait sa position inchangée**, ce qui est un pas
    d'historique qui n'annule rien.
13. **Un champ signale sa valeur deux fois** — à la frappe et à la validation — et le second signal
    arrivait dans une fermeture tenant encore le document d'avant le premier : chaque nombre tapé
    valait deux pas d'historique, et un undo ne faisait rien.
14. **Le pan d'un graphe de 500 nœuds passait par l'état React** : 148 ms par frame. La
    transformation du monde est écrite directement sur l'élément — 16,6 ms, soit exactement le prix
    de la page immobile.
15. **X en mode objet était dans le keymap et dans la page générée, et ne faisait rien du tout** :
    aucun gestionnaire ne l'attendait.
16. **`scene-cut` attendait 800 ms fixes** que A et Tab atterrissent sur une page qui venait de se
    recharger ; l'aperçu était parfois mesuré sur un cube jamais remplacé.

## Ce que la finition exigée demandait, et où cela se lit

- **L'éditeur UV a le toucher du viewport** : mêmes seuils, même capture, HUD en DOM, G/R/S sous
  Pointer Lock, priorité de clic, sélection synchronisée à la frame suivante. `scene-uv`.
- **Sculpt** : 16,70 ms par frame sur 50 625 sommets, curseur de pinceau sur la surface, pression
  de tablette lue, un pas d'historique par trait. L'undo sous 50 ms n'y est pas, et le pourquoi est
  écrit plus haut.
- **Clés de forme** : la valeur se scrube avec aperçu vivant, et un contrôleur lié à une clé bouge
  la géométrie à la frame suivante. `scene-shape-keys`.
- **Courbes et texte** : les poignées de Bézier *sont* des sommets de la cage, donc elles ont
  exactement les mêmes cibles et la même priorité que les sommets d'un maillage ; le curseur de
  texte clignote au rythme d'un navigateur et s'immobilise sous `prefers-reduced-motion` ; la
  conversion en maillage se reprend par un undo. `scene-curves-text`.
- **Éditeur de shader** : les câbles sont calculés depuis l'index d'un port, donc ils suivent le
  nœud dans la même frame — un test l'assure au premier rendu, avant toute mise en page ; un port
  compatible s'allume avant qu'on lâche ; la compilation est débouncée à 150 ms et ne touche jamais
  le pointeur ; une erreur se lit sur le nœud fautif ; 500 nœuds pannent au prix de la page
  immobile.
- **Chaque nouveau mode a son en-tête, sa barre T et sa barre d'état** : le mode peinture a ses deux
  pinceaux et sa ligne de gestes, l'édition d'une courbe remplace Vertex/Edge/Face par Curve, celle
  d'un texte ne garde que View et dit que le clavier écrit. Le camembert ⌃Tab porte les quatre
  modes. La page keymap est régénérée et distingue les touches d'une courbe de celles d'un maillage.
