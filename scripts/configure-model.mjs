// Local one-time setup. Secrets arrive through stdin, never process arguments.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createModelConfig,DEFAULT_MODEL} from '../server/model-config.mjs';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try{
  const dataDir=path.resolve(process.argv[2]||process.env.DEMO_DATA_DIR||path.join(project,'data'));
  const config=await createModelConfig({dataDir});
  if(process.stdin.isTTY)process.stdin.setRawMode(true);
  process.stdout.write('等待本机密钥输入（不回显）…\n');
  let secret=await new Promise((resolve,reject)=>{
    let text='';
    const finish=()=>{process.stdin.off('data',receive);process.stdin.off('end',ended);process.stdin.pause();resolve(text.trim());};
    const ended=()=>finish();
    const receive=chunk=>{const value=chunk.toString('utf8');if(value.includes('\u0003')){reject(new Error('cancelled'));return;}text+=value;if(text.length>4097){reject(new Error('oversized'));return;}if(/[\r\n]/.test(text)){text=text.split(/[\r\n]/)[0];finish();}};
    process.stdin.on('data',receive);process.stdin.once('end',ended);process.stdin.resume();
  });
  if(process.stdin.isTTY)process.stdin.setRawMode(false);
  await config.update({apiKey:secret,model:DEFAULT_MODEL});secret=null;
  process.stdout.write('方舟密钥已按当前Windows用户加密保存；模型为 glm-5.3-flash。\n');
}catch{if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();process.stderr.write('密钥未能保存，请检查输入或Windows当前用户权限。\n');process.exitCode=1;}
