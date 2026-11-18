// Executes the real app action bodies against a small, replaceable DOM. No browser/network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {submitModelSettings} from '../public/model-settings.mjs';
import * as modelUi from '../public/model-ui.mjs';
import {taskStartSettings} from '../public/task-workbench.mjs';

const source=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
const actionBody=source.slice(source.indexOf('async function modelAction(action){'),source.indexOf('function scheduleWorkspacePoll(){'));
assert.ok(actionBody.includes('submitModelSettings')&&actionBody.includes('async function runAiTask('));
const factory=new Function('env','submitModelSettings','modelConnectionBadge','taskStartSettings',`
  let {dialog,ui,document,workspace,uiT,uiError,lockSaving,renderDialog,openModelSettings,crypto,state,adoptWorkspace,render,toast}=env;
  ${actionBody}
  return{modelAction,runAiTask,getDialog:()=>dialog,replaceDialog:value=>{dialog=value;}};
`);
const config=()=>({configured:true,keyConfigured:true,connectionTested:true,connectionTestedAt:'2026-11-10T09:00:00+08:00',baseUrl:'http://controlled.invalid/v1',model:'controlled-model',authMode:'bearer',timeoutMs:120000,reasoningEffort:null,maxTokens:null});
const values=()=>({model:'controlled-model',baseUrl:'http://controlled.invalid/v1',authMode:'bearer',apiKey:'',timeoutSeconds:'120',reasoningEffort:'',maxTokens:''});
const ids={model:'model-id',baseUrl:'model-base-url',authMode:'model-auth-mode',apiKey:'model-api-key',timeoutSeconds:'model-timeout',reasoningEffort:'model-reasoning-effort',maxTokens:'model-max-tokens'};
const decode=value=>String(value??'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function harness({input=values(),initial=config(),testModel,readModelConfig,saveModelConfig}={}){
  const owner={type:'model-settings',config:structuredClone(initial)},ui={modelConfig:structuredClone(initial)},nodes=new Map();
  let api,html='',renders=0,tests=0,reads=0,starts=0,opens=0,locked=false,backend=structuredClone(initial);
  function renderDialog(){
    const current=api?.getDialog()||owner;renders++;html=modelUi.modelDialog(current).body;nodes.clear();
    for(const [key,id] of Object.entries(ids)){
      const tag=html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0];
      const options=html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/select>`))?.[1];
      const selected=options?.match(/<option[^>]*value="([^"]*)"[^>]*selected[^>]*>/)?.[1]??options?.match(/<option[^>]*value="([^"]*)"/)?.[1];
      nodes.set(id,{value:decode(tag?.match(/\bvalue="([^"]*)"/)?.[1]??selected??''),textContent:'',innerHTML:''});
    }
    for(const id of ['model-error','model-feedback'])nodes.set(id,{value:'',textContent:'',innerHTML:''});
    if(html.includes('id="model-connection-status"'))nodes.set('model-connection-status',{innerHTML:modelUi.modelConnectionBadge(current),textContent:''});
  }
  renderDialog();renders=0;
  for(const [key,value] of Object.entries(input))nodes.get(ids[key]).value=value;
  const workspace={
    async testModel(){tests++;backend={...backend,connectionTested:false,connectionTestedAt:null};return testModel?testModel():Promise.reject(new Error('Controlled connection failure'));},
    async readModelConfig(){reads++;return readModelConfig?readModelConfig():structuredClone(backend);},
    async saveModelConfig(changes){return saveModelConfig?saveModelConfig(changes):{...initial,...changes,connectionTested:false,connectionTestedAt:null};},
    async startAI(){starts++;return{};},
  };
  api=factory({dialog:owner,ui,document:{getElementById:id=>nodes.get(id)||null},workspace,uiT:text=>text,uiError:error=>error?.message||String(error),lockSaving:value=>{locked=value;},renderDialog,openModelSettings:async()=>{opens++;},crypto:{randomUUID:()=> 'controlled-run'},state:{tasks:[{id:'task'}]},adoptWorkspace(){},render(){},toast(){}},submitModelSettings,modelUi.modelConnectionBadge,taskStartSettings);
  return{api,owner,ui,nodes,renderDialog,inputValues:()=>Object.fromEntries(Object.entries(ids).map(([key,id])=>[key,nodes.get(id)?.value])),get visibleStatus(){return nodes.get('model-connection-status')?.innerHTML||html;},get html(){return html;},get renders(){return renders;},get tests(){return tests;},get reads(){return reads;},get starts(){return starts;},get opens(){return opens;},get locked(){return locked;}};
}

test('a failed connection retest refreshes public config, removes verified badge and closes the AI start gate',async()=>{
  const h=harness();await h.api.modelAction('model-test');
  assert.equal(h.tests,1);assert.equal(h.reads,1);assert.equal(h.owner.config.connectionTested,false);assert.equal(h.ui.modelConfig.connectionTested,false);
  assert.match(h.visibleStatus,/当前连接尚未测试/);assert.doesNotMatch(h.visibleStatus,/当前连接已测试通过/);
  assert.equal(h.nodes.get('model-error').textContent,'Controlled connection failure');assert.equal(h.locked,false);
  await h.api.runAiTask('task');assert.equal(h.opens,1);assert.equal(h.starts,0);
});
test('the previous verified state is cleared and pending badge is visible before the test request resolves',async()=>{
  const gate=deferred(),h=harness({testModel:()=>gate.promise}),pending=h.api.modelAction('model-test');
  await Promise.resolve();assert.equal(h.tests,1);assert.equal(h.ui.modelConfig.connectionTested,false);assert.equal(h.owner.config.connectionTestedAt,null);
  assert.match(h.visibleStatus,/正在连接模型服务/);assert.doesNotMatch(h.visibleStatus,/当前连接已测试通过/);
  gate.reject(new Error('Controlled async failure'));await pending;assert.match(h.visibleStatus,/当前连接尚未测试/);
});
test('an unavailable failure reread keeps the conservative state and original form values',async()=>{
  const initial={...config(),timeoutMs:290000,reasoningEffort:'high',maxTokens:32768},input={...values(),timeoutSeconds:'290',reasoningEffort:'high',maxTokens:'32768'},h=harness({initial,input,readModelConfig:async()=>{throw new Error('Controlled reread failure');}});
  await h.api.modelAction('model-test');assert.equal(h.reads,1);assert.equal(h.ui.modelConfig.connectionTested,false);assert.equal(h.owner.config.connectionTested,false);
  assert.deepEqual(h.inputValues(),input);assert.match(h.visibleStatus,/当前连接尚未测试/);assert.equal(h.nodes.get('model-error').textContent,'Controlled connection failure');
});
test('dirty and invalid settings never send a connection test or overwrite the entered form',async()=>{
  for(const input of [{...values(),baseUrl:'http://changed.invalid/v1',model:'changed-model',timeoutSeconds:'289',reasoningEffort:'low',maxTokens:'32768'},{...values(),timeoutSeconds:'1.5'},{...values(),apiKey:'user-entered-new-key'}]){
    const h=harness({input});await h.api.modelAction('model-test');assert.equal(h.tests,0);assert.equal(h.reads,0);assert.deepEqual(h.inputValues(),input);
    assert.match(h.nodes.get('model-error').textContent,/先保存|超时/);assert.equal(h.ui.modelConfig.connectionTested,true);
  }
});
test('successful tests adopt the returned public configuration and permit AI start',async()=>{
  const confirmed={...config(),connectionTestedAt:'2026-11-10T10:00:00+08:00'},h=harness({testModel:async()=>({modelId:confirmed.model,config:confirmed})});
  await h.api.modelAction('model-test');assert.deepEqual(h.owner.config,confirmed);assert.deepEqual(h.ui.modelConfig,confirmed);assert.match(h.visibleStatus,/当前连接已测试通过/);assert.equal(h.reads,0);
  await h.api.runAiTask('task');assert.equal(h.starts,1);assert.equal(h.opens,0);
});
test('a stale action cannot write feedback or rerender after another modal replaces its owner',async()=>{
  for(const replacement of [{type:'help'},{type:'model-settings',config:{...config(),model:'another-open-dialog'}}]){
    const gate=deferred(),h=harness({testModel:()=>gate.promise}),pending=h.api.modelAction('model-test');await Promise.resolve();
    h.api.replaceDialog(replacement);h.nodes.clear();const sentinel={textContent:'new modal content',value:'new modal value'};h.nodes.set('model-error',sentinel);h.nodes.set('model-feedback',sentinel);
    const renders=h.renders;gate.reject(new Error('Stale test failed'));await assert.doesNotReject(pending);
    assert.equal(h.api.getDialog(),replacement);assert.equal(sentinel.textContent,'new modal content');assert.equal(h.renders,renders);assert.equal(h.locked,false);assert.equal(h.ui.modelConfig.connectionTested,false);
  }
});
test('late successful tests or saves update public state without touching a replacement modal',async()=>{
  for(const action of ['model-test','model-save']){
    const gate=deferred(),h=harness({testModel:()=>gate.promise,saveModelConfig:()=>gate.promise}),pending=h.api.modelAction(action);await Promise.resolve();
    const replacement={type:'help'},sentinel={value:'replacement input',textContent:'replacement text'};h.api.replaceDialog(replacement);h.nodes.clear();h.nodes.set('model-feedback',sentinel);h.nodes.set('model-error',sentinel);const renders=h.renders;
    const publicConfig={...config(),connectionTested:action==='model-test'};gate.resolve(action==='model-test'?{modelId:publicConfig.model,config:publicConfig}:publicConfig);await assert.doesNotReject(pending);
    assert.deepEqual(h.ui.modelConfig,publicConfig);assert.equal(h.api.getDialog(),replacement);assert.equal(sentinel.textContent,'replacement text');assert.equal(sentinel.value,'replacement input');assert.equal(h.renders,renders);assert.equal(h.locked,false);
  }
});
test('successful saves clear only a newly entered key and failed saves retain all values',async()=>{
  const input={...values(),baseUrl:'http://changed.invalid/v1',model:'changed-model',timeoutSeconds:'288',apiKey:'user-entered-key'},h=harness({input,saveModelConfig:async()=>{throw new Error('Controlled save failure');}});
  await h.api.modelAction('model-save');assert.deepEqual(h.inputValues(),input);assert.equal(h.nodes.get('model-error').textContent,'Controlled save failure');
  const saved=harness({input});await saved.api.modelAction('model-save');assert.equal(saved.nodes.get('model-api-key').value,'');assert.equal(saved.nodes.get('model-base-url').value,input.baseUrl);assert.equal(saved.ui.modelConfig.connectionTested,false);
});
test('connection status rendering never includes saved secrets',()=>{
  const h=harness({initial:{...config(),apiKey:'NEVER-RENDER-SAVED-SECRET'}});assert.doesNotMatch(h.html,/NEVER-RENDER-SAVED-SECRET/);assert.equal(h.nodes.get('model-api-key').value,'');
});
