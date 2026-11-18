import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createAiService} from '../server/ai-service.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {ensureEcommerceCatalog} from '../public/ecommerce-catalog.mjs';
import {createEcommerceSample} from '../public/ecommerce-sample.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';
import {EC_RULE_IDS,ecommerceSourceProjection} from '../public/ecommerce-schema.mjs';
import {createBasisSnapshot,referenceKey} from '../public/task-basis.mjs';
import {DEFAULT_REVIEW_POLICY} from '../public/ai-triage.mjs';

for(const action of ['resume','new-start'])test(`cached ecommerce semantic results recover after comparison failure with triage audit (${action})`,async t=>{
 const parent=path.resolve('tests/.onboarding-scratch');await fs.mkdir(parent,{recursive:true});const dataDir=await fs.mkdtemp(path.join(parent,'triage-ec-')),store=await createWorkspaceStore({dataDir});
 const bytes=await createEcommerceSample(),parsed=await parseEcommerceFile({name:'synthetic.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}),sessions=parsed.sessions.slice(0,3);
 for(const s of sessions){s.ecommerce.raw[11]='Synthetic same agent';s.ecommerce.raw[9]+=' Synthetic record '+s.ecommerce.row;Object.assign(s,ecommerceSourceProjection(s.ecommerce));}
 const source=await store.putSource(bytes,'synthetic.xlsx'),catalog=ensureEcommerceCatalog(createCatalog()),basis=createBasisSnapshot(catalog,{effectiveDate:'2026-10-30',ruleIds:EC_RULE_IDS});
 const state=createImportedTask(createBusinessState(),{name:'Synthetic cached comparison retry',reviewer:'Reviewer',sessions,source,basisSnapshot:basis,reviewPolicy:DEFAULT_REVIEW_POLICY});await store.save({state,catalog,baseRevision:0,mutationId:'initial'});
 let failComparison=true,rowCalls=0;const errors=[];
 const client={inspectEcommerceRow:async({session,basis})=>{rowCalls++;const turn=session.turns.find(t=>t.role==='客服');return {results:basis.rules.map(r=>({ruleId:r.id,verdict:'符合',reason:'Synthetic source checks.',evidence:[turn.id],evidenceQuotes:[{turnId:turn.id,quote:turn.text,role:turn.role}],confidence:0.95,conflictsWith:[],referenceIds:r.policyIds.map(id=>{const p=basis.policies.find(p=>p.id===id);return referenceKey(p,p.sections[0]);})})),modelId:'synthetic'};},compareEcommerceReplies:async({block})=>{if(failComparison)throw Object.assign(new Error('Synthetic timeout'),{code:'TIMEOUT'});return {similarPairs:[],checkedIds:block.representativeIds};}};
 const ai=await createAiService({store,modelConfig:{getPrivate:()=>({connectionTested:true,apiKey:null,model:'synthetic',authMode:'none',baseUrl:'http://synthetic.invalid/v1',configured:true})},client,maxAttempts:1,comparisonMaxAttempts:1,retryDelayMs:1,onError:e=>errors.push(e.message)});
 t.after(async()=>{await ai.close();await store.close();assert.ok(dataDir.startsWith(parent+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 const id=state.tasks[0].id;await ai.start(id,'FIRST',{batchSize:1});await ai.waitForIdle();let doc=await store.read();assert.ok(doc.state.sessions.every(s=>s.aiDecision.status==='UNCERTAIN'));
 const old=doc.state.sessions.map(s=>structuredClone(s.aiDecision));failComparison=false;if(action==='resume')await ai.resume(id);else await ai.start(id,'RETRY');await ai.waitForIdle();doc=await store.read();
 assert.deepEqual(errors,[]);assert.equal(rowCalls,3,'cached semantic results must not be charged again');assert.equal(doc.state.tasks[0].aiStatus,'completed');assert.equal(ai.runtime().error,'');assert.deepEqual(errors,[]);
 doc.state.sessions.forEach((s,i)=>{assert.equal(s.aiExecution.status,'completed');assert.deepEqual(s.aiDecisionHistory,[old[i]]);assert.ok(s.aiResults.length===5);assert.ok(s.aiResults.find(r=>r.ruleId==='EC-TIME').referenceIds.length>0);assert.ok(!s.aiDecision.reasonCodes.includes('missing_reference'));});
});
