import { Link } from 'react-router-dom'
import { DocsChrome } from '@/docs/DocsChrome'
import { SCENE_PROPERTY_PATHS } from '@/scene/rig'

/**
 * How to write a scene that carries its own controls, for whoever is building one — a person
 * reading, or a model generating a file.
 *
 * The table of paths is generated from the parser's own field maps rather than typed out here, so
 * a property the app gains is a row on the same commit and a property it loses cannot linger.
 */

const EXAMPLE = `{
  "format": "paramrig.scene",
  "formatVersion": 1,
  "kind": "scene",
  "document": {
    "version": 1,
    "id": "scene-lantern",
    "name": "Paper lantern",
    "objects": [
      { "id": "lantern", "name": "Lantern", "kind": "mesh",
        "collectionId": "collection-scene",
        "transform": { "position": [0, 0, 1.1], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
        "visible": true, "selectable": true, "renderable": true,
        "data": { "kind": "mesh", "meshId": "mesh-lantern" },
        "modifiers": [
          { "id": "round", "kind": "subsurf", "name": "Subdivision",
            "enabled": { "viewport": true, "render": true, "editMode": false, "onCage": false },
            "params": { "levels": 2, "renderLevels": 3 } },
          { "id": "paper", "kind": "solidify", "name": "Solidify",
            "enabled": { "viewport": true, "render": true, "editMode": false, "onCage": false },
            "params": { "thickness": 0.06, "offset": -1 } }
        ],
        "materialSlots": ["paper"] }
    ],
    "meshes": { "mesh-lantern": { "vertices": [], "edges": [], "faces": [] } },
    "collections": [{ "id": "collection-scene", "name": "Scene" }],
    "materials": [
      { "id": "paper", "name": "Paper", "baseColor": "#f2e4cd",
        "metallic": 0, "roughness": 0.72, "emission": "#ffb45c", "emissionStrength": 1.2 }
    ],
    "rig": {
      "groups": [{ "id": "shape", "label": "Shape" }],
      "parameters": [
        { "kind": "number", "id": "roundness", "label": "Roundness", "group": "shape",
          "min": 0, "max": 4, "step": 1, "defaultValue": 2 },
        { "kind": "number", "id": "paper", "label": "Paper thickness", "group": "shape",
          "min": 0.01, "max": 0.3, "step": 0.01, "defaultValue": 0.06, "unit": "m" },
        { "kind": "number", "id": "spin", "label": "Spin", "group": "shape",
          "min": -180, "max": 180, "step": 1, "defaultValue": 0, "unit": "°" },
        { "kind": "color", "id": "glow", "label": "Glow", "group": "shape",
          "defaultValue": "#ffb45c" }
      ],
      "bindings": [
        { "id": "b1", "objectId": "lantern",
          "property": "modifiers[round].levels",     "parameterId": "roundness" },
        { "id": "b2", "objectId": "lantern",
          "property": "modifiers[paper].thickness",  "parameterId": "paper" },
        { "id": "b3", "objectId": "lantern",
          "property": "transform.rotation.z",        "parameterId": "spin" },
        { "id": "b4", "property": "materials[paper].emission", "parameterId": "glow" }
      ]
    },
    "createdAt": "2026-09-04T00:00:00.000Z",
    "updatedAt": "2026-09-04T00:00:00.000Z"
  }
}`

export function SceneRigsPage() {
  return (
    <DocsChrome>
      <h1>Scene rigs</h1>
      <p className="lede">
        A scene document is a 3D scene. A scene document with a <code>rig</code> is a rig: it
        exposes controls, and the scene follows them. The file is the same either way — a{' '}
        <code>.paramrig.json</code> saved from the editor, or written by hand and dropped on the
        library.
      </p>

      <h2>The shape of it</h2>
      <p>
        <code>document.rig</code> holds the same four things a vector rig does.{' '}
        <code>groups</code> names the sections the controls sit in; every control names one of
        them. <code>parameters</code> is the <code>ParameterDef</code> the rest of the workbench
        uses. <code>bindings</code> says which control writes where.{' '}
        <code>inspectorCategories</code> is optional.
      </p>
      <p>
        A binding is{' '}
        <code>{'{ id, objectId?, materialId?, property, parameterId, transform? }'}</code>. Most
        paths belong to an object, and name it with <code>objectId</code>; the paths marked{' '}
        <em>document</em> below belong to the scene and name no object. Anything the app cannot
        read — a control of an unknown kind, a binding whose object, modifier or control is not in
        the file — is dropped on the way in and reported, rather than guessed at.
      </p>

      <h2>What can be driven</h2>
      <table className="docs-table">
        <thead><tr><th>Property</th><th>Takes</th><th>Belongs to</th></tr></thead>
        <tbody>
          {SCENE_PROPERTY_PATHS.map((row) => (
            <tr key={row.path}>
              <td><code>{row.path}</code></td>
              <td>{row.takes}{row.note ? ` — ${row.note}` : ''}</td>
              <td>{row.scope === 'object' ? 'an object' : 'the document'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        A <code>number</code> property takes a number control, or a switch (off is 0, on is 1). A{' '}
        <code>color</code> takes a colour control, and a hex string. A <code>boolean</code> takes a
        switch. A modifier parameter takes whatever that modifier's schema declares, which is also
        where the editor reads the control's <code>min</code>, <code>max</code> and{' '}
        <code>step</code> from when the field is exposed with ◇.
      </p>

      <h2>Reshaping a value on the way</h2>
      <p>
        A binding may carry a <code>transform</code>: <code>scale</code> and <code>offset</code> map
        the value, <code>min</code> and <code>max</code> clamp it, and <code>expression</code>{' '}
        replaces both with arithmetic over <code>value</code> and the other controls by name —{' '}
        <code>value * 0.5 + lift</code>. An expression that cannot be read leaves the value alone.
      </p>

      <h2>Constraints</h2>
      <ul className="docs-steps">
        <li>Ids are stable. A control id is the export key and the name an expression uses; an object, modifier or material id is what a binding points at.</li>
        <li>Every number control states <code>min</code>, <code>max</code> and <code>step</code>. A range the wrong way round is repaired, not honoured.</li>
        <li>Every control names a group that <code>groups</code> declares. One that does not is dropped.</li>
        <li>Rotations are degrees, distances are metres, a light's power is watts, a focal length is millimetres. The units the editor shows are the units the file holds.</li>
        <li>Several bindings may write the same property; the last one in the list wins. One control may drive as many properties as it likes.</li>
        <li>A control's <code>defaultValue</code> is what the scene looks like new — the library thumbnail is rendered from the defaults.</li>
      </ul>

      <h2>Known approximations</h2>
      <ul className="docs-steps">
        <li>Shape keys are refused. <code>shapeKeys[name].value</code> parses as nothing until they exist, so that a binding cannot look as though it works while doing nothing.</li>
        <li>A vertex binding names an index of the mesh. Editing the mesh renumbers vertices, and a binding that pointed at one may then point at another.</li>
        <li>A driven modifier is evaluated on every change of its control. The stack is cached by its inputs, so a control that returns to a value it has held is instant, and one dragged through new values is not.</li>
        <li>A control cannot add or remove an object, a modifier or a material: it writes to what the file already contains.</li>
        <li>Resolution is pure and whole-document: a bound scene is rebuilt from the stored one on every change. It is fast because the meshes are shared, not copied — but a rig on a very heavy scene will feel it.</li>
      </ul>

      <h2>A whole one</h2>
      <p>
        A lantern whose roundness, paper thickness, spin and glow are exposed — a modifier
        parameter, a second one, a transform channel and a material field, which is one of each
        family. Drop this file on the library to open it; it arrives as a document and a rig at
        once. The same scene is bundled with the app, with its mesh filled in: open{' '}
        <strong>Paper lantern</strong> from the library.
      </p>
      <pre className="docs-code"><code>{EXAMPLE}</code></pre>

      <p>
        <Link className="text-link" to="/docs">Adding a rig</Link>
        {' · '}
        <Link className="text-link" to="/docs/vector-rigs">Vector rigs</Link>
        {' · '}
        <Link className="text-link" to="/docs/controls">Live controller catalog</Link>
        {' · '}
        <Link className="text-link" to="/">Back to the library</Link>
      </p>
    </DocsChrome>
  )
}
