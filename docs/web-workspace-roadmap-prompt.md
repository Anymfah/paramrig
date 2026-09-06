# Prompt Web 1 : rendre l'atelier Web fiable, lisible et complet jusqu'à la remise à l'agent

> Document autonome : un agent qui démarre sans contexte doit pouvoir l'exécuter de bout en bout. L'état de référence est le code, pas ce document.

Tu es un agent qui démarre sans aucun contexte. Tout ce dont tu as besoin est ici ou dans le dépôt ; ne suppose rien, vérifie dans le code.

Dépôt : `/Users/soheil/Documents/repos/paramrig`, branche `main`. ParamRig est un workbench où une IA construit des rigs paramétrés qu'un humain règle avec des contrôleurs. L'atelier Web (`src/web/`, route `/r/web-<projet>`, page de connexion `/web`) ouvre une page de développement d'un autre projet dans une iframe **cross-origin**, y expose des contrôles déclarés par un manifeste (`.paramrig/manifest.json`), laisse l'humain sélectionner des éléments, commenter, dessiner, puis valide un lot de retours que l'agent du projet lit sur disque. Trois morceaux : l'hôte React (`src/web/WebWorkspace.tsx`, `WebToolbar.tsx`, `WebControls.tsx`, `WebAnnotations.tsx`, `FeedbackReview.tsx`, `ScreenCapture.tsx`, `WebConnectPage.tsx`, `useWebDocument.ts`, `session.ts`, `selection.ts`, `web.css`), le SDK injecté dans la page cible (`src/web/sdk.ts`, `geometry.ts`, `contracts.ts`, compilé par `npm run build:web-sdk`), et le service de fichiers (`services/web/server.mjs`, profil Compose `web`, proxy Vite sur `/api/web`). L'exemple Fieldnotes vit dans `examples/web/` et `src/web/example/`, ses fichiers de retours dans `.local/web/.paramrig/` (ignoré par git). Lis `docs/web-workspace.md` en entier avant de commencer : il décrit le contrat et le parcours voulus.

## Règles, toutes obligatoires

- **Runtime** : uniquement `docker compose` depuis la racine. Jamais `npm run dev`, jamais Vite sur macOS. Avant tout `docker compose up`, `docker compose ls` ; si `stellary`, `helios`, `site-anym` ou un autre stack de développement tourne, n'en démarre et n'en arrête aucun (`stellary-ci` peut rester). Le stack `paramrig` est en général déjà lancé et recharge à chaud ; le service `web` doit apparaître dans `docker compose ps`, sinon `docker compose --profile web up -d web`. Port fixe 5174.
- **Vérification avant chaque commit**, dans cet ordre, toutes vertes :
  ```bash
  docker compose run --rm app npm run typecheck
  docker compose run --rm app npm run lint
  docker compose run --rm app npm test
  docker compose run --rm app npm run test:web-service
  docker compose run --rm app npm run build:web-sdk
  docker compose run --rm app npm run e2e -- web-
  git diff --check
  ```
- **Git** : commits fréquents sur `main`, un par sous-chantier, messages qui décrivent le comportement ; pas de push, pas de branche, pas de stash, pas de `git checkout` destructif (d'autres agents partagent le working tree). Autorship : `AGENTS.md` fait loi, aucune signature ni co-auteur IA.
- **Interface minimale** (section « Minimal editor UI » d'`AGENTS.md`) : boutons icône avec le `Tooltip` maison (`src/ui/Tooltip.tsx`) pour les commandes reconnaissables, jamais d'attribut `title`, jamais d'`alert` / `confirm`, actions secondaires dans les menus existants, un outil actif se quitte par un second clic et par Échap. Réutilise `src/ui/` : `Button`, `IconButton`, `Tooltip`, `StatusMessage`, `NumberField`, `ColorField`, `SelectField`, `SwitchField`, `ContextMenu`, Radix `DropdownMenu` / `Popover` avec les classes `menu`, `menu__item`, `popover`. Palette et espacements : `src/styles/tokens.css` seulement, aucune couleur codée en dur côté hôte. Cibles de pointeur d'au moins 32 px, 44 px en pointeur grossier. `user-select: none` sur le chrome, `text` dans les champs et valeurs. Wording en anglais, sentence case, sans point d'exclamation, sans « real / true / no fake ».
- **Historique** : une geste continue = une entrée d'undo, via `WebSession.begin / end / cancel` (`src/web/session.ts`) ; les updaters restent purs. Un retour publié ne s'annule pas.
- **Contrat** : toute nouvelle clé d'un ticket, d'un lot ou d'une réponse passe par les gardes de `src/web/contracts.ts` (`isDraft`, `isBatch`, `isResponse`), par `services/web/server.mjs` et par `docs/web-workspace.md`. Le SDK ne dépend ni de React ni du DOM de l'hôte ; ce qu'il envoie est validé par `isEvent`, ce qu'il reçoit par `isCommand`.
- **Sécurité** : ne touche pas aux vérifications d'origine, de session, de jeton, de liens symboliques ni de traversée de chemin.

## Protocole de QA navigateur, obligatoire

- Un Chrome headless GPU écoute sur `http://127.0.0.1:9223` (`curl -s http://127.0.0.1:9223/json/version`). Connecte-toi avec `chromium.connectOverCDP` ; jamais `chromium.launch()`, qui ouvre une fenêtre sur le bureau de Soheil. Les scripts vivent dans `e2e/` et se nomment `web-<chantier>.e2e.mjs` ; `npm run e2e -- web-` les exécute depuis le conteneur (lis `e2e/README.md`, `e2e/run.mjs`, `e2e/lib.mjs` ; `run()` fournit `page`, `check`, `shot`, mais ses `helpers` sont ceux du vectoriel, n'appelle pas `helpers.newDocument`, qui vide le stockage). Sorties dans `e2e/output/`, non suivies par git.
- **Ouvrir le projet** : `/web`, bouton « Open project », puis `/r/web-fieldnotes`. Attends d'abord `.web-toolbar`, puis la disparition de `.web-connection-notice` ; dans l'autre ordre l'attente résout à vide. Sonde les éléments absents avec `count()`, jamais `textContent()` (30 s d'attente).
- **L'iframe est cross-origin** (`http://127.0.0.1:5174`). La souris pilotée par CDP y arrive en haut de page mais se perd par intermittence après un défilement dans la frame ou dans sa bande basse : le parent reçoit le `pointerdown` avec pour cible l'élément `<iframe>` et la frame ne voit rien. Ce n'est pas l'application. Pour tester la logique du SDK sous la ligne de flottaison : `const frame = page.frames().find(f => f.url().includes('127.0.0.1'))`, puis `frame.evaluate` et `el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, button: 0, pointerId: 9, clientX, clientY }))`, et `frame.press('body', 'Escape')` pour le clavier. Pour observer ce que le SDK émet, pose dans le parent `window.addEventListener('message', e => window.__ev.push(e.data?.payload?.type))` avant l'action. Avant de conclure qu'un gestionnaire est muet, pose les deux écouteurs témoins, parent et frame.
- **Sélecteurs** : `.web-inspector-head strong` (titre = libellé de la sélection), `.web-preview-stage[data-mode]`, `.web-quick-comment`, `.web-ticket-editor`, `textarea[aria-label="Comment"]`, `.web-markup-toolbar button[aria-label=…]`, `.web-ticket-list button`, `button[aria-label="Remove ticket"]`, `.web-review-button`, `.web-comment-pin`, `.web-ancestors button`, `.web-connection-notice`. Pièges : l'icône Commentaires s'appelle `Comments (n)` dès qu'il y a un ticket, vise `button[aria-label^="Comments"]` ; `:has-text("Back")` matche aussi « Validate feed**back** », utilise `getByRole('button', { name: 'Back', exact: true })`.
- **Le brouillon** `.local/web/.paramrig/draft.json` est partagé par toutes les fenêtres : un script qui crée des tickets les supprime à la fin ; une seconde fenêtre ouverte sur le même projet passe en « Draft changed elsewhere » à la première écriture, c'est attendu. Les lots validés sont immuables : un test de publication crée son propre ticket et tolère les lots existants ; ne supprime rien dans `.local/web/.paramrig/` à la main.
- Couvre 1440 px, 1024 px et 390 px, thèmes clair et sombre, et exige zéro erreur console. La capture d'écran (`getDisplayMedia`) ne se teste pas en headless : dis-le dans le bilan.

## 0. Diagnostic de départ (mesuré le 6 septembre 2026, à reproduire avant de toucher au code)

- **Poignée de main** : entre l'affichage de la barre d'outils et la disparition de « Connecting to preview », 2,4 s à l'ouverture, 2,1 s après « Reload preview », 1,4 s à un changement de page. Pendant ce délai le bouton Sélection est cliquable et non pressé, les contrôles ne sont pas inertes et « Review changes » est actif : tout a l'air prêt, rien ne répond. Cause : `src/web/example/main.tsx` attend `fetch('/api/web/state')` puis le montage React avant que `connectWeb` écoute, donc le `hello` envoyé au `load` de l'iframe est perdu et l'intervalle de relance de `WebWorkspace.tsx` est de 2 000 ms. Le même `hello` part aussi avant la navigation de l'iframe et produit l'avertissement console « Failed to execute 'postMessage' … does not match the recipient window's origin ».
- **Lien profond** : `/r/web-fieldnotes` sur un profil sans `localStorage['paramrig.web-projects.v1']` affiche « This rig is not in the example registry » (`src/workspace/WorkspacePage.tsx`), parce que `getRig` (`src/rigs/registry.ts`) ne connaît que les projets mémorisés ; le repli « Connect this web project » de `WebWorkspace` n'est jamais atteint alors que `/api/web/state` connaît le projet.
- **Survol collant** : le SDK n'écoute aucun `pointerleave` ; quand le pointeur sort de l'iframe, le dernier contour de survol (souvent celui de `.fn-page`, un cadre sur toute la page) reste dessiné dans tous les états suivants, revue et snapshots compris.
- **Sélection sans contrôle** : sélectionner le kicker du hero donne un inspecteur vide, deux puces « hero » et « page » et rien d'autre ; le message « No controls on this page » n'apparaît que sans sélection. Rien n'indique que « Title size », « Title text » et « Corner radius » existent tant qu'on n'a pas cliqué le bon élément.
- **Libellés bruts** : « story card », « hero », « page », « div » (un ancêtre non instrumenté) en titre d'inspecteur et dans les puces ; statuts `provisional`, `missing`, `ambiguous` affichés tels quels dans les lignes de cibles.
- **Titres de section remplacés par la portée** : « ALL INSTANCES », « FROM STORY CARD · ALL INSTANCES », « CONTROLS » ; et « Global » répété sur chaque section quand tout est global (`WebControls.tsx`, `selection.ts`).
- **Bouton flottant « Comment »** posé au-dessus de l'élément sélectionné : il recouvre le titre « From the journal » quand une carte est sélectionnée.
- **Marques** : en mode dessin, l'extrémité d'une marque d'un autre ticket se saisit (rayon 16 px, `down()` dans `sdk.ts`) et l'hôte bascule alors le ticket actif vers le propriétaire de la marque (gestionnaire `mark` de `WebWorkspace.tsx`) ; constaté : un second passage a raccourci la flèche du ticket 1 en dessinant dans le ticket 2.
- **Revue** : couleurs en hex sans pastille, exclusion possible par commentaire mais pas par contrôle, aucun contexte par ticket (page, cible, marques, capture), copie « Validate feedback » ; après validation, rien ne dit où le lot a été écrit ni quoi dire à l'agent, alors que `docs/web-workspace.md` donne l'instruction.
- **Divers mesurés** : preset Desktop 1440 dans une scène de 1120 → l'aperçu déborde et se coupe, le zoom reste à 100 % ; zoom limité à 50–100 % ; « Review changes » est le contrôle le plus visible de la barre et le plus souvent grisé ; le sélecteur de page fait 112 px avec « Home » à gauche et le chevron à droite ; pastille d'état de 6 px dont le texte n'existe qu'en tooltip et qui disparaît à 390 px ; « Draw on page » porte le même glyphe `Maximize` que « Available width » et que le déclencheur de taille ; recadrage de capture par quatre `NumberController` X / Y / W / H ; « Draft changed elsewhere » propose deux boutons sans date ni nombre de différences ; l'outil Sélection reste pressé en revue ; les numéros de pastille sautent quand des tickets sont validés.
- **Ce qui tient** : barre sur une rangée à 1024, deux rangées et dock Page / Inspector à 390, thème clair cohérent, texte atténué à environ 6:1, tous les boutons nommés, aucun tooltip natif, flèches du clavier dans l'arbre, historique partagé contrôles / commentaires, capture DOM automatique à la création d'un ticket. Ne régresse rien de cette liste.

Prends des captures de cet état avant de commencer (1440 px : contrôles projet, carte sélectionnée, kicker sélectionné, éditeur de ticket, revue ; 390 px : barre et inspecteur) et garde-les dans `e2e/reference/web/before/` ; le bilan les compare aux captures finales dans `e2e/reference/web/after/`.

## Chantier A · La poignée de main

- Le SDK s'annonce dès `connectWeb` : un message `{ type: 'sdk-present', projectId, instanceId }` posté au parent (origine `hostOrigin`), auquel l'hôte répond par `hello` immédiatement ; l'hôte garde en plus une relance à pas court (100, 200, 400, 800 ms puis 2 s) jusqu'au premier `ready`, et n'envoie plus rien avant le `load` de l'iframe (fin de l'avertissement `postMessage`). `WEB_PROTOCOL` ne change pas si les anciens SDK restent compatibles ; sinon incrémente-le et dis-le dans la doc.
- Tant que `connection !== 'Connected'` : le bouton Sélection, la palette de dessin et les contrôles sont inertes (`inert`, pas seulement grisés), « Review changes » est désactivé, et l'aperçu porte un voile discret (`--surface-preview` à faible opacité) avec le texte d'état centré, à la place du chip en bas à gauche. À la reconnexion, le mode et la sélection courants sont renvoyés (c'est déjà le rôle de `previewEpoch`, vérifie).
- Cible mesurée : « Connected » moins de 300 ms après que le SDK a fini de se connecter, à l'ouverture, au reload et au changement de page.
- Tests : `sdk.test.ts` (annonce à la connexion, aucune écoute avant appariement conservée), un test de la file de relance de l'hôte (fake timers), `web-connect.e2e.mjs` qui mesure la durée de vie de `.web-connection-notice` dans les trois cas et vérifie qu'un clic de sélection émis 100 ms après « Connected » produit une sélection.

## Chantier B · Le lien profond et la page de connexion

- Un `rigId` en `web-*` inconnu du registre ne montre jamais « This rig is not in the example registry » : `WorkspacePage` délègue à `WebWorkspace`, qui interroge `/api/web/state` ; si l'identifiant correspond, il mémorise le projet et ouvre l'atelier ; sinon il affiche le repli existant avec le lien vers `/web`. `getRig` peut aussi apprendre à répondre pour ces identifiants ; choisis l'endroit le plus simple et dis pourquoi.
- `/web` : une phrase sous le titre dit ce que fait l'atelier, la ligne du projet montre son origine et son nombre de pages, et l'état « Looking for the local web service » a un vrai retour d'erreur avec la commande à lancer. Pas de bouton de copie décoratif ; les blocs `code` restent sélectionnables.
- Tests : unitaire sur la résolution d'un identifiant web absent du stockage ; `web-deeplink.e2e.mjs` qui vide `paramrig.web-projects.v1`, ouvre `/r/web-fieldnotes` et attend `.web-toolbar`.

## Chantier C · Survol, sélection et état vide

- `pointerleave` / `pointerout` sur `window` dans le SDK efface `hover` et redessine ; Échap et le retour en `browse` aussi (vérifie que c'est déjà le cas).
- Le contour de survol porte une étiquette (chip dans le SVG de l'overlay, police système, couleurs passées par `configure` depuis les tokens de l'hôte pour suivre le thème) avec le libellé de l'élément et, s'il a des contrôles, leur nombre ; c'est ce qui rend les éléments instrumentés découvrables sans surcharger la page.
- Sélection sans contrôle : l'inspecteur dit « No controls on this element » puis liste les ancêtres qui en ont (« Hero title · 2 controls ») et les cibles instrumentées de la page, cliquables (elles sélectionnent et révèlent l'élément via `select` / `reveal-target`). Sans sélection, une section repliée « On this page » dans les contrôles projet liste les mêmes cibles avec leur nombre de contrôles.
- Libellés : `data-paramrig-label` d'abord, sinon l'identifiant mis en forme (« Story card », « Hero title »), sinon le contenu textuel, sinon « Unnamed <tag> » ; jamais un identifiant brut ni « div » seul. Statuts en mots : « Not instrumented », « Missing on this page », « Several matches » ; la ligne de cible montre une icône d'état et son bouton « Reattach » seulement quand il s'applique.
- Le sélecteur reste `Select element`, mais le tooltip dit le raccourci (« Select element · Esc to leave »).
- Tests : `sdk.test.ts` pour le `pointerleave` et l'étiquette ; `selection.test.ts` pour les libellés ; un test de composant pour l'état vide ; `web-select.e2e.mjs` avec capture du kicker sélectionné.

## Chantier D · Sections, portée et commentaire rapide

- `WebControls` : le titre de section est toujours le nom du groupe ; la portée (« Global », « Page », « All instances », « From Story card ») devient un badge discret à droite du titre, et n'apparaît pas quand toutes les sections visibles partagent la même portée. Le groupe « Selected element » garde son nom.
- Le bouton flottant « Comment » quitte la page. À sa place : un bouton icône « Comment on selection » dans l'entête de l'inspecteur, visible quand une sélection existe, tooltip « Comment · C », et la touche C conservée dans le SDK. Les pastilles numérotées restent sur la page.
- Les puces d'ancêtres deviennent un fil d'Ariane (« Page › Hero › Hero title »), les deux plus proches visibles, le reste dans le menu existant.
- Tests : composant pour les badges (aucune section ne porte « Global » quand tout est global) ; `web-scope.e2e.mjs` : carte sélectionnée, titre de section « Selected element », badge « All instances », capture.

## Chantier E · Marques, dessin et tickets

- En mode dessin, seules les marques du ticket actif se saisissent ; les autres se dessinent à opacité réduite et ne répondent pas au pointeur. Un `mark` reçu pour une marque d'un autre ticket est ignoré côté hôte (garde), et un test le prouve.
- Entrer en revue, en snapshots ou en capture repasse le mode en `browse` et dépresse le bouton Sélection ; en sortir ne le rétablit pas.
- Numérotation : un ticket garde son numéro du début à la fin (liste, pastille, entête) ; les validés n'apparaissent plus sur la page mais ne décalent pas les autres.
- Outil « Draw on page » : un glyphe qui n'est utilisé nulle part ailleurs dans la barre, et un tooltip qui dit « Draw in page coordinates ».
- Tests : `sdk.test.ts` (saisie d'extrémité limitée au ticket actif), `session.test.ts` (numéros stables), `web-marks.e2e.mjs` : deux tickets, une flèche chacun, tenter de déplacer celle de l'autre, vérifier que rien n'a bougé.

## Chantier F · La revue et la remise à l'agent

- `FeedbackReview` : chaque changement de contrôle a sa case, avant / après avec pastille pour les couleurs et unité pour les nombres ; un changement exclu remet sa valeur source dans `batch.values` et disparaît de `batch.changes` (précise-le dans `session.batch` ou dans la revue, avec un test). Chaque ticket montre sa page, sa cible principale, le nombre de marques et la vignette de sa dernière capture.
- Copie : « Approve feedback » pour le bouton, « Sent to agent » pour le statut `todo` dans l'interface (la valeur du contrat ne change pas).
- Après publication, l'inspecteur montre un panneau de confirmation : le chemin `.paramrig/batches/<id>.json`, l'instruction à donner à l'agent (celle de `docs/web-workspace.md`) dans un bloc `code` sélectionnable, et un bouton « Back to comments ». Le bouton « Review changes » revient à l'état repos.
- Tests : `FeedbackReview.test.tsx` (exclusion d'un contrôle, valeurs du lot), `web-review.e2e.mjs` qui crée un ticket, ouvre la revue, exclut un contrôle, publie, vérifie le fichier de lot via `/api/web/state`, puis supprime le ticket restant.

## Chantier G · Taille, zoom et barre d'outils

- Un preset plus large que la scène passe le zoom en « Fit width » et le dit dans le tooltip du déclencheur ; revenir à « Available width » rétablit 100 %. Options de zoom : 50, 75, 100, 150, 200 % et Fit.
- « Review changes » : variante `quiet` sans compteur quand il n'y a rien à revoir, `solid` avec compteur sinon ; le compteur sépare contrôles et commentaires dans son tooltip.
- Sélecteur de page à la largeur de son contenu, chevron collé au libellé. Pastille d'état de 8 px, tooltip immédiat, et à 390 px l'état est lisible dans le menu du projet.
- Le tooltip « Preview size » ne s'ouvre pas quand le focus revient au déclencheur après Échap (regarde `isKeyboardFocus` dans `Tooltip.tsx` ; si la correction touche le composant partagé, teste le vectoriel).
- Tests : composant pour l'état repos du bouton ; `web-viewport.e2e.mjs` : preset Desktop dans une scène de 1120, lire `.web-size-trigger` et le zoom, capture à 1440 et à 390.

## Chantier H · Recadrage et récupération

- `ScreenCapture` : un rectangle glissable sur l'image (déplacement et huit poignées, cibles 32 / 44 px, `--focus-ring`), les quatre champs numériques passent en secondaire dans un `details`. Le résultat sauvegardé est identique à l'ancien pour un même cadre (test sur un `canvas` factice).
- « Draft changed elsewhere » : pour chaque version, la date d'enregistrement, le nombre de commentaires et le nombre de valeurs différentes de la source ; le bouton principal est celui de la version la plus récente.
- Tests : composant pour le recadrage et pour le contenu du dialogue.

## Chantier I · Documentation et bilan

- `docs/web-workspace.md` suit chaque changement de comportement (poignée de main, lien profond, revue, copie). `e2e/README.md` gagne une section « Web » avec les pièges du protocole ci-dessus.
- `docs/web-workspace-prompt-1-bilan.md` : ce qui était demandé, ce qui est livré, ce qui est partiel, ce qui est laissé de côté et pourquoi, avec les mesures de poignée de main avant / après sur trois passages et l'écart entre passages, les captures avant / après, et la liste de ce qui n'a pas pu être vérifié en headless (capture d'écran, souris réelle sous la ligne de flottaison, réponse d'agent réelle, contraste forcé, tactile).

Livre les chantiers dans l'ordre, A d'abord ; ils sont indépendants mais A conditionne la fiabilité de tous les tests suivants. Dis clairement où tu t'arrêtes et ce que ça coûte à l'utilisateur.
