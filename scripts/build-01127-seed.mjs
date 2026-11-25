import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateSceneSeed} from '../server/scene-seed.mjs';

export const HOTFIX_SEED_ID='builtin-two-scenes-01127-target-v2-rollback';
export const BASE_SCENE_SHA256='51e71a94b16c410a9b3b0f0eb0caf7058d2adee42002185806bd3d642f539351';
export const V2_SCENE_SHA256='619af54b38007b1a1078870da4b1f751f86e31535bca56b3ff78539613734b2d';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

// Extract the authorized v2 text from its released artifact, never reconstruct it.
export function buildHotfixSeed(base,v2,catalog){
 const next=structuredClone(base),pkg=next.packages.find(p=>p.configuration.engine==='ecommerce'),prior=v2.packages.find(p=>p.configuration.engine==='ecommerce');
 next.id=HOTFIX_SEED_ID;
 const c=pkg.configuration,r=c.basis.rules.find(r=>r.id==='EC-TARGET'),old=prior.configuration.basis.rules.find(r=>r.id==='EC-TARGET');
 for(const key of ['summary','passCriteria','failCriteria','exceptionCriteria'])r[key]=old[key];
 r.version='V3.6';r.changeNote='0.11.27 用户授权回退：逐字恢复0.11.22 v2针对性口径；新版本发布，历史任务不回溯。';
 c.basis.businessProfile.targetPolicyVersion='ec-target-calibration-v2';
 const policy=c.basis.policies.find(p=>p.id==='EC-BUSINESS-POLICY'),oldPolicy=prior.configuration.basis.policies.find(p=>p.id===policy.id);
 policy.version='V3.7';
 policy.sections.find(s=>s.id==='EC-TARGET-BUSINESS-1').text=oldPolicy.sections.find(s=>s.id==='EC-TARGET-BUSINESS-1').text;
 policy.content=policy.sections.map(s=>`${s.id} ${s.title}\n${s.text}`).join('\n\n');
 policy.summary=oldPolicy.summary;policy.changeNote=r.changeNote;
 c.version=7;c.reason=r.changeNote;c.actor='0.11.27授权回退发布';
 c.ruleBindings.find(b=>b.ruleId===r.id).ruleVersion=r.version;
 pkg.template.version=7;c.templateRef.version=7;
 pkg.template.columns.find(col=>col.ruleId===r.id).ruleVersion=r.version;
 validateSceneSeed(next,catalog);return next;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [baseFile,v2File,catalogFile,output]=process.argv.slice(2);
 if(!output)throw new Error('Usage: node scripts/build-01127-seed.mjs <0.11.26-scene> <0.11.22-scene> <catalog> <output>');
 const [baseBytes,v2Bytes,catalogBytes]=await Promise.all([fs.readFile(baseFile),fs.readFile(v2File),fs.readFile(catalogFile)]);
 if(hash(baseBytes)!==BASE_SCENE_SHA256||hash(v2Bytes)!==V2_SCENE_SHA256)throw new Error('Authoritative release seed hash mismatch.');
 const result=buildHotfixSeed(JSON.parse(baseBytes),JSON.parse(v2Bytes),JSON.parse(catalogBytes)),bytes=JSON.stringify(result,null,2)+'\n';
 await fs.mkdir(path.dirname(path.resolve(output)),{recursive:true});await fs.writeFile(output,bytes);
 console.log(JSON.stringify({id:result.id,sha256:hash(bytes),baseSha256:hash(baseBytes),v2Sha256:hash(v2Bytes)},null,2));
}
