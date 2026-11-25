import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateBilingualMaterial,languageHash} from '../server/native-language-materials.mjs';

export const LEGACY_RELEASE_SEEDS=Object.freeze({
 'catalog-seed.json':'59b733917c9c2345f5a9143f6559661c73dfa7e43f5be7d84487850e23c54d55',
 'scene-seed.json':'51e71a94b16c410a9b3b0f0eb0caf7058d2adee42002185806bd3d642f539351'
});

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
 if(requireLegacyCompatibility&&!legacySeedCompatibility)throw new Error('Legacy seeds differ from the approved 0.11.24 baseline; native draft publication is not authorized.');
 let pilot=null;try{pilot=JSON.parse(await fs.readFile(path.join(root,'resources/native-pilot-materials.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(requirePilot&&!pilot)throw new Error('The complete native pilot bundle is required.');
 if(pilot)validateNativePilotBundle(pilot);
 return {stage:4,reviewGate:pilot?'explicit-user-authorized-pilot':'required',nativeBusinessMaterialCount:pilot?.materials.length||0,...(pilot?{pilotId:pilot.id,pilotVersion:pilot.version,pilotHash:languageHash(pilot),materialStatus:'pilot-unreviewed',authorizationId:pilot.authorization.authorizationId}:{}),legacySeedCompatibility,legacySeeds,npBilingualReview:'pending',reportPromptV12Review:'pending',ecEnglishArbitration:'pending'};
}

export function validateNativePilotBundle(bundle){
 if(bundle?.schemaVersion!==1||!bundle.id||!bundle.version||!bundle.authorization?.authorizationId||!Array.isArray(bundle.materials)||!bundle.materials.length)throw new Error('Invalid native pilot bundle.');
 const seen=new Set();
 for(const m of bundle.materials){validateBilingualMaterial(m);const key=m.scene+'::'+m.id;if(seen.has(key))throw new Error('Duplicate pilot material: '+key);seen.add(key);if(m.review.status!=='pilot-unreviewed'||['actor','reason','authorizationId'].some(k=>m.review[k]!==bundle.authorization[k]))throw new Error('Pilot authorization mismatch.');}
 for(const [scene,count]of [['新品产品咨询',17],['电商评论回复',5]]){const items=bundle.materials.filter(m=>m.scene===scene);if(items.filter(m=>m.kind==='rule').length!==count||['template','prompt','glossary'].some(kind=>items.filter(m=>m.kind===kind).length!==1)||!items.some(m=>m.id==='NATIVE-CONFIG'))throw new Error('Incomplete pilot scene: '+scene);}
 return bundle;
}

export function nativePilotReleaseGuide(language='zh'){
 return language==='en'?`Native-language pilot (0.11.26)

New workspaces can select Chinese or English and immediately use the built-in NP and EC scenes. Paired criteria, prompts and report templates are supplied under the user's explicit pilot authorization. Business review and EC arbitration are still pending; this package does not claim they are complete. The current Chinese criteria have not been recalibrated in this release. Please report incorrect or awkward wording with the task and rule IDs.

The workspace language is locked. AI explanations are generated directly in that language. Original source text is preserved, and review/reply translations are generated automatically with the delivery. Existing workspaces and historical task snapshots retain their original behavior.

English native tasks cannot reuse Chinese B6 calibration. They initially require human confirmation until each rule reaches the existing 30-pair / 80% agreement criteria in the English scope. Before upgrading, keep a full workspace backup outside the program directory. Reverting to 0.11.24 requires the pre-upgrade backup.

`:`原生语言试用版（0.11.26）

全新工作区选择中文或English后，即可使用内置新品、电商两场景。中英文判据、提示词与报告模板按用户明确授权作为试用材料随包提供；业务逐条核对和EC仲裁仍待完成，不标为正式复核通过。本版不增加新的电商判定口径调整。发现判定或措辞问题时，请记录任务编号、规则编号反馈。

工作区语言选定后锁定，AI理由直接以该语言生成；原始内容保留，评价/回复译文仍在交付时自动生成。旧工作区和历史任务继续原有行为，不重写冻结依据。

英文原生任务不能复用中文B6标定，初期均需人工确认；各规则在英文范围积累至少30对独立样本、一致率达到80%后再逐步启用免审。升级前请完整备份到程序目录之外。回退0.11.24须使用升级前备份。

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
