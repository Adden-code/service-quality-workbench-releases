import test from 'node:test';
import assert from 'node:assert/strict';
import {modelDialog} from '../public/model-ui.mjs';
import {taskDetailView} from '../public/task-workbench.mjs';
import {validateRuleProvenance} from '../public/context-fields.mjs';
const settings=await import('../public/model-settings.mjs').catch(()=>({}));

const input={baseUrl:'http://maas.internal.example/v1/chat/completions/',model:'外部模型-GLM-V5.3-Flash-1M',authMode:'none',timeoutSeconds:'290',reasoningEffort:'low',maxTokens:'32768',apiKey:''};

test('model settings exposes editable MaaS fields and never renders saved secrets',()=>{
 const {body}=modelDialog({config:{...input,baseUrl:'http://maas.internal.example/v1',timeoutMs:290000,maxTokens:32768,keyConfigured:false,configured:true,apiKey:'NEVER-RENDER-KEY'}});
 assert.match(body,/id="model-base-url"[^>]*value="http:\/\/maas\.internal\.example\/v1"/);
 assert.doesNotMatch(body.match(/<input[^>]*id="model-base-url"[^>]*>/)?.[0]||'',/readonly/);
 for(const id of ['model-auth-mode','model-timeout','model-reasoning-effort','model-max-tokens'])assert.match(body,new RegExp(`id="${id}"`));
 assert.match(body,/value="none" selected/);assert.match(body,/id="model-timeout"[^>]*value="290"/);
 assert.match(body,/value="low" selected/);assert.match(body,/id="model-max-tokens"[^>]*value="32768"/);
 assert.match(body,/无需密钥/);assert.doesNotMatch(body,/NEVER-RENDER-KEY|使用火山方舟/);
});

test('form conversion sends canonical model settings and drops key in explicit no-auth mode',()=>{
 assert.equal(typeof settings.modelFormChanges,'function');
 const changes=settings.modelFormChanges({...input,apiKey:'old-key-must-not-forward'});
 assert.deepEqual(changes,{baseUrl:'http://maas.internal.example/v1',model:input.model,authMode:'none',timeoutMs:290000,reasoningEffort:'low',maxTokens:32768});
});

test('blank optional settings preserve legacy node budgets and do not imply disabled model reasoning',()=>{
 assert.equal(typeof settings.modelFormChanges,'function');
 const changes=settings.modelFormChanges({...input,authMode:'bearer',timeoutSeconds:'120',reasoningEffort:'',maxTokens:'',apiKey:'new-local-test-key'});
 assert.equal(changes.reasoningEffort,null);assert.equal(changes.maxTokens,null);assert.equal(changes.apiKey,'new-local-test-key');
 assert.equal(changes.timeoutMs,120000);
});

test('form rejects bad or ambiguous URLs, fractional/oversized limits, and invalid model ids',()=>{
 assert.equal(typeof settings.modelFormChanges,'function');
 for(const patch of [{baseUrl:'file:///tmp/model'},{baseUrl:'http://user:password@maas/v1'},{baseUrl:'http://@maas/v1'},{baseUrl:'http://:@maas/v1'},{baseUrl:'http://maas/v1?key=x'},{baseUrl:'http://maas/v1?'},{baseUrl:'http://maas/v1#token'},{baseUrl:'http://maas/v1#'},{baseUrl:'http://maas\\v1'},{baseUrl:'http://maas/'+ 'x'.repeat(4096)},{model:'模型 名称'},{timeoutSeconds:'291'},{timeoutSeconds:'1.5'},{maxTokens:'65537'},{maxTokens:'15'},{reasoningEffort:'off'}])assert.throws(()=>settings.modelFormChanges({...input,...patch}));
});

test('test-connection detects every unsaved model option, while canonical equivalent URL is clean',()=>{
 assert.equal(typeof settings.modelFormIsDirty,'function');
 const config={baseUrl:'http://maas.internal.example/v1',model:input.model,authMode:'none',timeoutMs:290000,reasoningEffort:'low',maxTokens:32768};
 assert.equal(settings.modelFormIsDirty(input,config),false);
 for(const patch of [{baseUrl:'http://other.internal/v1'},{model:'另一个模型'},{authMode:'bearer'},{timeoutSeconds:'289'},{reasoningEffort:'high'},{maxTokens:'65536'}])assert.equal(settings.modelFormIsDirty({...input,...patch},config),true);
 assert.equal(settings.modelFormIsDirty({...input,authMode:'bearer',apiKey:'changed-key'},{...config,authMode:'bearer'}),true);
});

test('model front-end request timeout leaves room above configured provider timeout',()=>{
 assert.equal(typeof settings.modelRequestTimeLimit,'function');
 assert.equal(settings.modelRequestTimeLimit({timeoutMs:290000}),300000);
 assert.equal(settings.modelRequestTimeLimit({timeoutMs:120000}),130000);
 assert.equal(settings.modelRequestTimeLimit({}),130000);
});

test('save action forwards every selected option and test action blocks any unsaved change',async()=>{
 assert.equal(typeof settings.submitModelSettings,'function');
 const calls=[],saved={baseUrl:'http://maas.internal.example/v1',model:input.model,authMode:'none',timeoutMs:290000,reasoningEffort:'low',maxTokens:32768};
 const workspace={saveModelConfig:async changes=>{calls.push(changes);return saved;},testModel:async()=>{calls.push('test');return {modelId:input.model};}};
 const result=await settings.submitModelSettings('model-save',input,{},workspace);
 assert.deepEqual(result.config,saved);assert.deepEqual(calls[0],saved);
 await assert.rejects(settings.submitModelSettings('model-test',{...input,timeoutSeconds:'120'},saved,workspace),/先保存/);
 assert.equal(calls.length,1);
 assert.equal((await settings.submitModelSettings('model-test',input,saved,workspace)).result.modelId,input.model);
 assert.equal(calls.at(-1),'test');
});

test('task details show the frozen model configuration and fingerprint without rendering private fields',()=>{
 const task={id:'T-FROZEN',name:'配置快照',mode:'manual',scene:'电商评论回复',aiStatus:'paused',sessionIds:[],aiRun:{modelId:'内网模型',modelConfig:{baseUrl:'http://maas.internal/v1',model:'内网模型',authMode:'none',timeoutMs:290000,reasoningEffort:'low',maxTokens:32768,apiKey:'NEVER-RENDER-RUN-KEY'},modelConfigFingerprint:'a'.repeat(64)}};
 const html=taskDetailView({tasks:[task],sessions:[]},{taskDetailId:task.id});
 for(const value of ['本次模型配置','http://maas.internal/v1','内网模型','290 秒','32768','low','a'.repeat(64)])assert.ok(html.includes(value),value);
 assert.doesNotMatch(html,/NEVER-RENDER-RUN-KEY|apiKey/);
});

test('rule-preparation provenance preserves the same 160 Unicode codepoint model limit',()=>{
 const provenance={source:{name:'规则.txt',sha256:'a'.repeat(64),size:10},quote:'明确服务要求',locator:'第1段',scene:'新品产品咨询',preparedBy:{modelId:'𠀀'.repeat(160),promptVersion:'prepare-v1',at:'2026-11-03T12:00:00+08:00'}};
 assert.equal(validateRuleProvenance(provenance),true);
 assert.throws(()=>validateRuleProvenance({...provenance,preparedBy:{...provenance.preparedBy,modelId:'𠀀'.repeat(161)}}));
 assert.throws(()=>validateRuleProvenance({...provenance,preparedBy:{...provenance.preparedBy,promptVersion:'x'.repeat(161)}}));
});
