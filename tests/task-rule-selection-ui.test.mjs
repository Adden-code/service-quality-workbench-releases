import test from 'node:test';
import assert from 'node:assert/strict';
import {businessTaskDialog} from '../public/business-dialogs.mjs';

test('task rule picker exposes select all, clear and a stable summary region',()=>{
  const {body}=businessTaskDialog({step:3,effectiveDate:'2026-11-11',ruleIds:[]});
  assert.match(body,/data-act="select-all-task-rules"/);
  assert.match(body,/data-act="clear-task-rules"/);
  assert.match(body,/data-task-rule-list/);
  assert.match(body,/data-task-basis-summary/);
  assert.match(body,/class="btn" data-act="create-business-task"[^>]*disabled/);
  assert.match(body,/class="btn primary" data-act="create-business-task-start"[^>]*disabled/);
});

test('checkbox changes update basis controls in place and never redraw the modal',async()=>{
  const {handleTaskRuleSelectionChange}=await import('../public/task-rule-selection-ui.mjs');
  const checkbox={name:'task-rule',value:'R-2',checked:true},other={name:'task-rule',value:'R-1',checked:false};
  const summary={innerHTML:''},error={textContent:''},create={disabled:true},createStart={disabled:true},count={textContent:''};
  const date={value:'2026-11-11'};
  const root={querySelector(selector){return {'#basis-date':date,'[data-task-basis-summary]':summary,'#form-error':error,'[data-act="create-business-task"]':create,'[data-act="create-business-task-start"]':createStart,'[data-task-rule-count]':count}[selector]||null;},querySelectorAll(selector){return selector==='[name="task-rule"]'?[other,checkbox]:selector==='[data-act="create-business-task"],[data-act="create-business-task-start"]'?[create,createStart]:[];}};
  let redraws=0,refreshes=0;
  const dialog={type:'new-task',mode:'manual',step:3};
  const handled=handleTaskRuleSelectionChange({target:checkbox},{root,dialog,renderDialog(){redraws++;},refreshBasis(){refreshes++;dialog.basisSnapshot={rules:[{id:'R-2'}],policies:[]};}});
  assert.equal(handled,true);assert.equal(redraws,0);assert.equal(refreshes,1);
  assert.deepEqual(dialog.ruleIds,['R-2']);assert.equal(create.disabled,false);assert.equal(createStart.disabled,false);assert.match(summary.innerHTML,/1项规则/);assert.equal(count.textContent,'已选 1/2 项');
  assert.equal(checkbox.checked,true);assert.equal(other.checked,false);
});

test('clear and select all update only the existing checkbox nodes',async()=>{
  const {handleTaskRuleSelectionAction}=await import('../public/task-rule-selection-ui.mjs');
  const inputs=[{value:'R-1',checked:true},{value:'R-2',checked:false}];
  const create={disabled:false},createStart={disabled:false},root={querySelector(selector){return selector==='[data-act="create-business-task"]'?create:selector==='[data-act="create-business-task-start"]'?createStart:null;},querySelectorAll(selector){return selector==='[name="task-rule"]'?inputs:selector==='[data-act="create-business-task"],[data-act="create-business-task-start"]'?[create,createStart]:[];}};
  const dialog={type:'new-task',mode:'manual',step:3,ruleIds:['R-1']};
  const refreshBasis=()=>{dialog.basisSnapshot=dialog.ruleIds.length?{rules:dialog.ruleIds.map(id=>({id})),policies:[]}:null;};
  assert.equal(handleTaskRuleSelectionAction('clear-task-rules',{root,dialog,refreshBasis}),true);
  assert.deepEqual(dialog.ruleIds,[]);assert.equal(create.disabled,true);assert.equal(createStart.disabled,true);assert.ok(inputs.every(input=>!input.checked));
  assert.equal(handleTaskRuleSelectionAction('select-all-task-rules',{root,dialog,refreshBasis}),true);
  assert.deepEqual(dialog.ruleIds,['R-1','R-2']);assert.equal(create.disabled,false);assert.equal(createStart.disabled,false);assert.ok(inputs.every(input=>input.checked));
});

test('date re-evaluation preserves modal/list scroll and date focus after replacing expired rules',async()=>{
  const {handleTaskRuleSelectionChange}=await import('../public/task-rule-selection-ui.mjs');
  let date={id:'basis-date',name:'',value:'2026-11-12'},body={scrollTop:420,scrollLeft:0},list={scrollTop:185,scrollLeft:4},rules=[{name:'task-rule',value:'R-OLD',checked:true}],focused=null,redraws=0;
  const root={ownerDocument:{activeElement:date},contains:()=>true,querySelector(selector){return {'#basis-date':date,'.modal-body':body,'[data-task-rule-list]':list}[selector]||null;},querySelectorAll(selector){return selector==='[id]'?[date]:selector==='[name]'?rules:rules;}};
  const dialog={type:'new-task',mode:'manual',step:3,ruleIds:['R-OLD']};
  const handled=handleTaskRuleSelectionChange({target:date},{root,dialog,refreshBasis(){dialog.ruleIds=[];dialog.basisSnapshot=null;},renderDialog(){redraws++;date={id:'basis-date',value:dialog.effectiveDate,focus(options){focused={id:this.id,options};}};body={scrollTop:0,scrollLeft:0};list={scrollTop:0,scrollLeft:0};rules=[];}});
  assert.equal(handled,true);assert.equal(redraws,1);assert.deepEqual(dialog.ruleIds,[]);assert.equal(dialog.effectiveDate,'2026-11-12');
  assert.equal(body.scrollTop,420);assert.equal(list.scrollTop,185);assert.equal(list.scrollLeft,4);assert.deepEqual(focused,{id:'basis-date',options:{preventScroll:true}});
});
