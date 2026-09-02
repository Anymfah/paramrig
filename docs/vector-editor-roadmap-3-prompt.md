# Prompt 3 : ce qui manque encore côté dessin

Tu travailles dans `/Users/soheil/Documents/repos/paramrig` (branche `main`), éditeur vectoriel dans `src/vector/`, servi sur `http://localhost:5174` par Docker Compose. Les deux prompts précédents (`docs/vector-editor-roadmap-prompt.md` et `docs/vector-editor-roadmap-2-prompt.md`) ont été livrés intégralement ; lis-les d'abord, leurs règles, leur architecture et leur protocole de QA s'appliquent ici sans exception. Ce prompt ajoute sept chantiers de dessin, du plus utile au plus spécialisé. Même exigence : rien de décoratif, chaque contrôle fonctionne, un commit par sous-chantier, `typecheck`, `lint`, `test` et `git diff --check` avant chaque commit, bilan honnête à la fin.

## 0. État de départ (à vérifier, pas à supposer)

- Genres d'éléments : `rectangle | ellipse | path | group | text | frame | image | polygon | boolean`. Outils : `select | transform | node | pen | pencil | lasso | bucket | rectangle | ellipse | text | frame | line | polygon | scissors | scale | hand | zoom | measure`.
- Modules qui comptent pour ce prompt : `network.ts` (réseau), `planar.ts` (faces), `render.ts` (modèle de rendu mis en cache, `RenderLayer`, defs), `booleans.ts` et `booleanGroups.ts` (paper.js, booléens vivants), `text.ts` / `textOutline.ts` (mise en page approximative et conversion en contours via opentype.js sur Public Sans), `effects.ts` / `filters.ts`, `gradient.ts`, `images.ts` / `crop.ts`, `export.ts` (SVG, PNG par rasterisation d'un SVG sérialisé, `embedFonts`), `styles.ts`, `paints.ts`, `svgImport.ts`, `clipboard.ts`, `commands.ts` (palette et infobulles), `document.ts` (sanitisation, persistance), `project.ts` (fichier projet).
- Toute nouvelle propriété : type dans `types.ts`, sanitisation dans `document.ts`, prise en compte dans `render.ts`, dans l'export SVG et PNG, dans le presse-papiers et dans `svgImport.ts` quand une correspondance SVG existe. Toute nouvelle commande : `commands.ts`.
- Une geste continue = une entrée d'undo, avec libellé. Aucun contrôle natif, cibles 32 px / 44 px, tokens `--vector-*`, composants de `src/ui/`.
- QA navigateur : Chrome headless `127.0.0.1:9223` via `chromium.connectOverCDP` et le `playwright-core` de `/Users/soheil/Documents/repos/site-anym/node_modules` ; jamais `chromium.launch()` ; `mouse.dblclick`, modificateurs au clavier, `#main` focalisé avant les touches ; zéro erreur console ; 1440 px et 320 px ; thèmes clair et sombre. Les scripts vont désormais dans `e2e/` du dépôt, exécutables par `docker compose run --rm app npm run e2e` (ajoute la commande et un `README` dans `e2e/` si ce n'est pas encore fait ; l'hôte 9223 est atteignable depuis le conteneur via `host.docker.internal`).

## Chantier D · Contours à largeur variable et pinceaux

- **Modèle** : `strokeProfile?: Array<{ t: number; width: number }>` par élément (t le long de la longueur totale du réseau, 0 à 1, width en facteur du `strokeWidth`, au moins deux points), plus `brush?: { id, spacing, jitter, taper }` optionnel qui référence un pinceau nommé du document (forme unitaire en réseau + paramètres).
- **Rendu** : un contour profilé se rend comme un fill : construire l'enveloppe (offset gauche et droit le long de chaque chaîne avec interpolation de largeur, jonctions arrondies, extrémités selon `strokeCap`) puis unir avec paper.js ; mettre en cache par empreinte. Les pinceaux tamponnent la forme unitaire le long du chemin avec l'espacement et le jitter, puis unissent. Les deux se rendent comme une couche `fill` supplémentaire teintée par les `strokes`, sous les effets.
- **Outil largeur (⇧W, mode nœuds)** : glisser perpendiculairement au tracé à un point crée ou déplace un point de profil ; Delete le retire ; le HUD affiche la largeur en px ; un profil se réinitialise par la commande « Reset stroke width ».
- **Pinceaux** : section « Brush » dans l'inspecteur avec trois pinceaux fournis (rond, calligraphique à 45°, tireté), création d'un pinceau à partir de l'objet sélectionné (« Define brush from selection »), aperçu vivant.
- **Export** : le contour profilé s'exporte en `<path>` rempli ; le pinceau aussi. Le SVG n'a pas d'équivalent natif : documenter dans l'export que la forme est aplatie.
- **Tests** : enveloppe d'un segment droit à largeur linéaire (trapèze), fermeture correcte d'une boucle, cache, sanitisation ; QA : dessin, réglage, export, rechargement.

## Chantier E · Texte sur un chemin et polices externes

- **Texte sur un chemin** : `textPath?: { elementId, offset, side: 'above' | 'below', align }` sur un élément `text` ; le chemin cible est le premier chaînage du réseau référencé. Rendu SVG via `<textPath href>` avec un `<path>` caché dans les defs ; mise en page approximative par la mesure canvas (`text.ts`) pour les cibles de sélection ; `textOutline.ts` place les glyphes le long de la courbe (tangente locale) pour la conversion en contours. Commande « Attach to path » quand un texte et un chemin sont sélectionnés, « Detach from path », poignée sur le canvas pour l'offset.
- **Polices externes** : `fonts.ts` avec un registre de polices du document (`document.fonts: Array<{ family, source: 'system' | 'google' | 'file', weights, data? }>`). Chargement Google Fonts par `FontFace` depuis `fonts.googleapis.com` uniquement à la demande (liste courte de familles populaires, recherche, aperçu dans le `SelectField` remplacé par une liste virtualisée stylée), import d'un fichier `.woff2` / `.ttf` stocké en base64 dans le projet (limite 2 Mo, message `StatusMessage` au-delà). `embedFonts` dans `export.ts` inclut les fichiers importés et les Google Fonts récupérées en `@font-face` data URI pour que le PNG et le SVG soient fidèles. `textOutline.ts` utilise opentype.js sur la police réellement chargée quand elle est disponible en fichier ; sinon, la commande « Outline text » reste désactivée avec une infobulle explicite.
- **OpenType de base** : `fontFeatures?: { liga, kern, smcp, tnum }` appliqués via `font-feature-settings` ; crénage activé par défaut.
- Tests : placement de glyphes le long d'un cercle (distance constante à la courbe), sanitisation des polices, refus d'un fichier trop lourd ; QA : texte sur un cercle, changement de police Google, export PNG identique au canvas.

## Chantier F · Motifs et dégradés en maille

- **Remplissage par motif** : `VectorPaint` de type `pattern` : `sourceId` (un objet du document, souvent masqué ou dans une frame « Assets »), `tile: { width, height }`, `spacing`, `scale`, `angle`, `offset`, `mode: 'grid' | 'brick' | 'hex'`. Rendu par `<pattern>` dont le contenu est le modèle de rendu de l'objet source (réutiliser `layersToSvg`), `patternTransform` pour l'angle et l'échelle ; export identique ; commande « Define pattern from selection ».
- **Dégradé en maille** : `VectorPaint` de type `mesh` : grille `rows × cols` de points avec couleur et tangentes de Coons. SVG n'a pas de maille dans les navigateurs : rendre par triangulation en `<polygon>` dégradés (subdivision adaptative, 8 à 32 sous-divisions par patch selon la taille à l'écran) dans un `<g>` clippé par la forme, mis en cache. Éditeur sur le canvas : points déplaçables, double-clic pour ajouter une ligne ou une colonne, `ColorField` du point sélectionné dans l'inspecteur. Export SVG par la même triangulation ; PNG fidèle.
- Tests : `patternTransform`, triangulation d'un patch à quatre couleurs (couleur aux coins exacte), sanitisation.

## Chantier G · Vectorisation d'une image

- **`trace.ts`** : à partir d'un objet image, vectorisation par seuillage puis extraction de contours (marching squares sur la luminance ou sur des paliers de couleur : `mode: 'silhouette' | 'colors'`, `colors` entre 2 et 8, `threshold`, `smoothing`, `minArea`), puis simplification (`simplifyPolyline`) et lissage (`fitSmoothNodes` de `pencil.ts`) vers des réseaux ; un chemin par couleur, groupés.
- Dialogue « Trace image » (`VectorModal`) avec aperçu vivant sur une version réduite (max 512 px de côté) et bouton « Trace » qui applique à pleine résolution dans un `Worker` pour ne pas bloquer l'interface (budget : 1 s pour une image 1024 × 1024 en silhouette).
- Tests : un disque noir sur blanc donne un réseau à une face dont l'aire est à 3 % près celle du disque ; sanitisation ; QA : import d'une image, tracé, édition du résultat en mode nœuds.

## Chantier H · Composants et instances

- **Modèle** : `kind: 'component'` (un conteneur comme `frame`, marqué comme maître) et `kind: 'instance'` avec `componentId`, ses propres `x y width height rotation`, et des `overrides: Record<childId, Partial<VectorElement>>` limités à fills, strokes, texte, visibilité, effets. Le rendu d'une instance rend l'arbre du maître avec les overrides appliqués (cache par empreinte du maître + overrides).
- Commandes : « Create component » (⌥⌘K), « Detach instance » (⌥⌘B), « Go to main component », « Reset overrides ». Panneau « Assets » dans le rail des calques (onglet) listant les composants avec vignette, glisser sur le canvas pour instancier.
- Les instances suivent le maître à chaque édition ; l'édition d'un enfant d'instance écrit un override ; le redimensionnement d'une instance met à l'échelle son contenu comme un groupe.
- Sérialisation : export SVG d'une instance = arbre développé ; presse-papiers : coller une instance dans un autre document copie aussi le maître si absent.
- Tests : rendu d'une instance égal au maître, override d'un fill, détachement, suppression d'un maître qui détache ses instances ; QA : créer, instancier trois fois, modifier le maître, vérifier les trois.

## Chantier I · Export PDF et couleur

- **PDF** : `pdf.ts` sans dépendance lourde : génération d'un PDF 1.4 à la main (objets, flux de contenu, `re`, `m l c h`, fills, strokes, épaisseurs, dash, caps, joints, transformations `cm`, opacité par `ExtGState`, dégradés linéaires et radiaux par `Shading` type 2 et 3, images en `XObject` JPEG ou Flate, texte converti en contours pour éviter l'embarquement de polices), une page par frame ou une page pour le document. Effets rendus en bitmap et placés en image quand le PDF ne les représente pas. Ajout dans le menu d'export à côté de SVG et PNG.
- **Couleur** : `document.colorSpace: 'srgb' | 'display-p3'` ; les couleurs se stockent toujours en hex sRGB, mais le rendu émet `color(display-p3 …)` pour les documents P3 avec repli hex, et le `ColorField` propose un sélecteur P3 avec indicateur de gamut. Export PNG en P3 via un canvas `colorSpace: 'display-p3'` quand disponible.
- **CMYK indicatif** : lecture seule dans le `ColorField` (conversion naïve sRGB → CMYK avec profil générique) et export PDF en `DeviceCMYK` optionnel par une conversion simple ; le documenter comme indicatif, sans profil ICC.
- Tests : structure du PDF (xref valide, page, contenu attendu pour un rectangle et un dégradé), conversion P3 ; QA : ouvrir le PDF exporté dans le Chrome de test et le rasteriser pour comparer à l'export PNG.

## Livraison

1. Un commit par sous-chantier (D à I, chacun découpé si nécessaire), messages qui décrivent le comportement.
2. Tests unitaires pour chaque module pur, tests de rendu pour chaque def ou attribut SVG, tests `renderHook` pour chaque transaction nouvelle.
3. Scripts `e2e/` par chantier, exécutés, sortie réelle rapportée, captures pour ce qui est visuel.
4. Un bilan final qui distingue fait et vérifié, partiel, laissé de côté et pourquoi, avec les limites de chaque approximation (enveloppes de pinceau, maille triangulée, tracé, CMYK indicatif).
