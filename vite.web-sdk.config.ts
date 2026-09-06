import { defineConfig } from 'vite'

/*
 * The SDK package, and only the SDK package.
 *
 * `publicDir: false` because Vite's default is the workbench's own `public/` — the favicon, the
 * `.htaccess` and 150 kB of Public Sans were being copied into a package whose `files` is `dist`.
 * `emptyOutDir: true` because the chunk name carries a content hash, so without it every change
 * left the previous chunk behind for the package to carry as well.
 *
 * Emptying the directory is why the build runs before `tsc`: the declarations land in the same
 * `dist`, and a build that wiped them afterwards would ship a package with no types at all.
 */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'packages/web-sdk/dist',
    emptyOutDir: true,
    lib: { entry: 'src/web/sdk.ts', formats: ['es'], fileName: 'paramrig-web' },
  },
})
