// Functional, brief motion. Layout/state commits never wait for an animation.
const easing='cubic-bezier(0.22, 1, 0.36, 1)';
const running=new WeakMap();
const active=new Set();
const preferences=options=>({reduced:typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches,...options});

export function motionPlan(kind,{phase='enter',reduced=false,keyboard=false}={}){
  if(reduced||keyboard)return null;
  const exit=phase==='exit';
  const recipes={
    page:[140,'translateY(3px)','translateY(0)'],
    dialog:[180,'translateY(8px) scale(0.985)','translateY(0) scale(1)'],
    drawer:[220,'translateX(28px)','translateX(0)'],
    backdrop:[160,'none','none'],
    details:[170,'translateY(-4px)','translateY(0)'],
    feedback:[180,'translateY(3px) scale(0.97)','translateY(0) scale(1)'],
    toast:[190,'translate(-50%, -6px)','translate(-50%, 0px)'],
  };
  const [duration,from,to]=recipes[kind]||recipes.dialog;
  const departure=kind==='drawer'?'translateX(12px)':kind==='toast'?'translate(-50%, -3px)':'translateY(3px)';
  return {
    keyframes:exit?[{opacity:1,transform:to},{opacity:0,transform:kind==='backdrop'?'none':departure}]:[{opacity:0,transform:from},{opacity:1,transform:to}],
    options:{duration:exit?(kind==='backdrop'?120:140):duration,easing,fill:'both'},
  };
}
export const appearancePlan=(kind,options)=>motionPlan(kind,options);

export function displacementPlan(y,{reduced=false,keyboard=false}={}){
  if(reduced||keyboard||!Number.isFinite(y)||Math.abs(y)<0.5)return null;
  return {keyframes:[{transform:`translateY(${y}px)`},{transform:'translateY(0px)'}],options:{duration:210,easing,fill:'both'}};
}

export function cancelMotion(element){
  const animation=running.get(element);
  if(animation){running.delete(element);active.delete(animation);animation.cancel();}
}
export function cancelAllMotion(){for(const animation of [...active])animation.cancel();active.clear();}

function play(element,plan){
  if(!element?.animate)return null;
  // Sample the visual pose BEFORE cancellation. Rapid reversal retargets the
  // current pose instead of queueing or restarting at the original keyframe.
  const previous=running.get(element);
  if(previous&&plan&&typeof getComputedStyle==='function'){
    const style=getComputedStyle(element),first={...plan.keyframes[0]};
    if('opacity' in first)first.opacity=style.opacity;
    if('transform' in first)first.transform=style.transform;
    plan={...plan,keyframes:[first,...plan.keyframes.slice(1)]};
  }
  cancelMotion(element);
  if(!plan)return null;
  const animation=element.animate(plan.keyframes,plan.options);
  running.set(element,animation);active.add(animation);
  const clean=()=>{active.delete(animation);if(running.get(element)===animation){running.delete(element);animation.cancel();}};
  animation.finished.then(clean,clean);
  return animation;
}

export function animateAppearance(element,kind,options={}){return play(element,motionPlan(kind,preferences(options)));}
export function animateExit(element,kind,options={}){return play(element,motionPlan(kind,{...preferences(options),phase:'exit'}));}
export function capturePositions(elements){return new Map([...elements].map(element=>[element,element.getBoundingClientRect().top]));}
export function animateLayout(before,options={}){
  // All reads precede writes. Cancel only after capturing in-flight positions.
  for(const element of before.keys())cancelMotion(element);
  const plans=[...before].filter(([element])=>element.isConnected).map(([element,top])=>[element,displacementPlan(top-element.getBoundingClientRect().top,preferences(options))]);
  for(const [element,plan] of plans)play(element,plan);
}
