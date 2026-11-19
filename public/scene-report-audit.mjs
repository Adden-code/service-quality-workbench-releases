// Offline hashes use the same sorted-key representation as saved report jobs.
export const canonicalReportValue=value=>Array.isArray(value)?'['+value.map(canonicalReportValue).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalReportValue(value[key])).join(',')+'}':JSON.stringify(value);
const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
const rotate=(v,n)=>(v>>>n)|(v<<(32-n));
export function reportSha256(text){
 const bytes=new TextEncoder().encode(text),padded=new Uint8Array(Math.ceil((bytes.length+9)/64)*64),view=new DataView(padded.buffer);padded.set(bytes);padded[bytes.length]=128;view.setUint32(padded.length-8,Math.floor(bytes.length/0x20000000));view.setUint32(padded.length-4,(bytes.length*8)>>>0);
 const state=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],words=new Uint32Array(64);
 for(let offset=0;offset<padded.length;offset+=64){
  for(let i=0;i<16;i++)words[i]=view.getUint32(offset+i*4);
  for(let i=16;i<64;i++){const a=words[i-15],b=words[i-2];words[i]=(words[i-16]+(rotate(a,7)^rotate(a,18)^(a>>>3))+words[i-7]+(rotate(b,17)^rotate(b,19)^(b>>>10)))>>>0;}
  let [a,b,c,d,e,f,g,h]=state;
  for(let i=0;i<64;i++){const first=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+K[i]+words[i])>>>0,second=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;h=g;g=f;f=e;e=(d+first)>>>0;d=c;c=b;b=a;a=(first+second)>>>0;}
  [a,b,c,d,e,f,g,h].forEach((value,i)=>state[i]=(state[i]+value)>>>0);
 }
 return state.map(v=>v.toString(16).padStart(8,'0')).join('');
}
export function sceneReportIdentity(snapshot){
 const {createdAt,...delivery}=snapshot,execution=snapshot.executionSnapshot;
 return{contract:execution.contract||`scene-contract.schema-${execution.schemaVersion||1}`,configuration:`${execution.configuration.id||'configuration'}@${execution.configuration.version||1}`,template:`${execution.template.id||'template'}@${execution.template.version||1}`,contentHash:reportSha256(canonicalReportValue(execution)),snapshotFingerprint:reportSha256(canonicalReportValue(delivery))};
}
// Excel cells are limited to 32767 UTF-16 units. Keep each chunk below this and
// avoid cutting a surrogate pair; reconstruct by ascending part number.
function chunks(text){const parts=[];for(let offset=0;offset<text.length;){let end=Math.min(offset+24000,text.length);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;parts.push(text.slice(offset,end));offset=end;}return parts;}
export function sceneSnapshotAuditSheet(snapshot,enrichment={}){
 const rows=[];
 for(const [kind,value] of [['deliverySnapshot',snapshot],['enrichment',enrichment]]){const json=JSON.stringify(value),hash=reportSha256(json),parts=chunks(json);parts.forEach((part,index)=>rows.push([kind,index+1,parts.length,hash,part]));}
 return{name:'冻结快照审计',headers:['内容类型','分块序号','总块数','内容SHA-256','JSON分块（按序拼接）'],rows};
}
export const SCENE_REPORT_WARNING_BYTES=2*1024*1024;
export function sceneReportSizeWarning(html,language='zh'){
 const bytes=new TextEncoder().encode(html).length;if(bytes<=SCENE_REPORT_WARNING_BYTES)return null;
 return{code:'REPORT_HTML_LARGE',bytes,limitBytes:SCENE_REPORT_WARNING_BYTES,message:language==='en'?`Report HTML exceeds 2 MB (${(bytes/1024/1024).toFixed(2)} MB). Opening or printing may be slow; full audit data remains in the accompanying Excel workbook.`:`报告 HTML 超过 2 MB（${(bytes/1024/1024).toFixed(2)} MB），打开或打印可能较慢；完整审计数据仍保留在配套 Excel 中。`};
}
