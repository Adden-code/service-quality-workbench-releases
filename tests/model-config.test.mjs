import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ARK_BASE_URL,DEFAULT_MODEL,createModelConfig,ModelConfigError,protectWindowsSecret,unprotectWindowsSecret} from '../server/model-config.mjs';

const key='fictional-test-key-123456';
const crypto={protectSecret:async value=>'encrypted:'+Buffer.from(value).toString('base64'),unprotectSecret:async value=>Buffer.from(value.slice(10),'base64').toString()};
async function fixture(t,options={}) {
  const dataDir=await mkdtemp(path.join(tmpdir(),'ark-config-test-'));
  t.after(()=>rm(dataDir,{recursive:true,force:true}));
  return {dataDir,config:await createModelConfig({dataDir,env:{},...crypto,...options})};
}
test('empty configuration has the fixed provider endpoint and default model',async t=>{
  const {config}=await fixture(t);
  assert.equal(ARK_BASE_URL,'https://ark.cn-beijing.volces.com/api/plan/v3');
  assert.equal(DEFAULT_MODEL,'glm-5.3-flash');
  assert.deepEqual(config.publicConfig(),{provider:'volcengine-ark',baseUrl:ARK_BASE_URL,model:DEFAULT_MODEL,authMode:'bearer',timeoutMs:120000,reasoningEffort:null,maxTokens:null,configured:false,keyConfigured:false,connectionTested:false,connectionTestedAt:null});
});
test('saves encrypted secret atomically and reloads without exposing ciphertext or key publicly',async t=>{
  const {config,dataDir}=await fixture(t);
  await config.update({apiKey:key,model:'glm-5.3-flash'});
  const saved=await readFile(path.join(dataDir,'.secrets','ark-model.json'),'utf8');
  assert.ok(!saved.includes(key));assert.ok(saved.includes('encrypted:'));
  const reloaded=await createModelConfig({dataDir,env:{},...crypto});
  assert.equal(reloaded.getPrivate().apiKey,key);
  assert.equal(reloaded.publicConfig().configured,true);
  assert.ok(!JSON.stringify(reloaded.publicConfig()).includes(key));
  assert.ok(!JSON.stringify(reloaded.publicConfig()).includes('encrypted:'));
});
test('environment values take precedence and are not written to disk',async t=>{
  const envKey='fictional-environment-key';
  const {config,dataDir}=await fixture(t,{env:{ARK_API_KEY:envKey,ARK_MODEL_ID:'env-model'}});
  await config.update({apiKey:key,model:'local-model'});
  assert.equal(config.getPrivate().apiKey,envKey);assert.equal(config.publicConfig().model,'env-model');
  assert.ok(!(await readFile(path.join(dataDir,'.secrets','ark-model.json'),'utf8')).includes(envKey));
  await config.update({clearKey:true});
  assert.equal(config.getPrivate().apiKey,envKey);
  const noEnv=await createModelConfig({dataDir,env:{},...crypto});
  assert.equal(noEnv.publicConfig().configured,false);assert.equal(noEnv.publicConfig().model,'local-model');
});
test('failed encryption retains the previous saved key and allows a later update',async t=>{
  let fail=false;
  const {config,dataDir}=await fixture(t,{protectSecret:async value=>{if(fail)throw Error(key);return crypto.protectSecret(value);}});
  await config.update({apiKey:key});
  const old=await readFile(path.join(dataDir,'.secrets','ark-model.json'),'utf8');
  fail=true;
  await assert.rejects(config.update({apiKey:'fictional-replacement-key'}),error=>error instanceof ModelConfigError&&!error.message.includes(key));
  assert.equal(await readFile(path.join(dataDir,'.secrets','ark-model.json'),'utf8'),old);
  assert.equal(config.getPrivate().apiKey,key);
  fail=false;await config.update({model:'next-model'});assert.equal(config.publicConfig().model,'next-model');
});
test('concurrent changes serialize so key and model changes are not lost',async t=>{
  const {config}=await fixture(t,{protectSecret:async value=>{await new Promise(resolve=>setTimeout(resolve,8));return crypto.protectSecret(value);}});
  await Promise.all([config.update({apiKey:key}),config.update({model:'second-model'})]);
  assert.equal(config.getPrivate().apiKey,key);assert.equal(config.publicConfig().model,'second-model');
  await config.update({clearKey:true});assert.equal(config.publicConfig().keyConfigured,false);
});
test('validates model identifiers and API keys before persisting',async t=>{
  const {config}=await fixture(t);
  for(const model of ['', 'bad/model', 'bad model', '-bad','a'.repeat(161)])await assert.rejects(config.update({model}),ModelConfigError);
  for(const apiKey of ['', 'short', 'space key12', 'new\nlinekey', 'x'.repeat(4097)])await assert.rejects(config.update({apiKey}),ModelConfigError);
  await assert.rejects(config.update({apiKey:key,clearKey:true}),ModelConfigError);
  await assert.rejects(config.update({baseUrl:'https://other.invalid?query=secret'}),ModelConfigError);
  assert.equal(config.publicConfig().configured,false);
});

test('persists MaaS options, Unicode model and keyless authentication without leaking an existing key',async t=>{
  const {config,dataDir}=await fixture(t);await config.update({apiKey:key});
  const options={baseUrl:'http://127.0.0.1:18081/v1/chat/completions///',model:'智谱GLM-5.1_测试',authMode:'none',timeoutMs:290000,reasoningEffort:'high',maxTokens:65536};
  const saved=await config.update({...options,apiKey:key});assert.equal(saved.baseUrl,'http://127.0.0.1:18081/v1');assert.equal(saved.configured,true);assert.equal(saved.keyConfigured,true);assert.equal(config.getPrivate().apiKey,null);
  const reloaded=await createModelConfig({dataDir,env:{},...crypto});
  assert.deepEqual(reloaded.publicConfig(),saved);assert.equal(reloaded.getPrivate().apiKey,null);
  await reloaded.update({authMode:'bearer'});assert.equal(reloaded.getPrivate().apiKey,key);
  await reloaded.update({clearKey:true,authMode:'none',reasoningEffort:null,maxTokens:null});assert.equal(reloaded.publicConfig().configured,true);assert.equal(reloaded.publicConfig().keyConfigured,false);
});

test('changing endpoint clears saved credentials and scopes legacy environment keys to the legacy provider',async t=>{
  const {config,dataDir}=await fixture(t,{env:{ARK_API_KEY:'fictional-env-provider-key'}});await config.update({apiKey:key});
  await config.update({baseUrl:'http://maas.internal/v1'});
  assert.equal(config.publicConfig().configured,false);assert.equal(config.publicConfig().keyConfigured,false);assert.equal(config.getPrivate().apiKey,null);
  await config.update({apiKey:'fictional-maas-only-key'});assert.equal(config.getPrivate().apiKey,'fictional-maas-only-key');
  const reload=await createModelConfig({dataDir,env:{ARK_API_KEY:'fictional-env-provider-key'},...crypto});assert.equal(reload.getPrivate().apiKey,'fictional-maas-only-key');
  await reload.update({baseUrl:'http://maas.internal/v1/chat/completions/'});assert.equal(reload.getPrivate().apiKey,'fictional-maas-only-key');
  await reload.update({baseUrl:ARK_BASE_URL});assert.equal(reload.getPrivate().apiKey,'fictional-env-provider-key');
});

test('legacy environment model override applies only to its original provider',async t=>{
  const {config,dataDir}=await fixture(t,{env:{ARK_MODEL_ID:'fictional-env-model'}});
  assert.equal(config.publicConfig().model,'fictional-env-model');
  await config.update({baseUrl:'http://maas.internal/v1',model:'用户保存模型',authMode:'none'});assert.equal(config.publicConfig().model,'用户保存模型');
  const reloaded=await createModelConfig({dataDir,env:{ARK_MODEL_ID:'fictional-env-model'},...crypto});assert.equal(reloaded.publicConfig().model,'用户保存模型');
  await reloaded.update({baseUrl:ARK_BASE_URL});assert.equal(reloaded.publicConfig().model,'fictional-env-model');
});

test('schema one migrates with legacy defaults and safe snapshots ignore secrets',async t=>{
  const {dataDir}=await fixture(t);await mkdir(path.join(dataDir,'.secrets'),{recursive:true});
  await writeFile(path.join(dataDir,'.secrets','ark-model.json'),JSON.stringify({schemaVersion:1,model:'legacy-model',apiKeyCiphertext:null}));
  const config=await createModelConfig({dataDir,env:{},...crypto});
  const {modelConfigSnapshot,modelConfigFingerprint}=await import('../server/model-config.mjs');
  const safe={baseUrl:ARK_BASE_URL,model:'legacy-model',authMode:'bearer',timeoutMs:120000,reasoningEffort:null,maxTokens:null};
  assert.deepEqual(modelConfigSnapshot(config.getPrivate()),safe);
  assert.equal(modelConfigFingerprint({...safe,apiKey:key}),modelConfigFingerprint({...safe,apiKey:'another-fictional-key'}));
  assert.notEqual(modelConfigFingerprint(safe),modelConfigFingerprint({...safe,reasoningEffort:'low'}));assert.match(modelConfigFingerprint(safe),/^[a-f0-9]{64}$/);
});

test('MaaS validation rejects ambiguous addresses and out of range options before persistence',async t=>{
  const {config}=await fixture(t);
  for(const baseUrl of ['ftp://host/v1','http://user:pass@host/v1','http://@host/v1','http://:@host/v1','http://host/v1?x=1','http://host/v1#x','http://host/v1?','http://host/v1#','not-a-url'])await assert.rejects(config.update({baseUrl}),ModelConfigError);
  for(const changes of [{model:null},{baseUrl:null},{authMode:null},{timeoutMs:null},{authMode:'basic'},{timeoutMs:999},{timeoutMs:290001},{timeoutMs:1000.5},{reasoningEffort:'medium'},{maxTokens:15},{maxTokens:65537},{maxTokens:20.5}])await assert.rejects(config.update(changes),ModelConfigError);
  await config.update({baseUrl:'http://maas.internal:8010/v1/',model:'𠀀'.repeat(160),authMode:'none',timeoutMs:1000,maxTokens:16,reasoningEffort:'max'});
  assert.equal(config.publicConfig().model,'𠀀'.repeat(160));assert.equal(config.publicConfig().baseUrl,'http://maas.internal:8010/v1');
  await assert.rejects(config.update({model:'𠀀'.repeat(161)}),ModelConfigError);
});
test('getPrivate returns a detached value',async t=>{
  const {config}=await fixture(t);await config.update({apiKey:key});
  const value=config.getPrivate();value.apiKey='changed';value.model='changed';
  assert.equal(config.getPrivate().apiKey,key);assert.equal(config.publicConfig().model,DEFAULT_MODEL);
});
test('an environment key works even when the saved user-bound key cannot be decrypted',async t=>{
  const {config,dataDir}=await fixture(t);await config.update({apiKey:key});
  const override=await createModelConfig({dataDir,env:{ARK_API_KEY:'fictional-env-override-key'},unprotectSecret:async()=>{throw Error('other Windows user');}});
  assert.equal(override.getPrivate().apiKey,'fictional-env-override-key');
});
test('real DPAPI round trip uses only a fictional secret',{skip:process.platform!=='win32'},async()=>{
  const encrypted=await protectWindowsSecret(key);
  assert.notEqual(encrypted,key);assert.ok(!encrypted.includes(key));
  assert.equal(await unprotectWindowsSecret(encrypted),key);
});
