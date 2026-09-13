import { Link } from 'react-router-dom'
import { DocsChrome } from '@/docs/DocsChrome'
import { AUDIO_PROPERTY_PATHS } from '@/audio/rig'

/**
 * How to write a sound that carries its own controls, for whoever is building one — a person
 * reading, or a model generating a file.
 *
 * The table of paths is generated from the synthesiser's own field tables rather than typed out
 * here, so a field the engine gains is a row on the same commit and a field it loses cannot
 * linger. That is also why the table is long: this instrument has four layers of a dozen sections
 * each, and the honest count is the count.
 */

const EXAMPLE = `{
  "format": "paramrig.audio",
  "formatVersion": 1,
  "kind": "audio",
  "document": {
    "version": 1,
    "id": "audio-blip",
    "name": "Menu blip",
    "patch": {
      "version": 4,
      "duration": 0.22,
      "seed": 1,
      "layers": [
        {
          "enabled": true, "gain": 0.8, "pan": 0, "spread": 0.4, "offset": 0,
          "source": { "kind": "tone", "wave": "sine", "pmFrom": "internal",
                      "fmRatio": 3.5, "fmIndex": 2.4, "fmFall": 0.8, "voices": 1 },
          "pitch": { "start": 880, "slide": 7, "jitter": 12 },
          "filter": { "kind": "lowpass", "cutoff": 6000, "resonance": 0.2 },
          "insertA": { "kind": "drive", "place": "pre", "amount": 1, "drive": 0.25 },
          "insertC": { "kind": "body", "place": "post", "amount": 0.5,
                       "frequency": 2400, "spread": 0.4, "decay": 0.05, "partials": 3 },
          "amp": { "attack": 0.002, "hold": 0.01, "decay": 0.09, "sustain": 0, "release": 0.05, "curve": 2.4 }
        }
      ],
      "mods": [
        { "kind": "envelope", "enabled": true, "target": "layers[0].cutoff", "depth": 0.6,
          "attack": 0.002, "decay": 0.08, "sustain": 0, "release": 0.04, "curve": 2 }
      ],
      "fx": {
        "x": { "kind": "off" },
        "y": { "kind": "delay", "mode": "send", "mix": 0.18, "time": 0.09, "feedback": 0.25 },
        "z": { "kind": "reverb", "mode": "send", "mix": 0.12, "size": 0.35, "damping": 0.5 },
        "tone": 0.15, "width": 0.6
      },
      "master": { "gain": 0.9, "limiter": 0.6, "fadeOut": 0.01 }
    },
    "rig": {
      "groups": [{ "id": "voice", "label": "Voice" }],
      "parameters": [
        { "kind": "number", "id": "pitch", "label": "Pitch", "group": "voice",
          "min": 220, "max": 3520, "step": 1, "defaultValue": 880, "unit": "Hz", "scale": "log" },
        { "kind": "number", "id": "bite", "label": "Bite", "group": "voice",
          "min": 0, "max": 6, "step": 0.01, "defaultValue": 2.4 },
        { "kind": "number", "id": "room", "label": "Room", "group": "voice",
          "min": 0, "max": 1, "step": 0.01, "defaultValue": 0.12 }
      ],
      "bindings": [
        { "id": "b1", "property": "layers[0].pitch.start",     "parameterId": "pitch" },
        { "id": "b2", "property": "layers[0].source.fmIndex",  "parameterId": "bite" },
        { "id": "b3", "property": "fx.z.mix",                  "parameterId": "room" }
      ]
    },
    "createdAt": "2026-09-10T00:00:00.000Z",
    "updatedAt": "2026-09-10T00:00:00.000Z"
  }
}`

const TAKES: Record<string, string> = { number: 'a number', option: 'a choice', boolean: 'a switch', curve: 'a curve' }

export function AudioRigsPage() {
  return (
    <DocsChrome>
      <h1>Audio rigs</h1>
      <p className="lede">
        An audio document is a sound. An audio document with a <code>rig</code> is a rig: it
        exposes controls, and the sound follows them. The file is the same either way — a{' '}
        <code>.paramrig.json</code> saved from the editor, or written by hand and dropped on the
        library.
      </p>

      <h2>The shape of it</h2>
      <p>
        <code>document.rig</code> holds the same things a vector or a scene rig does.{' '}
        <code>groups</code> names the sections the controls sit in; every control names one of
        them. <code>parameters</code> is the <code>ParameterDef</code> the rest of the workbench
        uses. <code>bindings</code> says which control writes where.
      </p>
      <p>
        A binding is <code>{'{ id, property, parameterId, transform? }'}</code>. There is no
        object to name: a sound is one instrument, and a path says which of its parts it means.
        Anything the app cannot read — a control of an unknown kind, a binding whose property does
        not parse — is dropped on the way in rather than guessed at.
      </p>

      <h2>What a sound is made of</h2>
      <p>
        Four <strong>layers</strong>, numbered from zero in a path: two oscillators and two noise
        generators, though nothing stops a noise layer being a tone. Each has a source, a pitch, a
        filter, three <strong>insert</strong> slots and an amplifier envelope. Then eight{' '}
        <strong>modulation slots</strong>, each either an envelope or an oscillator, and three{' '}
        <strong>performers</strong>, each a drawn row of sixteen steps. Then three{' '}
        <strong>master effects</strong> — <code>fx.x</code>, <code>fx.y</code>, <code>fx.z</code> —
        and the master itself.
      </p>
      <p>
        A slot holds the fields of every kind it could be and reads only its own, so a slot changed
        from one kind to another and back is the slot it was. That is why the table below lists a
        comb&rsquo;s time on a slot that may be holding a drive: it is bounded whatever the slot is
        set to, and it is what the slot returns to.
      </p>

      <h2>What can be driven</h2>
      <p>
        <code>i</code> is an index: a layer is 0 to 3, a modulation slot 0 to 7, a performer 0 to 2.
      </p>
      <table className="docs-table">
        <thead><tr><th>Property</th><th>Is</th><th>Takes</th></tr></thead>
        <tbody>
          {AUDIO_PROPERTY_PATHS.map((row) => (
            <tr key={row.property}>
              <td><code>{row.property}</code></td>
              <td>{row.label}</td>
              <td>{TAKES[row.type] ?? row.type}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        A <strong>number</strong> takes a number control of any instrument — a field, a knob, a
        bar, a logarithmic scale — or a switch, where off is the floor and on is the ceiling. A{' '}
        <strong>choice</strong> takes a choice control, and the value has to be one of that
        field&rsquo;s options; anything else falls back to its default rather than being refused. A{' '}
        <strong>switch</strong> takes a switch, and a <strong>curve</strong> a curve control.
      </p>

      <h2>Reshaping a value on the way</h2>
      <p>
        A binding may carry a <code>transform</code>: <code>scale</code> and <code>offset</code>{' '}
        map the value, <code>min</code> and <code>max</code> clamp it, and <code>expression</code>{' '}
        replaces both with arithmetic over <code>value</code> and the other controls by name —{' '}
        <code>value * 0.5 + lift</code>. An expression that cannot be read leaves the value alone.
      </p>

      <h2>Constraints</h2>
      <ul className="docs-steps">
        <li>Every number is held to the range the field declares. A file that says the cutoff is minus four million comes back at twenty hertz rather than being refused.</li>
        <li>A choice that is not one of the options listed falls back to that field&rsquo;s default, so a misspelt filter is <code>off</code> and not a crash.</li>
        <li>Seconds are seconds and hertz are hertz. The editor shows milliseconds where milliseconds are what anybody reads; the file holds seconds either way.</li>
        <li>The same voice writes a file and plays live. Offline render and the AudioWorklet share <code>processVoice</code>, so a drag during playback is the sound the exporter will write. <code>seed</code> and jitter stay deterministic at a given sample rate.</li>
        <li>A macro may drive several fields. Each destination has a range and a curve. The last macro assigned to a property owns it. Bindings that are not the sixteen macros still apply afterwards, last writer winning.</li>
        <li>Randomize and Mutate keep the user&rsquo;s macro names, assignments, ranges and curves. When every destination of a mapped macro still agrees on one amount, the knob shows that amount. When they do not, the destinations are parked: the generated patch is left as heard, the knob is not rewritten onto it, and the next movement recaptures the current values as the origin of those ranges so the sound does not jump.</li>
        <li>A recorded gesture lives on the patch as <code>gestures[]</code>, with its destinations copied into the take. A missing user wavetable is an error, never a silent substitute.</li>
        <li>A layer may take another layer&rsquo;s output as its phase modulator with <code>source.pmFrom</code>. A layer that names itself, or sits in a ring of layers naming each other, falls back to its own modulator rather than failing.</li>
        <li>Several controls may drive the same property; the last binding in the list wins. One control may drive as many properties as it likes.</li>
      </ul>

      <h2>A whole one</h2>
      <p>
        A menu blip whose pitch, bite and room are exposed — a pitch, a phase-modulation depth and
        an effect&rsquo;s mix, which is one of each family. Drop this file on the library to open
        it; it arrives as a document and a rig at once.
      </p>
      <pre className="docs-code"><code>{EXAMPLE}</code></pre>

      <p>
        <Link className="text-link" to="/docs">Adding a rig</Link>
        {' · '}
        <Link className="text-link" to="/docs/vector-rigs">Vector rigs</Link>
        {' · '}
        <Link className="text-link" to="/docs/scene-rigs">Scene rigs</Link>
        {' · '}
        <Link className="text-link" to="/docs/controls">Live controller catalog</Link>
        {' · '}
        <Link className="text-link" to="/">Back to the library</Link>
      </p>
    </DocsChrome>
  )
}
