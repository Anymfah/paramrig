import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { selectModules } from './app-modules.mjs'
import { root } from './sdk-entries.mjs'
export function appAssetsPlugin() {
  let outDir
  return { name: 'paramrig-public-assets', apply: 'build',
    config() { return { build: { copyPublicDir: false } } },
    configResolved(config) { outDir = resolve(config.root, config.build.outDir) },
    writeBundle() {
      const modules = selectModules()
      const files = ['.htaccess', 'favicon.svg', 'fonts/PublicSans.woff2', 'fonts/PublicSans-OFL.txt']
      if (modules.includes('vector') || modules.includes('scene')) files.push('fonts/PublicSans.ttf', 'fonts/SpaceGrotesk.ttf', 'fonts/SpaceGrotesk.woff2', 'fonts/SpaceGrotesk-OFL.txt', 'fonts/SourceSerif4.ttf', 'fonts/SourceSerif4.woff2', 'fonts/SourceSerif4-OFL.txt', 'fonts/ARTWORK-FONTS.md')
      for (const module of modules) if (existsSync(resolve(root, 'public/thumbnails', module))) files.push(`thumbnails/${module}`)
      const copy = file => {
        const source = resolve(root, 'public', file)
        if (statSync(source).isDirectory()) { for (const child of readdirSync(source)) copy(`${file}/${child}`); return }
        const target = resolve(outDir, file)
        mkdirSync(resolve(target, '..'), { recursive: true })
        copyFileSync(source, target)
      }
      for (const file of files) copy(file)
    },
  }
}
