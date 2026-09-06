# Pre-release prompt 1 — what was asked, what was delivered

Work carried out on 6 September 2026 against `main`, in five commits, one per chantier. Every number
below was measured on the day, in the browser or in Docker, not estimated. The pictures are in
`e2e/reference/web/pre-release/before/` and `.../after/`; the browser checks that produce the
equivalent are `e2e/web-sdk-guard.e2e.mjs` and the eleven `web-*` scripts beside it.

## The short version

All five chantiers are delivered. Nothing was left out for lack of time. Five decisions the prompt
left to the agent are set out under **Choices made and why**, and one instruction was overtaken by a
later one — `files` in the SDK package had to grow for chantier D's schemas to ship.

Two things could not be verified from this machine, and neither was worked around: the file
ownership on Linux, and the GitHub Actions workflow, which has never executed. The public site and
its DNS are recorded rather than repaired, as instructed.

## The diagnostic reproduced first

Every item of the starting diagnostic was reproduced before anything was touched. All of it held.

| Measured | Reproduced |
| --- | --- |
| The SDK posts to `window.parent` with no frame | `http://127.0.0.1:5174/examples/web/index.html` alone: `Failed to execute 'postMessage' on 'DOMWindow': The target origin provided ('http://localhost:5174') does not match the recipient window's origin ('http://127.0.0.1:5174').` No overlay. |
| A host alias blanks the page | The same page at `http://localhost:5174/…`: `#root` **0 characters**, `pageerror: Error: Check the ParamRig host and project origins.`, and React's `<Demo>` boundary warning. |
| The workbench origin is hard-coded | `http://127.0.0.1:5174/r/web-fieldnotes` never pairs; after 8 s, `Preview unavailable or SDK missing. Check the page URL and frame permissions.` |
| The seed is on by default | `compose.yml:45`, `PARAMRIG_SEED_MANIFEST` defaulted to the example's manifest; files `-rw-------`, user `node`. |
| The package carries the workbench | `.htaccess`, `favicon.svg`, `fonts/PublicSans.ttf`, `fonts/PublicSans.woff2`, `fonts/PublicSans-OFL.txt` in `packages/web-sdk/dist`. |
| The repository | No `LICENSE`, no `license` field, `git ls-files output` → **59 files, 6.2 MB**, no `.github`, no `engines`. |
| The demo routes | `public/.htaccess` rewrote `r/*`, `docs`, `docs/controls` — three of the seven routes `src/App.tsx` declares. |
| The public site | `paramrig.com` has an A record (`213.186.33.5`) and refuses HTTPS; `demo.paramrig.com` has no DNS record. Both still true at the end of the day. |

One thing in the diagnostic is not ParamRig's: the example page also logs a 404, for the favicon its
HTML does not declare. It is the demo page's, it was there before, and it was left alone.

## The console of the example page, before and after

Only ParamRig's own lines are shown; Vite's client and React's DevTools notice are in both columns.

| | before | after |
| --- | --- | --- |
| Opened alone at `http://127.0.0.1:5174` (the manifest's origin) | `warning: Failed to execute 'postMessage' on 'DOMWindow': The target origin provided ('http://localhost:5174') does not match the recipient window's origin ('http://127.0.0.1:5174').` | **nothing** |
| Opened alone at `http://localhost:5174` (the host alias) | `pageerror: Error: Check the ParamRig host and project origins.` plus React's boundary warning; `#root` **0 chars** | `warning: ParamRig: this page is at http://localhost:5174 and .paramrig/manifest.json declares http://127.0.0.1:5174. Open the page at the manifest origin, or set the manifest's "origin" to http://localhost:5174. The page is left untouched.` — one line, `#root` **3902 chars** |

`web-sdk-guard.e2e.mjs` re-measures both on every run: zero SDK messages and zero
`paramrig-overlay` elements in the first case, exactly one warning naming both origins and a whole
page in the second. It derives the alias from the manifest the service serves rather than assuming
which of the two addresses is which — getting that the wrong way round makes every check pass
against the same URL twice, which it did on the first attempt.

## Pairing by either address

The workbench opened by `127.0.0.1` never paired before, in silence, for the whole eight seconds.
Measured as the lifetime of `.web-connection-notice`, in the page's own clock:

| | paired in |
| --- | --- |
| `http://localhost:5174/r/web-fieldnotes` | **72 ms** |
| `http://127.0.0.1:5174/r/web-fieldnotes` | **85 ms** |

`web-sdk-guard` fails if either exceeds a second, if they differ by more than half a second, or if
either produces a `postMessage` recipient warning.

The handshake itself is unchanged. `web-connect` at the last commit: open 102 / 81 / 68 ms, reload
78 / 93 / 54 ms, page change 60 / 45 / 44 ms, and from the SDK announcing itself to **Connected**
6 to 28 ms over nine passes — against 10 to 35 ms recorded in the previous report.

One regression was found and fixed on the way: clearing the diagnosis handed React a fresh empty
array on every `ready`, which is every reconnection and every page change, and each one cost a
render of the whole workspace. `clearCauses` returns the array it already has when there is nothing
to clear, and the numbers came back.

## Chantier by chantier

### A · The SDK no longer surprises the integrator — delivered

`connectWeb` never throws. It declines, in three ways, and hands back a connection whose `dispose()`
is safe to call:

- **Not in a frame**: nothing at all. No listener, no observer, no overlay, nothing in the console.
- **`manifest.origin` is not the page's origin, or `hostOrigin` is not an origin**: one
  `console.warn` naming both and what to correct.
- **Called again before `dispose()`**: a warning, and the previous connection is replaced.

`parseManifest` still throws, and the guide says why.

`hostOrigin` is optional, takes a string or a list, and defaults to
`['http://localhost:5174', 'http://127.0.0.1:5174']`. `src/web/example/Demo.tsx` and
`docs/web-workspace.md` no longer write it.

The announcement is addressed to the parent's exact origin when the browser names it —
`location.ancestorOrigins`, then `document.referrer` — and to `'*'` otherwise. On Chrome, the
acceptance target, it is always the exact origin, which is why pairing by either address produces no
recipient warning. The reasoning is written into the **Pairing** section of `docs/web-workspace.md`:
the announcement carries a project identifier and a random per-load instance identifier and grants
nothing, the session is opened by the `hello` that answers it, that reply is accepted only from a
declared origin, and the accepted `hello` **pins** its origin so every later message in both
directions is checked against that one origin and that one session. It is posted even when the
parent is not a declared origin, on purpose, so that the case below can be reported at all.

The workspace says what is missing. After eight seconds, the three causes in the order they usually
are; and when an announcement has been heard — which proves the page is reachable, the SDK is loaded
and the frame is allowed — the one cause that is left, after two seconds rather than eight. Both
panels were driven in the browser by replacing the preview's own module at the network level, and
are in `after/panel-three-causes.png` and `after/panel-sdk-refused.png`.

Tests: six new cases in `sdk.test.ts`, two in `handshake.test.ts` for the two messages, and
`web-sdk-guard.e2e.mjs`, 17 checks.

`sdk.test.ts` also changed shape. jsdom answers `window.parent` with the window itself — exactly the
case the SDK now declines — so the tests install a stub in that slot. They were previously exercising
the un-framed path by accident.

### B · The service and Compose facing a foreign project — delivered

The example manifest is seeded into an empty project directory and no other. **Why this rather than
a second Compose service for the example:** a second service sharing the `web` network alias behind a
second profile would move the default out of the generic service, but it leaves two services that
must never run together and it changes the command the documentation has always given. The
empty-directory rule costs one `readdir`, needs no second variable and no second service, and makes
`PARAMRIG_PROJECT_DIR=/path docker compose --profile web up -d` safe exactly as written.

Driven for real: the service was pointed at a temporary folder holding a `package.json` and no
manifest, with no `PARAMRIG_SEED_MANIFEST`. The log said
`ParamRig: /project is not empty, so the example manifest was not copied into it.`, `/api/web/state`
answered **404**, and the folder came out holding `.paramrig/` with `README.md`, `.gitignore` and the
three empty directories — and no Fieldnotes manifest. `/web` said:

```
No web manifest found. Add .paramrig/manifest.json to the connected project.
The service is connected to a project that has no manifest yet. Write it here, then reconnect.
/project/.paramrig/manifest.json
```

The message is unchanged, and the page now names the file rather than offering the command to start
a service that is already running. That needed one new key in the error body — `path`, beside
`error`, on the missing-manifest answer only — carried to the page by a `NoManifest` error in
`src/web/client.ts`. It is not a manifest, batch or response key, so it does not touch the schemas;
it is documented where the message is.

The `web` service runs as `${PARAMRIG_UID:-1000}:${PARAMRIG_GID:-1000}`. On macOS nothing changed:
after recreating the service, `/api/web/state` answers, and `ls -la .local/web/.paramrig` shows the
same `-rw-------` files owned by the host user. **Linux was not tested here** — see below.

The service writes a `.paramrig/.gitignore` when there is none, covering `draft.json` and
`captures/`. **Why write it rather than only recommend it:** the service already writes `README.md`
into the same directory it owns entirely, this is the same class of act, and the two lines it
contains are the two files ParamRig rewrites and nobody wants in a diff. It is never written over,
so an edit survives; deleting it brings it back on the next start, exactly as `README.md` does, and
the test says so. What to do with `manifest.json`, `batches/` and `responses/` stays the project's
call, and the guide sets out the trade-off rather than deciding it.

Tests: three new cases in `services/web/server.test.mjs` — the seed accepted in an empty folder and
refused in a project, the 404 naming the path, and the `.gitignore` that survives an edit across two
restarts.

### C · A clean SDK package — delivered

`publicDir: false` and `emptyOutDir: true`, which is why the build now runs **before** `tsc` rather
than after it: the declarations land in the same directory, and a build that wiped them afterwards
would ship a package with no types. `dist` is seven files.

`scripts/check-web-sdk.mjs` runs as part of `npm run build:web-sdk` and fails on anything else. It
was checked against both failure modes: a `favicon.svg` dropped into `dist` is reported by name, and
an `exports.types` pointing at a file that is not there fails twice over — once on the missing file
and once because the reference consumer stops compiling.

That consumer is not a mock. `scripts/web-sdk-consumer/` is a small project with its own
`tsconfig.json` that imports `@paramrig/web` through a link in its own `node_modules`, so TypeScript
resolves the package the way anyone else's does: through `exports`, its `types` condition, and the
declarations as emitted. Its manifest is a second valid manifest shape, and the schema test uses it.

`packages/web-sdk/package.json` declares `license`, `repository` with `directory`, `homepage`,
`bugs`, `keywords`, `sideEffects: false`, and `exports` with `types`, `import` and `default`. It
stays `private: true`.

**Where this departs from the prompt:** chantier C says `files` unchanged, and chantier D says the
schemas ship in `files`. `files` is now `["dist", "schemas", "README.md"]`. The later instruction
wins; the point of "unchanged" was not to broaden it to the whole package, and it has not been.

`package.json` at the root declares `engines.node: ">=22.6"`, with the reason in
`docs/local-docker-development.md`: the feedback service runs under
`node --experimental-strip-types`, which is where type stripping first appeared.

### D · The integration guide and the schemas — delivered

`packages/web-sdk/README.md`, 309 lines, written for the agent that maintains the project being
tuned and self-contained: installing, every manifest field, the 22 control kinds and the four that
ask for more, the three binding kinds and the three scopes, `unit`, `revision`, the four
`data-paramrig-*` attributes and the naming order, `connectWeb` in development only with `dispose` on
unmount and on hot reload, what it does when there is no workbench, the `frame-ancestors` header and
HTTPS, a table of what to commit in `.paramrig`, then the loop: reading a batch, applying it in the
source, the exact response shape, `needs-info`, and what never changes. `docs/web-workspace.md` points
at it for integration and keeps the workbench's own side; the two do not repeat each other.

JSON Schema (draft 2020-12) for the manifest, the batch and the response, in
`packages/web-sdk/schemas/`, shipped in the package and reachable as
`@paramrig/web/schemas/<name>.schema.json`. The `GUIDE` the service writes names them in one added
sentence.

`src/web/schemas.test.ts` confronts them with the guards on real samples — `examples/web/manifest.json`,
a batch the workspace actually wrote (copied out of `.local/web/.paramrig/batches/` into
`src/web/samples/`), and the response from the guide — and on eleven malformed ones. Every case
asserts that the schema and the guard reach the **same** verdict.

**No validator dependency, and here is why that is not a weaker test.** The SDK may take no runtime
dependency, and the subset of JSON Schema these three files use is small and fixed, so the test
carries its own validator for that subset. Its correctness is not taken on trust: because every case
asserts an equivalence, a validator that waved everything through would fail on the eleven invalid
samples, and one that refused everything would fail on the valid ones. Leniency shows up as a failing
test rather than a passing one.

Three rules cannot be written in JSON Schema. Each schema says so in its own `description`, and the
test pins each: identifiers unique within a manifest and bindings naming a declared control belong to
`parseManifest`; a response answering a ticket outside its batch is well formed to both the schema
and `isResponse`, and is refused by `session.response`, which is the only place the batch is beside
it.

### E · The repository — delivered

MIT, in `LICENSE` at the root, `Copyright (c) 2026 Soheil Saheb-Jamii`, declared by both package
manifests. `packages/web-sdk/LICENSE` is a copy so a published tarball travels with it — beyond the
letter of the prompt, and the ordinary shape for a package in a repository. The README's
**Licensing status** paragraph, which said no licence had been chosen while the same file called the
project open-source, now says what is true, including that the bundled Public Sans keeps the SIL
Open Font License beside it.

`output/` left the index — `git rm -r --cached`, so the 59 files are still on disk and nothing was
deleted — and `output/` and `e2e/output/` are ignored. `e2e/reference/`, which is the record a run is
compared against, stays tracked. `docs/web-workspace-roadmap-prompt.md` and this prompt are committed.

`.github/workflows/verify.yml` runs on push and pull request: Node 22, `npm ci`, then exactly the
chain agents run in Docker minus `npm run e2e`, plus `npm pack --dry-run` in the package. `npm ci`
has a lockfile to work from; `package-lock.json` is tracked.

`public/.htaccess` rewrote three of the seven routes `src/App.tsx` declares, so a reload or a shared
link to `/web`, `/docs/vector-rigs` or `/docs/scene-rigs` on the demo host would have answered with
Apache's own 404. It now covers all of them. `src/App.routes.test.ts` reads both files, puts each
route through the real rewrite rule, and fails naming the route that has none — checked by removing
`web/?` from the rule, which failed with `expected [ 'web' ] to deeply equal []`. It also holds the
other half of the rule: a missing asset is still not answered with the application.

`docs/deployment-ovh.md` gains those routes in its acceptance list and a section on what the
deployment is waiting for. `src/library/LibraryPage.tsx:179` is deliberately unchanged: the address
is right and it is the site that is missing.

## Choices made and why

Five decisions the prompt left open, all of them written into the code beside what they govern.

1. **A second `connectWeb` replaces the first** rather than being refused with a warning. After a hot
   reload the newer call's adapters close over the state that has just been rebuilt; the older ones
   write into a tree that is gone, which reads as a workbench that has stopped responding. Refusing
   would keep the dead one. Either way two overlays never coexist, and the warning still says the
   cleanup is missing.
2. **The seed is guarded by an empty directory** rather than by a second Compose service. Reasoned
   above, under chantier B.
3. **The `.gitignore` is written** rather than only recommended. Reasoned above, under chantier B.
4. **The announcement goes to the exact parent origin when the browser names it**, and to `'*'` only
   when it does not — `location.ancestorOrigins` is absent in Firefox, `document.referrer` is the
   fallback, and on Chrome neither is needed because the first always answers.
5. **The schema test carries its own validator** rather than taking a development dependency.
   Reasoned above, under chantier D.

## Decisions still open

None was needed. Everything the work reached was either in the prompt's list of Soheil's decisions or
was a technical choice of the kind listed above. Three things are outside this prompt's scope and are
waiting on a decision that is not an agent's:

- **When to publish, and whether to lift `private: true`.** The package is ready to be packed and
  nothing here publishes; `@paramrig` was still free at the registry on 6 September 2026.
- **Whether `batches/` and `responses/` should be committed by a project.** The guide sets out the
  trade-off and does not decide for anyone.
- **The public site and the demo DNS**, which are not in this repository.

## The exact `npm pack --dry-run`

From `packages/web-sdk`, at the last commit. **13 files**, package size 28.3 kB, unpacked 94.1 kB.

```
LICENSE
README.md
dist/index-L3Zm-CoX.js
dist/paramrig-web.js
dist/rigs/extended-types.d.ts
dist/rigs/types.d.ts
dist/web/contracts.d.ts
dist/web/geometry.d.ts
dist/web/sdk.d.ts
package.json
schemas/batch.schema.json
schemas/manifest.schema.json
schemas/response.schema.json
```

Before this work the same command would have added `dist/.htaccess`, `dist/favicon.svg`,
`dist/fonts/PublicSans.ttf`, `dist/fonts/PublicSans.woff2` and `dist/fonts/PublicSans-OFL.txt`, and
one more stale chunk for every change to the SDK. The check script prints this list on every build
and fails on a file that is not a declaration, a chunk, a schema, the manifest, the README or the
licence — so it is not a list anyone has to remember to read.

## The pictures

| `before/` | `after/` |
| --- | --- |
| `alone-127.png`, `alone-localhost.png` — the page alone and by alias | the same two names, the second no longer blank |
| `workbench-127-after-8s.png` — the eight-second panel that never named the cause | `workbench-127-connected.png` — the same URL, paired |
| — | `panel-three-causes.png`, `panel-sdk-refused.png` — the two diagnoses |
| — | `web-foreign-project.png`, `foreign-project.txt` — `/web` pointed at a project with no manifest |
| `console.txt` — every line either page logged | `console.txt` — the same, and the panels' words |

## What could not be verified here

- **File ownership on Linux.** `PARAMRIG_UID` and `PARAMRIG_GID` were exercised on Docker Desktop for
  macOS, which maps ownership itself, so their effect was not observed: the service came back, the
  state served, and the files stayed `-rw-------` owned by the host user. The case they exist for is
  a Linux bind mount, where the container's numeric ids survive into the host, and that needs a Linux
  machine. Both documents say so.
- **GitHub Actions.** The workflow cannot run from here. It is held to the strict equivalent of the
  commands verified in Docker, and its first execution will be the first push.
- **The public site and the demo DNS.** Measured and recorded, not repaired. They are not in this
  repository.
- **A real publication.** `npm pack --dry-run` is as far as this goes, by instruction.
- Everything the previous report listed as out of reach is still out of reach: the browser's own
  screen-sharing picker, and browser zoom as a setting.

## Out of scope, and what it costs

Untouched, by instruction: the `npx paramrig` command line, publishing to the registry, compiling the
service standalone, serving the workbench without Vite, and several projects connected at once.

What that costs whoever tries this next: installing the SDK is still "build it from the ParamRig
repository and install the folder", because there is nothing on the registry to install. Everything
else a project needs — the guide, the schemas, the manifest contract, the response format — is in the
package and does not depend on where the package came from.

## Verification at the last commit

```sh
docker compose run --rm app npm run typecheck        # clean
docker compose run --rm app npm run lint             # clean
docker compose run --rm app npm test                 # 241 files, 3443 tests
docker compose run --rm app npm run test:web-service # 7 tests, 7 pass
docker compose run --rm app npm run build            # the two known warnings, nothing new
docker compose run --rm app npm run build:web-sdk    # 7 files in dist, 13 packed, consumer compiles
docker compose run --rm app npm run e2e -- web-      # 12 scripts
git diff --check                                     # clean
```

Against 239 files and 3412 tests at the start of the day: 2 test files and 31 tests added, none
removed. The service went from 4 tests to 7.

**171 checks across the 12 `web-*` scripts, none failing** — 11 scripts and 154 checks before, plus
`web-sdk-guard` and its 17.

One run of the whole suite reported a 30-second `page.goto` timeout in `web-deeplink`, on a route
that had passed minutes earlier — the shared browser's signature, as the previous report describes
it: a collision fails on a navigation or a socket, never on a check. Re-run alone it passed 10 of 10.
`e2e/output/web-*.txt` at the end of the day holds 171 `PASS` lines and no `FAIL`.
