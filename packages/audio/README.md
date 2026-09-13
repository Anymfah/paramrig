# @paramrig/audio

The headless ParamRig sound engine: patches, deterministic synthesis, independent voices and block processing. No React, Web Audio, Three.js or Vector engine is installed.

```sh
npm install @paramrig/audio
```

```js
import { defaultPatch, renderPatch } from '@paramrig/audio'
import { encodeWav } from '@paramrig/audio/wav'

const patch = defaultPatch()
const samples = renderPatch(patch, 48000, 128)
const wav = encodeWav(samples, 48000)
```

`createVoice`, `processVoice`, `updateVoice`, `triggerVoice` and `setVoiceGate` provide streaming synthesis without a browser. Pass `resolveWavetable` to `createVoice` to keep user resources independent between voices. A resolver returns a `Wavetable` or `null` when the resource is unavailable. Treat returned frames as immutable.

Additional entries: `wav`, `wavetables`, `bindings`, `fields`, `curves` and `random`. Sub-entries reduce imported code; install the separate `@paramrig/audio-labs` package only when generation, variation or fusion is needed. Browser playback is available separately in `@paramrig/audio-browser`.

ESM and TypeScript declarations support Node 22 and modern browsers. Use the existing patch validator for untrusted inputs and valid sample rates. Missing user tables retain their existing silent-layer behavior in the headless engine; the browser player reports missing resources before starting.
