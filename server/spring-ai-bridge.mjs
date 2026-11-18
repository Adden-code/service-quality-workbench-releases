import {modelConfigSnapshot} from './model-config.mjs';
export function createSpringAiFetch({bridgeToken,fetchImpl=fetch,workerPort=4192}={}){
  if(typeof bridgeToken!=='string'||!/^[a-zA-Z0-9._~-]{32,256}$/.test(bridgeToken))throw new TypeError('Spring AI执行服务缺少有效的本机连接令牌。');
  const rawPort=typeof workerPort==='number'?String(workerPort):workerPort;
  if(typeof rawPort!=='string'||! /^[1-9]\d*$/.test(rawPort)||Number(rawPort)<1024||Number(rawPort)>65535)throw new TypeError('Spring AI本机端口须为1024至65535之间的整数。');
  const transport=async(url,options={})=>{
    const provider=modelConfigSnapshot(options.providerConfig);
    if(url!==provider.baseUrl+'/chat/completions'||options.method!=='POST')throw new Error('Spring AI仅允许当前配置的质检模型请求。');
    const headers=new Headers(options.headers);
    const authorization=headers.get('authorization');
    if(provider.authMode==='bearer'&&!authorization?.startsWith('Bearer '))throw new Error('Spring AI模型请求缺少认证。');
    return fetchImpl(`http://127.0.0.1:${rawPort}/internal/chat/completions`,{method:'POST',headers:{...(provider.authMode==='bearer'?{Authorization:authorization}:{}),'Content-Type':'application/json','X-Bridge-Token':bridgeToken,'X-Provider-Base-Url':provider.baseUrl,'X-Provider-Auth-Mode':provider.authMode,'X-Provider-Timeout-Ms':String(provider.timeoutMs)},body:options.body,signal:options.signal,redirect:'error'});
  };
  transport.engine='spring-ai';return transport;
}
