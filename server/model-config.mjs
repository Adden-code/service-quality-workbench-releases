import {mkdir,readFile,open,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

export const ARK_BASE_URL='https://ark.cn-beijing.volces.com/api/plan/v3';
export const DEFAULT_MODEL='glm-5.3-flash';
const PROVIDER='volcengine-ark';
export class ModelConfigError extends Error {
  constructor(code,message,status=400){super(message);this.name='ModelConfigError';this.code=code;this.status=status;}
}
const invalid=message=>{throw new ModelConfigError('INVALID_CONFIG',message);};
const validModel=value=>typeof value==='string'&&[...value].length<=160&&/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(value);
const validKey=value=>typeof value==='string'&&value.length>=8&&value.length<=4096&&!/[\s\p{Cc}]/u.test(value);
export const MODEL_CONFIG_FIELDS=Object.freeze(['baseUrl','model','authMode','timeoutMs','reasoningEffort','maxTokens','deploymentRevision','reasoningConfigVersion']);
export function canonicalModelBaseUrl(value) {
  if(typeof value!=='string'||!/^https?:\/\//i.test(value)||value.length>4096||/[\s\p{Cc}?#\\]/u.test(value)||/^https?:\/\/[^/]*@/i.test(value))invalid('模型地址须为不含账号、查询参数或片段的 HTTP/HTTPS 基础地址。');
  let url;try{url=new URL(value);}catch{invalid('模型地址须为有效的 HTTP/HTTPS 基础地址。');}
  if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password)invalid('模型地址须为不含账号的 HTTP/HTTPS 基础地址。');
  url.pathname=url.pathname.replace(/\/+$/,'').replace(/\/chat\/completions$/,'');
  return url.toString().replace(/\/+$/,'');
}
/** Exact, deterministic non-secret contract used to freeze and identify runs. */
export function modelConfigSnapshot(config={}) {
  if(!config||typeof config!=='object'||Array.isArray(config))invalid('模型配置无效。');
  const value={baseUrl:canonicalModelBaseUrl(config.baseUrl===undefined?ARK_BASE_URL:config.baseUrl),model:config.model===undefined?DEFAULT_MODEL:config.model,authMode:config.authMode===undefined?'bearer':config.authMode,timeoutMs:config.timeoutMs===undefined?120000:config.timeoutMs,reasoningEffort:config.reasoningEffort??null,maxTokens:config.maxTokens??null};
  if(!validModel(value.model))invalid('模型名称须为 1 至 160 个字符，以字母或数字开头，仅包含字母、数字、点、下划线或连字符。');
  if(!['bearer','none'].includes(value.authMode))invalid('模型认证方式无效。');
  if(!Number.isSafeInteger(value.timeoutMs)||value.timeoutMs<1000||value.timeoutMs>290000)invalid('模型超时须为 1000 至 290000 毫秒的整数。');
  if(value.reasoningEffort!==null&&!['low','high','max'].includes(value.reasoningEffort))invalid('模型推理强度无效。');
  if(value.maxTokens!==null&&(!Number.isSafeInteger(value.maxTokens)||value.maxTokens<16||value.maxTokens>65536))invalid('模型输出预算须为 16 至 65536 的整数，或留空采用节点默认值。');
  for(const k of ['deploymentRevision','reasoningConfigVersion']){const v=config[k];if(v===undefined||v===null||v==='')continue;if(typeof v!=='string'||!v.trim()||v.length>160||/[\p{Cc}]/u.test(v))invalid('模型部署或推理配置版本无效。');value[k]=v.trim();}
  return value;
}
export const modelConfigFingerprint=config=>createHash('sha256').update(JSON.stringify(modelConfigSnapshot(config)),'utf8').digest('hex');
const storageError=()=>new ModelConfigError('CONFIG_STORAGE','模型配置未能安全读取或保存，请检查本地配置文件权限。',500);
const cryptoError=()=>new ModelConfigError('SECRET_PROTECTION','无法使用当前 Windows 用户安全保护密钥。非 Windows 环境请使用 ARK_API_KEY 环境变量。',500);

// The fixed script receives the secret exclusively through stdin. DPAPI is bound
// to the current Windows user; there is deliberately no plaintext fallback.
const PROTECT_SCRIPT="$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Text.Encoding]::UTF8.GetBytes($v); $p=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($p))";
const UNPROTECT_SCRIPT="$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($v); $p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($p))";
function dpapi(value,unprotect=false) {
  if(process.platform!=='win32')return Promise.reject(cryptoError());
  return new Promise((resolve,reject)=>{
    let child,done=false,output='';
    const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);error?reject(cryptoError()):resolve(result);};
    const timer=setTimeout(()=>{child?.kill();finish(true);},15000);
    try{child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',unprotect?UNPROTECT_SCRIPT:PROTECT_SCRIPT],{windowsHide:true,stdio:['pipe','pipe','ignore']});}catch{finish(true);return;}
    child.on('error',()=>finish(true));child.stdin.on('error',()=>finish(true));
    child.stdout.on('data',chunk=>{output+=chunk.toString('ascii');if(output.length>65536){child.kill();finish(true);}});
    child.on('close',code=>{
      if(code!==0||!output||!/^[a-zA-Z0-9+/]+={0,2}$/.test(output)||output.length%4!==0){finish(true);return;}
      finish(false,unprotect?Buffer.from(output,'base64').toString('utf8'):output);
    });
    child.stdin.end(value,'utf8');
  });
}
export const protectWindowsSecret=value=>dpapi(value);
export const unprotectWindowsSecret=value=>dpapi(value,true);

async function atomicSave(filename,value) {
  await mkdir(path.dirname(filename),{recursive:true,mode:0o700});
  const temporary=path.join(path.dirname(filename),`.ark-model-${randomUUID()}.tmp`);
  let file;
  try{
    file=await open(temporary,'wx',0o600);await file.writeFile(JSON.stringify(value),'utf8');await file.sync();await file.close();file=null;
    await rename(temporary,filename);
  }catch{
    if(file)await file.close().catch(()=>{});
    await unlink(temporary).catch(()=>{});
    throw storageError();
  }
}

/** Legacy ARK_API_KEY and ARK_MODEL_ID override saved values independently at
 * the legacy endpoint only. Environment values never persist automatically. */
export async function createModelConfig({dataDir,protectSecret=protectWindowsSecret,unprotectSecret=unprotectWindowsSecret,env=process.env}={}) {
  if(typeof dataDir!=='string'||!dataDir)invalid('模型配置缺少本地存储目录。');
  const envKey=env.ARK_API_KEY||null,envModel=env.ARK_MODEL_ID||null;
  if(envKey!==null&&!validKey(envKey))invalid('ARK_API_KEY 环境变量格式无效。');
  if(envModel!==null&&!validModel(envModel))invalid('ARK_MODEL_ID 环境变量格式无效。');
  const filename=path.join(dataDir,'.secrets','ark-model.json');
  let saved={schemaVersion:2,...modelConfigSnapshot(),apiKeyCiphertext:null,connectionTest:null},savedKey=null,queue=Promise.resolve();
  const environmentBinding=randomUUID(),pendingTests=new Map();let testGeneration=0;
  try{
    const raw=await readFile(filename,'utf8');if(Buffer.byteLength(raw)>65536)throw storageError();
    const parsed=JSON.parse(raw);
    if(!parsed||![1,2].includes(parsed.schemaVersion)||!validModel(parsed.model)||(parsed.apiKeyCiphertext!==null&&(typeof parsed.apiKeyCiphertext!=='string'||!parsed.apiKeyCiphertext||parsed.apiKeyCiphertext.length>60000)))throw storageError();
    try{saved={schemaVersion:2,...modelConfigSnapshot(parsed.schemaVersion===1?{model:parsed.model}:parsed),apiKeyCiphertext:parsed.apiKeyCiphertext,connectionTest:parsed.connectionTest??null};}catch{throw storageError();}
    if(saved.connectionTest!==null&&(!saved.connectionTest||typeof saved.connectionTest!=='object'||!/^[a-f0-9]{64}$/.test(saved.connectionTest.binding)||!Number.isFinite(Date.parse(saved.connectionTest.testedAt))))throw storageError();
    // An environment key also supports running a copied configuration on a host
    // that cannot decrypt the original Windows user's DPAPI ciphertext.
    if(saved.apiKeyCiphertext!==null&&!(envKey&&saved.baseUrl===ARK_BASE_URL)){
      try{savedKey=await unprotectSecret(saved.apiKeyCiphertext);}catch{throw cryptoError();}
      if(!validKey(savedKey))throw cryptoError();
    }
  }catch(error){if(error?.code!=='ENOENT')throw error instanceof ModelConfigError?error:storageError();}
  // Legacy environment credentials are bound to their original provider, never
  // reused for a newly configured endpoint. This is a single-endpoint store.
  const activeKey=()=>saved.baseUrl===ARK_BASE_URL&&envKey?envKey:savedKey;
  const effectiveOptions=()=>modelConfigSnapshot({...saved,model:saved.baseUrl===ARK_BASE_URL&&envModel?envModel:saved.model});
  // Bound to encrypted credential identity, never to a digest of the plaintext key.
  // Environment credentials require a new test after process restart.
  const binding=()=>createHash('sha256').update(JSON.stringify([effectiveOptions(),saved.authMode==='none'?null:saved.baseUrl===ARK_BASE_URL&&envKey?environmentBinding:saved.apiKeyCiphertext])).digest('hex');
  const publicConfig=()=>{const configured=saved.authMode==='none'||Boolean(activeKey()),connectionTested=configured&&saved.connectionTest?.binding===binding();return {provider:PROVIDER,...effectiveOptions(),configured,keyConfigured:Boolean(activeKey()),connectionTested,connectionTestedAt:connectionTested?saved.connectionTest.testedAt:null};};
  const privateConfig=()=>({...publicConfig(),apiKey:saved.authMode==='none'?null:activeKey()||null});
  const serial=operation=>{const result=queue.then(operation);queue=result.catch(()=>{});return result;};
  return {
    publicConfig,
    getPrivate:privateConfig,
    beginConnectionTest(){return serial(async()=>{
      if(!publicConfig().configured)throw new ModelConfigError('CONNECTION_REQUIRED','请先保存完整模型设置，再测试连接。',409);
      const next={...saved,connectionTest:null};await atomicSave(filename,next);saved=next;
      const token=randomUUID();pendingTests.set(token,{binding:binding(),generation:++testGeneration});
      return {token,config:privateConfig()};
    });},
    finishConnectionTest(token,success){return serial(async()=>{
      const pending=pendingTests.get(token);pendingTests.delete(token);
      if(!pending||pending.generation!==testGeneration||pending.binding!==binding())return publicConfig();
      if(success===true){const next={...saved,connectionTest:{binding:pending.binding,testedAt:new Date().toISOString()}};await atomicSave(filename,next);saved=next;}
      return publicConfig();
    });},
    update(changes){
      const operation=queue.then(async()=>{
        if(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.keys(changes).some(key=>![...MODEL_CONFIG_FIELDS,'apiKey','clearKey'].includes(key)))invalid('模型配置字段无效。');
        const options=modelConfigSnapshot({...saved,...changes});
        if(Object.hasOwn(changes,'apiKey')&&!validKey(changes.apiKey))invalid('API Key 须为 8 至 4096 位且不包含空白或控制字符。');
        if(Object.hasOwn(changes,'clearKey')&&typeof changes.clearKey!=='boolean')invalid('清除密钥选项无效。');
        if(changes.clearKey&&Object.hasOwn(changes,'apiKey'))invalid('不能同时保存和清除 API Key。');
        const next={...saved,...options};let nextKey=savedKey;
        if(next.baseUrl!==saved.baseUrl){next.apiKeyCiphertext=null;nextKey=null;}
        if(changes.clearKey){next.apiKeyCiphertext=null;nextKey=null;}
        if(Object.hasOwn(changes,'apiKey')){
          let encrypted;
          try{encrypted=await protectSecret(changes.apiKey);}catch{throw cryptoError();}
          if(typeof encrypted!=='string'||!encrypted||encrypted.length>60000||encrypted===changes.apiKey)throw cryptoError();
          next.apiKeyCiphertext=encrypted;nextKey=changes.apiKey;
        }
        if(JSON.stringify(modelConfigSnapshot(next))!==JSON.stringify(modelConfigSnapshot(saved))||next.apiKeyCiphertext!==saved.apiKeyCiphertext){next.connectionTest=null;testGeneration++;pendingTests.clear();}
        try{await atomicSave(filename,next);}catch(error){throw error instanceof ModelConfigError?error:storageError();}
        saved=next;savedKey=nextKey;return publicConfig();
      });
      queue=operation.catch(()=>{});return operation;
    },
  };
}
