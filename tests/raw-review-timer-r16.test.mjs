import test from 'node:test';
import assert from 'node:assert/strict';
import {recordRawReviewTime} from '../public/domain.mjs';
const api=await import('../public/raw-review-timer.mjs').catch(()=>({}));
function fixture(){let clock=0,visible=true,session={id:'S',rawTranscript:{schemaVersion:1},review:{status:'待审核',reviewer:'Reviewer'},reviewPolicy:{enabled:true}};const packets=[];const timer=api.createRawReviewTimer?.({getSession:()=>session,isActive:()=>visible,clock:()=>clock,now:()=>new Date(2000000000000+clock).toISOString(),save:async packet=>packets.push(packet)});return{timer,packets,setClock:n=>clock=n,setVisible:v=>visible=v,session};}
test('active review time measures only the current editable raw session',async()=>{assert.equal(typeof api.createRawReviewTimer,'function');const f=fixture();f.timer.sync();f.setClock(1500);await f.timer.flush();assert.equal(f.packets[0].elapsedMs,1500);assert.equal(f.packets[0].sessionId,'S');});
test('time after sixty seconds without activity is not counted as human review effort',async()=>{const f=fixture();f.timer.sync();f.setClock(120000);await f.timer.flush();assert.equal(f.packets[0].elapsedMs,60000);});
test('hidden or read-only AI-final records do not accrue new review time',async()=>{const f=fixture();f.setVisible(false);f.timer.sync();f.setClock(1000);await f.timer.flush();assert.equal(f.packets.length,0);f.setVisible(true);f.session.review.status='已确认';f.timer.sync();f.setClock(2000);await f.timer.flush();assert.equal(f.packets.length,0);});
test('a failed timing save retains the exact idempotent segment for retry',async()=>{let clock=0,calls=[],fail=true;const timer=api.createRawReviewTimer({getSession:()=>({id:'S',rawTranscript:{schemaVersion:1},review:{status:'待审核',reviewer:'R'}}),isActive:()=>true,clock:()=>clock,save:async p=>{calls.push(p);if(fail)throw new Error('storage');}});timer.sync();clock=500;await assert.rejects(timer.flush(),/storage/);fail=false;await timer.flush();assert.deepEqual(calls[1],calls[0]);});
function scheduledFixture({checkpointMs=10000,save}={}){
 let clock=0,visible=true,session={id:'S',rawTranscript:{schemaVersion:1},review:{status:'待审核',reviewer:'R'}};let next=0;const jobs=new Map(),packets=[];
 const timer=api.createRawReviewTimer({getSession:()=>session,isActive:()=>visible,clock:()=>clock,now:()=>new Date(2000000000000+clock).toISOString(),checkpointMs,setTimer:(fn,delay)=>{const id=++next;jobs.set(id,{fn,delay});return id;},clearTimer:id=>jobs.delete(id),save:async packet=>{packets.push(packet);if(save)await save(packet);}});
 return {timer,jobs,packets,setClock:value=>clock=value,setVisible:value=>visible=value,setSession:value=>session=value,get session(){return session;},async fire(){assert.ok(jobs.size,'a periodic checkpoint must be scheduled');const [id,job]=jobs.entries().next().value;jobs.delete(id);await job.fn();}};
}
test('focus restored during an unfinished save resumes plain reading without another interaction',async()=>{
 let clock=0,visible=true,release;const packets=[],gate=new Promise(resolve=>release=resolve),s={id:'S',rawTranscript:{schemaVersion:1},review:{status:'待审核',reviewer:'R'}};
 const timer=api.createRawReviewTimer({getSession:()=>s,isActive:()=>visible,clock:()=>clock,checkpointMs:0,save:async packet=>{packets.push(packet);await gate;}});
 timer.sync();clock=1000;visible=false;const first=timer.flush();await Promise.resolve();visible=true;timer.sync();release();await first;clock=2000;await timer.flush();assert.equal(packets.reduce((n,p)=>n+p.elapsedMs,0),2000);
});
test('a continuous session longer than four hours splits into valid domain timing segments',async()=>{
 let clock=0,state={tasks:[{id:'T',mode:'manual',createdAt:'2026-01-01T00:00:00Z'}],sessions:[{id:'S',taskId:'T',rawTranscript:{schemaVersion:1},review:{status:'待审核',reviewer:'R'}}]};
 const timer=api.createRawReviewTimer({getSession:()=>state.sessions[0],isActive:()=>true,clock:()=>clock,checkpointMs:0,save:async p=>{state=recordRawReviewTime(state,p);}});timer.sync();
 for(clock=30000;clock<=4*3600000+30000;clock+=30000)timer.activity();await timer.flush();const segments=state.sessions[0].review.timeSegments;assert.ok(segments.length>1);assert.equal(state.sessions[0].review.activeTimeMs,clock);assert.ok(segments.every(p=>p.elapsedMs<=4*3600000));assert.equal(new Set(segments.map(p=>p.segmentId)).size,segments.length);assert.equal(timer.pendingCount,0);
});
test('configurable checkpoints save reading time periodically and stop at the idle deadline',async()=>{
 const f=scheduledFixture();f.timer.sync();assert.equal([...f.jobs.values()][0].delay,10000);
 for(let at=10000;at<=60000;at+=10000){f.setClock(at);await f.fire();}
 assert.equal(f.packets.length,6);assert.equal(f.packets.reduce((n,p)=>n+p.elapsedMs,0),60000);assert.equal(f.jobs.size,0);
 f.setClock(120000);f.timer.sync();assert.equal(f.jobs.size,0,'background sync must not reset the idle deadline');f.timer.activity();assert.equal(f.jobs.size,1);f.setClock(125000);await f.timer.flush();assert.equal(f.packets.reduce((n,p)=>n+p.elapsedMs,0),65000);
});
test('a failed periodic checkpoint retries its exact segment before adding later measured time',async()=>{
 let fail=true;const f=scheduledFixture({save:async()=>{if(fail)throw new Error('storage');}});f.timer.sync();f.setClock(10000);await f.fire();assert.equal(f.timer.pendingCount,1);const first=structuredClone(f.packets[0]);fail=false;f.setClock(20000);await f.fire();assert.deepEqual(f.packets[1],first);assert.equal(f.timer.pendingCount,0);assert.equal(f.packets.at(-1).elapsedMs,10000);
});
test('suspend captures once and prevents confirmation or session-change renders from restarting the old timer',async()=>{
 const f=scheduledFixture();f.timer.sync();f.setClock(1000);const release=f.timer.suspend();await f.timer.flush();f.setClock(1005);f.session.review.status='已确认';f.timer.sync();f.timer.activity();assert.equal(f.jobs.size,0);assert.equal(f.timer.pendingCount,0);
 const old=f.session;f.setSession({id:'NEXT',rawTranscript:{schemaVersion:1},review:{status:'待审核',reviewer:'R'}});f.timer.sync();release();release();f.setClock(2005);await f.timer.flush();assert.deepEqual(f.packets.map(p=>[p.sessionId,p.elapsedMs]),[['S',1000],['NEXT',1000]]);assert.equal(old.review.status,'已确认');
});
test('a tiny unqueued post-flush interval cannot turn a newly readonly session into a rejected save',async()=>{
 const f=scheduledFixture();f.timer.sync();f.setClock(1000);await f.timer.flush();f.setClock(1001);f.session.review.status='已确认';f.timer.sync();await f.timer.flush();assert.equal(f.packets.length,1);assert.equal(f.timer.pendingCount,0);assert.equal(f.jobs.size,0);
});
test('readonly transitions preserve an already failed idempotent timing packet',async()=>{
 const f=scheduledFixture({save:async()=>{throw new Error('storage');}});f.timer.sync();f.setClock(1000);await assert.rejects(f.timer.flush(),/storage/);const first=structuredClone(f.packets[0]);f.session.review.status='已确认';f.timer.sync();assert.equal(f.timer.pendingCount,1);await assert.rejects(f.timer.flush(),/storage/);assert.deepEqual(f.packets[1],first);assert.equal(f.timer.pendingCount,1);
});
