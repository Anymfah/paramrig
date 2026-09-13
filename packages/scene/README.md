# @paramrig/scene

ESM scene documents, bindings, modifiers, geometry, materials and shaders shared with ParamRig.

Install `@paramrig/scene` and `three@0.185.1`. Use `/engine` to create content for your own Three.js renderer and animation loop, or `/browser` for an optional canvas owner. React is not required.

```js
import { createSceneInstance } from '@paramrig/scene/engine';
const instance = createSceneInstance({ document, renderer, resources });
await instance.ready;
instance.configureRenderer(renderer);
renderer.render(instance.scene, instance.camera);
instance.destroy(); // Your renderer remains yours.
```

`resources.resource(id, signal)` supplies textures and environments as blobs. `resources.font(request)` supplies outline font bytes. No browser storage or application asset paths are used. The host owns its renderer, render loop and resource source. Errors are available through `onError` and `instance.errors`.

The root entry supports documents and bindings under Node. `/gltf`, `/obj` and `/stl` expose the existing format readers and writers with their existing limits. Graph materials and image environments require the browser; glTF is an interchange export and does not reproduce every procedural shader.
