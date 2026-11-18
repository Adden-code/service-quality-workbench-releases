import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {createWorkbenchServer} from '../server.mjs';
import {createBusinessState} from '../public/domain.mjs';
import {createBusinessCatalog} from '../public/catalog.mjs';

test('calibration HTTP validation tells operators how to recover and never changes workspace on rejection',async t=>{
 const scratch=path.resolve('tests/artifacts/calibration-input-api');await fs.mkdir(scratch,{recursive:true});
 const dataDir=await fs.mkdtemp(path.join(scratch,'case-')),server=await createWorkbenchServer({dataDir,catalogSeed:null});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.ok(dataDir.startsWith(scratch+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const initial=await(await fetch(origin+'/api/workspace')).json();
 const headers={Origin:origin,'Content-Type':'application/json','X-Workspace-Token':initial.token};
 const initialized=await fetch(origin+'/api/workspace',{method:'PUT',headers,body:JSON.stringify({baseRevision:0,mutationId:'synthetic-init',state:createBusinessState(),catalog:createBusinessCatalog()})});
 assert.equal(initialized.status,200);const before=await initialized.json();
 for(const [input,message] of [
  [{action:'preview',trainingTaskIds:[],validationTaskIds:[]},'请选择不重复的参考批次和独立验证批次。'],
  [{action:'preview',trainingTaskIds:['missing'],validationTaskIds:['independent']},'标定批次不存在或已作废。'],
  [{action:'calibrate',actor:''},'请填写操作人标签。'],
  [{action:'enable',id:'missing',actor:'合成管理员',reason:'合成验证'},'标定记录不存在。'],
 ]){
  const response=await fetch(origin+'/api/rule-calibration',{method:'POST',headers,body:JSON.stringify(input)});
  const preview=input.action==='preview';
  assert.equal(response.status,preview?400:409);assert.deepEqual(await response.json(),{error:message,...(preview?{code:'CALIBRATION_INVALID'}:{})});
 }
 const after=await(await fetch(origin+'/api/workspace')).json();assert.equal(after.revision,before.revision);assert.deepEqual(after.state,before.state);
});
