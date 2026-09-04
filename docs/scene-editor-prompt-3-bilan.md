# Prompt 3 — bilan

Ce que l'éditeur de scène a gagné avec `docs/scene-editor-roadmap-3-prompt.md` :
les modificateurs, les matériaux, le monde, les lumières, les caméras, les
quatre ombrages et les fichiers. Écrit après coup, à partir des mesures et des
sorties réelles, pas à partir du plan.

Sept commits, dans l'ordre : les seize modules de modificateurs, le panneau
Modifiers, les matériaux et le monde, un correctif d'en-tête, la vue caméra et
les poignées de lumière, les fichiers et le rendu, enfin les réglages du solid.

---

## Fait et vérifié

### H · La pile de modificateurs

Les **seize modificateurs** de la liste sont là et testés un par un contre un cas
canonique : subdivision (Catmull-Clark, creases, plafond de deux millions de
faces vérifié en arithmétique avant de construire quoi que ce soit), mirror
(soudure par paire, bisect, objet miroir, clipping), array (fixed count / fit
length, décalages relatif, constant et par objet, merge, caps), solidify,
bevel, boolean, decimate, screw, triangulate, weld, wireframe, smooth, simple
deform, cast, edge split, displace. 157 tests unitaires pour la famille.

Solidify et wireframe **réutilisent les opérateurs du même nom** : les fonctions
de géométrie ont été sorties de `operators/shell.ts` et sont appelées par les
deux, donc il y a une coque et une barre dans le dépôt, pas deux qui divergent.
Mirror appelle `bisectFaces`, array appelle `weldVertices`.

Le **clipping** n'est dans aucun module : c'est une règle sur l'endroit où un
sommet a le droit d'aller, donc il vit dans `transform/elements.ts`, là où
passent toutes les routes vers une position — un glissé, un nombre tapé, la
sidebar. Six tests.

Le **panneau Modifiers** dessine la pile dans l'ordre où elle s'exécute : une
carte par modificateur, poignée de glisser, nom éditable, les quatre
interrupteurs de Blender, et un menu ⋯ (Apply, Duplicate, Copy to selected,
Move to first/last/up/down, Delete). Les champs sont **générés depuis le schéma
déclaré** de chaque module ; un paramètre nommé dans `objectInputs` est rempli
depuis le document, puisqu'un schéma ne peut pas connaître la scène. `⌃1` à `⌃5`
règlent le niveau de subdivision, `⌃0` l'enlève.

`modifier.apply` est un opérateur, parce que c'est la seule chose ici qui change
un maillage : il refuse un maillage partagé par plusieurs objets, avec le compte
dans la phrase, et refuse d'appliquer hors de l'ordre en nommant celui à
appliquer d'abord.

### I · Matériaux et monde

Onglet Material en deux moitiés, comme dans Blender : les slots (propriété de
l'objet, les faces y pointent par indice) et le matériau (chose du document que
plusieurs objets peuvent nommer — le panneau dit combien). Tout ce qui touche
aux slots est un opérateur, parce que déplacer un slot déplace les faces qui le
nommaient.

Chaque matériau est dessiné comme **la sphère qu'il ferait**, pas comme un carré
de sa couleur : la moitié de ce qu'est un matériau — rugosité, métal,
transmission — est invisible dans un carré. Un seul renderer 64 px sert toute
l'application, le résultat est mis en cache sur l'empreinte du matériau.

L'ombrage solid prend sa couleur du matériau, de l'objet, d'une couleur unique
ou d'une par objet ; c'est cette dernière qui rend lisible une scène de quarante
objets. Assign / Select / Deselect n'apparaissent qu'en mode édition.

Les matériaux sont aussi des **assets** : un onglet Assets de la sidebar les
liste avec la même pastille et on peut les **glisser sur le viewport** — sur un
objet pour le peindre, sur une face avec ⇧, ce qui a demandé un vrai lancer de
rayon puisque le tampon d'identifiants ne contient que des objets hors édition.

Le **monde** a son environnement : image équirectangulaire venue des ressources
du projet, préfiltrée une fois (PMREM), force et rotation, et les deux
interrupteurs séparés de Blender pour éclairer et pour être vu. Brouillard,
résolution de sortie et exposition sont arrivés avec.

### J · Lumières et caméras

La **vue caméra** montre un peu plus que ce que la caméra voit, avec son cadre
dessiné et le reste assombri. Les deux moitiés viennent de la même fonction
pure, donc ce qui est dans le cadre est exactement ce qui sera rendu.
`Numpad 0` entre et sort, `⌃⌥Numpad 0` donne la vue à la caméra, et « Lock
camera to view » décide de ce que naviguer veut dire : avec, la caméra suit ;
sans, bouger la vue **quitte** la vue caméra au lieu de faire semblant d'y être.

Un spot et une area portent une **poignée** sur leur glyphe. Dessinée dans la
page comme le cadre : nette à toute densité, cible de 32 px sans 32 px de
géométrie, et jamais dans un rendu.

**Une convention était fausse.** Blender nomme ses rotations d'Euler dans
l'ordre où elles s'appliquent aux axes du monde ; three.js dans l'ordre où elles
s'appliquent à l'objet. Les mêmes lettres, à l'envers. Toute rotation composée
était donc légèrement fausse depuis le début, et la caméra de la scène de départ
— dont les nombres sont ceux de Blender — ne pointait pas vers le cube. La
composition et la décomposition traduisent maintenant l'orthographe, et le test
qui l'aurait attrapé (« la caméra par défaut regarde l'origine ») est écrit.

### K · Ombrage

Trois éclairages (studio, matcap, flat), cinq couleurs, et les interrupteurs.
Les **six matcaps sont calculés, pas livrés** : pas d'image à télécharger, pas
de licence à attribuer, pas de binaire dans le dépôt, et n'importe quelle taille
peut être demandée. Les tests vérifient ce qui rend un matcap utilisable — éclairé
de quelque part, plage tenue, coins couverts.

La **cavité** assombrit là où une surface tourne. C'est un correctif de shader
plutôt qu'une passe écran : la vitesse à laquelle la normale change d'un pixel à
l'autre *est* la courbure, et la carte l'a déjà dans `fwidth`. Une instruction
au lieu d'une passe plein écran, et surtout : rien n'y dépend de l'image
précédente, donc ça ne scintille pas en orbite.

X-ray rend maintenant les surfaces elles-mêmes translucides ; backface culling,
specular et le fond (thème ou monde) sont des interrupteurs ; l'épaisseur du
wireframe est un réglage de vue.

### L · Fichiers et rendu

Trois formats, chacun pour ce qu'il sait faire. **OBJ** garde les n-gones (un
cube part en six quads et revient en six quads). **STL** ne garde que des
triangles, donc la lecture les **soude par position** — sans quoi un cube
arrive en trente-six sommets isolés. **glTF** garde le plus : hiérarchie,
matériaux, caméras, lumières.

L'import est la même porte dans les deux sens : un fichier **déposé sur le
viewport** arrive au curseur 3D, sélectionné et actif, avec ses noms rendus
uniques, et passe par la sanitisation.

**F12** rend hors écran à la taille demandée par Scene · Output, en tuiles, avec
progression et arrêt, aperçu, puis Save. Les **vignettes de la bibliothèque**
sont un vrai rendu, depuis le même renderer que les pastilles de matériaux.

---

## Mesures

Prises sur cette machine, navigateur GPU sans fenêtre, à travers `e2e/campaign.mjs`
et une sonde dédiée. Les temps unitaires viennent du conteneur Docker à un CPU,
qui est plus lent que l'hôte.

| Mesure | Résultat | Budget du prompt |
| --- | --- | --- |
| Solid studio, 100 352 triangles | 61 i/s soutenues, 0,08 ms de CPU par image | 60 i/s |
| Solid matcap, 100 352 triangles | 61 i/s, 0,06 ms | 60 i/s |
| Solid cavité, 100 352 triangles | 61 i/s, 0,06 ms | — |
| Rendered, 4 lampes avec ombres | 60 i/s, 0,09 ms, 16 appels de dessin | 30 i/s |
| Subsurf niveau 2, 400 quads → 6 400 faces | 0,045 ms cache chaud (104 ms à froid, conteneur) | < 100 ms à chaud |
| `invalidateCount` au repos, solid et rendered | stable (11 → 11) | stable |
| Tab sur 99 856 sommets | 356 ms | ~300 ms (prompt 2) |
| Première image | 1,19 s | 1,5 s |
| Sélection au survol | 0,39 ms en moyenne | 4 ms |
| Scène de départ en GLB | 2 648 octets | — |

La cavité mesurée sur une sphère : 114 → 82 sur le silhouette, soit 28 % plus
sombre là où la surface tourne le plus vite.

Suite e2e : **27 scripts**, tous verts en campagne (`node e2e/campaign.mjs scene-`).
Suite unitaire : **2 634 tests**, verts. `typecheck`, `lint` et `git diff --check`
verts avant chaque commit.

---

## Partiel, et pourquoi

- **Cavité sur une face plate** : rien. La courbure d'un plan est nulle, donc sur
  un cube la cavité ne se voit que le long des arêtes. Une passe écran depuis le
  tampon de profondeur montrerait aussi les coins concaves ; elle coûte une passe
  plein écran et peut scintiller. Le choix est assumé et documenté dans le module.
- **Contour de tous les objets en solid** (« outline » de Blender) : le contour
  de sélection existe depuis le prompt 1, pas celui qui cerne chaque objet. Le
  réglage est dans l'état du document, il ne fait encore rien.
- **Shadow du solid** (l'ombre douce depuis la lumière de studio) : même chose,
  déclaré et inerte.
- **Couleur « texture » du solid** : retombe sur la couleur du matériau, faute
  d'un dessin de la carte de couleur de base en solid.
- **Onglet Assets** : c'est un quatrième onglet de la sidebar de droite plutôt
  qu'un rail à gauche. La sidebar existait, un rail n'existait pas ; le geste
  demandé — glisser un matériau sur un objet — est le même.
- **Aperçu des matcaps en vignettes** : le menu les nomme, il ne les dessine pas
  encore en pastilles.
- **Profondeur de champ** : les champs existent dans l'onglet Data et le rendu
  ne les lit pas ; F12 rend net.
- **Import par Worker** : le parsing est synchrone. Un OBJ de dix mégaoctets
  bloque la page une seconde. Les formats sont lus en flux de texte ou d'octets,
  donc le passage au Worker est un déplacement, pas une réécriture.
- **`optimalDisplay` de la subdivision** : déclaré par le module, lu par
  personne — le viewport dessine toutes les arêtes du maillage évalué.
- **Mirror U/V** : rien à refléter tant qu'il n'y a pas d'UV (prompt 5).

## Approximations, dites franchement

- **Booléen** : `three-bvh-csg`, donc triangulé. Un cube moins un cylindre sort
  en triangles, pas en n-gones.
- **Décimation planaire** : fusionne par angle limite, sans la garantie de
  Blender sur les bords.
- **Lumière area en glTF** : l'extension n'en a pas ; elle part en point de même
  puissance.
- **Ombres** : quatre lumières au maximum, les plus fortes d'abord.
- **Exposition** : appliquée comme facteur de tonemapping ACES, pas comme le
  pipeline complet de gestion de couleur de Blender (le gamma est stocké et non
  appliqué).
- **Cavité** : courbure, pas occlusion — voir plus haut.
- **`writeMtl`** : le modèle d'ombrage d'OBJ n'a pas de rugosité ; elle devient
  un exposant de Phong.

## Ce qui a été trouvé en chemin

Trois défauts réels, invisibles dans les tests d'alors :

1. **L'ordre d'Euler** inversé par rapport à Blender (ci-dessus).
2. **Face orientation** ne s'affichait plus tant que le maillage ne changeait
   pas : l'ombrage réécrivait le matériau après l'overlay. Le correctif fait
   demander à l'ombrage ce que l'objet porterait autrement, plutôt que de s'en
   souvenir.
3. **L'en-tête dessinait « Object mode » par-dessus « View »** à 1440 px : une
   commande qui rétrécit sous son propre libellé ne rapetisse pas, elle déborde.
   Visible dans une capture de référence, dans aucun test.

Et deux dans l'outillage : le tampon d'état des faces réallouait une texture
immuable (`GL_INVALID_VALUE` silencieux dans le journal du navigateur), et les
registres d'opérateurs et de modificateurs plantaient l'éditeur au rechargement
à chaud d'un module — ce qui a empoisonné deux campagnes de QA avant d'être vu.

La campagne elle-même tourne maintenant depuis macOS (`e2e/campaign.mjs`) : le
navigateur de QA cesse de composer au bout d'un moment, et seul un navigateur
qui vient de démarrer y remédie — depuis le conteneur, il n'y a rien à
redémarrer.
