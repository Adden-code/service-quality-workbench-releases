// Synthetic, offline report evidence only. No app data and no model requests.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {sceneReportFixture} from './scene-report-fixtures.mjs';
import {collectReportTranslationFields} from '../public/report-locale.mjs';
import {buildSceneReportHtml,buildSceneDeliveryXlsx} from '../public/scene-delivery.mjs';
const output=path.resolve(process.argv[2]||'../outputs/service01122-delivery-20261124');await fs.mkdir(output,{recursive:true});
const {snapshot,enrichment}=sceneReportFixture('ecommerce',4),record=snapshot.records[0],audit=snapshot.sceneAudit[0];
record.raw22[8]='Synthetic customer review: The warranty answer is incomplete.';record.raw22[9]='Please contact our team. We will check the warranty conditions.';
for(const [index,quote]of ['Please contact our team.','contact our team.','team. We will check'].entries()){record.final[index].verdict='不符合';record.final[index].reason='未明确回答用户关于保修的具体问题。';audit.review.drafts[record.final[index].id].reason=record.final[index].reason;audit.ai[index].reason=record.final[index].reason;audit.ai[index].evidenceQuotes=[{turnId:2,quote}];}
snapshot.reviewPolicy={enabled:false,confidenceThreshold:.9};record.routing={aiFinal:false,needsReview:true};
const fields=collectReportTranslationFields(snapshot,enrichment),translations=fields.map(field=>({id:field.id,sourceText:field.text,text:/\p{Script=Han}/u.test(field.text)?field.text.includes('未明确回答')?'The reply does not answer the specific warranty question.':`Synthetic English ${field.id}`:field.text,status:'translated',detectedLanguage:'zh'}));
const browser=await chromium.launch({headless:true,channel:process.env.REPORT_BROWSER_CHANNEL||'msedge'}),results=[];
try{for(const language of ['zh','en']){
 const html=buildSceneReportHtml(snapshot,enrichment,{language,translations}),file=path.join(output,`report-${language}.html`);await fs.writeFile(file,html);await fs.writeFile(path.join(output,`report-${language}.xlsx`),new Uint8Array(await buildSceneDeliveryXlsx(snapshot,enrichment,{language,translations})));
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),requests=[],errors=[];page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});page.on('pageerror',error=>errors.push(error.message));await page.goto(pathToFileURL(file).href);
 const item=page.locator('.case.error-case').first(),text=await item.innerText();assert.ok(text.includes(language==='en'?'Quote 1 · Reply':'引文 1 · 回复'));assert.ok(text.includes(language==='en'?'Covered rules':'覆盖规则'));assert.equal(text.split('Please contact our team. We will check').length-1,1);assert.equal(await page.locator('.ai-final-definition').count(),1);
 await item.screenshot({path:path.join(output,`report-${language}-case-desktop.png`)});const desktop=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,caseCount:document.querySelectorAll('.case').length}));assert.equal(desktop.overflow,false);
 await page.setViewportSize({width:390,height:844});const mobile=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1}));assert.equal(mobile.overflow,false);await item.screenshot({path:path.join(output,`report-${language}-case-mobile.png`)});await page.emulateMedia({media:'print'});await page.pdf({path:path.join(output,`report-${language}.pdf`),format:'A4',printBackground:true});assert.equal(requests.length,0);assert.deepEqual(errors,[]);results.push({language,desktop,mobile,externalRequests:requests.length,pageErrors:errors,mergedQuoteOccurrences:1});await page.close();
}}finally{await browser.close();}
await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({syntheticOnly:true,modelCalls:0,translationFields:fields.length,results},null,2));console.log(JSON.stringify({output,results},null,2));
