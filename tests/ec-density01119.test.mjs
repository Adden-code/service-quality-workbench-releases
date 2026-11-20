import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createBusinessCatalog} from '../public/catalog.mjs';
import {ensureEcommerceCatalog} from '../public/ecommerce-catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {EC_HEADERS,EC_RULE_IDS} from '../public/ecommerce-schema.mjs';
import {workbook} from '../public/io.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';
import {reviewView,reviewHeader} from '../public/review-view.mjs';
import {inlineEcommerceFooter} from '../public/ecommerce-inline-review.mjs';
import {readingLayout,saveReadingLayout} from '../public/raw-review-layout.mjs';
async function fixture(){const raw=Array(22).fill('');raw[10]='1';raw[8]='Synthetic issue';raw[9]='Synthetic response';raw[12]='2026-11-15 09:00:00';raw[13]='2026-11-15 10:00:00';raw[14]='差评';const bytes=await workbook([{name:'Sheet4',headers:[...EC_HEADERS],rows:[Array(22).fill(''),raw]}]);const parsed=await parseEcommerceFile({name:'synthetic.xlsx',size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true);const catalog=ensureEcommerceCatalog(createBusinessCatalog());return createImportedTask(createBusinessState(),{name:'Synthetic inline review',sessions:parsed.sessions,reviewer:'Synthetic reviewer',source:{name:'synthetic.xlsx',size:bytes.length,sha256:parsed.sessions[0].ecommerce.fileSha256},basisSnapshot:createBasisSnapshot(catalog,{ruleIds:EC_RULE_IDS,effectiveDate:'2026-11-17'}),reviewPolicy:{enabled:false}});}

const reviewUI=s=>({reviewTaskId:s.taskId,selectedId:s.id,reviewStatus:'全部',reviewQuery:'',openRules:[],highlightedTurns:[],resultFilter:'全部',showReviewRecords:true});
test('completed ecommerce review keeps all five checks while deduplicating status and folding provenance',async()=>{
 const state=await fixture(),s=state.sessions[0],ui=reviewUI(s);s.aiExecution={status:'completed',modelId:'synthetic-only',promptVersion:'synthetic-v1',runId:'synthetic-run'};
 s.aiResults=EC_RULE_IDS.map(ruleId=>({ruleId,verdict:ruleId==='EC-TEXT'?'不符合':'符合',reason:'Synthetic reason',evidence:[2],referenceIds:[],confidence:.95}));
 const html=reviewView(state,ui),pane=html.slice(html.indexOf('<section class="results-pane"'));
 assert.equal((pane.match(/待人工确认 5 项/g)||[]).length,1);
 assert.equal((pane.match(/data-inline-rule=/g)||[]).length,5);
 assert.match(pane,/<details class="ec-review-context"><summary>/);assert.match(pane,/synthetic-only/);assert.match(pane,/synthetic-run/);
 assert.match(pane,/data-act="task-detail"/);assert.match(pane,/判定理由/);
 assert.doesNotMatch(inlineEcommerceFooter(s),/<p>/);assert.match(inlineEcommerceFooter(s),/title="保存草稿不会形成最终结论/);
 assert.match(reviewHeader(state,ui),/ec-compact-heading/);
 state.tasks[0].lifecycle={archivedAt:'2026-11-20T00:00:00Z'};state.tasks[0].status='已归档';
 const archived=reviewView(state,ui);assert.match(archived,/历史只读/);assert.match(archived,/人工操作历史/);assert.doesNotMatch(archived,/data-reading-divider|ec-inline-confirm|ec-review-summary/);
 assert.doesNotMatch(reviewHeader(state,ui),/ec-compact-heading/);
});
test('shared reading layout remembers each task independently and clamps only to 25–85',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 saveReadingLayout('EC-A',{ratio:85,mode:'split',font:16},storage);saveReadingLayout('NP-B',{ratio:25,mode:'source',font:20},storage);
 assert.equal(readingLayout('EC-A',storage).ratio,85);assert.deepEqual(readingLayout('NP-B',storage),{ratio:25,mode:'source',font:20});
 assert.equal(saveReadingLayout('EC-A',{ratio:99},storage).ratio,85);assert.equal(saveReadingLayout('EC-A',{ratio:1},storage).ratio,25);
 assert.equal(readingLayout('NP-B',storage).ratio,25);
});
