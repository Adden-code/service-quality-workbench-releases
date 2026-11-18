import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createInitialState} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';

async function fixture(t,options={}){
  const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');assert.match(source,/export\s+(?:async\s+)?function\s+createWorkbenchServer/,'缺少可隔离端口及数据目录的服务器工厂');
  const {createWorkbenchServer}=await import('../server.mjs');const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'quality-api-'));
  const server=await createWorkbenchServer({dataDir,...options});server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await server.closeWorkspace();await fs.rm(dataDir,{recursive:true,force:true});});
  const initial=await(await fetch(`${origin}/api/workspace`)).json();
  const headers={'Content-Type':'application/json','Origin':origin,'X-Workspace-Token':initial.token};
  const body={baseRevision:0,mutationId:'initial',state:createInitialState(),catalog:createCatalog()};
  return {origin,headers,body,initial,server,dataDir,createWorkbenchServer};
}

test('isolated HTTP workspace is empty, saves, conflicts and keeps existing static routes',async t=>{
  const {origin,headers,body,initial}=await fixture(t);
  assert.equal(initial.initialized,false);assert.equal(initial.revision,0);assert.equal(initial.state,null);assert.equal(initial.catalog,null);assert.match(initial.token,/^[a-f0-9]{64}$/);
  assert.equal((await fetch(origin)).status,200);
  const response=await fetch(`${origin}/api/workspace`,{method:'PUT',headers,body:JSON.stringify(body)});assert.equal(response.status,200);assert.equal((await response.json()).revision,1);
  assert.equal((await fetch(`${origin}/api/workspace`,{method:'PUT',headers,body:JSON.stringify({...body,mutationId:'stale'})})).status,409);
  assert.deepEqual((await(await fetch(`${origin}/api/workspace`)).json()).state,body.state);
  assert.equal((await fetch(`${origin}/data/workspace.json`)).status,404);
});

test('mutations require token, exact same origin and JSON; hostile Host is rejected',async t=>{
  const {origin,headers,body}=await fixture(t);
  for(const override of [{'X-Workspace-Token':'wrong'},{'X-Workspace-Token':'é'.repeat(64)},{Origin:'https://evil.example'},{Origin:''},{'Content-Type':'text/plain'}]){
    const response=await fetch(`${origin}/api/workspace`,{method:'PUT',headers:{...headers,...override},body:JSON.stringify(body)});assert.ok([403,415].includes(response.status),`${JSON.stringify(override)} returned ${response.status}`);
  }
  const hostileHost=await new Promise((resolve,reject)=>{const req=httpRequest(`${origin}/api/workspace`,{headers:{Host:'evil.example'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});
  assert.equal(hostileHost,403);
  assert.equal((await fetch(`${origin}/api/workspace`,{method:'OPTIONS',headers:{Origin:'https://evil.example'}})).headers.get('access-control-allow-origin'),null);
  assert.equal((await fetch(`${origin}/api/workspace`,{method:'PUT',headers,body:'{'})).status,400);
});

test('chunked oversized request receives 413 without dropping the connection response',async t=>{
  const {origin,headers}=await fixture(t,{maxBodyBytes:256});
  const response=await new Promise((resolve,reject)=>{
    const req=httpRequest(`${origin}/api/workspace`,{method:'PUT',headers:{...headers,'Transfer-Encoding':'chunked'}},res=>{
      let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,data}));
    });req.on('error',reject);req.write('x'.repeat(200));req.write('y'.repeat(200));req.end();
  });assert.equal(response.status,413);assert.match(response.data,/超过/);
});

test('body limits do not initialize the workspace',async t=>{
  const {origin,headers,body}=await fixture(t,{maxBodyBytes:256});
  assert.equal((await fetch(`${origin}/api/workspace`,{method:'PUT',headers,body:JSON.stringify(body)})).status,413);
  const bad={...body,state:{schemaVersion:1,tasks:[],sessions:[{}],activity:[]}};
  assert.equal((await fetch(`${origin}/api/workspace`,{method:'PUT',headers,body:JSON.stringify(bad)})).status,413);
  assert.equal((await(await fetch(`${origin}/api/workspace`)).json()).initialized,false);
});

test('invalid state receives 400 without committing a partial workspace',async t=>{
  const {origin,headers,body}=await fixture(t);body.state.tasks.push(body.state.tasks[0]);
  const result=await fetch(`${origin}/api/workspace`,{method:'PUT',headers,body:JSON.stringify(body)});assert.equal(result.status,400);
  const saved=await(await fetch(`${origin}/api/workspace`)).json();assert.equal(saved.revision,0);assert.equal(saved.catalog,null);
});

test('source upload/download round-trips bytes under SHA paths and rejects unsafe requests',async t=>{
  const {origin,headers}=await fixture(t),bytes=Buffer.from('二进制文件\u0000原样保存');
  const uploadHeaders={...headers,'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent('会话原文.xlsx')};
  const upload=await fetch(`${origin}/api/sources`,{method:'POST',headers:uploadHeaders,body:bytes});assert.equal(upload.status,201);const source=await upload.json();
  const download=await fetch(`${origin}/api/sources/${source.sha256}`);assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);assert.match(download.headers.get('content-disposition'),/attachment/);
  assert.equal((await fetch(`${origin}/api/sources/${'a'.repeat(64)}`)).status,404);
  assert.equal((await fetch(`${origin}/api/sources/not-a-digest`)).status,400);
  assert.equal((await fetch(`${origin}/api/sources`,{method:'POST',headers:{...uploadHeaders,'X-File-Name':encodeURIComponent('../evil.xlsx')},body:bytes})).status,400);
  assert.equal((await fetch(`${origin}/api/sources`,{method:'POST',headers:{...uploadHeaders,'X-Workspace-Token':'bad'},body:bytes})).status,403);
  assert.equal((await fetch(`${origin}/api/sources`,{method:'POST',headers:uploadHeaders,body:Buffer.alloc(8*1024*1024+1)})).status,413);
});
