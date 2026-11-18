import test from 'node:test';
import assert from 'node:assert/strict';
import {WORKSPACE_BACKUP_MAX_BYTES,workspaceBackupGuard,validateWorkspaceBackupFile,workspaceBackupDialog,createWorkspaceBackupManager} from '../public/workspace-backup-ui.mjs';
import {workspaceUsageDialog} from '../public/workspace-usage-ui.mjs';
import {setLocale} from '../public/i18n.mjs';

const instant=Date.parse('2026-11-16T01:00:00Z');
const counts={taskCount:2,sessionCount:8,ruleCount:3};
const file=()=>Object.assign(new Blob(['synthetic backup bytes']),{name:'synthetic.sqwb'});
const preview=()=>({previewId:'synthetic-preview',expiresAt:new Date(instant+60000).toISOString(),baseRevision:7,backup:{createdAt:'2026-11-15T05:00:00Z',appVersion:'0.10.6',fileCount:12,totalBytes:1500,...counts},current:{taskCount:1,sessionCount:4,ruleCount:2},warnings:[]});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function harness({fetchImpl=async()=>json(preview()),status={revision:7},now=()=>instant,onReloadRequired}={}){
  let dialog=null,renders=0,reloads=0;const requests=[],downloads=[],reloadSignals=[];
  const ctx={getDialog:()=>dialog,openDialog:value=>dialog=value,renderDialog:()=>renders++,getToken:()=> 'synthetic-workspace-token',getStatus:()=>status,now,fetchImpl:async(url,options)=>{requests.push({url,options});return fetchImpl(url,options);},download:async(...values)=>downloads.push(values),reload:()=>reloads++,onReloadRequired:value=>{reloadSignals.push(value);onReloadRequired?.(value);}};
  const manager=createWorkspaceBackupManager(ctx);
  return{manager,ctx,status,requests,downloads,reloadSignals,get dialog(){return dialog;},get renders(){return renders;},get reloads(){return reloads;}};
}
async function ready(h){await h.manager.action('workspace-backup-tab-restore');h.manager.change({target:{id:'workspace-backup-file',files:[file()]}});await h.manager.action('workspace-backup-preview');h.manager.change({target:{id:'workspace-backup-confirm',checked:true}});}

test('backup guards preserve editing, suspended imports, unresolved saves and conflicts before opening or sending requests',async()=>{
  for(const key of ['saving','hasPending','conflicted','readOnly','editing','suspendedDraft','composing','timerPending']){
    const h=harness({status:{[key]:true}});assert.ok(workspaceBackupGuard(h.status,'zh'));assert.ok(workspaceBackupGuard(h.status,'en'));
    await assert.rejects(h.manager.action('workspace-backup-open'));assert.equal(h.dialog,null);assert.equal(h.requests.length,0);
  }
});

test('restore accepts only nonempty sqwb files up to 512 MiB and retains no stale preview on file changes',async()=>{
  assert.equal(validateWorkspaceBackupFile({name:'LOCAL.SQWB',size:WORKSPACE_BACKUP_MAX_BYTES},'en'),'');
  assert.match(validateWorkspaceBackupFile({name:'workspace.json',size:10},'en'),/cannot be restored directly/);
  assert.match(validateWorkspaceBackupFile({name:'test.sqwb',size:0},'en'),/empty/);assert.match(validateWorkspaceBackupFile({name:'test.sqwb',size:WORKSPACE_BACKUP_MAX_BYTES+1},'en'),/512 MiB/);
  const h=harness();await ready(h);assert.equal(h.dialog.confirmed,true);h.manager.change({target:{id:'workspace-backup-file',files:[{name:'wrong.zip',size:100}]}});
  assert.equal(h.dialog.preview,null);assert.equal(h.dialog.confirmed,false);assert.equal(h.dialog.file,null);assert.match(h.dialog.error,/专用备份/);
});

test('preview uploads the original File as binary with token and does not restore before explicit confirmation',async()=>{
  const h=harness();await h.manager.action('workspace-backup-tab-restore');const selected=file();h.manager.change({target:{id:'workspace-backup-file',files:[selected]}});
  await h.manager.action('workspace-backup-preview');assert.equal(h.requests[0].url,'/api/workspace-backup/preview');assert.equal(h.requests[0].options.body,selected);assert.equal(h.requests[0].options.headers['Content-Type'],'application/octet-stream');assert.equal(h.requests[0].options.headers['X-Workspace-Token'],'synthetic-workspace-token');assert.equal(h.requests[0].options.credentials,'same-origin');
  assert.equal(h.dialog.preview.previewId,'synthetic-preview');assert.equal(h.dialog.confirmed,false);await h.manager.action('workspace-backup-restore');assert.equal(h.requests.length,1);assert.match(h.dialog.error,/勾选替换确认/);
});

test('preview must contain trustworthy counts and identifiers; malformed and failed responses never become success',async()=>{
  for(const response of [()=>json({...preview(),baseRevision:-1}),()=>json({...preview(),backup:{...preview().backup,taskCount:'2'}}),()=>new Response('<html>Error</html>',{status:200}),()=>json({error:'synthetic busy',code:'BUSY'},409)]){
    const h=harness({fetchImpl:async()=>response()});await h.manager.action('workspace-backup-tab-restore');h.manager.change({target:{id:'workspace-backup-file',files:[file()]}});await h.manager.action('workspace-backup-preview');
    assert.equal(h.dialog.preview,null);assert.ok(h.dialog.error);assert.equal(h.manager.requiresReload,false);assert.equal(h.downloads.length,0);
  }
});

test('expired or changed previews cannot restore; counts must be re-previewed and confirmation reset',async()=>{
  let clock=instant;const h=harness({now:()=>clock});await ready(h);clock+=120000;await h.manager.action('workspace-backup-restore');assert.equal(h.requests.length,1);assert.equal(h.dialog.preview,null);assert.equal(h.dialog.confirmed,false);assert.match(h.dialog.error,/过期/);
  const other=harness();await ready(other);other.status.revision=8;await other.manager.action('workspace-backup-restore');assert.equal(other.requests.length,1);assert.equal(other.dialog.preview,null);assert.match(other.dialog.error,/已变化/);
});

test('restore sends only preview binding, preserves retained archive path and locks old page until explicit reload',async()=>{
  const h=harness({fetchImpl:async url=>url.endsWith('/preview')?json(preview()):json({restored:true,retainedPath:'D:\\retained\\before-restore.sqwb',summary:counts})});await ready(h);await h.manager.action('workspace-backup-restore');
  assert.deepEqual(JSON.parse(h.requests[1].options.body),{previewId:'synthetic-preview',baseRevision:7});assert.equal(h.manager.requiresReload,true);assert.equal(h.manager.blocksNavigation,true);assert.equal(h.manager.blocksWorkspaceWrites,true);assert.equal(h.dialog.result.restored,true);assert.equal(h.reloadSignals[0].confirmed,true);
  const view=h.manager.dialog(h.dialog);assert.match(view,/工作区已恢复/);assert.match(view,/id="workspace-backup-retained" readonly/);assert.match(view,/before-restore\.sqwb/);assert.match(view,/重新加载已恢复/);
  await h.manager.action('workspace-backup-restore');assert.equal(h.requests.length,2);await h.manager.action('workspace-backup-reload');assert.equal(h.reloads,1);
});

test('lost restore response, invalid success payload and restore failure require reload without claiming success or retrying',async()=>{
  for(const reply of [async()=>{throw new TypeError('Synthetic disconnected');},async()=>json({restored:true,summary:counts}),async()=>json({error:'Synthetic rollback retained; token rotated',code:'RESTORE_FAILED'},500),async()=>json({error:'Synthetic maintenance',code:'WORKSPACE_MAINTENANCE'},503)]){
    const h=harness({fetchImpl:async url=>url.endsWith('/preview')?json(preview()):reply()});await ready(h);await h.manager.action('workspace-backup-restore');
    assert.equal(h.dialog.result,null);assert.equal(h.manager.requiresReload,true);assert.equal(h.reloadSignals[0].confirmed,false);assert.match(h.manager.dialog(h.dialog),/恢复结果尚未确认/);assert.doesNotMatch(h.manager.dialog(h.dialog),/工作区已恢复/);await h.manager.action('workspace-backup-restore');assert.equal(h.requests.length,2);
  }
});

test('known stale preview refusal clears confirmation and allows a fresh preview, never repeats restore automatically',async()=>{
  const h=harness({fetchImpl:async url=>url.endsWith('/preview')?json(preview()):json({error:'Synthetic newer revision',code:'REVISION_CONFLICT'},409)});await ready(h);await h.manager.action('workspace-backup-restore');
  assert.equal(h.manager.requiresReload,false);assert.equal(h.dialog.preview,null);assert.equal(h.dialog.confirmed,false);assert.match(h.dialog.error,/重新预览/);assert.equal(h.requests.length,2);await h.manager.action('workspace-backup-preview');assert.equal(h.requests.length,3);assert.equal(h.dialog.confirmed,false);
});

test('export downloads complete binary with server filename and only reports browser handoff after download callback succeeds',async()=>{
  const bytes='SYNTHETIC-ARCHIVE',h=harness({fetchImpl:async()=>new Response(bytes,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(bytes.length),'Content-Disposition':'attachment; filename="workspace-20261116-010000.sqwb"'}})});
  await h.manager.action('workspace-backup-open');await h.manager.action('workspace-backup-export');assert.equal(h.requests[0].options.body,'{}');assert.equal(h.requests[0].options.headers['Content-Type'],'application/json');assert.equal(h.downloads.length,1);assert.equal(h.downloads[0][1],'workspace-20261116-010000.sqwb');assert.equal(await h.downloads[0][0].text(),bytes);assert.match(h.manager.dialog(h.dialog),/交给浏览器下载/);assert.equal(h.manager.requiresReload,false);
});

test('failed, nonbinary, empty or truncated export never announces a download',async()=>{
  for(const response of [()=>json({error:'Synthetic busy',code:'BUSY'},409),()=>json({ok:true}),()=>new Response('',{headers:{'Content-Type':'application/octet-stream'}}),()=>new Response('short',{headers:{'Content-Type':'application/octet-stream','Content-Length':'100'}})]){
    const h=harness({fetchImpl:async()=>response()});await h.manager.action('workspace-backup-open');await h.manager.action('workspace-backup-export');assert.equal(h.downloads.length,0);assert.equal(h.dialog.downloaded,null);assert.ok(h.dialog.error);assert.doesNotMatch(h.manager.dialog(h.dialog),/交给浏览器下载/);
  }
  const h=harness({fetchImpl:async()=>new Response('bytes',{headers:{'Content-Type':'application/octet-stream'}})});h.ctx.download=async()=>{throw new Error('Synthetic download failure');};await h.manager.action('workspace-backup-open');await h.manager.action('workspace-backup-export');assert.equal(h.dialog.downloaded,null);assert.ok(h.dialog.error);
});

test('one operation owns its dialog and blocks repeated clicks and changing the file while a request is in flight',async()=>{
  let finish;const h=harness({fetchImpl:()=>new Promise(resolve=>finish=resolve)});await h.manager.action('workspace-backup-tab-restore');const selected=file();h.manager.change({target:{id:'workspace-backup-file',files:[selected]}});const pending=h.manager.action('workspace-backup-preview');assert.equal(h.manager.isBusy,true);assert.equal(h.manager.blocksNavigation,true);assert.equal(h.manager.blocksWorkspaceWrites,true);
  await h.manager.action('workspace-backup-preview');h.manager.change({target:{id:'workspace-backup-file',files:[{name:'other.sqwb',size:20}]}});assert.equal(h.dialog.file,selected);assert.equal(h.requests.length,1);assert.match(h.manager.dialog(h.dialog),/尚未替换工作区/);assert.doesNotMatch(h.manager.dialog(h.dialog),/\d+%/);
  finish(json(preview()));await pending;assert.equal(h.manager.isBusy,false);assert.equal(h.manager.blocksNavigation,false);
});

test('bilingual views use explicit labels, escape service/source strings and expose backup actions in storage dialog',()=>{
  const d={type:'workspace-backup',tab:'restore',file:{name:'<script>synthetic</script>.sqwb',size:10},preview:{...preview(),warnings:['<script>warning</script>']},confirmed:false};
  for(const language of ['zh','en']){
    const html=workspaceBackupDialog(d,{language,now:instant});assert.match(html,/for="workspace-backup-file"/);assert.match(html,/for="workspace-backup-confirm"/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,language==='en'?/does not merge/:/不会合并/);
  }
  setLocale('en');const usage=workspaceUsageDialog({type:'workspace-usage'});assert.match(usage,/data-act="workspace-backup-open">Full backup/);assert.match(usage,/data-act="workspace-backup-tab-restore">Restore backup/);setLocale('zh');
});

test('preview times use Beijing time and both tabs explain archive limits and user-facing exclusions',()=>{
  const d={type:'workspace-backup',tab:'restore',preview:{...preview(),backup:{...preview().backup,createdAt:'2026-11-15T23:30:00Z'}}};
  for(const language of ['zh','en']){
    setLocale(language);const restore=workspaceBackupDialog(d,{language,now:instant}),backup=workspaceBackupDialog({type:'workspace-backup',tab:'export'},{language,now:instant});
    assert.match(restore,/07:30/);assert.match(restore,/09:01/);assert.equal((restore.match(/UTC\+08:00/g)||[]).length,2);assert.doesNotMatch(restore,/2026-11-15T23:30:00Z/);
    for(const view of [restore,backup]){assert.match(view,/512 MiB/);assert.match(view,/64 MiB/);assert.match(view,/20,?000/);}
    assert.doesNotMatch(backup,/\.secrets/);assert.match(backup,language==='en'?/launcher control information and startup logs/:/启动器控制信息及启动日志/);
  }
  setLocale('zh');
});
