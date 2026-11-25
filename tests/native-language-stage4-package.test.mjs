import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateNativeReleasePayload,nativeReleaseGuide} from '../packaging/native-release-gate.mjs';

async function payload(t,files){
 const parent=path.resolve('../outputs/service-r39-stage4-20261125/package-gate-tests');await fs.mkdir(parent,{recursive:true});
 const root=await fs.mkdtemp(path.join(parent,'payload-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const [name,value] of Object.entries(files)){const full=path.join(root,name);await fs.mkdir(path.dirname(full),{recursive:true});await fs.writeFile(full,value);}
 return root;
}
test('Stage 4 package keeps legacy seed bytes and declares zero native business releases',async t=>{
 const root=await payload(t,{'server/native-report-language.mjs':'// runtime only','resources/catalog-seed.json':'{"synthetic":true}','resources/scene-seed.json':'{"legacy":true}'});
 const before=await fs.readFile(path.join(root,'resources/catalog-seed.json'));
 const expectedSeeds={'catalog-seed.json':createHash('sha256').update(before).digest('hex'),'scene-seed.json':createHash('sha256').update('{"legacy":true}').digest('hex')};
 const proof=await validateNativeReleasePayload(root,{expectedSeeds,requireLegacyCompatibility:true});
 assert.equal(proof.nativeBusinessMaterialCount,0);assert.equal(proof.reviewGate,'required');
 assert.equal(proof.legacySeedCompatibility,true);assert.equal(proof.legacySeeds.length,2);
 assert.deepEqual(await fs.readFile(path.join(root,'resources/catalog-seed.json')),before);
 await fs.writeFile(path.join(root,'resources/catalog-seed.json'),'{"changed":true}');
 await assert.rejects(validateNativeReleasePayload(root,{expectedSeeds,requireLegacyCompatibility:true}),/differ from/);
});
for(const name of ['server/native-language-prompt-draft.mjs','resources/NP-REVIEW-DRAFT.json','resources/native-materials/published.json','tests/native-language-stage3-fixture.mjs','data/workspace.json']){
 test('Stage 4 rejects forbidden release content: '+name,async t=>{
  const root=await payload(t,{[name]:'synthetic fixture'});
  await assert.rejects(validateNativeReleasePayload(root),/not permitted|not allowed/);
 });
}
test('Stage 4 guide separates old compatibility from gated new native tasks in both languages',()=>{
 assert.match(nativeReleaseGuide('en'),/reviewed bilingual materials/);assert.match(nativeReleaseGuide('en'),/V1\.2/);
 assert.match(nativeReleaseGuide('zh'),/旧工作区/);assert.match(nativeReleaseGuide('zh'),/待业务复核/);
});
