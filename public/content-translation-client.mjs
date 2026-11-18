const endpoint='/api/translation-jobs';
const failure=(message,status)=>Object.assign(new Error(message),status?{status}:{});
const id=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value))throw failure('翻译任务标识无效。');return encodeURIComponent(value);};

/** Explicit requests only: construction, rendering and locale changes do no IO. */
export function createTranslationClient({getToken,fetchImpl=globalThis.fetch}={}){
 if(typeof getToken!=='function'||typeof fetchImpl!=='function')throw new TypeError('Translation client requires getToken and fetchImpl.');
 async function request(url,{method='GET',body}={}){
  const headers={'X-Workspace-Token':getToken()};if(method!=='GET')headers['Content-Type']='application/json';
  let response;try{response=await fetchImpl(url,{method,headers,credentials:'same-origin',...(body!==undefined?{body:JSON.stringify(body)}:{})});}catch{throw failure('翻译请求结果尚未确认，请刷新任务状态后重试。');}
  let value;try{value=await response.json();}catch{throw failure('翻译服务返回了无法识别的结果。',response.status);}
  if(!response.ok)throw failure(value?.error||`翻译请求失败（${response.status}）。`,response.status);return value;
 }
 return{
  create(input){return request(endpoint,{method:'POST',body:input});},
  get(jobId){return request(endpoint+'/'+id(jobId));},
  result(jobId){return request(endpoint+'/'+id(jobId)+'/result');},
  list(source){return request(endpoint+(source?'?source='+encodeURIComponent(JSON.stringify(source)):''));},
  async action(jobId,action){if(!['pause','resume','retry'].includes(action))throw failure('翻译操作 action 无效。');return request(endpoint+'/'+id(jobId)+'/'+action,{method:'POST',body:{}});},
 };
}
