import test from 'node:test';
import assert from 'node:assert/strict';
import {setLocale} from '../public/i18n.mjs';
import {createHash} from 'node:crypto';
import {matchRawQuote} from '../public/raw-evidence.mjs';
const api=await import('../public/raw-review-view.mjs').catch(()=>({}));
function fixture(){
 const text='Customer: هل يمكنني الاسترجاع؟\nAgent: Guaranteed. Guaranteed. <script>doNotExecute()</script>';
 const rules=[{id:'SYN1',name:'Synthetic compliance',title:'Synthetic compliance',version:'V1',policyIds:[]},{id:'SYN2',name:'Synthetic completeness',title:'Synthetic completeness',version:'V1',policyIds:[]}];
 const task={id:'TASK-SYN',mode:'manual',inputMode:'raw-transcript-v1',name:'Synthetic',source:{name:'source.xlsx'},basisSnapshot:{rules,policies:[]}};
 const session={id:'S1',externalId:'RAW-1',taskId:task.id,expectedRuleIds:rules.map(r=>r.id),turns:[],agent:'Agent B',product:'',rawTranscript:{schemaVersion:1,text,row:2,timePolicy:{mode:'unavailable',timezone:'+08:00'}},aiExecution:{status:'completed',runId:'R1'},aiDecision:{status:'UNCERTAIN',runId:'R1',reasonCodes:[]},reviewPolicy:{enabled:true,confidenceThreshold:0.9},review:{status:'待审核',reviewer:'Local operator',notes:'',history:[],drafts:{}},aiResults:[{ruleId:'SYN1',verdict:'不符合',reason:'Synthetic source quote',evidence:[],evidenceQuotes:[{quote:'Guaranteed.',matches:[{start:999,end:1000}]}],referenceIds:[],confidence:0.99,conflictsWith:[],rawValidation:{status:'verified',reasonCodes:[]}},{ruleId:'SYN2',verdict:'无法判定',reason:'No reliable source time.',evidence:[],evidenceQuotes:[],referenceIds:[],confidence:0,conflictsWith:[],rawValidation:{status:'verified',reasonCodes:['source_time_unavailable']}}]};
 session.rawTranscript.textSha256=createHash('sha256').update(text).digest('hex');
 for(const r of session.aiResults){r.rawValidation.schemaVersion=1;r.rawValidation.textSha256=session.rawTranscript.textSha256;for(const q of r.evidenceQuotes)q.matches=matchRawQuote(text,q.quote);}
 return {state:{tasks:[task],sessions:[session]},task,session,queue:[session],ui:{openRules:[],rawResultFilter:'问题与需核实'}};
}
test('raw review uses original text and rule panes without a permanent third queue or invented turn bubbles',()=>{
 assert.equal(typeof api.rawReviewView,'function');const f=fixture(),html=api.rawReviewView(f.state,f.ui,{session:f.session,queue:f.queue});assert.match(html,/raw-original/);assert.match(html,/raw-rule-pane/);assert.doesNotMatch(html,/class="review-queue"|message-avatar|第1轮/);assert.match(html,/无可靠时间戳/);
});
test('quote highlighting recomputes literal locations and escapes source markup, ignoring supplied offsets',()=>{
 const f=fixture(),html=api.highlightRawText(f.session.rawTranscript.text,[{quote:'Guaranteed.',matches:[{start:999,end:1000}]}]);assert.equal((html.match(/<mark\b/g)||[]).length,2);assert.doesNotMatch(html,/<script>doNotExecute/);assert.match(html,/&lt;script&gt;/);
});
test('a quote absent from the raw row cannot create a fake highlight',()=>{
 const f=fixture(),html=api.highlightRawText(f.session.rawTranscript.text,[{quote:'not present'}]);assert.doesNotMatch(html,/<mark\b/);
});
test('attention rules show compact inline controls before optional evidence details',()=>{
 const f=fixture();api.rawReviewView(f.state,f.ui,{session:f.session,queue:f.queue});assert.deepEqual(f.ui.openRules,[]);f.session.aiResults[1].verdict='符合';f.session.aiResults[1].confidence=0.99;f.session.aiResults[1].evidenceQuotes=[{quote:'Guaranteed.',matches:matchRawQuote(f.session.rawTranscript.text,'Guaranteed.')}];f.session.aiResults[1].rawValidation.reasonCodes=[];f.ui.rawSelectedSession=null;f.ui.openRules=[];api.rawReviewView(f.state,f.ui,{session:f.session,queue:f.queue});assert.deepEqual(f.ui.openRules,[]);
});
test('English review labels do not translate or replace the original Arabic and literal source',t=>{
 setLocale('en',{storage:null});t.after(()=>setLocale('zh',{storage:null}));const f=fixture(),html=api.rawReviewView(f.state,f.ui,{session:f.session,queue:f.queue});assert.match(html,/Original transcript/);assert.match(html,/Rule results/);assert.match(html,/هل يمكنني الاسترجاع/);
});

test('overly short repeated quote cannot freeze the review renderer or create an unchecked highlight',()=>{const text='a'.repeat(20001);assert.doesNotThrow(()=>api.highlightRawText(text,[{quote:'a'}]));assert.doesNotMatch(api.highlightRawText(text,[{quote:'a'}]),/<mark\b/);});

test('overlapping literal occurrences stay exact and each navigation index remains reachable',()=>{assert.match(api.highlightRawText('aaaa',[{quote:'aaa'}]),/<mark[^>]*>aaa<\/mark>a/);assert.match(api.highlightRawText('aaaa',[{quote:'aaa'}],{activeIndex:1}),/a<mark id="raw-hit-1"[^>]*>aaa<\/mark>/);});

test('saved legacy review highlights keep literal coordinates while new evidence uses newline equivalence',()=>{
 const text='A\nB / A\r\nB',quotes=[{quote:'A\r\nB',matches:[{start:6,end:10}]}];
 const legacy=api.highlightRawText(text,quotes,{activeIndex:0});
 assert.equal(legacy,'A\nB / <mark id="raw-hit-0" data-raw-hit="0">A\r\nB</mark>');
 const current=api.highlightRawText(text,quotes,{activeIndex:0,validation:{evidenceMatching:'crlf-lf-v1'}});
 assert.equal(current,'<mark id="raw-hit-0" data-raw-hit="0">A\nB</mark> / A\r\nB');
 const f=fixture();f.session.rawTranscript.text=text;f.session.aiResults[0].evidenceQuotes=quotes;
 const html=api.rawReviewView(f.state,f.ui,{session:f.session,queue:f.queue});
 assert.match(html,/data-raw-match-count="1"/);
 assert.match(html,/A\nB \/ <mark[^>]*>A\r\nB<\/mark>/);
});

test('derived summary never contributes to pending badges or pending rule cards',async()=>{
 const {getReviewPresentation}=await import('../public/ai-triage.mjs'),f=fixture();f.task.executionSnapshot={configuration:{aggregateRuleId:'NP-R01',ruleBindings:['NP-R01',...f.session.expectedRuleIds].map(ruleId=>({ruleId,ruleVersion:'V1'}))}};f.session.expectedRuleIds.unshift('NP-R01');f.session.aiResults.unshift({...structuredClone(f.session.aiResults[0]),ruleId:'NP-R01'});f.session.review.drafts.SYN2={...f.session.aiResults[2],source:'人工修改'};
 const p=getReviewPresentation(f.session,f.task);assert.equal(p.pendingCount,1);const html=api.rawReviewView(f.state,f.ui,{session:f.session,queue:f.queue});assert.equal((html.match(/data-rule-card=/g)||[]).length,1);assert.doesNotMatch(html,/data-rule-card="NP-R01"/);assert.match(html,/待人工确认 1 项/);assert.match(html,/自动汇总，随16个子项更新/);assert.match(html,/问题 1.*需核实 0.*其他待确认 0/s);
});
