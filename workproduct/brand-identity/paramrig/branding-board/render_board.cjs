const path = require('node:path');
const sharp = require('sharp');
const dir = path.resolve(__dirname, '../../../../assets/brand/branding-board');
async function main() {
  const svg = path.join(dir, 'paramrig-branding-board.svg');
  await sharp(svg, { density: 144 }).png().toFile(path.join(dir, 'paramrig-branding-board.png'));
  await sharp(svg).resize({ width: 1200 }).png().toFile(path.join(dir, 'paramrig-branding-board-preview.png'));
  console.log('Rendered standalone SVG at 3200 × 4080 and preview at 1200 × 1530.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
