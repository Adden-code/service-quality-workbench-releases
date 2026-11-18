import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewShortcutAction,createReviewShortcutHandler,firstReviewActionControl} from '../public/review-shortcuts.mjs';

const context=(extra={})=>({page:'review',queue:[{id:'visible-C'},{id:'visible-A'},{id:'visible-B'}],selectedId:'visible-A',...extra});
const key=(value,extra={})=>({key:value,preventDefault(){this.defaultPrevented=true;},...extra});

test('J/K follow only the filtered visible queue and never wrap or replace a missing selection',()=>{
  assert.deepEqual(reviewShortcutAction(key('j'),context()),{kind:'navigate',sessionId:'visible-B'});
  assert.deepEqual(reviewShortcutAction(key('k'),context()),{kind:'navigate',sessionId:'visible-C'});
  assert.equal(reviewShortcutAction(key('j'),context({selectedId:'visible-B'})),null);
  assert.equal(reviewShortcutAction(key('k'),context({selectedId:'visible-C'})),null);
  assert.equal(reviewShortcutAction(key('j'),context({selectedId:'filtered-out'})),null);
  assert.equal(reviewShortcutAction(key('j'),context({queue:[]})),null);
});

test('E delegates editing and only Ctrl+Enter delegates the existing confirmation flow',()=>{
  assert.deepEqual(reviewShortcutAction(key('e'),context()),{kind:'edit'});
  assert.deepEqual(reviewShortcutAction(key('Enter',{ctrlKey:true}),context()),{kind:'confirm'});
  for(const event of [key('Enter'),key('Enter',{metaKey:true}),key('Enter',{ctrlKey:true,shiftKey:true}),key('Enter',{ctrlKey:true,altKey:true}),key('e',{ctrlKey:true}),key('j',{shiftKey:true})])assert.equal(reviewShortcutAction(event,context()),null);
  assert.equal(reviewShortcutAction(key('e'),context({selectedId:''})),null);
  assert.equal(reviewShortcutAction(key('e'),context({queue:[]})),null);
  assert.equal(reviewShortcutAction(key('Enter',{ctrlKey:true}),context({selectedId:'filtered-out'})),null);
});

test('typing, focused form controls, editable descendants and shadow input paths stay untouched',()=>{
  const editor={closest:()=>({}),isContentEditable:true};
  for(const target of [{tagName:'INPUT'},{tagName:'TEXTAREA'},{tagName:'SELECT'},editor]){
    assert.equal(reviewShortcutAction(key('j',{target}),context()),null);
    assert.equal(reviewShortcutAction(key('Enter',{ctrlKey:true}),context({activeElement:target})),null);
  }
  assert.equal(reviewShortcutAction(key('e',{target:{},composedPath:()=>[{},editor,{}]}),context()),null);
});

test('IME, modifiers, repeat, modal, unsaved work and saves prevent shortcuts',()=>{
  for(const guard of [{page:'tasks'},{dialogOpen:true},{saving:true},{dirty:true},{composing:true}])for(const event of [key('j'),key('e'),key('Enter',{ctrlKey:true})])assert.equal(reviewShortcutAction(event,context(guard)),null);
  for(const guard of [{defaultPrevented:true},{repeat:true},{isComposing:true},{keyCode:229},{altKey:true},{metaKey:true},{shiftKey:true}])assert.equal(reviewShortcutAction(key('j',guard),context()),null);
});

test('handler calls exactly one existing action callback and only consumes handled shortcuts',()=>{
  const calls=[];
  const handler=createReviewShortcutHandler({getContext:()=>context(),onNavigate:action=>calls.push(action),onEdit:action=>calls.push(action),onConfirm:action=>calls.push(action)});
  for(const event of [key('j'),key('e'),key('Enter',{ctrlKey:true})]){assert.equal(handler(event),true);assert.equal(event.defaultPrevented,true);}
  assert.deepEqual(calls,[{kind:'navigate',sessionId:'visible-B'},{kind:'edit'},{kind:'confirm'}]);
  const enter=key('Enter');assert.equal(handler(enter),false);assert.equal(enter.defaultPrevented,undefined);
  const noControl=createReviewShortcutHandler({getContext:()=>context(),onConfirm:()=>false});
  const confirm=key('Enter',{ctrlKey:true});assert.equal(noControl(confirm),false);assert.equal(confirm.defaultPrevented,undefined);
});

function control({rule='rule-A',disabled=false,hidden=false,ariaDisabled=false,rects=1,parent=null,card=null}={}){
  return {dataset:{rule},disabled,hidden,parentElement:parent,getAttribute:name=>name==='aria-disabled'&&ariaDisabled?'true':null,getClientRects:()=>Array(rects).fill({}),closest:()=>card};
}
test('E selects first actual editable rule in rendered order, skips disabled rules, and has no guessed footer fallback',()=>{
  const first=control({disabled:true}),second=control({rule:'explicit-rule-B'}),third=control({rule:'explicit-rule-C'});
  const root={querySelectorAll:selector=>{assert.match(selector,/\.result-list/);return[first,second,third];}};
  assert.equal(firstReviewActionControl(root,'edit'),second);
  assert.equal(firstReviewActionControl({querySelectorAll:()=>[control({rule:''}),first]},'edit'),null);
});

test('collapsed visible cards remain editable, fully hidden or inert cards cannot be triggered',()=>{
  const card=control(),collapsed={hidden:true,classList:{contains:name=>name==='result-details'},parentElement:card};
  const edit=control({parent:collapsed,card,rects:0});
  assert.equal(firstReviewActionControl({querySelectorAll:()=>[edit]},'edit'),edit);
  card.hidden=true;assert.equal(firstReviewActionControl({querySelectorAll:()=>[edit]},'edit'),null);
  card.hidden=false;card.inert=true;assert.equal(firstReviewActionControl({querySelectorAll:()=>[edit]},'edit'),null);
  const invisible=control({card:control({rects:0})});assert.equal(firstReviewActionControl({querySelectorAll:()=>[invisible]},'edit'),null);
});

test('confirmation uses the enabled current footer control and never bypasses disabled validation state',()=>{
  const disabled=control({disabled:true}),blocked=control({ariaDisabled:true}),ready=control();
  const root={querySelectorAll:selector=>{assert.match(selector,/raw-confirm-next/);assert.match(selector,/confirm-unreplied/);assert.doesNotMatch(selector,/do-confirm/);return[disabled,blocked,ready];}};
  assert.equal(firstReviewActionControl(root,'confirm'),ready);
  assert.equal(firstReviewActionControl({querySelectorAll:()=>[disabled,blocked]},'confirm'),null);
});
