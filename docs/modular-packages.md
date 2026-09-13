# Modular packages and application domains

ParamRig uses npm workspaces and one dependency lockfile. The application aliases public package entries to their canonical sources during development and production builds. Package builds compile those same sources to ESM and standalone TypeScript declarations; they do not copy an alternative implementation of an engine.

## Choose a package

| Package | Responsibility | Host requirements |
| --- | --- | --- |
| `@paramrig/core` | Rig contracts, value validation, bindings and animated values | Node or browser; no engine, React or storage |
| `@paramrig/audio` | Patches, synthesis and block rendering; `/wav` and `/wavetables` | Node or browser; Core only |
| `@paramrig/audio-labs` | Existing seeded generation, variation, fusion and catalogs | Audio and Core; no visual interface |
| `@paramrig/audio-browser` | Independent AudioWorklet players | Host AudioContext and destination; secure browser context |
| `@paramrig/vector` | Drawing and layout documents, bindings, geometry, SVG, PNG and PDF | Explicit browser/export entries and font/image resolvers |
| `@paramrig/scene` | Documents, evaluated geometry, materials, shaders and scene instances | One host-owned Three.js copy; optional viewer |
| `@paramrig/controls` | Controlled React inputs and extensible control registries | Host React/React DOM; explicit scoped stylesheet |
| `@paramrig/web` | Existing web connector, contracts and schemas | Remains independent of Core and the other engines |

Package READMEs describe APIs and their errors. Runnable examples live in `examples/sdk/`. Copy an example outside the repository, install its dependencies and follow its README. Web's existing reference consumer and connected example remain available under `scripts/web-sdk-consumer` and `examples/web`.

Separate packages reduce installation dependencies. Sub-entries select what a bundler loads from an installed package. These are different guarantees. Installing an engine never installs the complete editor.

## Resources and ownership

Audio players receive an AudioContext and destination. Each maintains its own user wavetable registry. Stop ends playback; destroy disconnects owned nodes and ports and cancels pending work. Neither closes the host's context. The compiled worklet URL is resolved relative to the package and can be overridden for a host bundler or CSP.

Vector receives a container, document, parameter values and resource callbacks. Font callbacks receive display/outline purpose and a cancellation signal. Images resolve to self-contained data URLs. Await `ready` or `update()` before exporting. Node supports documents, serialization and bindings. Browser typography and canvas-dependent rendering are not presented as equivalent server rendering. PDF exposes skipped/rasterized output notes.

Scene instances expose their Three.js scene and cameras. A host can update document, values, time and view, then render in its own loop. The optional browser viewer owns its canvas and renderer; destroying it does not destroy a renderer owned by another integration. Texture and font resources are injected. Explicit, idempotent modifier initialization is shared with exports and previews. The visual engine reuses viewport geometry, materials, lighting and shaders; the glTF interchange builder is not its renderer.

Controls accept values and gesture callbacks. They have no document, history or engine dependency. Import `@paramrig/controls/styles.css` deliberately; styles are scoped, including portaled controls, and do not fetch fonts. Specialized controls use an explicit registry and host resource/catalog callbacks.

## Application loading

`src/modules` supplies Audio, Vector, Scene and Web descriptors. Each descriptor owns its editor, preview, import/export, examples, specialized controls and cleanup. `/audio`, `/vector`, `/3d` and `/web` open the relevant domain; `/r/:rigId` remains the document address.

The library reads a generated example catalog and a reconstructible local metadata index. It uses cached thumbnails without evaluating a scene or synthesizing audio. Domain CSS loads with its module. Full document validation happens when that domain opens.

Sound Labs keeps its existing Three.js spectral relief, loaded when the Labs view opens. That is a visualization owned by the Audio application, not a dependency of the Audio or Labs SDK, and it does not include the Scene editor or SDK.

## Storage compatibility

Existing document IDs, project formats, local storage keys and IndexedDB resource stores are retained. The metadata index is secondary to the documents. Rebuilding it reads metadata without regenerating patches or rewriting stored documents. A successful save remains successful when index persistence fails. Writes update only their target document, preserving unreadable or future-version neighbors in the same store. Other-tab changes are reconciled both while subscribed and when returning to the library.

The thumbnail cache is separate from document storage. A missing module or a failed lazy load keeps the stored project intact and offers an appropriate recovery route.

## Builds and gates

Run local tasks through Docker Compose from the repository root. Do not start a second persistent development stack to run these tasks.

```sh
docker compose run --rm app npm run build:sdks
docker compose run --rm app npm run test:sdks
docker compose run --rm app npm run build:app
docker compose run --rm app npm run build:modules -- --modules=audio
docker compose run --rm app npm run build:modules -- --modules=vector,scene
docker compose run --rm app npm run build:modules -- --matrix
```

The existing full build still writes `dist`. Selective builds and archives are generated under `.local/modularity/distributions` and `.local/modularity/archives`. Selection generates literal entry points at compilation. Public resources are copied from explicit domain allowlists; omitted domains are checked in actual bundle graphs and archive contents.

The bundle measurement code calibrates its gzip and graph collectors against known fixtures. CI checks clean tarball installations, strict NodeNext declarations, Node APIs, browser builds and runnable examples. It checks forbidden dependencies, a single Three.js copy, Audio plus WAV below 30,000 gzip bytes, Labs below 90,000 bytes, and the initial library JS/CSS below 250,000 bytes. Vector, Scene and Controls have recorded consumer baselines in `tests/consumers/budgets.json`; a growth above 5% requires an explicit, documented baseline change.

Consumer bundles include the host libraries and export paths their fixtures exercise. Their gzip sizes are not npm installation sizes. Generated reports list installed dependencies and the actual modules and assets measured.
