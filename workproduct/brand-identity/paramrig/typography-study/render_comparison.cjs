const path = require('node:path');
const sharp = require('sharp');
const dir = path.resolve(__dirname, '../../../../assets/brand/typography');
async function main() {
  const svg = path.join(dir, 'paramrig-type-comparison.svg');
  await sharp(svg, { density: 144 }).png().toFile(path.join(dir, 'paramrig-type-comparison.png'));
  await sharp(svg).resize({ width: 1200 }).png().toFile(path.join(dir, 'paramrig-type-comparison-preview.png'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
