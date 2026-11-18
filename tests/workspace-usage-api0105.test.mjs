import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {createWorkbenchServer} from '../server.mjs';
import {createBusinessState} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';

const scratch=path.resolve('..','outputs','service0105-20261115','test-usage-api');
async function fixture(t,{initialized=false}={}){
  await fs.mkdir(scratch,{recursive:true});const dataDir=await fs.mkdtemp(path.join(scratch,'case-'));
  const server=await createWorkbenchServer({dataDir,catalogSeed:null});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await server.closeWorkspace();assert.ok(path.resolve(dataDir).startsWith(scratch+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${server.address().port}`,initial=await(await fetch(origin+'/api/workspace')).json(),headers={'X-Workspace-Token':initial.token,Origin:origin};
  if(initialized){const response=await fetch(origin+'/api/workspace',{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({baseRevision:initial.revision,mutationId:'usage-api-initialize',state:createBusinessState(),catalog:createCatalog()})});assert.equal(response.status,200,await response.text());}
  return{dataDir,origin,headers};
}

test('workspace usage GET requires current token, rejects foreign origin and hostile Host',async t=>{
  const {origin,headers}=await fixture(t);
  for(const override of [{}, {'X-Workspace-Token':'bad'}, {'X-Workspace-Token':'0'.repeat(64)}, {...headers,Origin:'https://foreign.invalid'}, {...headers,Origin:'null'}, {...headers,Origin:''}]){
    const response=await fetch(origin+'/api/workspace-usage',{headers:override});assert.equal(response.status,403);assert.equal(response.headers.get('access-control-allow-origin'),null);
  }
  const hostile=await new Promise((resolve,reject)=>{const request=httpRequest(origin+'/api/workspace-usage',{headers:{...headers,Host:'foreign.invalid'}},response=>{response.resume();response.once('end',()=>resolve(response.statusCode));});request.once('error',reject);request.end();});assert.equal(hostile,403);
  for(const allowed of [headers,{'X-Workspace-Token':headers['X-Workspace-Token']}]){const response=await fetch(origin+'/api/workspace-usage',{headers:allowed});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');}
  const after=await(await fetch(origin+'/api/workspace')).json();assert.equal(after.revision,0);assert.equal(after.initialized,false);
});

test('workspace usage rejects every mutation method and preflight without writing state',async t=>{
  const {origin,headers}=await fixture(t);
  for(const method of ['HEAD','POST','PUT','PATCH','DELETE','OPTIONS']){
    const response=await fetch(origin+'/api/workspace-usage',{method,headers});assert.equal(response.status,405,method);assert.equal(response.headers.get('access-control-allow-origin'),null);
  }
  assert.equal((await(await fetch(origin+'/api/workspace')).json()).revision,0);
});

test('concurrent usage reads preserve workspace revision and file bytes while exposing only aggregate metadata',async t=>{
  const {dataDir,origin,headers}=await fixture(t,{initialized:true});
  await fs.mkdir(path.join(dataDir,'sources'),{recursive:true});await fs.writeFile(path.join(dataDir,'sources','private-source-name.txt'),'synthetic-source-marker');
  await fs.mkdir(path.join(dataDir,'.secrets'),{recursive:true});await fs.writeFile(path.join(dataDir,'.secrets','private-settings-name.txt'),'synthetic-settings-marker');
  const before=await fs.readFile(path.join(dataDir,'workspace.json')),snapshot=await(await fetch(origin+'/api/workspace')).json();
  const responses=await Promise.all(Array.from({length:12},()=>fetch(origin+'/api/workspace-usage',{headers})));
  const values=await Promise.all(responses.map(async response=>{assert.equal(response.status,200);return response.json();}));
  for(const value of values){assert.equal(value.workspacePath,dataDir);assert.ok(value.totalBytes>before.byteLength);assert.ok(value.categories.find(row=>row.key==='sources').bytes>0);assert.ok(value.categories.find(row=>row.key==='settings').bytes>0);assert.doesNotMatch(JSON.stringify(value),/synthetic-source-marker|synthetic-settings-marker|private-source-name|private-settings-name/);}
  assert.deepEqual(await fs.readFile(path.join(dataDir,'workspace.json')),before);
  const after=await(await fetch(origin+'/api/workspace')).json();assert.equal(after.revision,snapshot.revision);assert.deepEqual(after.state,snapshot.state);assert.deepEqual(after.catalog,snapshot.catalog);
});
