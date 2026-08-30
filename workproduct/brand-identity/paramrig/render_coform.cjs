// Rasterize the real SVG deliverables, not a second hand-drawn approximation.
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');
const work = __dirname;
const root = path.resolve(work, '../../..');
const qa = path.join(work, 'vector-qa');
const manifest = JSON.parse(fs.readFileSync(path.join(qa, 'manifest.json')));

(async () => {
  const square = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect x="12" y="12" width="40" height="40"/></svg>');
  await sharp(square).flatten({background:'#fff'}).png().toFile(path.join(qa,'calibration.png'));
  for (const [name, asset] of Object.entries(manifest.assets)) {
    for (const scale of [1, 4]) {
      await sharp(path.join(root, asset.file), {density:72*scale})
        .flatten({background:'#fff'}).png().toFile(path.join(qa,`${name}-render-${scale}x.png`));
    }
    for (const width of [16, 24, 32, 64, 256, 768]) {
      await sharp(path.join(root, asset.file), {density:288})
        .resize({width}).flatten({background:'#fff'}).png()
        .toFile(path.join(qa,`${name}-${width}px.png`));
    }
    const white = fs.readFileSync(path.join(root,asset.file),'utf8').replace('fill="currentColor"','fill="#fff"');
    await sharp(Buffer.from(white), {density:144}).flatten({background:'#000'}).png()
      .toFile(path.join(qa,`${name}-reversed.png`));
  }
  console.log('Rendered SVGs at native, 4x and 16–768px, plus white on black.');
})().catch(error => {console.error(error); process.exitCode=1;});
