import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {assertPilotIdentity,buildNativePilotMaterials,writePilotInputs,PILOT_ID,PILOT_AUTHORIZATION} from '../scripts/build-native-pilot-materials.mjs';
import {languageHash,validateBilingualMaterial} from '../server/native-language-materials.mjs';
const read=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
const seedDir=process.env.NATIVE_PILOT_SEEDS,previous=process.env.NATIVE_PILOT_PREVIOUS;
const integration=Boolean(seedDir&&previous&&process.env.NATIVE_PILOT_BUNDLE);
const input=async()=>({np:await read(previous),seed:await read(path.join(seedDir,'scene-seed.json')),catalog:await read(path.join(seedDir,'catalog-seed.json')),translations:await read('resources/native-pilot-english.json')});

test('a pilot ID cannot be reused for changed bytes, including a changed version label',()=>{
 const old={id:'pilot-identity',version:'1',materials:[]};
 assert.doesNotThrow(()=>assertPilotIdentity(structuredClone(old),old));
 for(const change of [{version:'2'},{materials:[{changed:true}]}])assert.throws(()=>assertPilotIdentity({...old,...change},old),/already identifies different bytes/);
 assert.doesNotThrow(()=>assertPilotIdentity({...old,id:'new-pilot-identity'},old));
});

test('release input writer preserves exact seeds, supports identical rebuilds and refuses changed output',async t=>{
 const scratch=path.resolve('outputs/native-pilot-rebase-tests');await fs.mkdir(scratch,{recursive:true});
 const dir=await fs.mkdtemp(path.join(scratch,'writer-'));t.after(async()=>{assert.ok(dir.startsWith(scratch+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 const sceneFile=path.join(dir,'original-scene.json'),catalogFile=path.join(dir,'original-catalog.json'),outFile=path.join(dir,'inputs/native-pilot-materials.json');
 const sceneBytes=Buffer.from('\uFEFF{ "packages": [] }\r\n'),catalogBytes=Buffer.from('{ "rules": [] }\r\n');
 await fs.writeFile(sceneFile,sceneBytes);await fs.writeFile(catalogFile,catalogBytes);
 const bundle={id:'synthetic-write',version:'1',materials:[{scene:'Synthetic'}]};
 const args={bundle,sceneFile,catalogFile,outFile},first=await writePilotInputs(args);
 assert.deepEqual(await writePilotInputs(args),first);
 assert.deepEqual(await fs.readFile(path.join(dir,'inputs/scene-seed.json')),sceneBytes);
 assert.deepEqual(await fs.readFile(path.join(dir,'inputs/catalog-seed.json')),catalogBytes);
 await assert.rejects(writePilotInputs({...args,bundle:{...bundle,version:'2'}}),/already identifies different bytes/);
 assert.deepEqual(await read(outFile),bundle);
 await fs.writeFile(sceneFile,'{"packages":["changed"]}');
 await assert.rejects(writePilotInputs(args),/Refusing to replace existing release input/);
 assert.deepEqual(await fs.readFile(path.join(dir,'inputs/scene-seed.json')),sceneBytes);
});

test('0.11.28 rebuild is deterministic and matches every current source binding',{skip:!integration},async()=>{
 const args=await input(),bundle=buildNativePilotMaterials(args);
 assert.deepEqual(bundle,await read(process.env.NATIVE_PILOT_BUNDLE));
 assert.equal(bundle.id,PILOT_ID);assert.equal(bundle.version,'0.11.28');assert.equal(bundle.materials.length,52);
 assert.deepEqual(bundle.authorization,PILOT_AUTHORIZATION);
 for(const m of bundle.materials){validateBilingualMaterial(m);assert.equal(m.review.status,'pilot-unreviewed');assert.equal(m.semanticRevision,PILOT_ID);assert.equal(m.review.authorizationId,'user-20261126-native-frontline-pilot');}
 for(const p of args.seed.packages)for(const source of [...p.configuration.basis.rules,...p.configuration.basis.policies,...p.configuration.referenceMaterials||[],p.template,p.taxonomy,...p.exceptions].filter(Boolean)){
  const m=bundle.materials.find(m=>m.scene===p.configuration.sceneId&&m.id===source.id);
  assert.equal(m.sourceHash,languageHash(source),source.id);
 }
});

test('rebuild rejects stale seeds, incomplete English, and edited inherited NP bytes',{skip:!integration},async()=>{
 const args=await input();
 for(const mutate of [a=>a.seed.packages[0].configuration.reason+=' changed',a=>a.catalog.rules[0].title+=' changed',a=>a.np.materials.find(m=>m.scene==='新品产品咨询'&&m.kind==='rule').clauses[0].locales.en+=' changed']){
  const bad=structuredClone(args);mutate(bad);assert.throws(()=>buildNativePilotMaterials(bad),/Source mismatch|NP paired draft bytes changed/);
 }
 const bad=structuredClone(args);delete bad.translations.rules['EC-TARGET'].exceptionCriteria;
 assert.throws(()=>buildNativePilotMaterials(bad),/nonempty value/);
});

test('EC-TARGET v2 criteria and instructions contain no v3 positive-review relaxation or invalid exemption',{skip:!integration},async()=>{
 const args=await input(),bundle=buildNativePilotMaterials(args),ec=bundle.materials.filter(m=>m.scene==='电商评论回复'),rule=ec.find(m=>m.id==='EC-TARGET');
 assert.equal(rule.version,'V3.6');
 const texts=Object.fromEntries(rule.clauses.map(c=>[c.clauseId,c.locales.en]));
 assert.match(texts.pass,/Even generic positive reviews require relevant additional information/);
 assert.match(texts.pass,/apology\/acknowledgement.*issue-specific explanation.*usable official channel/);
 assert.match(texts.fail,/at least three distinct source rows.*same nonempty administrator.*every pair reaching 85%/);
 assert.match(texts.exception,/existing generic reply is FAIL/);
 assert.doesNotMatch(Object.values(texts).join('\n'),/invalid|not mandatory|may PASS even|both conditions/);
 const policy=ec.find(m=>m.id==='EC-BUSINESS-POLICY').clauses.find(c=>c.clauseId==='EC-TARGET-BUSINESS-1');
 assert.equal(policy.locales.en,`Pass: ${texts.pass}\nFail: ${texts.fail}\nExceptions: ${texts.exception}`);
 const prompt=ec.find(m=>m.kind==='prompt'),instruction=prompt.clauses.find(c=>c.clauseId==='inspection.ecommerce-policy');
 assert.match(instruction.locales.en,/ec-target-calibration-v2/);assert.ok(instruction.locales.en.includes(texts.pass));
 assert.doesNotMatch(instruction.locales.en,/ec-target-calibration-v3|can pass without extra information|makes only single-reply relevance NA/);
 assert.match(prompt.clauses.find(c=>c.clauseId==='program.ec-invalid').locales.en,/do not exempt/);
});
