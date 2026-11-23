import test from 'node:test';
import assert from 'node:assert/strict';
import {frozenLanguageHint,reportLanguageControl} from '../public/report-export-view.mjs';
test('frozen language restriction explains the disabled English option; legacy/all-language tasks remain unchanged',()=>{
 const view=reportLanguageControl('zh',false,['zh']);assert.match(view,/title="本任务冻结的输出语种不含英文/);assert.match(view,/<option value="en" disabled>/);
 assert.match(reportLanguageControl('zh',true,['zh']),/Select English when creating a new batch/);assert.equal(frozenLanguageHint(['zh','en']),'');assert.equal(frozenLanguageHint(undefined),'');
});
