# @paramrig/core

Shared ParamRig parameter and rig contracts, validation, binding transforms, expressions and animated values. ESM with TypeScript declarations. No React, browser storage or rendering engine.

```sh
npm install @paramrig/core
```

```js
import { evaluateExpression, normalizeValue } from '@paramrig/core'

const value = evaluateExpression('width * 2', id => id === 'width' ? 12 : 0)
```

The individual `types`, `extended-types`, `binding`, `sanitize`, `expression`, `values`, `parameter-values`, `drivers`, `fonts` and `font-value` entries expose the same implementation used by the application. Importing a contract does not initialize a renderer or read storage. Node 22 and modern ESM browsers are supported.

Validation preserves the application's existing limits and fallback rules. Callers retain ownership of documents, history and persistence. Font contracts describe carried data; this package does not fetch or register fonts.
