// Build-time English UI guard. Uses the existing Playwright Babel parser, no
// installed package or customer workspace is read. The browser gate completes
// the dynamic-data/state coverage; this pass checks source literals.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {html,t,uiAttributes,setLocale,getLocale} from '../public/i18n.mjs';
const require=createRequire(import.meta.url);
const {babelParse}=require(path.join(path.dirname(require.resolve('playwright/package.json')),'lib/transform/babelBundle.js'));
const CJK=/[\u3400-\u9fff]/u;
const visibleParts=source=>String(source).split(/(<!--[\s\S]*?-->|<[^>]*>)/g).flatMap(part=>part.startsWith('<')?[...part.matchAll(/\b(?:aria-label|title|placeholder|alt|aria-description)=(['"])([\s\S]*?)\1/g)].map(m=>m[2]):[part]).filter(part=>CJK.test(part));
const literal=node=>node?.type==='StringLiteral'?node.value:node?.type==='TemplateLiteral'&&node.expressions.length===0?node.quasis[0].value.cooked:null;
// Downloaded bilingual documents have a report-language contract independent of
// the screen locale. Their HTML is validated by report tests, not the UI gate.
const DOCUMENT_SERIALIZERS=new Set(['business-report.mjs','consultation-report.mjs','management-report.mjs','io.mjs','ecommerce-results.mjs']);

export function checkEnglishSource(source,file='<source>') {
  const ast=babelParse(source,file),findings=[],stats={taggedTemplates:0,translatedCalls:0,htmlLiterals:0};
  const imports=new Map();for(const node of ast.program.body)if(node.type==='ImportDeclaration'&&node.source.value==='./i18n.mjs')for(const spec of node.specifiers)imports.set(spec.local.name,spec.imported?.name);
  const flag=(node,kind,text)=>findings.push({file,line:node.loc?.start.line,kind,text});
  const privateFunctions=new Set(ast.program.body.filter(n=>n.type==='FunctionDeclaration').map(n=>n.id.name)),contexts=new Map(),zhFunctions=new Set();let collecting=true;
  // Explicit Chinese-only branches are excluded structurally, never by a hash
  // baseline. A new literal elsewhere is still checked on every build.
  const localeTest=node=>{
    if(node?.type!=='BinaryExpression'||!['===','==','!==','!='].includes(node.operator))return null;
    const call=node.left?.type==='CallExpression'&&node.left.callee.name==='getLocale',lang=literal(node.right);
    if(!call||!['en','zh'].includes(lang))return null;
    return ['===','=='].includes(node.operator)?lang:lang==='en'?'zh':'en';
  };
  function visit(node,parents=[],zhOnly=false){
    if(!node||typeof node!=='object'||!node.type)return;
    if(!collecting&&node.type==='FunctionDeclaration'&&zhFunctions.has(node.id.name))zhOnly=true;
    if(node.type==='ConditionalExpression'||node.type==='IfStatement'){
      const lang=localeTest(node.test);if(lang){visit(node.test,[...parents,node],zhOnly);visit(node.consequent,[...parents,node],zhOnly||lang==='zh');visit(node.alternate,[...parents,node],zhOnly||lang==='en');return;}
    }
    if(node.type==='BlockStatement'){
      let only=zhOnly;for(const item of node.body){visit(item,[...parents,node],only);if(item.type==='IfStatement'&&localeTest(item.test)==='en'&&(item.consequent.type==='ReturnStatement'||item.consequent.type==='BlockStatement'&&item.consequent.body.at(-1)?.type==='ReturnStatement'))only=true;}return;
    }
    const parent=parents.at(-1),name=node.callee?.type==='Identifier'?node.callee.name:'';
    if(collecting&&node.type==='CallExpression'&&privateFunctions.has(name)){if(!contexts.has(name))contexts.set(name,[]);contexts.get(name).push(zhOnly);}
    if(collecting&&node.type==='Identifier'&&privateFunctions.has(node.name)&&parent?.type==='CallExpression'&&parent.arguments.includes(node)){if(!contexts.has(node.name))contexts.set(node.name,[]);contexts.get(node.name).push(zhOnly);}
    if(!collecting&&!zhOnly&&node.type==='TaggedTemplateExpression'&&imports.get(node.tag.name)==='html'){
      stats.taggedTemplates++;const strings=node.quasi.quasis.map(q=>q.value.cooked),values=node.quasi.expressions.map((_,i)=>`QA_VALUE_${i}`);
      for(const text of visibleParts(html(strings,...values)))flag(node,'untranslated-template',text.trim());
    }
    if(!collecting&&!zhOnly&&node.type==='CallExpression'&&['t','uiLabel','uiLiteral','uiAttributes'].includes(imports.get(name))){
      const value=literal(node.arguments[0]);if(value!==null&&CJK.test(value)){
        stats.translatedCalls++;const result=imports.get(name)==='uiAttributes'?`<input ${uiAttributes(value)}>`:imports.get(name)==='uiLiteral'?html([value]):t(value);
        for(const text of visibleParts(result))flag(node,'missing-translation-key',text.trim());
      }
    }
    const value=node.type==='TemplateLiteral'?node.quasis.map(q=>q.value.cooked).join('QA_VALUE'):literal(node);
    if(!collecting&&!zhOnly&&!DOCUMENT_SERIALIZERS.has(path.basename(file))&&value&&/<[a-z][^>]*>/i.test(value)&&CJK.test(value)&&parent?.type!=='TaggedTemplateExpression'&&!(parent?.type==='CallExpression'&&['uiLiteral','uiAttributes'].includes(imports.get(parent.callee?.name)))){
      stats.htmlLiterals++;for(const text of visibleParts(value))flag(node,'unwrapped-html',text.trim());
    }
    // Direct browser writes must not insert untranslated Chinese literals.
    if(!collecting&&!zhOnly&&node.type==='AssignmentExpression'&&['innerHTML','textContent','innerText','placeholder','title'].includes(node.left?.property?.name)){
      const value=literal(node.right);if(value&&CJK.test(value))flag(node,'untranslated-dom-write',value);
    }
    for(const [key,value] of Object.entries(node))if(!['loc','start','end','extra','comments'].includes(key)){if(Array.isArray(value))for(const child of value)visit(child,[...parents,node],zhOnly);else visit(value,[...parents,node],zhOnly);}
  }
  visit(ast.program);for(const [name,modes] of contexts)if(modes.length&&modes.every(Boolean))zhFunctions.add(name);collecting=false;visit(ast.program);return{findings,stats};
}

export async function checkEnglishUi({root=path.resolve('public'),outDir}={}){
  const previousLocale=getLocale();setLocale('en',{storage:null});try{
  const entries=await fs.readdir(root),files=entries.filter(name=>name.endsWith('.mjs')),htmlFiles=entries.filter(name=>name.endsWith('.html')),findings=[],totals={files:files.length,htmlDocuments:htmlFiles.length,taggedTemplates:0,translatedCalls:0,htmlLiterals:0};
  for(const name of files){const report=checkEnglishSource(await fs.readFile(path.join(root,name),'utf8'),name);findings.push(...report.findings);for(const key of Object.keys(report.stats))totals[key]+=report.stats[key];}
  for(const name of htmlFiles){const source=await fs.readFile(path.join(root,name),'utf8');for(const text of visibleParts(source))findings.push({file:name,kind:'untranslated-entrypoint',text:text.trim()});for(const meta of source.matchAll(/<meta\b[^>]*\bcontent=(['"])(.*?)\1[^>]*>/gi))if(CJK.test(meta[2]))findings.push({file:name,kind:'untranslated-entrypoint-meta',text:meta[2]});}
  const report={status:findings.length?'failed':'passed',...totals,findings,documentSerializers:[...DOCUMENT_SERIALIZERS],scope:'Imported i18n literals across public/*.mjs and unwrapped screen HTML. Explicit Chinese-only branches/private helpers and downloaded document serializers are distinct from English screen UI. Canonical enums/model prompts are not UI literals. Dynamic content requires Chromium.'};
  if(outDir){await fs.mkdir(outDir,{recursive:true});await fs.writeFile(path.join(outDir,'static-check.json'),JSON.stringify(report,null,2));}return report;
  }finally{setLocale(previousLocale,{storage:null});}
}
export async function englishUiFingerprint({projectRoot=path.resolve('.')}={}){
  const files=[];async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else if(/\.(?:mjs|html|css)$/.test(entry.name))files.push(path.relative(projectRoot,file).replaceAll('\\','/'));}}
  await walk(path.join(projectRoot,'public'));
  files.push('scripts/check-english-ui.mjs','tests/english-ui-coverage.mjs','tests/english-ui-release-gate.mjs');
  const records=[];for(const file of files.sort())records.push(`${file}\0${createHash('sha256').update(await fs.readFile(path.join(projectRoot,file))).digest('hex')}`);
  return createHash('sha256').update(records.join('\n')).digest('hex');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const report=await checkEnglishUi({outDir:path.resolve('../outputs/service01124-20261125/english-gate')});console.log(JSON.stringify(report,null,2));if(report.findings.length)process.exitCode=1;
}
