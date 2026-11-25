import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {validateNativePilotBundle,validateNativeReleasePayload,nativePilotReleaseGuide} from '../packaging/native-release-gate.mjs';
import {languageHash} from '../server/native-language-materials.mjs';
import {payloadFiles} from '../packaging/build.mjs';
import {parseFactoryBuildArgs} from '../packaging/factory-resources.mjs';
const input=process.env.NATIVE_PILOT_BUNDLE,seedDir=process.env.NATIVE_PILOT_SEEDS;
test('pilot build explicitly passes the resource through installer and portable paths',async()=>{
 assert.deepEqual(parseFactoryBuildArgs(['--native-pilot-materials','pilot.json']),{nativePilotMaterialsFile:'pilot.json'});
 assert.ok(payloadFiles.includes('server/native-ecommerce-execution.mjs'));
 const source=await fs.readFile('packaging/build-installer.mjs','utf8');assert.match(source,/stageInstallerPayload\(\{[^\n]*nativePilotMaterialsFile/);
 for(const lang of ['en','zh'])assert.match(nativePilotReleaseGuide(lang),lang==='en'?/Business review and EC arbitration are still pending/:/业务逐条核对和EC仲裁仍待完成/);
});
test('complete pilot release retains original criteria and rejects unilateral material edits',{skip:!input||!seedDir},async t=>{
 const bundle=JSON.parse(await fs.readFile(input,'utf8'));assert.equal(validateNativePilotBundle(bundle),bundle);
 const seed=JSON.parse(await fs.readFile(path.join(seedDir,'scene-seed.json'),'utf8'));
 for(const pkg of seed.packages)for(const rule of pkg.configuration.basis.rules){const material=bundle.materials.find(m=>m.scene===pkg.configuration.sceneId&&m.id===rule.id);assert.equal(material.sourceHash,languageHash(rule));for(const [id,key]of [['pass','passCriteria'],['fail','failCriteria'],['exception','exceptionCriteria']])assert.equal(material.clauses.find(c=>c.clauseId===id).locales.zh,rule[key]);}
 for(const mutate of [b=>b.materials.pop(),b=>b.materials[0].clauses[0].locales.en+=' modified',b=>b.authorization.actor='forged']){const bad=structuredClone(bundle);mutate(bad);assert.throws(()=>validateNativePilotBundle(bad));}
 const parent=path.resolve('../outputs/service-r39-pilot-20261125/package-tests');await fs.mkdir(parent,{recursive:true});const root=await fs.mkdtemp(path.join(parent,'payload-'));t.after(async()=>{assert.ok(root.startsWith(parent+path.sep));await fs.rm(root,{recursive:true,force:true});});
 await fs.mkdir(path.join(root,'resources'));for(const name of ['catalog-seed.json','scene-seed.json'])await fs.copyFile(path.join(seedDir,name),path.join(root,'resources',name));
 await assert.rejects(validateNativeReleasePayload(root,{requirePilot:true}),/bundle is required/);
 await fs.copyFile(input,path.join(root,'resources/native-pilot-materials.json'));const proof=await validateNativeReleasePayload(root,{requirePilot:true,requireLegacyCompatibility:true});assert.equal(proof.nativeBusinessMaterialCount,52);assert.equal(proof.reviewGate,'explicit-user-authorized-pilot');assert.equal(proof.npBilingualReview,'pending');assert.equal(proof.ecEnglishArbitration,'pending');assert.equal(proof.legacySeedCompatibility,true);
});
