export const DEFAULT_MODEL_BASE_URL='https://ark.cn-beijing.volces.com/api/plan/v3';
export const DEFAULT_MODEL_ID='glm-5.3-flash';

function baseUrl(value){
 const raw=String(value??'').trim();
 if(!/^https?:\/\//i.test(raw)||raw.length>4096||/[\s\p{Cc}?#\\]/u.test(raw)||/^https?:\/\/[^/]*@/i.test(raw))throw new Error('接口地址须为不含账号、密码、查询参数或片段的HTTP或HTTPS基础地址。');
 let url;try{url=new URL(raw);}catch{throw new Error('请输入有效的模型接口地址。');}
 if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password||url.search||url.hash)throw new Error('接口地址须为HTTP或HTTPS基础地址，不能包含账号、密码、查询参数或片段。');
 url.pathname=url.pathname.replace(/\/+$/,'').replace(/\/chat\/completions$/,'');
 return url.href.replace(/\/+$/,'');
}
function integer(value,min,max,message){
 const text=String(value??'').trim();
 if(!/^\d+$/.test(text)||!Number.isSafeInteger(Number(text))||Number(text)<min||Number(text)>max)throw new Error(message);
 return Number(text);
}
export function modelFormChanges(values){
 const model=String(values.model??'').trim();
 if(!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,159}$/u.test(model))throw new Error('模型名称须为1至160位字母、数字、点、下划线或连字符，并以字母或数字开头。');
 if(!['bearer','none'].includes(values.authMode))throw new Error('请选择有效的鉴权方式。');
 const reasoningEffort=values.reasoningEffort||null;
 if(reasoningEffort!==null&&!['low','high','max'].includes(reasoningEffort))throw new Error('请选择接口默认、低、高或最高推理档位。');
 const revisions={};for(const k of ['deploymentRevision','reasoningConfigVersion'])if(values[k]!==undefined){const v=String(values[k]).trim();if(v.length>160||/[\p{Cc}]/u.test(v))throw new Error('模型部署或推理配置版本无效。');revisions[k]=v;}
 const changes={...revisions,baseUrl:baseUrl(values.baseUrl),model,authMode:values.authMode,timeoutMs:integer(values.timeoutSeconds,1,290,'单次请求超时须为1至290秒的整数。')*1000,reasoningEffort,maxTokens:String(values.maxTokens??'').trim()===''?null:integer(values.maxTokens,16,65536,'最大输出须为16至65536的整数，或留空采用节点默认。')};
 if(values.authMode==='bearer'&&values.apiKey){
  if(values.apiKey.length<8||values.apiKey.length>4096||/[\s\p{Cc}]/u.test(values.apiKey))throw new Error('API Key须为8至4096位且不包含空白或控制字符。');
  changes.apiKey=values.apiKey;
 }
 return changes;
}
export function modelFormIsDirty(values,config={}){
 const changes=modelFormChanges(values);
 if(changes.apiKey)return true;
 const saved={...Object.fromEntries(['deploymentRevision','reasoningConfigVersion'].filter(k=>config[k]).map(k=>[k,config[k]])),baseUrl:baseUrl(config.baseUrl||DEFAULT_MODEL_BASE_URL),model:config.model||DEFAULT_MODEL_ID,authMode:config.authMode||'bearer',timeoutMs:config.timeoutMs??120000,reasoningEffort:config.reasoningEffort??null,maxTokens:config.maxTokens??null};
 return [...new Set([...Object.keys(saved),...Object.keys(changes)])].filter(k=>k!=='apiKey').some(key=>(changes[key]??'')!==(saved[key]??''));
}
export function modelRequestTimeLimit(config={}){
 const timeout=Number.isInteger(config.timeoutMs)&&config.timeoutMs>=1000&&config.timeoutMs<=290000?config.timeoutMs:120000;
 return timeout+10000;
}
export async function submitModelSettings(action,values,config,workspace){
 const changes=modelFormChanges(values);
 if(action==='model-save')return {config:await workspace.saveModelConfig(changes),input:changes};
 if(action!=='model-test')throw new Error('模型设置操作无效。');
 if(modelFormIsDirty(values,config))throw new Error('请先保存当前设置，再测试连接。');
 return {result:await workspace.testModel(),input:changes};
}
