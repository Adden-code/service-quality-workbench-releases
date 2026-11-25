import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateCatalogSeed} from '../server/catalog-seed.mjs';
import {validateSceneSeed} from '../server/scene-seed.mjs';
import {parseBusinessInput} from '../public/business-input.mjs';
import {createBusinessState} from '../public/domain.mjs';
import {migrateCatalogScenes,eligibleSceneRules} from '../public/catalog-scenes.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const catalogPath='resources/catalog-seed.json';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const synthetic=/\bsynthetic\b|虚构(?:演示|售前|场景|示例|测试)|演示(?:资料|规则|版本|维护人)|测试夹具/iu;
const hasSynthetic=value=>synthetic.test(JSON.stringify(value));
async function bytes(file){const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw new Error('目录种子与示例须为8MB以内的普通文件。');return fs.readFile(file);}

async function discoverCatalogSeed(sourceDir){
 const directory=path.join(path.resolve(sourceDir),'resources');
 try{const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('目录种子资源须为普通目录，不允许链接。');await fs.lstat(path.join(directory,'catalog-seed.json'));return path.join(directory,'catalog-seed.json');}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
}

function factoryCatalog(catalog,profile){
 if(profile==='builtin-two-scenes'){
  const ids=Array.from({length:17},(_,i)=>`NP-R${String(i+1).padStart(2,'0')}`);
  if(catalog.rules.length!==17||new Set(catalog.rules.map(r=>r.id)).size!==17||ids.some(id=>!catalog.rules.some(r=>r.id===id&&r.ruleKind==='session-check'&&r.sceneIds?.includes('新品产品咨询'))))throw new Error('两场景内置目录须恰好17条NP-R01至NP-R17会话规则；EC五项由执行器提供，不放入目录。');
  return{newProductRules:17,ecommerceRules:5,policies:catalog.policies.length};
 }
 const expected=Array.from({length:22},(_,i)=>`NP-R${String(i+1).padStart(2,'0')}`),np=catalog.rules.filter(rule=>/^NP-R\d{2}$/.test(rule.id)),ec=catalog.rules.filter(rule=>['EC-TIME','EC-TEXT','EC-TARGET','EC-STEPS','EC-PRIVACY'].includes(rule.id));
 const completeNewProduct=np.length===22&&new Set(np.map(rule=>rule.id)).size===22&&expected.every(id=>np.some(rule=>rule.id===id));
 if(profile==='new-product'){
  if(!completeNewProduct||catalog.rules.length!==22||catalog.policies.length!==1||catalog.policies[0].id!=='NP-POLICY'||catalog.policies[0].sections.length!==23)throw new Error('新品出厂目录须且只能有NP-R01至NP-R22共22条规则，以及一份含23章节的NP-POLICY。');
  if(catalog.ruleSets!==undefined)throw new Error('新品出厂目录不包含电商规则集。');
 }else{
  if(!completeNewProduct||ec.length!==5||new Set(ec.map(rule=>rule.id)).size!==5)throw new Error('出厂目录须有新品NP-R01至R22共22条及电商五项规则。');
  if(!catalog.policies.some(policy=>policy.id==='NP-POLICY'&&policy.sections.length===23)||!catalog.policies.some(policy=>policy.id==='EC-POLICY'&&policy.sections.length===5))throw new Error('出厂种子须有新品23章节和电商5章节政策。');
 }
 const state=createBusinessState(),assigned=migrateCatalogScenes({state,catalog}).catalog,basisDate=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 const usable=scene=>new Set(eligibleSceneRules({state,catalog:assigned,scene,effectiveDate:basisDate}).map(rule=>rule.id));
 const newProduct=usable('新品产品咨询'),ecommerce=usable('电商评论回复');
 if(np.some(rule=>!newProduct.has(rule.id))||(profile==='all-scenes'&&ec.some(rule=>!ecommerce.has(rule.id))))throw new Error(`出厂种子在基准日期${basisDate}须有22条新品${profile==='all-scenes'?'及5条电商':''}可用规则，场景归属、发布和引用资料生效期均须匹配。`);
 return {newProductRules:np.length,ecommerceRules:ec.length,policies:catalog.policies.length,basisDate};
}

function completeBuiltinScenes(seed){
 const np=seed?.packages.find(p=>p.configuration.sceneId==='新品产品咨询'),ec=seed?.packages.find(p=>p.configuration.sceneId==='电商评论回复');
 if(!np||!ec)throw new Error('两场景内置包须同时包含已核对的场景种子，不需要业务示例文件。');
 if(np.configuration.aggregateRuleId!=='NP-R01')throw new Error('新品NP-R01须映射整体派生列，不得作为独立AI或人工检核项。');
 const expectedCategories=['整体判定',...Array(11).fill('服务礼仪'),...Array(2).fill('探需'),...Array(3).fill('导购')];
 if(expectedCategories.some((category,i)=>!np.configuration.basis.rules.some(r=>r.id===`NP-R${String(i+1).padStart(2,'0')}`&&r.category===category)))throw new Error('新品17条规则类别须为整体判定1、服务礼仪11、探需2、导购3。');
 if(np.configuration.timingPolicy.standardsStatus!=='pending'||np.configuration.timingPolicy.standards.length)throw new Error('内置站点标准必须留空待质检人员维护。');
 const missing=['site','timing','intent','salesStage','demandSummary','negativeVoice'].filter(key=>!np.configuration.capabilities.some(c=>c.key===key&&c.phase==='pre'));
 if(missing.length)throw new Error('新品内置前置能力缺少：'+missing.join('、'));
 if(np.taxonomy?.labels.filter(l=>l.parentId).length!==14||!np.taxonomy.examples.length||!np.taxonomy.principles.length)throw new Error('新品须内置14个二级分类及核对过的双语示例、选择原则。');
 if(!np.exceptions.some(t=>t.ruleId==='NP-R13'&&t.entries.length===8))throw new Error('新品探需规则须内置独立8场景例外表。');
 for(const [p,sections] of [[np,['overview','dimensions','cases','improvements','voc']],[ec,['overview','distribution','dimensions','cases','improvements','voc']]])if(JSON.stringify(p.template.sections.map(s=>s.key))!==JSON.stringify(sections))throw new Error('新品五部分、电商六部分业务章节顺序不完整。');
 if(!['commentTranslation','replyTranslation'].every(field=>ec.template.columns.some(c=>c.field===field&&c.visible)))throw new Error('电商明细须显示评价、回复双翻译列。');
 // The legacy profile is >=3 duplicates and V1 text/structure/privacy checks.
 // Never label that runtime as the newly approved >=2 / 85% business contract.
 if(ec.configuration.basis.executionProfile!=='ec-business-v1')throw new Error('电商业务口径执行器尚未完成升级：旧测试口径不能作为两场景开箱即用包发布（须核对至少2条/85%、文本四项、200字符豁免及掩码禁用）。');
}

/** Optional build CLI flags; positional runtime/compiler inputs remain unchanged. */
export function parseFactoryBuildArgs(args=[]){
 const names={'--native-pilot-materials':'nativePilotMaterialsFile','--catalog-seed':'catalogSeedFile','--scene-seed':'sceneSeedFile','--source-dir':'sourceDir','--sample':'sampleFile','--factory-profile':'factoryProfile','--materials-kind':'materialsKind'},options={};
 for(let i=0;i<args.length;i++){
  const flag=args[i],name=flag==='--require-factory-materials'?'requireFactoryMaterials':names[flag];
  if(!name)throw new Error('未知构建参数：'+flag);if(Object.hasOwn(options,name))throw new Error('构建参数重复：'+flag);
  if(name==='requireFactoryMaterials'){options[name]=true;continue;}
  const value=args[++i];if(typeof value!=='string'||!value.trim()||value.startsWith('--'))throw new Error('构建参数缺少值或路径：'+flag);options[name]=value;
 }
 return options;
}

/** Validate before staging; discovery is restricted to source resources, never user data. */
export async function prepareFactoryResources({root,catalogSeedFile,sceneSeedFile,sourceDir=project,sampleFile,requireFactoryMaterials=false,factoryProfile='all-scenes',materialsKind='unverified'}={}){
 if(!['all-scenes','new-product','builtin-two-scenes'].includes(factoryProfile))throw new Error('出厂目录 profile 仅支持 all-scenes、new-product 或 builtin-two-scenes。');
 if(!['unverified','synthetic','approved'].includes(materialsKind))throw new Error('materialsKind 材料类型仅支持 unverified、synthetic 或 approved。');
 if(catalogSeedFile!==undefined&&(typeof catalogSeedFile!=='string'||!catalogSeedFile.trim()))throw new Error('目录种子路径无效。');
 const seedFile=catalogSeedFile===undefined?await discoverCatalogSeed(sourceDir):catalogSeedFile;
 // Explicit only: adding a scene resource to a source folder must not silently change an ordinary program release.
 let sceneSeedBytes,sceneSeed=null;
 const builtin=factoryProfile==='builtin-two-scenes';
 if(builtin&&(!seedFile||!sceneSeedFile))throw new Error('两场景内置包需要完整17条目录种子和场景种子，不依赖示例文件。');
 if(builtin&&sampleFile)throw new Error('两场景内置包不携带业务会话示例；合成验收资料独立存放。');
 if(requireFactoryMaterials&&!builtin&&(!seedFile||!sampleFile))throw new Error('出厂包需要完整目录种子和标准示例，材料缺失时不构建正式包。');
 let seedBytes,sampleBytes,catalog=null,sample=null,counts=null,syntheticFound=false;
 if(seedFile){seedBytes=await bytes(seedFile);catalog=validateCatalogSeed(JSON.parse(seedBytes.toString('utf8').replace(/^\uFEFF/,'')));syntheticFound=hasSynthetic(catalog);if(requireFactoryMaterials||factoryProfile==='new-product'||builtin)counts=factoryCatalog(catalog,factoryProfile);}
 if(sceneSeedFile!==undefined){if(typeof sceneSeedFile!=='string'||!sceneSeedFile.trim())throw new Error('场景种子路径无效。');sceneSeedBytes=await bytes(sceneSeedFile);sceneSeed=validateSceneSeed(JSON.parse(sceneSeedBytes.toString('utf8').replace(/^\uFEFF/,'')),catalog);syntheticFound||=hasSynthetic(sceneSeed);}
 if(builtin)completeBuiltinScenes(sceneSeed);
 if(sampleFile){
  sampleBytes=await bytes(sampleFile);if(path.extname(sampleFile).toLowerCase()!=='.xlsx')throw new Error('随包示例必须为标准xlsx文件。');
  const parsed=await parseBusinessInput({name:'sample.xlsx',size:sampleBytes.length,arrayBuffer:async()=>sampleBytes});
  if(!parsed.valid)throw new Error('标准示例预检未通过：'+parsed.errors.join('；'));
  syntheticFound||=hasSynthetic(parsed.sessions);
  sample={sessions:parsed.sessions.length,turns:parsed.turnCount,sha256:sha(sampleBytes),bytes:sampleBytes.length};
  if(requireFactoryMaterials&&(sample.sessions!==49||sample.turns!==1735||parsed.sessions.some(session=>session.scene!=='新品产品咨询')))throw new Error('出厂新品示例必须为49会话、1735轮，且全部属于新品产品咨询。');
 }
 if(materialsKind==='approved'&&syntheticFound)throw new Error('SYNTHETIC 合成或虚构材料不得标记为 approved 业务标准。');
 const actualKind=catalog||sample?(syntheticFound?'synthetic':materialsKind):'none';
 const info={sourceDataIncluded:Boolean(catalog||sample),catalogSeedIncluded:Boolean(catalog),sampleIncluded:Boolean(sample),businessTaskDataIncluded:false,credentialsIncluded:false,factoryProfile,materialsKind:actualKind,factoryReady:Boolean(requireFactoryMaterials&&catalog&&(builtin?sceneSeed:sample)&&actualKind==='approved'),catalog:catalog?catalogPath:null,catalogInfo:catalog?{sha256:sha(seedBytes),bytes:seedBytes.length,rules:catalog.rules.length,policies:catalog.policies.length,...counts}:null,sample};
 info.sceneSeedIncluded=Boolean(sceneSeed);info.sceneSeedInfo=sceneSeed?{id:sceneSeed.id,sha256:sha(sceneSeedBytes),bytes:sceneSeedBytes.length,scenes:sceneSeed.packages.map(p=>({id:p.configuration.sceneId,version:p.configuration.version}))}:null;
 if(catalog){await fs.mkdir(path.join(root,'resources'),{recursive:true});await fs.writeFile(path.join(root,catalogPath),seedBytes,{flag:'wx'});}
 if(sceneSeed)await fs.writeFile(path.join(root,'resources/scene-seed.json'),sceneSeedBytes,{flag:'wx'});
 if(sample){await fs.mkdir(path.join(root,'docs/samples'),{recursive:true});await fs.writeFile(path.join(root,'docs/samples/新品产品咨询_标准示例.xlsx'),sampleBytes,{flag:'wx'});}
 return info;
}
