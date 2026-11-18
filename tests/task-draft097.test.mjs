import test from 'node:test';
import assert from 'node:assert/strict';
import {updateTaskDraftInput} from '../public/task-draft.mjs';
test('wizard labels survive a back step and replacement file without resetting or trimming partial input',()=>{
 const draft={type:'new-task',mode:'manual',step:2,name:'Default',reviewer:''};
 assert.equal(updateTaskDraftInput(draft,{id:'new-task-name',value:' My batch '}),true);
 assert.equal(updateTaskDraftInput(draft,{id:'new-task-reviewer',value:'Reviewer A'}),true);
 draft.step=1;draft.file={name:'replacement.xlsx'};draft.step=2;
 assert.equal(draft.name,' My batch ');assert.equal(draft.reviewer,'Reviewer A');
 assert.equal(updateTaskDraftInput(draft,{id:'model-api-key',value:'never store here'}),false);
 assert.deepEqual(Object.keys(draft).sort(),['file','mode','name','reviewer','step','type']);
});
test('draft updates ignore unrelated dialogs and automatic modes',()=>{
 for(const dialog of [null,{type:'model-settings'},{type:'new-task',mode:'demo'}])assert.equal(updateTaskDraftInput(dialog,{id:'new-task-name',value:'Ignored'}),false);
});
