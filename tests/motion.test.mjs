import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import * as motion from '../public/motion.mjs';

test('减少动态效果和键盘操作不触发入场动画',async()=>{
  assert.ok(existsSync(new URL('../public/motion.mjs',import.meta.url)),'缺少无障碍动效计划');
  const {appearancePlan}=await import('../public/motion.mjs');
  assert.equal(appearancePlan('dialog',{reduced:true}),null);
  assert.equal(appearancePlan('dialog',{keyboard:true}),null);
});

test('交互动效按组件区分节奏，退出轻于进入',()=>{
  assert.equal(typeof motion.motionPlan,'function','缺少统一交互动效计划');
  for(const kind of ['drawer','backdrop','details','feedback','toast']){
    const plan=motion.motionPlan(kind);
    assert.ok(plan.options.duration>0&&plan.options.duration<=250,kind);
    for(const frame of plan.keyframes)assert.ok(Object.keys(frame).every(key=>['opacity','transform'].includes(key)),kind);
    assert.equal(motion.motionPlan(kind,{keyboard:true}),null);
    assert.equal(motion.motionPlan(kind,{reduced:true}),null);
  }
  assert.ok(motion.motionPlan('drawer',{phase:'exit'}).options.duration<motion.motionPlan('drawer').options.duration);
  assert.match(motion.motionPlan('drawer').keyframes[0].transform,/translateX/);
  assert.match(motion.motionPlan('toast').keyframes[0].transform,/-50%/,'提示动画不能覆盖水平居中');
});

test('移动计划忽略无位移并为FLIP提供合成属性',()=>{
  assert.equal(typeof motion.displacementPlan,'function','缺少布局衔接计划');
  assert.equal(motion.displacementPlan(0),null);
  assert.equal(motion.displacementPlan(40,{reduced:true}),null);
  assert.equal(motion.displacementPlan(40,{keyboard:true}),null);
  assert.equal(motion.displacementPlan(40).keyframes.at(-1).transform,'translateY(0px)');
});
test('工作台入场短促且只使用合成属性',async()=>{
  assert.ok(existsSync(new URL('../public/motion.mjs',import.meta.url)),'缺少工作台动效计划');
  const {appearancePlan}=await import('../public/motion.mjs');
  assert.equal(appearancePlan('dialog').options.duration,180);
  assert.equal(appearancePlan('page').options.duration,140);
  for(const kind of ['dialog','page']){
    const plan=appearancePlan(kind);
    assert.match(plan.options.easing,/cubic-bezier/);
    assert.deepEqual(Object.keys(plan.keyframes[0]).sort(),['opacity','transform']);
    assert.equal(plan.keyframes.at(-1).opacity,1);
  }
});

test('动画执行器在键盘、减少动态效果和无动画API时即时回退',()=>{
  const element={animate(){assert.fail('此偏好下不应启动动画');}};
  for(const options of [{keyboard:true},{reduced:true}]){
    assert.equal(motion.animateAppearance(element,'drawer',options),null);
    assert.equal(motion.animateExit(element,'drawer',options),null);
  }
  assert.equal(motion.animateAppearance({},'drawer'),null);
  assert.equal(motion.animateExit(null,'drawer'),null);
});

test('连续触发取消旧动画，旧清理回调不能取消新动画',async()=>{
  // Only the browser animation-engine boundary is simulated; the real lifecycle
  // and promise cancellation code run unchanged.
  const animations=[];
  const element={animate(){
    let resolve,reject;
    const finished=new Promise((ok,no)=>{resolve=ok;reject=no;});
    const animation={finished,cancelled:false,cancel(){this.cancelled=true;reject(new Error('cancelled'));},complete:resolve};
    animations.push(animation);return animation;
  }};
  motion.animateAppearance(element,'drawer');
  motion.animateExit(element,'drawer');
  assert.equal(animations[0].cancelled,true);
  await Promise.resolve();
  assert.equal(animations[1].cancelled,false);
  animations[1].complete();await Promise.resolve();
  assert.equal(animations[1].cancelled,true,'结束后应清除填充效果与动画引用');
});
