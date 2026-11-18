// Evidence composition only; no browser automation or product/image source changes.
import sharp from 'sharp';
import path from 'node:path';
const dir=path.resolve('docs/design-exploration/2026-10-18-liquid-glass');
const capture=process.argv[2]||'implementation-pass1-steady.jpg';
const label=process.argv[3]||'pass1';
const source=path.join(dir,'selected-porcelain-optical.png');
const implementation=path.join(dir,capture);
const sourceMeta=await sharp(source).metadata(),implementationMeta=await sharp(implementation).metadata();
const width=1488,height=1056;
const left=await sharp(source).resize(width,height,{fit:'contain',background:'#eaf0f4'}).png().toBuffer();
const right=await sharp(implementation).resize(width,height,{fit:'contain',background:'#eaf0f4'}).png().toBuffer();
await sharp({create:{width:width*2+16,height,channels:3,background:'#ccd4de'}}).composite([{input:left,left:0,top:0},{input:right,left:width+16,top:0}]).png().toFile(path.join(dir,`${label}-comparison.png`));
const region={left:1020,top:120,width:440,height:700};
const detailLeft=await sharp(left).extract(region).toBuffer();
const detailRight=await sharp(right).extract(region).toBuffer();
await sharp({create:{width:896,height:700,channels:3,background:'#ccd4de'}}).composite([{input:detailLeft,left:0,top:0},{input:detailRight,left:456,top:0}]).png().toFile(path.join(dir,`${label}-evidence-comparison.png`));
console.log(JSON.stringify({source:{width:sourceMeta.width,height:sourceMeta.height},implementation:{width:implementationMeta.width,height:implementationMeta.height},comparison:{width:width*2+16,height},label},null,2));
