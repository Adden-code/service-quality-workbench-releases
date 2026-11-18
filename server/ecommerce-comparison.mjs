import {isBusinessEcommerceBasis,businessDuplicateGroups} from '../public/ecommerce-business-profile.mjs';
import {createHash} from 'node:crypto';
import {validateEcommerceRecord} from '../public/ecommerce-schema.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytes=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{const error=new Error(message);error.code='INVALID_COMPARISON';throw error;};
const pairKey=(a,b)=>JSON.stringify([a,b].sort());
const wire=rep=>({id:rep.id,reply:rep.reply});

/** All unordered reply pairs are scheduled, including pairs crossing chunks.
 * Only reply text, administrator and source coordinates influence this plan.
 * Human labels and comment classification never enter a comparison request.
 */
export function planEcommerceComparisons(sessions,{maxRecords=20,maxWorkBytes=64000,maxBlocks=4096,basis}={}){
  if(!Array.isArray(sessions)||!sessions.length||sessions.length>500)fail('比较记录范围须为1至500条。');
  if(!Number.isSafeInteger(maxRecords)||maxRecords<2||maxRecords>40||!Number.isSafeInteger(maxWorkBytes)||maxWorkBytes<128||maxWorkBytes>800000||!Number.isSafeInteger(maxBlocks)||maxBlocks<1||maxBlocks>4096)fail('比较调度设置超出允许范围。');
  if(isBusinessEcommerceBasis(basis)){const exactGroups=businessDuplicateGroups(sessions,basis);return {version:2,executionProfile:'ec-business-v1',fingerprint:hash(['ec-business-pairs-v1',basis.businessProfile.similarity,sessions.map(s=>[s.id,s.ecommerce.fileSha256,s.ecommerce.sheet,s.ecommerce.row,s.ecommerce.raw[9]])]),representatives:[],blocks:[],exactGroups,totalPairs:sessions.length*(sessions.length-1)/2};}
  const ids=new Set(),coordinates=new Set(),representatives=[],byText=new Map(),source=[];
  for(const session of sessions){
    if(!object(session)||typeof session.id!=='string'||!session.id||session.id.length>256||ids.has(session.id))fail('比较来源记录标识无效或重复。');
    validateEcommerceRecord(session.ecommerce);
    const r=session.ecommerce,coordinate=JSON.stringify([r.fileSha256,r.sheet,r.row]);
    if(coordinates.has(coordinate))fail('重复物理来源行不能用不同标识凑足记录。');
    coordinates.add(coordinate);ids.add(session.id);
    const agent=r.raw[11].trim(),reply=r.raw[9].trim();
    source.push([session.id,r.fileSha256,r.sheet,r.row,agent,reply]);
    if(!agent||!reply)continue;
    const key=JSON.stringify([agent,reply]);
    if(!byText.has(key)){
      const rep={id:'REP-'+hash([agent,reply]).slice(0,32),sessionIds:[],agent,reply};
      byText.set(key,rep);representatives.push(rep);
    }
    byText.get(key).sessionIds.push(session.id);
  }
  representatives.sort((a,b)=>a.id.localeCompare(b.id));
  for(const rep of representatives)rep.sessionIds.sort();
  const exactGroups=representatives.filter(rep=>rep.sessionIds.length>=3).map(rep=>({kind:'exact',sessionIds:[...rep.sessionIds],reason:'同一管理员在本次导入业务批次的至少3个不同来源行使用相同回复（忽略首尾空白）。'}));
  const administrators=new Map();
  for(const rep of representatives){if(!administrators.has(rep.agent))administrators.set(rep.agent,[]);administrators.get(rep.agent).push(rep);}
  const blocks=[];let totalPairs=0;
  const add=(left,right,kind)=>{
    const count=kind==='within'?left.length*(left.length-1)/2:left.length*right.length;if(!count)return;
    if(blocks.length>=maxBlocks){const error=new Error('同客服回复比较工作量超过本轮安全调度上限，请减小导入业务范围或调整执行计划；系统未将遗漏比较视为通过。');error.code='INPUT_TOO_LARGE';throw error;}
    const reps=kind==='within'?left:[...left,...right],leftIds=left.map(r=>r.id),rightIds=kind==='within'?[]:right.map(r=>r.id);
    const estimatedBytes=bytes({kind,leftIds,rightIds,replies:reps.map(wire)});
    blocks.push({id:'CMP-'+hash([kind,leftIds,rightIds]).slice(0,32),kind,leftIds,rightIds,representativeIds:reps.map(r=>r.id),estimatedBytes,oversized:estimatedBytes>maxWorkBytes});totalPairs+=count;
  };
  for(const replies of administrators.values()){
    if(replies.length<2)continue;
    const chunks=[];let current=[];const perChunk=Math.max(1,Math.floor(maxRecords/2));
    for(const rep of replies){
      // Reserve half the request budget for each side of a cross-chunk block.
      if(current.length&&(current.length>=perChunk||bytes([...current,rep].map(wire))>Math.floor(maxWorkBytes/2))){chunks.push(current);current=[];}
      current.push(rep);
    }
    if(current.length)chunks.push(current);
    for(let i=0;i<chunks.length;i++){
      add(chunks[i],[],'within');
      for(let j=i+1;j<chunks.length;j++)add(chunks[i],chunks[j],'cross');
    }
  }
  return{version:1,fingerprint:hash(['ec-full-pair-v1',source.sort((a,b)=>a[0].localeCompare(b[0])),maxRecords,maxWorkBytes]),representatives,blocks,exactGroups,totalPairs};
}

/** Validate coverage and every positive edge before it can become evidence. */
export function validateComparisonBlock(output,block,plan){
  if(!object(output)||!object(block)||!Array.isArray(block.representativeIds)||!Array.isArray(plan?.representatives))fail('比较输出或计划结构无效。');
  const expected=new Set(block.representativeIds),checked=output.checkedIds;
  if(!Array.isArray(checked)||checked.length!==expected.size||new Set(checked).size!==expected.size||checked.some(id=>!expected.has(id)))fail('比较输出必须精确覆盖本块的全部回复代表。');
  const left=new Set(block.leftIds),right=new Set(block.rightIds),reps=new Map(plan.representatives.map(rep=>[rep.id,rep]));
  const limit=block.kind==='within'?left.size*(left.size-1)/2:left.size*right.size;
  if(!Array.isArray(output.similarPairs)||output.similarPairs.length>limit)fail('相似比较配对结构或数量无效。');
  const seen=new Set(),similarPairs=[];
  for(const pair of output.similarPairs){
    if(!object(pair)||typeof pair.leftId!=='string'||typeof pair.rightId!=='string'||pair.leftId===pair.rightId||typeof pair.reason!=='string'||!pair.reason.trim()||pair.reason.length>2000)fail('相似比较配对和理由无效。');
    const a=reps.get(pair.leftId),b=reps.get(pair.rightId);
    const allowed=block.kind==='within'?left.has(pair.leftId)&&left.has(pair.rightId):(left.has(pair.leftId)&&right.has(pair.rightId))||(right.has(pair.leftId)&&left.has(pair.rightId));
    if(!allowed||!a||!b||a.agent!==b.agent||!a.agent)fail('相似配对必须来自本比较块的同一管理员。');
    const key=pairKey(pair.leftId,pair.rightId);if(seen.has(key))fail('相似比较配对重复。');seen.add(key);
    similarPairs.push({leftId:pair.leftId,rightId:pair.rightId,reason:pair.reason.trim()});
  }
  return{similarPairs,checkedIds:[...checked]};
}

/** A triangle, or a weighted pair containing two exact source rows, is needed.
 * An A~B~C chain alone never establishes A~C or a valid three-row group.
 */
export function mergeComparisonGroups(plan,completedBlocks=[]){
  if(!object(plan)||!Array.isArray(plan.blocks)||!Array.isArray(plan.representatives)||!Array.isArray(completedBlocks))fail('比较合并输入无效。');
  const scheduled=new Map(plan.blocks.map(block=>[block.id,block])),finished=new Set(),edges=new Map(),reasons=new Map();
  for(const entry of completedBlocks){
    if(!object(entry)||typeof entry.id!=='string'||!scheduled.has(entry.id))fail('比较缓存含未知块。');
    if(entry.status!=='completed'&&!entry.partialResult)continue;
    if(finished.has(entry.id))fail('比较完成块重复。');
    const validated=validateComparisonBlock(entry.status==='completed'?(entry.result??entry):{...entry.partialResult,checkedIds:scheduled.get(entry.id).representativeIds},scheduled.get(entry.id),plan);if(entry.status==='completed')finished.add(entry.id);
    for(const pair of validated.similarPairs){
      if(!edges.has(pair.leftId))edges.set(pair.leftId,new Set());if(!edges.has(pair.rightId))edges.set(pair.rightId,new Set());
      edges.get(pair.leftId).add(pair.rightId);edges.get(pair.rightId).add(pair.leftId);reasons.set(pairKey(pair.leftId,pair.rightId),pair.reason);
    }
  }
  const groups=structuredClone(plan.exactGroups),covered=new Set(groups.flatMap(group=>group.sessionIds)),reps=new Map(plan.representatives.map(rep=>[rep.id,rep])),groupKeys=new Set(groups.map(group=>JSON.stringify([...group.sessionIds].sort())));
  const add=(rep,others)=>{
    const sessionIds=[...rep.sessionIds];
    for(const other of others)sessionIds.push(...other.sessionIds.slice(0,Math.max(0,3-sessionIds.length)));
    if(sessionIds.length<3)return;
    const key=JSON.stringify([...sessionIds].sort());
    if(!groupKeys.has(key)){
      const proof=[rep,...others].flatMap((a,i,list)=>list.slice(i+1).map(b=>reasons.get(pairKey(a.id,b.id)))).filter(Boolean);
      groups.push({kind:'similar',sessionIds,reason:('同一管理员的不同来源回复经分块两两核验为高度相似；'+[...new Set(proof)].join('；')).slice(0,2000)});groupKeys.add(key);
    }
    for(const id of sessionIds)covered.add(id);
  };
  for(const rep of plan.representatives){
    if(rep.sessionIds.every(id=>covered.has(id)))continue;
    const neighbors=[...(edges.get(rep.id)||[])].map(id=>reps.get(id));
    const weighted=neighbors.find(other=>rep.sessionIds.length+other.sessionIds.length>=3);
    if(weighted){add(rep,[weighted]);continue;}
    let found=false;
    for(let i=0;i<neighbors.length&&!found;i++)for(let j=i+1;j<neighbors.length;j++){
      if(edges.get(neighbors[i].id)?.has(neighbors[j].id)){add(rep,[neighbors[i],neighbors[j]]);found=true;break;}
    }
  }
  const pendingBySession={};for(const block of plan.blocks.filter(b=>!finished.has(b.id)))for(const repId of block.representativeIds)for(const id of reps.get(repId)?.sessionIds||[])(pendingBySession[id]??=[]).push(block.id);
  return{groups,complete:finished.size===scheduled.size,pendingBySession};
}
