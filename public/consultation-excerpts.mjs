const allowedRole=role=>['客户','用户','customer','user','客服','坐席','agent','assistant'].includes(String(role??'').toLowerCase());
const customerRole=role=>['客户','用户','customer','user'].includes(String(role??'').toLowerCase());

export function selectConsultationCaseExcerpts(record){
  if(record?.inputMode==='raw-transcript-v1'){
    const text=record.rawTranscript?.text??record.conversation??'',seen=new Set(),quotes=[];
    for(const result of record.final||[])if(result.verdict==='Fail')for(const evidence of result.evidenceQuotes||[]){
      if(typeof evidence.quote!=='string'||!evidence.quote.trim()||!text.includes(evidence.quote)||seen.has(evidence.quote))continue;
      seen.add(evidence.quote);quotes.push({id:`raw-q-${quotes.length+1}`,role:'角色未核验',text:evidence.quote,basis:'evidence',matches:structuredClone(evidence.matches||[]),raw:true});
    }
    return quotes.slice(0,6);
  }
  const seen=new Set(),turns=(Array.isArray(record?.turns)?record.turns:[]).filter(turn=>{
    if(!allowedRole(turn?.role)||typeof turn.text!=='string'||!turn.text.trim()||turn.id===undefined||turn.id===null||seen.has(String(turn.id)))return false;
    seen.add(String(turn.id));return true;
  });
  const refs=new Set((Array.isArray(record?.final)?record.final:[]).filter(item=>item.verdict==='Fail').flatMap(item=>Array.isArray(item.evidence)?item.evidence:[]).map(value=>String(value?.turnId??value)));
  const evidence=turns.map((turn,index)=>refs.has(String(turn.id))?index:-1).filter(index=>index>=0),selected=new Set(evidence.slice(0,6));
  if(selected.size){
    for(const index of evidence)for(const neighbor of [index-1,index+1])if(selected.size<6&&neighbor>=0&&neighbor<turns.length)selected.add(neighbor);
  }else{
    const customer=turns.findIndex(turn=>customerRole(turn.role)),agent=turns.findIndex(turn=>!customerRole(turn.role));
    if(customer>=0)selected.add(customer);if(agent>=0)selected.add(agent);
  }
  return[...selected].sort((a,b)=>a-b).map(index=>({id:turns[index].id,role:turns[index].role,text:turns[index].text,basis:refs.has(String(turns[index].id))?'evidence':'context'}));
}
