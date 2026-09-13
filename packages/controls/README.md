# @paramrig/controls

Controlled React parameter inputs, with no audio, vector or 3D engine.

```jsx
import { RigControls } from '@paramrig/controls';
import '@paramrig/controls/styles.css';
<RigControls parameters={parameters} groups={groups} values={values}
  onChange={(id, value) => setValues(old => ({ ...old, [id]: value }))}
  onGestureStart={beginGesture} onGestureEnd={endGesture} onGestureCancel={cancelGesture} />
```

React and React DOM are peer dependencies, tested with 19.2. Styles are optional, scoped to the components and their portals, and use system fonts. `ParameterControl` renders one input; `ControlsScope` scopes a host's custom inputs. No document, history or browser storage is accessed.

Use `createControlRegistry()` and pass `registry` to override a kind (`number`) or a specific view (`select:font-library`). Resources are explicit: `resources.load(id, signal)` returns a Blob, and `resources.save(file, accept, maxMB)` returns a resource value. A file input is disabled until its host provides these callbacks. Specialised catalogues belong to the host's registered components.
