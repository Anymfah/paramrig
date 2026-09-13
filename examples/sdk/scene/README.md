# scene example

A standalone consumer of the public npm packages. Copy this directory outside the ParamRig repository.

```sh
npm install
npm run dev
```

Vite prints the local URL. The example uses no repository aliases or application sources. Run `npm run build` to produce a standalone browser distribution.

Three.js is an explicit host dependency. Both integrations share that single copy. Destroying the optional viewer leaves the host renderer running.
