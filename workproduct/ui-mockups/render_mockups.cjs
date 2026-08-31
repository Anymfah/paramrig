const path = require('node:path');
const sharp = require('sharp');
const out = path.resolve(__dirname, '../../assets/ui-mockups');

async function main() {
  const names = ['01-library', '02-svg-editor', '03-3d-editor'];
  const tiles = [];
  for (const [i, name] of names.entries()) {
    const svg = path.join(out, `${name}.svg`);
    await sharp(svg, {density: 144}).png().toFile(path.join(out, `${name}.png`));
    await sharp(svg).resize(1280).png().toFile(path.join(out, `${name}-preview.png`));
    const input = await sharp(svg).resize(1200).png().toBuffer();
    tiles.push({input, left: 32, top: 32 + i * 782});
  }
  await sharp({create: {width: 1264, height: 2378, channels: 4, background: '#C8CCC0'}})
    .composite(tiles).png().toFile(path.join(out, 'overview.png'));
  const sizes = await Promise.all(names.map(async name => {
    const metadata = await sharp(path.join(out, `${name}.png`)).metadata();
    if (metadata.width !== 3200 || metadata.height !== 2000) throw new Error(`Wrong size: ${name}`);
    return {name, width: metadata.width, height: metadata.height};
  }));
  console.log(JSON.stringify(sizes));
}
main().catch(error => {console.error(error); process.exitCode = 1;});
