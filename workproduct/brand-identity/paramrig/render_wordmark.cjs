const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const work = __dirname;
const assets = path.resolve(work, '../../../assets/brand');
const polish = process.argv.includes('--polish');
const out = path.join(work, polish ? 'wordmark-polish-qa' : 'wordmark-qa');
fs.mkdirSync(out, { recursive: true });

async function main() {
  const before = await sharp(path.join(work, `reference/${polish ? 'svg-v3' : 'svg-v2'}/paramrig-coform-logo.svg`), { density: 288 })
    .extract({ left: 0, top: 318 * 4, width: 383 * 4, height: 86 * 4 })
    .flatten({ background: '#fff' }).png().toBuffer();
  const after = await sharp(path.join(assets, 'paramrig-wordmark.svg'), { density: 288 })
    .flatten({ background: '#fff' }).png().toBuffer();
  fs.writeFileSync(path.join(out, 'before-wordmark.png'), before);
  fs.writeFileSync(path.join(out, 'after-wordmark.png'), after);
  const labels = Buffer.from(`<svg width="1652" height="940"><g font-family="sans-serif" font-size="23" fill="#666"><text x="60" y="53">${polish ? 'BEFORE — first vector lettering' : 'BEFORE — smoothed raster trace'}</text><text x="60" y="523">${polish ? 'AFTER — optical refinement' : 'AFTER — redrawn vector lettering'}</text></g></svg>`);
  await sharp({ create: { width: 1652, height: 940, channels: 3, background: '#fff' } })
    .composite([{ input: labels }, { input: before, left: 60, top: 90 }, { input: after, left: 60, top: 560 }])
    .png().toFile(path.join(out, 'comparison.png'));
  for (const width of [192, 383, 766]) {
    await sharp(path.join(assets, 'paramrig-coform-logo.svg'), { density: 288 })
      .resize({ width }).flatten({ background: '#fff' }).png()
      .toFile(path.join(out, `logo-${width}.png`));
  }
  const svg = fs.readFileSync(path.join(assets, 'paramrig-coform-logo.svg'), 'utf8');
  await sharp(Buffer.from(svg.replace('fill="currentColor"', 'fill="#fff"')), { density: 144 })
    .flatten({ background: '#171717' }).png().toFile(path.join(out, 'logo-dark.png'));
  console.log(out);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
