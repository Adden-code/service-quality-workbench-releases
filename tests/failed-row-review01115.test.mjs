import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createBusinessCatalog} from '../public/catalog.mjs';
import {ensureEcommerceCatalog} from '../public/ecommerce-catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {EC_HEADERS,EC_RULE_IDS} from '../public/ecommerce-schema.mjs';
import {workbook} from '../public/io.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';
import {inlineDrafts,saveInlineEcommerce,inlineEcommerceView} from '../public/ecommerce-inline-review.mjs';
async function fixture(){const raw=Array(22).fill('');raw[10]='1';raw[8]='Synthetic issue';raw[9]='Synthetic response';raw[12]='2026-11-15 09:00:00';raw[13]='2026-11-15 10:00:00';raw[14]='差评';const bytes=await workbook([{name:'Sheet4',headers:[...EC_HEADERS],rows:[Array(22).fill(''),raw]}]);const parsed=await parseEcommerceFile({name:'synthetic.xlsx',size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true);const catalog=ensureEcommerceCatalog(createBusinessCatalog());return createImportedTask(createBusinessState(),{name:'Synthetic inline review',sessions:parsed.sessions,reviewer:'Synthetic reviewer',source:{name:'synthetic.xlsx',size:bytes.length,sha256:parsed.sessions[0].ecommerce.fileSha256},basisSnapshot:createBasisSnapshot(catalog,{ruleIds:EC_RULE_IDS,effectiveDate:'2026-11-17'}),reviewPolicy:{enabled:false}});}

import {saveClassificationReview,classificationReviewForm} from '../public/ecommerce-classification-review.mjs';
import {sceneReviewEvidence} from '../public/scene-review-view.mjs';
import {validateWorkspace} from '../server/workspace-validation.mjs';
async function failed(withOutput){const state=await fixture(),s=state.sessions[0],t=state.tasks[0];t.aiStatus='failed';const at=new Date().toISOString();t.aiRun={id:'synthetic-run',modelId:'synthetic',status:'failed',total:1,done:0,failed:1,startedAt:at,completedAt:at};s.aiExecution={status:'failed',runId:'synthetic-run',modelId:'synthetic',startedAt:at,completedAt:at,errorCode:'invalid_output'};if(withOutput)s.sceneCapabilities={outputs:{ecommerceClassification:{status:'completed',value:{evaluationType:'差评',vocKind:'substantive'},reason:'Synthetic negative',confidence:.95}}};return state;}
for(const withOutput of [true,false])test('failed row completes human classification and five independent checks, output='+withOutput,async()=>{
 const state=await failed(withOutput),s=state.sessions[0],before=structuredClone(state),at=new Date().toISOString();
 const form=sceneReviewEvidence(s,'EC-TIME');assert.match(form,/人工（行失败）/);assert.doesNotMatch(form,/<select[^>]+disabled/);
 const packet={evaluationType:'差评',vocKind:'substantive',reason:'Synthetic manual assessment'};
 const next=saveInlineEcommerce(state,s.id,{},at,{confirm:true,classification:packet}),saved=next.sessions[0];
 assert.equal(saved.review.status,'已确认');assert.equal(saved.review.classification.origin,'manual-row-failed');assert.equal(saved.review.classificationHistory.length,1);assert.equal(saved.aiExecution.status,'failed');assert.deepEqual(saved.aiResults,[]);assert.ok(Object.values(saved.review.drafts).every(d=>d.source==='人工独立审核'));assert.deepEqual(state,before);
 const catalog=ensureEcommerceCatalog(createBusinessCatalog());assert.doesNotThrow(()=>validateWorkspace(next,catalog,state));
});
test('running row stays locked; classification must remain within original rating band',async()=>{const state=await failed(true),s=state.sessions[0],packet={evaluationType:'好评正向',vocKind:'none',reason:'Synthetic'};assert.throws(()=>saveClassificationReview(state,s.id,packet,new Date().toISOString()),/评分档位/);s.aiExecution.status='running';assert.throws(()=>saveClassificationReview(state,s.id,packet,new Date().toISOString()),/AI尚未完成/);assert.match(classificationReviewForm(s),/<select[^>]+disabled/);});
