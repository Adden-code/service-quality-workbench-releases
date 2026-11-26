import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateBilingualMaterial,languageHash} from '../server/native-language-materials.mjs';

export const LEGACY_RELEASE_SEEDS=Object.freeze({
 'catalog-seed.json':'59b733917c9c2345f5a9143f6559661c73dfa7e43f5be7d84487850e23c54d55',
 'scene-seed.json':'51e71a94b16c410a9b3b0f0eb0caf7058d2adee42002185806bd3d642f539351'
});
export const HOTFIX_01127_RELEASE_SEEDS=Object.freeze({...LEGACY_RELEASE_SEEDS,'scene-seed.json':'3e2b25273ae15ce3b214bc01ae7da8a23db1d8619e419d0ef556ee593ea143e5'});

/** Compatibility packages omit drafts; pilot packages require explicit, hash-bound authorization. */
export async function validateNativeReleasePayload(root,{expectedSeeds=LEGACY_RELEASE_SEEDS,requireLegacyCompatibility=false,requirePilot=false}={}){
 const rejected=[];
 async function walk(directory,relative=''){
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){
   const rel=(relative?relative+'/':'')+entry.name;
   if(entry.isSymbolicLink())throw new Error('Linked release content is not allowed: '+rel);
   if(/^(?:data|tests|acceptance-workspaces)\//i.test(rel)||/(?:^|\/)(?:native-materials|language-materials)(?:\/|$)/i.test(rel)||/native-language-prompt-draft|review[-_]draft/i.test(rel))rejected.push(rel);
   if(entry.isDirectory())await walk(path.join(directory,entry.name),rel);
  }
 }
 await walk(root);
 if(rejected.length)throw new Error('Unreviewed native materials or workspace/test data are not permitted in this release: '+rejected.join(', '));
 const legacySeeds=[];
 for(const [name,expectedSha256] of Object.entries(expectedSeeds)){
  const bytes=await fs.readFile(path.join(root,'resources',name)).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  const sha256=bytes?createHash('sha256').update(bytes).digest('hex'):null;
  legacySeeds.push({path:'resources/'+name,sha256,expectedSha256,matches:sha256===expectedSha256});
 }
 const legacySeedCompatibility=legacySeeds.length>0&&legacySeeds.every(seed=>seed.matches);
 const authorizedHotfixCompatibility=legacySeeds.length===2&&legacySeeds.every(seed=>seed.sha256===HOTFIX_01127_RELEASE_SEEDS[seed.path.slice('resources/'.length)]);
 if(requireLegacyCompatibility&&!legacySeedCompatibility&&!authorizedHotfixCompatibility)throw new Error('Seeds differ from the approved baseline and the exact authorized 0.11.27 v2 rollback.');
 let pilot=null;try{pilot=JSON.parse(await fs.readFile(path.join(root,'resources/native-pilot-materials.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(requirePilot&&!pilot)throw new Error('The complete native pilot bundle is required.');
 if(pilot)validateNativePilotBundle(pilot);
 return {stage:4,reviewGate:pilot?'explicit-workspace-activation-required':'required',nativeBusinessMaterialCount:pilot?.materials.length||0,...(pilot?{pilotId:pilot.id,pilotVersion:pilot.version,pilotHash:languageHash(pilot),materialStatus:'pilot-unreviewed',authorizationId:pilot.authorization.authorizationId,automaticInjection:false}:{}),legacySeedCompatibility,authorizedHotfixCompatibility,legacySeeds,npBilingualReview:'pending',reportPromptV12Review:'pending',ecEnglishArbitration:'pending'};
}

export function validateNativePilotBundle(bundle){
 if(bundle?.schemaVersion!==1||!bundle.id||!bundle.version||!bundle.authorization?.authorizationId||!Array.isArray(bundle.materials)||!bundle.materials.length)throw new Error('Invalid native pilot bundle.');
 const seen=new Set();
 for(const m of bundle.materials){validateBilingualMaterial(m);const key=m.scene+'::'+m.id;if(seen.has(key))throw new Error('Duplicate pilot material: '+key);seen.add(key);if(m.review.status!=='pilot-unreviewed'||['actor','reason','authorizationId'].some(k=>m.review[k]!==bundle.authorization[k]))throw new Error('Pilot authorization mismatch.');}
 for(const [scene,count]of [['新品产品咨询',17],['电商评论回复',5]]){const items=bundle.materials.filter(m=>m.scene===scene);if(items.filter(m=>m.kind==='rule').length!==count||['template','prompt','glossary'].some(kind=>items.filter(m=>m.kind===kind).length!==1)||!items.some(m=>m.id==='NATIVE-CONFIG'))throw new Error('Incomplete pilot scene: '+scene);}
 return bundle;
}

export function nativePilotReleaseGuide(language='zh'){
 return language==='en'?`0.11.28 — native English frontline pilot

The complete 52-item bilingual pilot bundle is rebuilt from the exact 0.11.27 source criteria, including EC-TIME V3.3 and the EC-TARGET V3.6 v2 rollback. Both New Product Consultation and Ecommerce Review Replies can run natively in English after explicit activation. Business review and EC arbitration are still pending; the user authorized frontline trial on 26 November 2026 without waiting for them. This is trial permission, not formal business approval of the translations.

No pilot material is injected or activated automatically. In a fresh workspace, choose English, open Pilot material maintenance, enter the maintainer name and reason, acknowledge the unreviewed status, then activate. The confirmation is tied to this workspace and exact bundle hash. Both scenes should then show Ready. A new bundle requires its own confirmation; older confirmation does not authorize newly changed materials. Existing frozen tasks and reports retain their original materials.

AI findings, reasons and report analysis use the locked language directly. Original review/reply text is preserved and its delivery translation columns are generated automatically. English native tasks cannot reuse Chinese B6 calibration: initially all findings require human confirmation until each rule meets the existing minimum of 30 independent validation pairs and 80% agreement in the English scope.

WebView2 profiles remain outside the business data directory. Any old desktop-profile directory is preserved and omitted from backups. The 0.11.27 Chinese criteria are unchanged. Keep a complete workspace backup outside the program directory before upgrading.

`:`0.11.28 英文原生一线试用说明

完整52项双语试点材料已按0.11.27当前源重新生成，含EC-TIME V3.3、回退v2口径的EC-TARGET V3.6。新品产品咨询、电商评论回复两个场景均可在显式激活后英文原生运行。业务逐条核对和EC仲裁仍待完成；用户于2026年11月26日明确授权不再等待，先让一线试用并反馈。这是试用授权，不代表正式业务复核通过。

试点材料默认不注入、不激活。全新工作区选择English后，打开“试用材料维护”，填写维护人与原因，确认未完成业务逐条复核后激活；确认绑定本工作区和完整材料包哈希。激活后两场景均应显示就绪。新版材料需要单独确认，旧包授权不自动授权变更后的材料。已有任务与报告继续使用原冻结材料。

AI判定、理由及报告分析直接使用锁定语言生成；评论/回复原文保持，交付物原文译文列仍自动生成。英文原生任务不能复用中文B6标定，初期全部人工确认；英文范围每规则至少30对独立验证样本、一致率80%后逐步开启免审。

WebView2配置仍位于业务数据目录之外；旧desktop-profile保留原处并跳过备份。0.11.27中文判据不变。升级前请在程序目录外另存完整工作区备份。

`;
}

export function nativeReleaseGuide(language='zh'){
 return language==='en'?`Workspace language and reviewed materials (R39 Stage 4)

Existing workspaces with task history keep their existing language and display-translation behavior. Upgrading the program does not rewrite task snapshots, AI results, human reviews or calibration records.

A new workspace requires an explicit Chinese or English choice. The choice is locked to this workspace; the installer language does not make that choice for you. New native tasks require reviewed bilingual materials that exactly match the selected scene, rules, template and prompts. When these materials are unavailable, the workbench explains the missing prerequisites and blocks task creation. It never substitutes old Chinese execution or synthetic examples.

This package retains the previously released legacy seeds for compatibility. It contains no new NP bilingual execution materials, no unreviewed prompt V1.1/V1.2 package, and no EC English arbitration draft. Those materials remain pending business review. The program release is not their approval. Keep using an existing workspace for ongoing production work until your maintainer releases the approved native materials.

Native AI reasons use the frozen language directly. Original review/reply text remains unchanged and delivery translations are still generated automatically. English exemptions cannot reuse Chinese calibration: each rule needs at least 30 independent English validation pairs and 80% agreement before exemption is enabled.

Before upgrading, export a complete workspace backup. Keep it separately from the program directory. Returning to 0.11.24 requires restoring the pre-upgrade backup; do not ask the older program to execute new native tasks.

`:`工作区语言与已复核材料（需求39第4步）

已有任务历史的旧工作区继续原有语言与展示翻译方式。升级程序不改写历史任务快照、AI结果、人工复核或标定记录。

新工作区必须明确选择中文或English，选定后锁定；安装器语言不会替你选择。新原生任务必须具备与场景、规则、模板和提示词精确匹配且已复核的双语材料。材料未就绪时，界面说明缺项并阻止建任务，不回落到旧中文执行或合成示例。

本包保留既有旧合同种子用于兼容，不包含新的NP双语执行材料、未复核提示词V1.1/V1.2包或EC英文仲裁草稿；这些仍待业务复核。程序发布不代表材料已批准。在维护人发布已复核原生材料前，日常作业请继续使用已有工作区。

原生AI理由直接使用冻结语言；评价/回复原文保持，交付时原文译文仍自动生成。英文免审不能借用旧中文标定，每条规则须按既有标准积累至少30对独立英文验证样本、一致率达到80%后逐步启用。

升级前导出完整工作区备份，并保存在程序目录之外。回退0.11.24需恢复升级前备份，不把新原生任务交给旧程序执行。

`;
}
