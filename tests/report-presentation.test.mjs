import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readdirSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {buildBusinessReportHtml} from '../public/business-report.mjs';
import {reportFixture} from './business-report-fixtures.mjs';
import {consultationReportFixture} from './consultation-report-fixtures.mjs';
import {scenarioConfig} from './scenario-report-fixtures.mjs';
import {collectReportTranslationFields} from '../public/report-locale.mjs';
import {formatBusinessReason} from '../public/business-delivery.mjs';

const moduleUrl=new URL('../public/report-presentation.mjs',import.meta.url);
async function presentation(){
  assert.ok(existsSync(moduleUrl),'shared report presentation helpers are required');
  return import(moduleUrl);
}
const section=(html,id)=>html.match(new RegExp(`<section class="report-section" id="${id}">([\\s\\S]*?)<\\/section>`))?.[1]||'';
const translatedOptions=(snapshot,enrichment)=>({language:'en',translations:collectReportTranslationFields(snapshot,enrichment).map(field=>({id:field.id,sourceText:field.text,status:'translated',text:`English ${field.id}`}))});
function fixtures(){
  const ecommerce=reportFixture(),consultation=consultationReportFixture(),configured=consultationReportFixture();
  configured.snapshot.scenarioSnapshot=scenarioConfig({analysisFields:['intent'],customFields:[],report:{title:'售后服务报告',groupBy:'product',groupField:'',groupLabel:'产品',sections:['overview','breakdown','dimensions','cases','improvements','voc']}});
  configured.snapshot.scene=configured.snapshot.scenarioSnapshot.id;
  return[ecommerce,consultation,configured];
}

test('rate comparison keeps the 60 percent boundary and unavailable values separate from zero',async()=>{
  const {rateComparisonCell,reportTable}=await presentation();
  const html=reportTable(['Comparison'],[[rateComparisonCell(59.9,60,{ai:'AI',final:'Final',unavailable:'Unavailable'})],[rateComparisonCell(null,undefined,{ai:'AI',final:'Final',unavailable:'Unavailable'})],[rateComparisonCell(0,100)]]);
  assert.match(html,/class="rate-comparison"/);
  assert.match(html,/class="rate-fill low"[^>]*width:59\.9%/);
  assert.match(html,/class="rate-fill"[^>]*width:60%/);
  assert.equal((html.match(/class="rate-unavailable"/g)||[]).length,2);
  assert.equal((html.match(/class="rate-fill(?: low)?"/g)||[]).length,4);
  assert.match(html,/Unavailable/);assert.match(html,/>0%<\//);assert.doesNotMatch(html,/<svg/);
  const invalid=reportTable(['Comparison'],[[rateComparisonCell('',NaN)],[rateComparisonCell(Infinity,'not a rate')]]);
  assert.equal((invalid.match(/class="rate-unavailable"/g)||[]).length,4);
  assert.doesNotMatch(invalid,/class="rate-fill/);
});

test('only controlled comparison tables reserve print width and table headers keep the blue header color',async()=>{
  const {reportTable,rateComparisonCell,reportStyles}=await presentation();
  const html=reportTable(['Pending','Comparison'],[['Pending',rateComparisonCell(70,80)]]);
  assert.match(html,/<table class="comparison-table">/);assert.match(html,/<th scope="col">Pending<\/th>/);
  assert.match(html,/<td><span class="verdict pending">Pending<\/span><\/td>/);
  const plain=reportTable(['Value'],[[{html:'<div class="rate-comparison">unsafe</div>',kind:'rate-comparison'}]]);
  assert.doesNotMatch(plain,/<table class="comparison-table">/);
  assert.match(reportStyles,/@media print[\s\S]*\.comparison-table th:last-child,\.comparison-table td:last-child\{width:(?:25|26|27|28)%\}/);
  assert.match(reportStyles,/@media print[\s\S]*\.comparison-table \.rate-row\{grid-template-columns:22px minmax\(40px,1fr\) 36px/);
});

test('presentation helpers escape data and accept rich table cells only from controlled helpers',async()=>{
  const {verdictHtml,reportTable,rateComparisonCell,caseFindingsHtml,directionHtml,clusterReasonCell,invalidFeedbackHtml,metadataHtml}=await presentation();
  for(const [word,kind]of[['Pass','pass'],['通过','pass'],['Fail','fail'],['不通过','fail'],['Pending','pending'],['待判定','pending']])assert.equal(verdictHtml(word),`<span class="verdict ${kind}">${word}</span>`);
  for(const word of ['constructor','toString','__proto__'])assert.equal(verdictHtml(word),word);
  const attack='<img src=x onerror="evil()">';
  const html=[reportTable([attack],[[attack,{html:attack},rateComparisonCell(59,61,{ai:attack,final:attack,unavailable:attack})]]),caseFindingsHtml([{dimension:attack,category:attack,reason:attack,evidence:attack,source:attack}]),directionHtml(attack,attack),reportTable(['Cluster'],[[clusterReasonCell(attack,attack,attack)]]),invalidFeedbackHtml([{sourceRows:attack,original:attack,reason:attack}],{source:attack}),metadataHtml([[attack,attack]],[[attack,attack]]),verdictHtml(attack)].join('');
  assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img\b|onerror="evil\(\)"/);
  assert.match(html,/\[object Object\]/);assert.doesNotMatch(html,/<(?:script|svg|iframe)\b/);
});

test('all six report views use the same offline G presentation and three primary metadata rows',()=>{
  for(const fixture of fixtures())for(const language of ['zh','en']){
    const {snapshot,enrichment}=fixture,before=JSON.stringify(fixture),html=buildBusinessReportHtml(snapshot,enrichment,language==='en'?translatedOptions(snapshot,enrichment):{});
    assert.match(html,/class="report-banner"/);
    assert.match(html,/class="meta meta-primary"/);
    const primary=html.match(/<dl class="meta meta-primary">([\s\S]*?)<\/dl>/)?.[1]||'';
    assert.equal((primary.match(/<dt>/g)||[]).length,3);
    assert.match(html,/class="meta meta-supporting"/);
    assert.match(html,/class="rate-comparison"/);assert.match(html,/class="case-findings"/);assert.match(html,/class="direction"/);assert.match(html,/class="actions"/);assert.match(html,/class="voc-invalid"/);
    assert.match(html,/<footer class="report-footer"><h2>(?:附注|Notes)<\/h2>/);
    for(const color of ['#f0f3f8','#1f3864','#2f5496','#f6f8fc','#fdf1f2','#c0392b','#d5e0f0','#e3e9f3','#eaf0fa','#1e8e3e','#b58a2b','#fdecea','#f4f6fa','#eef4ff'])assert.ok(html.includes(color),color);
    assert.match(html,/max-width:1100px/);assert.match(html,/border-radius:12px/);assert.match(html,/rgba\(0,0,0,\.06\)/);assert.match(html,/@page\{size:A4/);assert.match(html,/@media print/);
    assert.doesNotMatch(html,/<(?:svg|script|link|iframe|img)\b|@import|url\s*\(/i);
    assert.doesNotMatch(html,/\b(?:src|href)\s*=\s*["']?(?:https?:|\/\/)/i);
    assert.equal(JSON.stringify(fixture),before);
  }
});

test('failure badges directions and translations have explicit copyable labels in both report languages',()=>{
  for(const {snapshot,enrichment}of fixtures())for(const language of ['zh','en']){
    const html=buildBusinessReportHtml(snapshot,enrichment,language==='en'?translatedOptions(snapshot,enrichment):{});
    assert.match(html,language==='en'?/class="failure-badge">[^<]+<span class="badge-verdict"> Fail<\/span>/:/class="failure-badge">[^<]+<span class="badge-verdict">不通过<\/span>/);
    const directions=[...html.matchAll(/<div class="direction">([\s\S]*?)<\/div>/g)];assert.ok(directions.length);
    for(const [,body]of directions)assert.match(body,language==='en'?/<span class="direction-label">Direction: <\/span>/:/<span class="direction-label">方向：<\/span>/);
    const translations=[...html.matchAll(/<p class="(?:translation|missing)"[^>]*>([\s\S]*?)<\/p>/g)];assert.ok(translations.length);
    for(const [,body]of translations)assert.match(body,language==='en'?/^<span class="translation-label">Translation: <\/span>/:/^<span class="translation-label">译：<\/span>/);
  }
});

test('rate comparisons append to the existing check table and preserve its denominators',()=>{
  for(const {snapshot,enrichment}of fixtures())for(const language of ['zh','en']){
    const html=buildBusinessReportHtml(snapshot,enrichment,language==='en'?translatedOptions(snapshot,enrichment):{}),consultation=snapshot.deliveryType==='consultation-v1',id=language==='en'?'dimension-results':consultation?'dimension-results':'check-results',body=section(html,id),rows=consultation?snapshot.metrics.dimensionStats:snapshot.metrics.ruleStats;
    const headers=body.match(/<thead>([\s\S]*?)<\/thead>/)?.[1]||'';
    assert.equal((headers.match(/<th\b/g)||[]).length,language==='en'?9:8);
    assert.equal((body.match(/class="rate-comparison"/g)||[]).length,rows.length);
    for(const row of rows)for(const value of [row.ai.denominator,row.final.denominator,row.final.failed,row.final.pending])assert.ok(body.includes(`>${value}</td>`),`${id}: ${value}`);
  }
});

test('single column case findings retain existing formatted reasons and evidence with separate direction blocks',()=>{
  const long='Full reason <unsafe> & exact evidence. '.repeat(40)+'REASON-END';
  for(const fixture of fixtures()){
    const {snapshot,enrichment}=fixture,record=snapshot.records.find(record=>record.finalOverall==='不通过'),item=record.final.find(item=>['不通过','Fail'].includes(item.verdict));item.reason=long;
    const html=buildBusinessReportHtml(snapshot,enrichment),body=section(html,'typical-cases');
    const formatted=formatBusinessReason(long,snapshot.deliveryType==='consultation-v1'?{maxChars:500}:{record,ruleId:item.ruleId||item.id}),escaped=formatted.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    assert.match(body,/<ul class="case-findings">/);assert.match(body,/<li><strong>/);assert.ok(body.includes(escaped));
    assert.match(body,/class="failure-badge"/);assert.match(body,/class="direction"/);assert.match(body,/class="case-meta"/);
    assert.doesNotMatch(body,/<thead><tr><th scope="col">(?:检核维度|检查项 \/ 所属维度)/);
    assert.match(html,/\.case-text\{display:grid;grid-template-columns:1fr;/);
    if(snapshot.deliveryType==='consultation-v1'){assert.match(body,/第20轮|>20<\//);assert.match(body,/AI初判/);assert.match(body,/需求承接/);assert.match(body,/Please contact the store directly\./);}
    else{assert.ok(body.includes(record.raw22[8]));assert.ok(body.includes(record.raw22[9]));assert.match(body,/原表历史人工参考/);}
  }
});

test('three column clusters keep labels source rows summaries and actions while Top 3 uses cards',()=>{
  for(const {snapshot,enrichment}of fixtures()){
    const html=buildBusinessReportHtml(snapshot,enrichment),body=section(html,'issue-clusters'),tables=[...body.matchAll(/<table>([\s\S]*?)<\/table>/g)],cluster=tables.find(match=>match[1].includes('class="cluster-reason"'))?.[1]||'';
    assert.equal((cluster.match(/<th\b/g)||[]).length,3);
    const item=enrichment.issueClusters[0];for(const value of [item.label,item.summary,item.action])assert.ok(cluster.includes(value),value);
    assert.match(cluster,/原表行号/);assert.match(body,/<ol class="actions">/);
  }
});

test('configured scenarios preserve selected modules and English source-bound translation guards',()=>{
  const {snapshot,enrichment}=fixtures()[2];snapshot.scenarioSnapshot.report.sections=['overview'];
  enrichment.issueClusters[0].action='DISABLED-ACTION';
  for(const language of ['zh','en']){
    const html=buildBusinessReportHtml(snapshot,enrichment,language==='en'?translatedOptions(snapshot,enrichment):{});
    assert.equal((html.match(/class="report-section"/g)||[]).length,1);assert.ok(!html.includes('DISABLED-ACTION'));
  }
  const ec=reportFixture();ec.snapshot.targetLang='en';ec.enrichment.translations['case-bad'].comment={status:'translated',text:'不允许混用的中文译文',detectedLanguage:'zh'};
  const html=buildBusinessReportHtml(ec.snapshot,ec.enrichment,{language:'en'});assert.match(html,/Original/);assert.match(html,/\[Translation missing\]/);assert.ok(!html.includes('不允许混用的中文译文'));
});

test('long source identifiers and maximum category labels stay contained in mobile and A4 layouts',async t=>{
  let playwrightUrl;
  try{playwrightUrl=import.meta.resolve('playwright');}
  catch(error){
    if(error?.code==='ERR_MODULE_NOT_FOUND'&&error.message.startsWith("Cannot find package 'playwright' imported from ")){t.skip('Optional browser layout regression requires the playwright package.');return;}
    throw error;
  }
  const {chromium}=await import(playwrightUrl),preferred=chromium.executablePath(),versionDirectory=dirname(dirname(preferred)),cache=dirname(versionDirectory),suffix=relative(versionDirectory,preferred);
  const cached=existsSync(cache)?readdirSync(cache).filter(name=>/^chromium-\d+$/.test(name)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})).map(name=>join(cache,name,suffix)):[];
  const executablePath=[process.env.DEMO_BROWSER_PATH,preferred,...cached].find(path=>path&&existsSync(path));
  if(!executablePath){t.skip('Browser layout regression requires an installed Chromium or DEMO_BROWSER_PATH.');return;}
  const browser=await chromium.launch({headless:true,executablePath});
  const longProduct='PRODUCT-'+'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(3),longId='CONVERSATION-'+'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(3),longCategory='W'.repeat(60);
  try{
    for(const boundary of ['product-id','maximum-category'])for(const [index,fixture]of fixtures().slice(1).entries()){
      const {snapshot,enrichment}=fixture,record=snapshot.records.find(record=>record.finalOverall==='不通过');
      if(boundary==='product-id'){record.product=longProduct;record.externalId=longId;}
      else{
        const replaceCategory=item=>{if(item.category==='需求承接')item.category=longCategory;if(item.key==='需求承接')item.key=longCategory;if(item.label==='需求承接')item.label=longCategory;};
        for(const item of [...snapshot.basis.rules,...snapshot.basis.dimensions,...snapshot.metrics.ruleStats,...snapshot.metrics.dimensionStats,...enrichment.issueClusters])replaceCategory(item);
        for(const item of snapshot.records.flatMap(row=>['ai','historical','confirmed','final'].flatMap(group=>row[group]||[])))replaceCategory(item);
      }
      const expectedTokens=boundary==='product-id'?[longProduct,longId]:[longCategory];
      for(const language of ['zh','en'])for(const media of ['screen','print'])await t.test(`${boundary} ${index?'configured':'consultation'} ${language} ${media}`,async subtest=>{
        const page=await browser.newPage({viewport:media==='screen'?{width:390,height:844}:{width:794,height:1123}});
        try{
          await page.emulateMedia({media});
          await page.setContent(buildBusinessReportHtml(snapshot,enrichment,language==='en'?translatedOptions(snapshot,enrichment):{}),{waitUntil:'load'});
          if(media==='print')await page.addStyleTag({content:'@media print{body{width:calc(210mm - 24mm)}}'});
          const layout=await page.evaluate(()=>{
            const rect=element=>element.getBoundingClientRect(),report=document.querySelector('.report'),table=document.querySelector('.comparison-table'),wrap=table.closest('.table-wrap');
            const caseOverflow=Array.from(document.querySelectorAll('.case')).flatMap(card=>Array.from(card.querySelectorAll('*')).filter(element=>!element.closest('.table-wrap')).filter(element=>rect(element).right>rect(card).right+1||rect(element).left<rect(card).left-1).map(element=>({tag:element.tagName,className:element.className,text:element.textContent,width:rect(element).width,right:rect(element).right,caseRight:rect(card).right})));
            return{documentWidth:document.documentElement.scrollWidth,viewport:innerWidth,bodyWidth:rect(document.body).width,reportWidth:rect(report).width,reportScroll:report.scrollWidth,tableWidth:rect(table).width,wrapWidth:wrap.clientWidth,wrapScroll:wrap.scrollWidth,headingOverflow:Array.from(document.querySelectorAll('h1,h2,h3,h4')).filter(element=>element.scrollWidth>element.clientWidth+1).map(element=>({text:element.textContent,width:element.clientWidth,scroll:element.scrollWidth})),caseOverflow,tracks:Array.from(table.querySelectorAll('.rate-track')).map(element=>rect(element).width),text:document.body.textContent};
          });
          const details=JSON.stringify({...layout,text:undefined});
          subtest.diagnostic(JSON.stringify({documentWidth:layout.documentWidth,viewport:layout.viewport,reportWidth:layout.reportWidth,reportScroll:layout.reportScroll,tableWidth:layout.tableWidth,wrapWidth:layout.wrapWidth,wrapScroll:layout.wrapScroll,minTrack:Math.min(...layout.tracks)}));
          for(const token of expectedTokens)assert.ok(layout.text.includes(token),'complete source product, conversation ID and category tokens must remain in the rendered document');
          assert.ok(layout.documentWidth<=layout.viewport+1,`document overflow: ${details}`);
          assert.ok(layout.reportScroll<=layout.reportWidth+1,`report overflow: ${details}`);
          assert.deepEqual(layout.headingOverflow,[],`heading text must wrap without truncation: ${details}`);
          assert.deepEqual(layout.caseOverflow,[],`all case content must fit the card boundary: ${details}`);
          if(media==='screen'){
            assert.ok(layout.tableWidth>=600,`multi-column table must remain readable: ${details}`);
            assert.ok(layout.wrapScroll>layout.wrapWidth,`wide mobile table must scroll inside its wrapper: ${details}`);
          }else{
            assert.ok(layout.tableWidth<=layout.bodyWidth+1,`A4 table must fit the printable body: ${details}`);
            assert.ok(layout.tracks.every(width=>width>=39),`A4 comparison tracks must remain legible: ${details}`);
          }
        }finally{await page.close();}
      });
    }
  }finally{await browser.close();}
});
