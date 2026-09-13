# @paramrig/vector

Vector documents, bindings, geometry and SVG rendering, with explicit browser and export adapters. Drawing and page layout use this same engine.

```sh
npm install @paramrig/vector
```

```js
import { createVectorDocument, createVectorElement } from '@paramrig/vector'
import { createVectorRenderer } from '@paramrig/vector/browser'

const document = createVectorDocument()
document.elements.push(createVectorElement('rectangle', { x: 20, y: 20, width: 100, height: 60 }))
const view = createVectorRenderer({ container: documentHost, document })
await view.ready
const svg = await view.exportSvg()
view.destroy()
```

The SDK factory does not save anything. The application adds persistence around that same factory. Import/export project helpers retain the existing project format and return import errors and loss notes.

`browser` accepts a document, controlled parameter values and optional resource resolvers. `update` returns a promise; wait for it before exporting the updated result. `destroy` removes only the owned view and fonts and cancels pending image work.

Resource resolvers are supplied by the host. Font requests include the family, weight, purpose (`display` or `outline`) and cancellation signal. Return font bytes or null. Image resolvers return self-contained data URLs. No `/fonts` path or browser storage is assumed by the package. Carried font bytes are usable without a resolver.

Dedicated entries include `model`, `bindings`, `geometry`, `svg`, `project`, `resources`, `export` and `pdf`. PNG uses browser canvas. PDF preserves the existing path writer and reports rasterized or skipped elements. Supply its rasterization callback where needed for effects and unsupported PDF primitives.

Node supports contracts, project serialization and bindings. Typography, canvas-dependent geometry and raster exports require a browser; server rendering is not claimed to match browser text layout. React controls and complete editors are not included.
