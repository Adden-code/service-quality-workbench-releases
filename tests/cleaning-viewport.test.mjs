import test from 'node:test';
import assert from 'node:assert/strict';
import {captureCleaningViewport,restoreCleaningViewport} from '../public/cleaning-viewport.mjs';
function view(row='2'){
 const selected={value:row},modal={scrollTop:520,scrollLeft:0},source={scrollTop:310,scrollLeft:12},edit={scrollTop:80,scrollLeft:0},detail={open:true};
 const field={id:'',dataset:{cleaningRow:row,cleaningSegment:'3',cleaningField:'text'},selectionStart:19,selectionEnd:24,focus(options){this.focused=options;},setSelectionRange(start,end){this.selection=[start,end];}};
 const mark={scrollIntoView(options){this.located=options;}},nodes={'#cleaning-selected-row':selected,'.modal-body':modal,'.cleaning-source-panel pre':source,'.cleaning-edit-panel':edit,'.cleaning-source-panel mark':mark};
 const root={ownerDocument:{activeElement:field},contains:el=>el===field,querySelector:selector=>nodes[selector]||null,querySelectorAll:selector=>selector==='input,select,textarea,button'?[field]:selector==='.cleaning-edit-panel details'?[detail]:[]};
 return{root,modal,source,edit,field,mark,detail};
}
test('cleaning redraw keeps source scroll, edit scroll, focused field and selection on the same physical row',()=>{
 const before=view(),saved=captureCleaningViewport(before.root),after=view();after.modal.scrollTop=0;after.source.scrollTop=0;after.edit.scrollTop=0;after.detail.open=false;
 restoreCleaningViewport(after.root,saved);assert.equal(after.modal.scrollTop,520);assert.equal(after.source.scrollTop,310);assert.equal(after.source.scrollLeft,12);assert.equal(after.edit.scrollTop,80);assert.deepEqual(after.field.focused,{preventScroll:true});assert.deepEqual(after.field.selection,[19,24]);assert.equal(after.detail.open,true);assert.equal(after.mark.located,undefined);
});
test('source navigation only scrolls the mark on explicit field-source selection',()=>{
 const before=view(),after=view();restoreCleaningViewport(after.root,captureCleaningViewport(before.root),{locateQuote:true});assert.deepEqual(after.mark.located,{block:'nearest',inline:'nearest',behavior:'instant'});
});
test('changing the selected physical row does not restore the previous row scroll or field focus',()=>{
 const before=view(),after=view('3');after.modal.scrollTop=0;restoreCleaningViewport(after.root,captureCleaningViewport(before.root));assert.equal(after.modal.scrollTop,0);assert.equal(after.field.focused,undefined);
});
