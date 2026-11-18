import {validateComparisonBlock} from './ecommerce-comparison.mjs';

const MAX_CONTENT_CHARS=2*1024*1024,MAX_CANDIDATES=16,MAX_DEPTH=64;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const diagnosticCodes=new Set(['invalid_output','wire_limit','missing_json_object','multiple_json_objects','malformed_json','invalid_structure','invalid_checked_ids','missing_checked_ids','unknown_checked_ids','invalid_pairs','conflicting_pairs']);
const countKeys=['expectedCheckedIds','receivedCheckedIds','uniqueCheckedIds','duplicateCheckedIds','missingCheckedIds','unknownCheckedIds','receivedPairs','normalizedPairs','candidateObjects'];

/** Only fixed codes, counts and IDs from the frozen block may enter a retry. */
export function comparisonRetryFeedback(diagnostic,block){
 const codes=[...new Set(Array.isArray(diagnostic?.codes)?diagnostic.codes.filter(code=>diagnosticCodes.has(code)):[])].slice(0,8);
 const counts=Object.fromEntries(countKeys.filter(key=>Number.isSafeInteger(diagnostic?.counts?.[key])&&diagnostic.counts[key]>=0&&diagnostic.counts[key]<=1000000).map(key=>[key,diagnostic.counts[key]]));
 const missing=new Set(Array.isArray(diagnostic?.missingRepresentativeIds)?diagnostic.missingRepresentativeIds:[]);
 return{codes:codes.length?codes:['invalid_output'],counts,missingRepresentativeIds:(block?.representativeIds||[]).filter(id=>missing.has(id)).slice(0,40)};
}

/** Bounded wire tolerance only. Persisted comparison validation stays exact. */
export function parseComparisonWire(content,block,plan,{allowPartial=false}={}){
 const expected=new Set(block.representativeIds),counts={expectedCheckedIds:expected.size,receivedCheckedIds:0,uniqueCheckedIds:0,duplicateCheckedIds:0,missingCheckedIds:expected.size,unknownCheckedIds:0,receivedPairs:0,normalizedPairs:0,candidateObjects:0};
 let missingRepresentativeIds=[...expected];
 const failure=(...codes)=>Object.assign(new Error('Comparison wire output is invalid.'),{code:'INVALID_COMPARISON',diagnostic:{codes,counts:{...counts},missingRepresentativeIds:[...missingRepresentativeIds]}});
 if(typeof content!=='string'||!content.trim())throw failure('missing_json_object');
 if(content.length>MAX_CONTENT_CHARS)throw failure('wire_limit');
 const candidates=[];let start=-1,stack=[],keySets=[],quoted=false,escaped=false,quoteStart=-1,regions=0;
 for(let index=0;index<content.length;index++){
  const character=content[index];
  if(start<0){
   if(character==='{'||character==='['){if(++regions>MAX_CANDIDATES)throw failure('wire_limit');start=index;stack=[character];keySets=[character==='{'?new Set():null];quoted=false;escaped=false;}
   continue;
  }
  if(quoted){
   if(escaped)escaped=false;else if(character==='\\')escaped=true;else if(character==='"'){
    quoted=false;let next=index+1;while(next<content.length&&/\s/.test(content[next]))next++;
    if(content[next]===':'&&stack.at(-1)==='{'){
     let key;try{key=JSON.parse(content.slice(quoteStart,index+1));}catch{throw failure('malformed_json');}
     const keys=keySets.at(-1);if(keys.has(key))throw failure('malformed_json');keys.add(key);
    }
   }continue;
  }
  if(character==='"'){quoted=true;quoteStart=index;continue;}
  if(character==='{'||character==='['){stack.push(character);keySets.push(character==='{'?new Set():null);if(stack.length>MAX_DEPTH)throw failure('wire_limit');continue;}
  if(character!=='}'&&character!==']')continue;
  if(stack.at(-1)!==(character==='}'?'{':'['))throw failure('malformed_json');
  stack.pop();keySets.pop();if(stack.length)continue;
  const source=content.slice(start,index+1);start=-1;
  let value;try{value=JSON.parse(source);}catch{
   // Skip ordinary prose/Markdown labels as complete regions. Never repair a
   // JSON-looking container or harvest any child object from that container.
   if(/^\{\s*["']/.test(source)||/^\[\s*(?:[\[{"'\d-]|true\b|false\b|null\b)/.test(source))throw failure('malformed_json');continue;
  }
  if(Array.isArray(value))throw failure('invalid_structure');
  candidates.push(value);counts.candidateObjects=candidates.length;
 }
 if(start>=0)throw failure('malformed_json');
 if(candidates.length!==1)throw failure(candidates.length?'multiple_json_objects':'missing_json_object');
 const output=candidates[0];if(!object(output))throw failure('invalid_structure');
 const checked=output.checkedIds;if(!Array.isArray(checked))throw failure('invalid_checked_ids');
 counts.receivedCheckedIds=checked.length;
 if(checked.length>Math.max(128,expected.size*8))throw failure('wire_limit');
 const trimmed=checked.map(id=>typeof id==='string'?id.trim():id),unique=[...new Set(trimmed)];
 counts.uniqueCheckedIds=unique.length;counts.duplicateCheckedIds=checked.length-unique.length;
 missingRepresentativeIds=[...expected].filter(id=>!unique.includes(id));counts.missingCheckedIds=missingRepresentativeIds.length;counts.unknownCheckedIds=unique.filter(id=>!expected.has(id)).length;
 const coverageCodes=[];if(counts.missingCheckedIds)coverageCodes.push('missing_checked_ids');if(counts.unknownCheckedIds)coverageCodes.push('unknown_checked_ids');if(coverageCodes.length&&!allowPartial)throw failure(...coverageCodes);
 let partial=coverageCodes.length>0;
 if(!Array.isArray(output.similarPairs))throw failure('invalid_pairs');
 counts.receivedPairs=output.similarPairs.length;
 const limit=block.kind==='within'?block.leftIds.length*(block.leftIds.length-1)/2:block.leftIds.length*block.rightIds.length;
 if(output.similarPairs.length>Math.max(64,limit*4))throw failure('wire_limit');
 const pairs=new Map();
 for(const raw of output.similarPairs){
  const pair=object(raw)?{...raw,leftId:typeof raw.leftId==='string'?raw.leftId.trim():raw.leftId,rightId:typeof raw.rightId==='string'?raw.rightId.trim():raw.rightId}:raw;
  let valid;try{valid=validateComparisonBlock({checkedIds:block.representativeIds,similarPairs:[pair]},block,plan).similarPairs[0];}catch{if(allowPartial){partial=true;continue;}throw failure('invalid_pairs');}
  const key=JSON.stringify([valid.leftId,valid.rightId].sort()),previous=pairs.get(key);
  if(previous&&previous.reason!==valid.reason){if(!allowPartial)throw failure('conflicting_pairs');partial=true;continue;}
  if(!previous)pairs.set(key,valid);
 }
 counts.normalizedPairs=pairs.size;
 if(partial)return{checkedIds:unique.filter(id=>expected.has(id)),similarPairs:[...pairs.values()],complete:false,diagnostic:comparisonRetryFeedback({codes:coverageCodes.length?coverageCodes:['invalid_pairs'],counts,missingRepresentativeIds},block)};
 // This final validator remains the authority for exact coverage and grounding.
 try{return validateComparisonBlock({checkedIds:unique,similarPairs:[...pairs.values()]},block,plan);}catch{throw failure('invalid_pairs');}
}
