# @paramrig/audio-browser

Independent AudioWorklet players for `@paramrig/audio`, without React or editor UI.

```sh
npm install @paramrig/audio @paramrig/audio-browser
```

```js
import { defaultPatch } from '@paramrig/audio'
import { createAudioPlayer } from '@paramrig/audio-browser'

const context = new AudioContext()
const player = createAudioPlayer({ context, destination: context.destination })
// Start from a user gesture in a secure browser context.
await player.start(defaultPatch())
player.setPatch(defaultPatch())
player.trigger()
player.stop()
player.destroy()
// Only the host may decide to close its context.
```

The player exposes `start`, `setPatch`, `setGate`, `trigger`, `stop`, `getMeter`, `getError`, `isPlaying`, `subscribe` and `destroy`. A subscription returns an unsubscribe function. `start` returns false on unavailable playback and records the error; `onError` can receive it. A destroyed player cannot restart.

The compiled processor is distributed with the package and referenced relative to its module. Bundlers must copy URL assets. `audioWorkletUrl` exposes the default location; supply `workletUrl` when your bundler or CSP requires another location. Serve the processor as JavaScript from an allowed origin.

Supply `resolveWavetable` for host resources. Each player and worklet processor maintains its own user table registry. Two players may use the same resource ID with different frames. The host owns its AudioContext and destination; destroying a player disconnects only that player's nodes, closes its ports and releases its subscriptions.
