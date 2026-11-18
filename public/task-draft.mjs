import {normalizeExecutionSettings} from './execution-settings.mjs';

// Keep user-entered labels in the in-memory wizard as they type. Validation
// remains at the next step; going back to replace a file must not erase them.
export function updateTaskDraftInput(dialog,target){
 if(dialog?.type!=='new-task'||dialog.mode!=='manual'||!target)return false;
 const executionField = {'task-concurrency':'concurrency','task-batch-size':'batchSize'}[target.id];
 if (executionField) {
  const defaults = normalizeExecutionSettings({}, {raw:dialog.parsed?.rawDirect===true});
  dialog.executionSettings = {
   ...defaults,
   ...dialog.executionSettings,
   [executionField]:target.value === '' ? '' : Number(target.value)
  };
  return true;
 }
 const field={'new-task-name':'name','new-task-reviewer':'reviewer'}[target.id];
 if(!field)return false;
 dialog[field]=target.value;return true;
}
