import test from 'node:test';
import assert from 'node:assert/strict';
import {businessExportView} from '../public/business-export-view.mjs';
import {businessUI,managerState,summaryFixture,reportFixture} from './business-report-fixtures.mjs';

test('a report paused by storage failure explains the cause and preserves the resume action',()=>{
 const {snapshot,enrichment}=reportFixture(),job=summaryFixture({status:'paused',stopReason:'storage_error'});
 const html=businessExportView(managerState(),businessUI(),{job,result:{snapshot,enrichment,job}});
 assert.ok(html.includes('运行记录保存失败'),'Storage interruption must not look like a user-requested pause.');
 assert.ok(html.includes('已保存内容保留'));assert.ok(html.includes('data-act="business-resume"'));
});
