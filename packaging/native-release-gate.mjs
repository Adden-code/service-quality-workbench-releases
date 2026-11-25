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
 return language==='en'?`Emergency repair 0.11.27 — native pilot activation

The 52 paired pilot materials are unchanged from 0.11.26. They are NOT injected or activated automatically. A local maintainer must explicitly enable them, enter their name and reason, and acknowledge that Business review and EC arbitration are still pending. This approval is logged for this workspace and exact bundle. Previously auto-installed materials also require this confirmation before new tasks may use them. Existing frozen tasks and reports retain their original materials.

EC-TARGET is restored verbatim to the released 0.11.22 v2 criteria, published under a new bundle/version. Other EC and NP criteria are unchanged. The retained EC native pilot material describes v3; it therefore cannot be used for new v2 tasks. Enabling the pilot allows the matching NP material, but does not bypass the EC mismatch. Existing legacy workspaces can create EC tasks using v2.

English native tasks cannot reuse Chinese B6 calibration. They initially require human confirmation until each rule reaches the existing 30-pair / 80% agreement criteria in the English scope. Original source text is preserved; delivery translations remain automatic.

WebView2 now stores its browser profile outside the business data directory. Old desktop-profile folders are preserved and excluded from backups/startup cleanup. Browser-local preferences may reset once. Business data, frozen tasks, model settings and audit history remain in the workspace. Keep a full backup outside the program directory before upgrading.

`:`0.11.27紧急修复版：原生试用启用说明

52项双语试用材料与0.11.26逐字不变，默认不注入、不启用。维护人须在本机显式启用，填写姓名与原因，并确认业务逐条核对和EC仲裁仍待完成；授权绑定本工作区与材料包哈希并留痕。0.11.26已自动装入的材料，在用于新任务前同样须确认；已有任务及报告继续原冻结材料。

EC-TARGET逐字回退0.11.22 v2，以新种子ID及版本发布。其他EC与NP判据不变。保留的EC原生试用材料仍对应v3，因此不能用于新v2任务：启用试用后，匹配的NP材料可用，EC不绕过版本不匹配。既有legacy工作区可正常新建使用v2的EC任务。

英文原生任务不能复用中文B6标定，初期均需人工确认；英文范围每规则独立验证至少30对且一致率80%后再逐步开启免审。原始内容保持，交付原文译文仍自动生成。

WebView2浏览器配置移至业务数据目录之外；旧desktop-profile保留原处，不进入备份与启动清理。浏览器本地偏好可能重置一次；业务数据、冻结任务、模型设置与审计保留。升级前请另存完整工作区备份。

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
