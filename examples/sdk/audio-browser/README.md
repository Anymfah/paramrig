# audio-browser example

A standalone consumer of the public npm packages. Copy this directory outside the ParamRig repository.

```sh
npm install
npm run dev
```

Vite prints the local URL. The example uses no repository aliases or application sources. Run `npm run build` to produce a standalone browser distribution.

Playback starts from a user gesture. Both players share the host context; stopping or destroying one never closes it. This example owns and closes the context on page exit.
