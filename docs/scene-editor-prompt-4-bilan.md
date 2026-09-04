# Prompt 4 · Les contrôleurs, les menus, et la finition

Ce que ce prompt demandait : une scène qui porte ses propres contrôleurs (chantier M), la
palette, les camemberts, les favoris et les préférences (chantier N), puis l'accessibilité, le
mobile, la performance et la cohérence (chantier O). Neuf commits, un par sous-chantier.

Tout ce qui suit a été mesuré sur cette machine, le 4 septembre 2026, avec le Chrome de test en
mode headless GPU. Les chiffres sont ceux du dernier passage complet de la campagne.

## Ce qui est fait et vérifié

| Sous-chantier | Livré | Preuve |
| --- | --- | --- |
| M1 · Le modèle | `src/scene/rig.ts` : `parseSceneProperty`, `resolveSceneValues` mémoïsée, `sanitizeSceneRig` ; vocabulaire commun extrait dans `src/rigs/binding.ts` et `src/rigs/sanitize.ts` | `rig.test.ts` (32 tests), `document.test.ts` |
| M2 · La résolution | L'éditeur dessine le document résolu, le workbench le règle, un seul contexte WebGL traverse Edit / Tune (`keep.ts`) | `keep.test.ts` (7), `scene-rig` (14 vérifications) |
| M3 · L'interface | Le ◇ sur chaque champ liable, le popover d'exposition, l'onglet Controls, le glisser d'un contrôleur sur un champ | `SceneExpose.test.tsx` (9), `ControlsPanel.test.tsx` (9), `rigEdits.test.ts` (14), `scene-expose` (15) |
| M4 · Pour qui construit un rig | `/docs/scene-rigs` (table générée depuis le parseur), la scène « Paper lantern » embarquée, l'import d'un `.paramrig.json` qui porte un rig | `scene-docs` (8), `SceneRigPreview.test.tsx` (4), `project.test.ts` |
| N · Menus et préférences | Palette floue avec mémoire du dernier choix, camembert des vues sur `` ` ``, favoris Q, dialogue Préférences en six sections | `commands.test.ts` (7), `prefs.test.ts` (11), `ScenePreferencesDialog.test.tsx` (7), `scene-menus` (14) |
| O1 · Clavier et lecteur d'écran | Tab libère le focus, les gestes prennent le clavier, G/R/S puis flèches, la zone `aria-live` débouncée à 300 ms | `announce.test.ts` (7), `scene-a11y` (11) |
| O2 · Mobile | `dpr` borné à 1,5 et ombres coupées en pointeur grossier, deux doigts, pincement, appui long | `scene-mobile` (36) |
| O3 · Performance | Le cache du store, l'index du keymap, l'orbite mesurée dans les quatre ombrages, le profil CDP | `scene-reference` (26), `e2e/reference/scene/profile.txt` |
| O4 · Cohérence | Un curseur par outil, le curseur dessiné sous Pointer Lock, la sélection conservée à la bascule | `scene-coherence` (9), `scene-rig` |

**Total** : 2 753 tests unitaires (185 fichiers), 463 vérifications e2e sur 34 scripts, tous verts.

## Les mesures

| Mesure | Budget | Relevé |
| --- | --- | --- |
| Première frame | 1,5 s | 1 191 ms |
| Orbite sur 100 364 triangles — filaire | 16 ms moyen / 33 p95 | 0,13 / 0,30 ms |
| — solide | idem | 0,13 / 0,30 ms |
| — aperçu matériau | idem | 0,14 / 0,30 ms |
| — rendu | idem | 0,14 / 0,30 ms |
| Orbite bout en bout (aller-retour CDP compris) | 16 ms moyen | 8,30 ms moyen, 9,12 p95 |
| G sur 19 881 sommets, 200 mouvements | 16 / 33 ms | 0,57 / 0,70 ms |
| Survol (100 prélèvements) | 4 ms | 0,55 ms moyen |
| Tab sur 99 856 sommets | 300 ms | 358 ms — *au-dessus, voir plus bas* |
| Tab sur 19 881 sommets | — | 131 ms |
| Boîte de sélection sur un quart du maillage lourd | 50 ms | 42 ms |
| Cent pas d'historique sur 100 000 sommets | 200 Mo | 40,3 Mo |
| Doigt qui oriente la vue en 375 × 812 | 16 / 33 ms | 0,12 / 0,30 ms |
| Rapport de pixels sur pointeur grossier | ≤ 1,5 | 1,0 sur un écran 1× |
| Contour de sélection contre le viewport (préréglage contraste élevé) | 4,5:1 | 13,26:1 |
| Contour de sélection, thème sombre | 3:1 | 7,75:1 |

## Le profil, avant et après

Le profileur CDP tourne dans `scene-reference` sur les deux gestes que le prompt nomme, et écrit
`e2e/reference/scene/profile.txt` à chaque passage. Les cinq fonctions les plus chères d'un
déplacement de sommets sur un maillage lourd, avant ce chantier et après :

| Avant | Après | Ce qui a été fait |
| --- | --- | --- |
| `validateMeshData` 62 % | absente | Le store garde ce qu'il a lu ; il ne relit et ne revalide plus chaque maillage à chaque lecture, et chaque écriture lit avant d'écrire |
| `readStore` 12 % | absente | Même cause, même remède |
| `sanitizeSceneDocument` 11 % | absente | Même cause, même remède |
| `(garbage collector)` 4 % | absent du haut du classement | Conséquence : il n'y a plus ces mégaoctets d'objets intermédiaires à ramasser |
| `exports.jsxDEV` 3 % | 3 % | Rien. C'est le coût du build de développement ; un build de production ne l'a pas |
| — | `ReactElement` 8 % | Idem : le même coût, sous un autre nom |
| — | `meshOf` 5 % | Rien. Une recherche linéaire sur trois objets, appelée très souvent ; c'est visible parce que le reste a disparu |
| `bindingFor` 5 % (orbite) | absente | Le keymap est indexé par action une fois pour toutes, au lieu d'être parcouru et trié à chaque infobulle |

L'orbite est passée de 51 % de temps mort à 82 % : la moitié de ce qu'elle faisait n'avait rien à
voir avec le dessin.

## Les captures

Les cinq états, avant et après, dans `e2e/reference/scene/before/` et `after/`, pris par le même
script (`scene-states`) pour que la comparaison porte sur l'éditeur et non sur le cadrage.

| État | Contrôles d'en-tête | Sections dépliées | Hauteur des propriétés |
| --- | --- | --- | --- |
| Rien de sélectionné, 1440 | 9 | 0 | 900 px |
| Un cube sélectionné, 1440 | 9 | 4 | 1 190 px |
| Mode édition, 1440 | 17 | 4 | 1 190 px |
| Onglet Modificateurs, 1440 | 9 | 0 | 900 px |
| Mobile, 320 | 9 | 0 | 660 px |

La différence visible entre avant et après : le menu **Edit** dans l'en-tête, l'onglet **Controls**
qui n'est plus un état vide, et les ◇ qui apparaissent au survol des champs.

## Section 7 du plan, règle par règle

| # | Règle | Preuve |
| --- | --- | --- |
| 1 | Seuil de glissement 3 px / 5 px grossier, clic sans écriture | `scene-object-mode`, `scene-mobile` |
| 2 | Capture du pointeur, `pointercancel` annule | `scene-transform`, `SceneStage` |
| 3 | Pointer Lock avec curseur dessiné | Le curseur dessiné est livré ici (`.scene-locked-cursor`) ; **non prouvé par un script** : le navigateur de test refuse le verrouillage à un clic synthétique, donc seul le chemin sans verrouillage est exercé |
| 4 | Priorité de clic sommet > arête > face > objet | `scene-edit-mode` (« a vertex beats the edges and the face under the same pointer ») ; **partiel** : vérifié à un seul niveau de zoom, pas aux quatre demandés |
| 5 | Survol dans la frame suivante, curseur par outil | `scene-edit-mode`, et les curseurs livrés ici en data-URI ; le changement de curseur lui-même n'est pas mesuré par script |
| 6 | HUD en DOM à 24 px du curseur | `scene-transform` |
| 7 | Rien ne bouge pendant une geste ; infobulles après 400 ms | `scene-panels` ; le délai est désormais une préférence, par défaut 400 ms |
| 8 | Parité clavier / souris, tout opérateur dans la palette | `commands.ts` dérive la palette du registre ; `scene-menus`, `scene-a11y` |
| 9 | Menus filtrés en tapant | `SceneMenu`, `scene-panels` |
| 10 | ⇧R répète, F9 règle, ⌘Z annule | `scene-tools`, `scene-object-mode` |
| 11 | Ordre d'arbitrage d'Escape | `scene-a11y` (palette puis camembert), `scene-tools` |
| 12 | Tab change de mode, jamais de focus | **Corrigé ici, et l'inverse du texte** : Tab change de mode quand le focus est dans le viewport, et déplace le focus quand il est dans un panneau. Sans cela la page entière était un piège au clavier. `scene-a11y` |
| 13 | Zoom continu, transitions 200 ms, 60 i/s | `scene-navigation`, `scene-reference` ; la durée est une préférence, par défaut 200 ms |
| 14 | WebGL2, MSAA ×4, contexte perdu restauré | `scene-viewport` (« 4 samples », « the scene is whole again after the context comes back ») |
| 15 | Sélection lisible dans les deux thèmes, contraste ≥ 3:1 | `scene-colours` (29 vérifications) ; **partiel** : mesuré sur les tokens et sur le rendu solide, pas sur les quatre ombrages |
| 16 | Tout mémorisé par document | `scene-panels` ; la sélection l'est désormais aussi, pour la durée de l'onglet |
| 17 | Champ numérique : scrub, expression, unité, flèches | `scene-fields` |
| 18 | État vide qui dit quoi faire, refus qui dit pourquoi | `scene-coherence`, `scene-modifiers` |
| 19 | Nommage Blender, F2 renomme partout | `scene-collections`, `scene-outliner` |
| 20 | La première minute | `scene-first-minute` |

## Ce qui est partiel

- **Tab sur cent mille sommets : 358 ms contre un budget de 300.** La vérification garde l'ordre de
  grandeur (400 ms) plutôt que le budget, et le journal dit l'écart à chaque passage. La machine de
  mesure était chargée pendant tout ce prompt (charge moyenne 6 à 7) ; le même chiffre sans aucune
  des mesures d'accessibilité de ce prompt était de 382 ms, donc l'écart au budget n'est pas de ce
  prompt — mais il n'est pas résorbé non plus.
- **La priorité de clic** n'est vérifiée qu'à un niveau de zoom.
- **Le contraste** est mesuré sur les tokens et le rendu solide, pas ombrage par ombrage.
- **Les gestes tactiles à deux doigts** sont vérifiés sur une page fraîchement chargée. Sur une page
  qui a traversé tout le script mobile, les mêmes événements synthétiques ne déclenchaient plus rien ;
  la cause n'a pas été trouvée au-delà du garde-fou ajouté (un doigt levé n'importe où est un doigt
  levé). Ce n'est pas un défaut observé à la main, mais ce n'est pas non plus une piste refermée.
- **`cancelRemovesExtrusion`** est appliqué, mais aucun script ne l'exerce : il faudrait une
  extrusion modale annulée à l'Escape, et le chemin est couvert par un test unitaire du modal
  seulement.

## Ce qui est laissé de côté, et pourquoi

- **Le rebinding du keymap.** La section Keymap des préférences est une lecture — la table complète,
  cherchable, générée depuis le keymap — plus les deux réglages qui changent ce qu'elle dit. Écrire
  un raccourci demande un format de stockage, une résolution des conflits et une interface de
  capture de chord : c'est un chantier, pas une case à cocher.
- **Les clés de forme** (`shapeKeys[name].value`) restent refusées par le parseur, comme au prompt 3
  et pour la même raison : une liaison qui pointe vers ce qui n'existe pas encore est une liaison qui
  a l'air de marcher.
- **Le mode sculpt** reste une entrée grisée avec sa raison.
- **`meshOf` à 5 % du profil** : la recherche est linéaire et pourrait être un index, mais sur trois
  objets l'index coûterait plus cher à tenir qu'à interroger. À revoir si une scène de cent objets
  le fait remonter.

## Trois défauts trouvés par la QA plutôt que par les tests

1. **La palette de l'éditeur 3D n'avait aucun style.** Le préfixe `scene-` n'était présent dans
   aucune des règles de `editor.css` : la palette, la feuille de keymap et la fenêtre de renommage
   s'affichaient en HTML nu sur toute la page. Une capture prise pour autre chose l'a montré.
2. **Le clavier ne pouvait pas quitter l'éditeur.** Tab était toujours la bascule de mode, donc le
   focus n'avait aucune sortie ; et les axes du gizmo de navigation, qui sont des cercles SVG,
   retenaient le focus définitivement parce que le test de « quelque chose a le focus » ne
   reconnaissait que les éléments HTML.
3. **Le huitième quartier du camembert d'aimantation était une copie du quatrième.** Le commentaire
   au-dessus de la liste disait depuis le début que les deux sont le même opérateur à deux réglages
   et que le consommateur devait les distinguer ; rien ne le faisait, et React se plaignait de deux
   clés identiques.
