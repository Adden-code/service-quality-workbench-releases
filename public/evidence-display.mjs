const array=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'?value:'';
const badStatus=value=>typeof value==='string'&&/unverified|invalid|ambiguous|missing|failed/.test(value);

/** Source fields, not model role labels, determine attribution. Offsets are UTF-16. */
function sourceFields(record){
 const raw=record?.raw22||record?.ecommerce?.raw;
 if(raw){let turn=0;return[['comment',8,'评价','Comment'],['reply',9,'回复','Reply']].map(([key,index,label,englishLabel])=>({key,text:text(raw[index]),label,englishLabel,turnId:text(raw[index]).trim()?++turn:null}));}
 if(record?.inputMode==='raw-transcript-v1'||record?.rawTranscript)return[{key:'conversation',text:text(record.rawTranscript?.text||record.conversation),label:'原文（角色未核实）',englishLabel:'Source (roles unverified)'}];
 if(array(record?.turns).length)return record.turns.map(turn=>({key:`turn:${turn.id}`,turnId:turn.id,text:text(turn.text),label:text(turn.role)||'原文（角色未核实）',englishLabel:({'客户':'Customer','用户':'Customer','客服':'Agent','坐席':'Agent'})[turn.role]||'Source (role unverified)'}));
 return[{key:'conversation',text:text(record?.conversation),label:'原文（角色未核实）',englishLabel:'Source (roles unverified)'}];
}
function locate(fields,quote){
 let candidates=fields;const suppliedField=quote.sourceField??quote.field;
 if(suppliedField!==undefined)candidates=candidates.filter(field=>field.key===suppliedField);
 const turnId=quote.turnId??(/^turn[-:]?(.+)$/.exec(String(quote.blockId||''))?.[1]);
 if(turnId!==undefined)candidates=candidates.filter(field=>String(field.turnId)===String(turnId));
 if(quote.blockId==='comment'||quote.blockId==='reply')candidates=candidates.filter(field=>field.key===quote.blockId);
 if(quote.blockId!==undefined&&turnId===undefined&&!['comment','reply','raw','conversation'].includes(quote.blockId))candidates=[];
 const value=text(quote.quote),hits=[];
 for(const field of candidates){
  if(Number.isSafeInteger(quote.start)&&Number.isSafeInteger(quote.end)&&quote.start>=0&&quote.end>quote.start&&field.text.slice(quote.start,quote.end)===value){hits.push({field,start:quote.start,end:quote.end});continue;}
  for(let offset=0;value&&offset<=field.text.length-value.length;){const start=field.text.indexOf(value,offset);if(start<0)break;hits.push({field,start,end:start+value.length});offset=start+1;if(hits.length>1)break;}
 }
 return hits.length===1?hits[0]:null;
}

/** Display-only grouping. Every original entry and covered rule remains available. */
export function groupEvidenceQuotes(record,results=[]){
 const fields=sourceFields(record),items=[];
 for(const result of array(results)){
  const ruleId=result.ruleId||result.id||'',evidence=result.ai||result;
  let quotes=array(evidence.evidenceQuotes);
  if(!quotes.length&&array(evidence.evidence).every(Number.isInteger))quotes=array(evidence.evidence).flatMap(id=>{const field=fields.find(field=>String(field.turnId)===String(id));return field?.text?[{turnId:id,quote:field.text,start:0,end:field.text.length}]:[];});
  for(const original of quotes){const quote=typeof original==='string'?{quote:original}:original;if(!text(quote?.quote).trim())continue;
   const located=badStatus(evidence.rawValidation?.status)||badStatus(evidence.evidenceValidation?.status)?null:locate(fields,quote);
   items.push({fieldKey:located?.field.key??null,label:located?.field.label||'引文（来源未核实）',englishLabel:located?.field.englishLabel||'Quote (source unverified)',quote:quote.quote,start:located?.start??null,end:located?.end??null,status:located?'verified':'unverified',ruleIds:ruleId?[ruleId]:[],evidenceOriginals:[{ruleId,evidence:structuredClone(original)}]});
  }
 }
 const grouped=[];
 const claim=group=>{const quote=group.evidenceOriginals[0]?.evidence;return JSON.stringify([quote?.sourceField??null,quote?.field??null,quote?.blockId??null,quote?.turnId??null]);};
 for(const item of items){if(item.status!=='verified'){const duplicate=grouped.find(group=>group.status==='unverified'&&group.quote===item.quote&&claim(group)===claim(item));if(duplicate){duplicate.ruleIds=[...new Set([...duplicate.ruleIds,...item.ruleIds])];duplicate.evidenceOriginals.push(...item.evidenceOriginals);}else grouped.push(item);continue;}const overlaps=grouped.filter(group=>group.status==='verified'&&group.fieldKey===item.fieldKey&&group.start<item.end&&item.start<group.end);
  if(!overlaps.length){grouped.push(item);continue;}
  const first=overlaps[0];first.start=Math.min(item.start,...overlaps.map(group=>group.start));first.end=Math.max(item.end,...overlaps.map(group=>group.end));first.quote=fields.find(field=>field.key===first.fieldKey).text.slice(first.start,first.end);first.ruleIds=[...new Set([...overlaps.flatMap(group=>group.ruleIds),...item.ruleIds])];first.evidenceOriginals=[...overlaps.flatMap(group=>group.evidenceOriginals),...item.evidenceOriginals];for(const group of overlaps.slice(1))grouped.splice(grouped.indexOf(group),1);
 }
 return grouped;
}

export function evidenceDisplayText(record,results,{language='zh',ruleLabel=id=>id,coverage=true}={}){
 return groupEvidenceQuotes(record,results).map((group,index)=>`${coverage?`${language==='en'?'Quote':'引文'} ${index+1} · `:''}${language==='en'?group.englishLabel:group.label}：${group.quote}${coverage&&group.ruleIds.length?`\n${language==='en'?'Covered rules':'覆盖规则'}：${group.ruleIds.map(ruleLabel).join('、')}`:''}`).join('\n\n');
}
