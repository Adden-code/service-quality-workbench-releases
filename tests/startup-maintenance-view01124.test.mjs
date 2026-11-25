import test from 'node:test';
import assert from 'node:assert/strict';
import {setLocale} from '../public/i18n.mjs';
import {startupMaintenanceNotice} from '../public/startup-maintenance-view.mjs';

test('startup recovery remains visible without a policy revision and paths are escaped',()=>{
 setLocale('en');
 const html=startupMaintenanceNotice({status:'current',recovery:{status:'recovered',cleaned:['content-translations/.creating-UI-REASON-123'],auditPath:'D:/workspace.startup-maintenance.jsonl'}});
 assert.match(html,/Interrupted temporary writes were recovered/);
 assert.match(html,/data-startup-maintenance/);
 assert.match(html,/Temporary items recovered/);
 assert.doesNotMatch(html,/\p{Script=Han}/u);
 const unsafe=startupMaintenanceNotice({status:'current',recovery:{refused:[{path:'temporary/<script>alert(1)</script>'}]}});
 assert.match(unsafe,/Paths requiring maintainer attention/);
 assert.ok(!unsafe.includes('<script>'));
 assert.match(unsafe,/&lt;script&gt;/);
});

test('failed upgrade has an actionable path, maintenance history and English labels',()=>{
 setLocale('en');
 const html=startupMaintenanceNotice({status:'failed',message:'原始中文错误应留在诊断中',recovery:{refused:[{path:'report-jobs/.creating-invalid'}]},maintenanceEvents:[{at:'2026-11-25T08:00:00Z',action:'upgrade-failed',path:'report-jobs/.creating-invalid'}],retention:{retained:['backup1.sqwb','backup2.sqwb'],pruned:['backup0.sqwb']}});
 assert.match(html,/Scenario management/);
 assert.match(html,/Automatic upgrade did not complete/);
 assert.match(html,/report-jobs\/\.creating-invalid/);
 assert.match(html,/Retained upgrade snapshots/);
 assert.doesNotMatch(html,/\p{Script=Han}/u);
});

test('ordinary current startup is quiet; switching locale updates maintenance labels',()=>{
 assert.equal(startupMaintenanceNotice({status:'current'}),'');
 const value={status:'upgraded',recovery:{cleaned:['.creating-fixture']}};
 setLocale('zh');assert.match(startupMaintenanceNotice(value),/已清理临时项/);
 setLocale('en');assert.match(startupMaintenanceNotice(value),/Temporary items recovered/);
 setLocale('zh');
});
