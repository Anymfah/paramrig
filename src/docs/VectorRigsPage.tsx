import { Link } from 'react-router-dom'
import { DocsChrome } from '@/docs/DocsChrome'
import { SIMPLE_PROPERTIES } from '@/vector/rig'

const PAINT_PATHS = [
  ['fills[i].color', 'colour', 'The colour of one paint layer of the fill stack, counted from the bottom.'],
  ['fills[i].opacity', 'number', 'How much of that layer shows, 0 to 1.'],
  ['fills[i].stops', 'gradient', 'The stops of a gradient layer. Turns a solid layer into a gradient.'],
  ['strokes[i].color', 'colour', 'The same, on the stroke stack.'],
  ['strokes[i].opacity', 'number', ''],
  ['effects[i].blur', 'number', 'Also dx, dy, spread, opacity and color, on the effect at that place.'],
  ['regionsOff[key]', 'switch', 'Whether the region with that face key is filled. On means filled.'],
  ['network.nodes[id].x', 'number', 'A node of an edited path, in the object box. Also .y.'],
]

const EXAMPLE = `{
  "format": "paramrig.vector",
  "formatVersion": 1,
  "document": {
    "version": 1,
    "id": "vector-mark",
    "name": "Aperture mark",
    "width": 400, "height": 400,
    "background": "#101211",
    "elements": [
      { "id": "ring", "kind": "ellipse", "name": "Ring",
        "x": 60, "y": 60, "width": 280, "height": 280, "rotation": 0,
        "fill": "none", "stroke": "#8CBDA8", "strokeWidth": 24,
        "arcStart": 0, "arcSweep": 300, "arcRatio": 0,
        "opacity": 1, "visible": true, "locked": false },
      { "id": "core", "kind": "rectangle", "name": "Core",
        "x": 150, "y": 150, "width": 100, "height": 100, "rotation": 0,
        "fill": "#D4E7E1", "stroke": "none", "strokeWidth": 0,
        "cornerRadius": 24,
        "opacity": 1, "visible": true, "locked": false }
    ],
    "guides": [],
    "rig": {
      "groups": [{ "id": "mark", "label": "Mark" }],
      "parameters": [
        { "kind": "color",  "id": "ink",     "label": "Ink",      "group": "mark",
          "defaultValue": "#8CBDA8" },
        { "kind": "number", "id": "radius",  "label": "Radius",   "group": "mark",
          "min": 0, "max": 50, "step": 1, "defaultValue": 24, "unit": "px" },
        { "kind": "number", "id": "opening", "label": "Opening",  "group": "mark",
          "min": 0, "max": 360, "step": 1, "defaultValue": 300, "unit": "°" }
      ],
      "bindings": [
        { "id": "b1", "elementId": "ring", "property": "stroke",       "parameterId": "ink" },
        { "id": "b2", "elementId": "core", "property": "fill",         "parameterId": "ink" },
        { "id": "b3", "elementId": "core", "property": "cornerRadius", "parameterId": "radius" },
        { "id": "b4", "elementId": "ring", "property": "arcSweep",     "parameterId": "opening" }
      ]
    },
    "createdAt": "2026-09-02T00:00:00.000Z",
    "updatedAt": "2026-09-02T00:00:00.000Z"
  }
}`

/** How to write a vector document that carries its own controls, for whoever is building one. */
export function VectorRigsPage() {
  return (
    <DocsChrome>
      <h1>Vector rigs</h1>
      <p className="lede">
        A vector document is a drawing. A vector document with a <code>rig</code> is a rig: it
        exposes controls, and the drawing follows them. The file format is the same either way —
        a <code>.paramrig.json</code> saved from the editor, or written by hand.
      </p>

      <h2>The shape of it</h2>
      <p>
        <code>document.rig</code> holds four things. <code>groups</code> names the sections the
        controls sit in; every control names one of them. <code>parameters</code> is the same
        <code> ParameterDef</code> the rest of the workbench uses. <code>bindings</code> says which
        control writes where. <code>inspectorCategories</code> is optional, for a rig with several
        families of controls.
      </p>
      <p>
        A binding is <code>{'{ id, elementId, property, parameterId, transform? }'}</code>.{' '}
        <code>elementId</code> names an object of <code>elements</code>; <code>property</code> is a
        path into it. Anything the app cannot read — a control of an unknown kind, a binding whose
        object or control is not in the file — is dropped on the way in and reported, rather than
        guessed at.
      </p>

      <h2>What can be driven</h2>
      <table className="docs-table">
        <thead><tr><th>Property</th><th>Takes</th></tr></thead>
        <tbody>
          {Object.entries(SIMPLE_PROPERTIES).map(([property, type]) => (
            <tr key={property}><td><code>{property}</code></td><td>{type}</td></tr>
          ))}
          {PAINT_PATHS.map(([property, type, note]) => (
            <tr key={property}><td><code>{property}</code></td><td>{type}{note ? ` — ${note}` : ''}</td></tr>
          ))}
        </tbody>
      </table>
      <p>
        A <code>number</code> property takes a number, a vector (its first axis) or a switch. A{' '}
        <code>colour</code> takes a hex string. A <code>switch</code> takes a boolean. An{' '}
        <code>option</code> takes one of the blend modes. A <code>text</code> takes a string.
      </p>

      <h2>Reshaping a value on the way</h2>
      <p>
        A binding may carry a <code>transform</code>: <code>scale</code> and <code>offset</code> map
        the value, <code>min</code> and <code>max</code> clamp it, and <code>expression</code>{' '}
        replaces both with arithmetic over <code>value</code> and the other controls by name —{' '}
        <code>value * 2 + margin</code>. An expression that cannot be read leaves the value alone.
      </p>

      <h2>Constraints</h2>
      <ul className="docs-steps">
        <li>Ids are stable. A control id is the export key and the name an expression uses; an object id is what a binding points at.</li>
        <li>Every number control states <code>min</code>, <code>max</code> and <code>step</code>. A range the wrong way round is repaired, not honoured.</li>
        <li>Every control names a group that <code>groups</code> declares. One that does not is dropped.</li>
        <li>Several bindings may write the same property; the last one in the list wins. One control may drive as many properties as it likes.</li>
        <li>A control's <code>defaultValue</code> is what the drawing looks like new — the library thumbnail is rendered from the defaults.</li>
      </ul>

      <h2>A whole one</h2>
      <p>
        A mark whose colour, corner radius and opening are exposed. Drop this file on the library to
        open it; it arrives as a document and a rig at once.
      </p>
      <pre className="docs-code"><code>{EXAMPLE}</code></pre>

      <p>
        <Link className="text-link" to="/docs">Adding a rig</Link>
        {' · '}
        <Link className="text-link" to="/docs/controls">Live controller catalog</Link>
        {' · '}
        <Link className="text-link" to="/">Back to the library</Link>
      </p>
    </DocsChrome>
  )
}
