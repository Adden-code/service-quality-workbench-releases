import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {payloadFiles} from '../packaging/build.mjs';
test('every static relative runtime import is present in the actual installer payload',async()=>{
 const root=path.resolve('.'),payload=new Set(payloadFiles.map(p=>p.replaceAll('\\','/'))),seen=new Set();
 async function visit(name){if(seen.has(name))return;seen.add(name);const body=await fs.readFile(path.join(root,name),'utf8');
  for(const match of body.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+\.mjs)['"]/g)){
   if(!match[1].startsWith('.'))continue;const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1]));
   assert.ok(dependency.startsWith('public/')||payload.has(dependency),`${name} requires unpackaged ${dependency}`);await visit(dependency);
  }
 }
 for(const name of payload)if(name.endsWith('.mjs'))await visit(name);
 assert.ok(seen.has('server/startup-builtin-upgrade.mjs'));assert.ok(seen.has('server/delivery-progress.mjs'));
});
