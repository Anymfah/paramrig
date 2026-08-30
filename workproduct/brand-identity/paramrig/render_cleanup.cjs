const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');
const root=path.resolve(__dirname,'../../..');
const qa=path.join(__dirname,'cleanup-qa');
fs.mkdirSync(qa,{recursive:true});
(async()=>{
  for(const name of ['symbol','logo']) {
    for(const version of ['before','after']) {
      const file=version==='before'
        ? path.join(__dirname,'reference/svg-v1',`paramrig-coform-${name}.svg`)
        : path.join(__dirname,'reference/svg-v2',`paramrig-coform-${name}.svg`);
      for(const scale of [1,4,8]) {
        await sharp(file,{density:72*scale}).flatten({background:'#fff'}).png()
          .toFile(path.join(qa,`${name}-${version}-${scale}x.png`));
      }
      for(const width of [16,24,32,64]) {
        await sharp(file,{density:288}).resize({width}).flatten({background:'#fff'}).png()
          .toFile(path.join(qa,`${name}-${version}-${width}px.png`));
      }
    }
    const svg=fs.readFileSync(path.join(__dirname,'reference/svg-v2',`paramrig-coform-${name}.svg`),'utf8');
    await sharp(Buffer.from(svg.replace('fill="currentColor"','fill="#fff"')),{density:144})
      .flatten({background:'#000'}).png().toFile(path.join(qa,`${name}-reversed.png`));
  }
  console.log('Before/after and scale renders ready.');
})().catch(e=>{console.error(e);process.exitCode=1;});
