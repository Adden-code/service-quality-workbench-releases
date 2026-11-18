import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {existsSync} from 'node:fs';
const moduleUrl=new URL('../launch-demo.mjs',import.meta.url);
const html='<title>服务会话质检工作台 · 售前咨询演示</title><script type="module" src="./app.mjs"></script>';
async function implementation(){assert.ok(existsSync(moduleUrl),'缺少支持冷启动的桌面启动器');return import(moduleUrl);}
const listen=(server,port=0)=>new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
const stop=server=>new Promise(resolve=>server.close(resolve));

test('桌面启动器复用已就绪的Demo，不重复启动服务',async t=>{
  const {ensureDemoReady}=await implementation();
  const server=http.createServer((req,res)=>res.end(html));await listen(server);t.after(()=>stop(server));
  let starts=0;const result=await ensureDemoReady({baseUrl:`http://127.0.0.1:${server.address().port}`,start:()=>starts++});
  assert.equal(starts,0);assert.equal(result.started,false);assert.match(result.url,/#review$/);
});

test('服务未运行时自动启动，等待真正可访问后返回审核地址',async t=>{
  const {ensureDemoReady}=await implementation();
  const server=http.createServer((req,res)=>res.end(html));await listen(server);const port=server.address().port;await stop(server);
  t.after(()=>server.listening?stop(server):undefined);
  let starts=0;const result=await ensureDemoReady({baseUrl:`http://127.0.0.1:${port}`,start:async()=>{starts++;await listen(server,port);}});
  assert.equal(starts,1);assert.equal(result.started,true);assert.equal(result.url,`http://127.0.0.1:${port}/#review`);
});

test('其它程序占用端口时明确报错，不启动或结束任何程序',async t=>{
  const {ensureDemoReady}=await implementation();
  const server=http.createServer((req,res)=>res.end('another app'));await listen(server);t.after(()=>stop(server));
  let starts=0;
  await assert.rejects(ensureDemoReady({baseUrl:`http://127.0.0.1:${server.address().port}`,start:()=>starts++}),/占用/);
  assert.equal(starts,0);
});
