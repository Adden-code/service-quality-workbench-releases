// Local synthetic HTML only: no model, customer data, API or external request.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {buildSceneReportHtml} from '../public/scene-delivery.mjs';
import {sceneReportFixture} from './scene-report-fixtures.mjs';
import {REPORT_CLUSTER_POLICY,buildReportIssueClusters} from '../public/report-issue-clusters.mjs';
const output=path.resolve(process.argv[2]||'../outputs/service01120-20261123/cluster-verification');await fs.mkdir(output,{recursive:true});
const fixture=sceneReportFixture('ecommerce',18);fixture.snapshot.reportClusterPolicy=REPORT_CLUSTER_POLICY;
const failed=fixture.snapshot.records.filter(record=>record.final.some(result=>result.verdict==='不符合'));
fixture.enrichment.issueClusters=failed.map((record,index)=>{const ruleId=record.final.find(result=>result.verdict==='不符合').id;return{ruleId,label:ruleId==='EC-TIME'?(index?'回复不及时':'回复超时'):ruleId==='EC-TEXT'?'拼写错误':`合成具体原因 ${ruleId}`,memberIds:[record.id],summary:'仅用于展示核验的合成原因，未代表业务事实。',action:'按冻结规则复核本条合成原文。'};});
fixture.enrichment={...fixture.enrichment,...buildReportIssueClusters(fixture.snapshot,fixture.enrichment.issueClusters)};
const file=path.join(output,'synthetic-cluster-preview.html');await fs.writeFile(file,buildSceneReportHtml(fixture.snapshot,fixture.enrichment));
const browser=await chromium.launch({headless:true,channel:'msedge'}),results=[];
try{
 const page=await browser.newPage({viewport:{width:1366,height:900}}),external=[],errors=[];page.on('request',request=>{if(/^https?:/i.test(request.url()))external.push(request.url());});page.on('pageerror',error=>errors.push(error.message));await page.goto(pathToFileURL(file).href);
 for(const [name,width,height] of [['desktop',1366,900],['mobile',390,844]]){
  await page.setViewportSize({width,height});await page.locator('.issue-hierarchy').scrollIntoViewIfNeeded();
  const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,primary:document.querySelectorAll('[data-cluster-primary]').length,secondary:document.querySelectorAll('[data-cluster-secondary]').length,recordText:[...document.querySelectorAll('.issue-hierarchy .cluster-source-rows')].map(element=>element.textContent)}));
  assert.equal(state.overflow,false);assert.equal(state.primary,5);assert.equal(state.secondary,5);assert.equal(state.recordText.reduce((n,text)=>n+text.split('：')[1].split('、').length,0),6);
  const audit=page.locator('.issue-hierarchy details').first();await audit.locator('summary').click();assert.equal(await audit.getAttribute('open'),'');await audit.locator('summary').click();await page.locator('.issue-hierarchy').screenshot({path:path.join(output,`clusters-${name}.png`)});results.push({name,...state});
 }
 await page.emulateMedia({media:'print'});await page.pdf({path:path.join(output,'synthetic-cluster-preview.pdf'),format:'A4',printBackground:true});assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(output,'cluster-browser-verification.json'),JSON.stringify({syntheticOnly:true,modelCalls:0,externalRequests:0,pageErrors:errors,results},null,2));console.log(JSON.stringify({output,results},null,2));
}finally{await browser.close();}
