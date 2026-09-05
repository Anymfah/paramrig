import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'packages/web-sdk/dist',
    emptyOutDir: false,
    lib: { entry: 'src/web/sdk.ts', formats: ['es'], fileName: 'paramrig-web' },
  },
})
