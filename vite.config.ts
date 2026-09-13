import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { sourceAliases } from './scripts/sdk-entries.mjs'
import { appPreviewPlugin } from './scripts/app-preview.mjs'
import { appAssetsPlugin } from './scripts/app-assets.mjs'
import { appBundleReport } from './scripts/app-bundle-report.mjs'
import { appModulesPlugin } from './scripts/app-modules.mjs'

export default defineConfig({
  plugins: [react(), appModulesPlugin(), appBundleReport(), appAssetsPlugin(), appPreviewPlugin()],
  resolve: {
    alias: [...sourceAliases, { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) }],
    // three-bvh-csg and three-mesh-bvh each pull three in; two copies of it in one bundle would
    // mean two class identities and an `instanceof` that quietly answers false.
    dedupe: ['three'],
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    proxy: { '/api/web': { target: process.env.PARAMRIG_WEB_SERVICE ?? 'http://web:5175', changeOrigin: false } },
  },
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    // DSP sweeps and full editor mounts compete for CPU and memory. Two isolated
    // files at a time keep the same functional deadlines reliable in CI.
    maxWorkers: 2,
    /*
     * Fifteen seconds, not five.
     *
     * The heaviest tests here open a whole editor in jsdom — the audio face-plate is several
     * hundred controls over four hundred bound fields, and every keystroke in one of those tests
     * re-renders it and re-renders the sound underneath it. Alone they take two to four seconds;
     * run beside two hundred and seventy other files on a machine that is also running a browser
     * and two other stacks, they cross five and fail on the clock rather than on anything they
     * were testing. A test that times out for want of a spare core reports the machine, not the
     * code it was pointed at.
     */
    testTimeout: 15000,
  },
})
