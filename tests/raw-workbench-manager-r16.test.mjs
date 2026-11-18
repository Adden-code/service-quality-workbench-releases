import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../public/raw-workbench-manager.mjs').catch(()=>({}));
function setup(){
 const task={id:'TASK-SYN',name:'Synthetic',inputMode:'raw-transcript-v1',source:{name:'source.xlsx',sha256:'a'.repeat(64)},basisSnapshot:{rules:[{id:'SYN-R',version:'V1'}],policies:[]},reviewPolicy:{enabled:true,confidenceThreshold:0.9}};
 const session={id:'SYN-S',externalId:'EXT',taskId:task.id,rawTranscript:{schemaVersion:1,row:2,text:'Synthetic',timePolicy:{mode:'unavailable'}},aiResults:[],review:{drafts:{},status:'待审核'}};
 let dialog,config={configured:false,connectionTested:false,baseUrl:'https://synthetic.invalid/v1',model:'synthetic-model',authMode:'none'},calls=[],downloads=[];
 const state={tasks:[task],sessions:[session]},manager=api.createRawWorkbenchManager?.({getState:()=>state,getUI:()=>({selectedId:session.id}),getDialog:()=>dialog,getModelConfig:()=>config,openDialog:d=>{dialog=d;},closeDialog:()=>{dialog=null;},renderDialog(){},render(){},toast(){},download:(...args)=>downloads.push(args),api:async(url,options)=>{calls.push({url,options});return{job:{id:'J',taskId:task.id,status:'paused',nodes:[],processed:0,total:1}};},configureModel(){},commit:async fn=>{Object.assign(state,fn(state));},selectSession(){},reinspect(){}});
 return {manager,state,task,session,calls,downloads,get dialog(){return dialog;},get config(){return config;},setConfig(value){config=value;}};
}
test('golden comparison opens a frozen local task snapshot and can download an identity-complete template',async()=>{
 assert.equal(typeof api.createRawWorkbenchManager,'function');const f=setup();await f.manager.click('raw-golden-open',{dataset:{id:f.task.id}});assert.equal(f.dialog.type,'raw-golden');f.task.name='Changed later';assert.equal(f.dialog.state.tasks[0].name,'Synthetic');await f.manager.click('raw-golden-template');assert.equal(f.downloads.length,1);assert.equal(f.calls.length,0);f.manager.stop();
});
test('background structure cannot call a provider without tested configuration and fresh consent',async()=>{
 const f=setup();await f.manager.click('raw-structure-open',{dataset:{id:f.task.id}});f.dialog.consent=true;await assert.rejects(f.manager.click('raw-structure-run'),/测试|接口/);assert.equal(f.calls.filter(c=>c.options?.method==='POST').length,0);f.manager.stop();
});
test('changing the model after consent revokes the optional structure authorization',async()=>{
 const f=setup();f.setConfig({...f.config,configured:true,connectionTested:true});await f.manager.click('raw-structure-open',{dataset:{id:f.task.id}});f.dialog.consent=true;f.setConfig({...f.config,model:'other-model'});await assert.rejects(f.manager.click('raw-structure-run'),/确认|设置|授权/);assert.equal(f.calls.filter(c=>c.options?.method==='POST').length,0);f.manager.stop();
});
test('a ready optional structure task sends only task identity and explicit consent through its separate job API',async()=>{
 const f=setup();f.setConfig({...f.config,configured:true,connectionTested:true});await f.manager.click('raw-structure-open',{dataset:{id:f.task.id}});f.dialog.consent=true;await f.manager.click('raw-structure-run');const post=f.calls.find(c=>c.options?.method==='POST');assert.equal(post.url,'/api/raw-structure-jobs');assert.equal(post.options.body.taskId,f.task.id);assert.equal(post.options.body.consent,true);assert.ok(!JSON.stringify(post.options.body).includes('Synthetic original'));f.manager.stop();
});
