// Explicit, optional synthetic model probe. Never reads production model settings.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createArkClient} from '../server/ark-client.mjs';
import {executeSceneCapabilities} from '../server/scene-capabilities.mjs';
import {fixture} from '../tests/native-language-stage2-fixture.mjs';
const args=process.argv.slice(2),option=k=>args.includes(k)?args[args.indexOf(k)+1]:undefined;
if(!args.includes('--confirm-synthetic-model-calls')||!args.includes('--config')||!['zh','en'].includes(option('--language')))throw new Error('Explicit invocation required: --config <local JSON> --language en|zh --confirm-synthetic-model-calls. This makes at most six synthetic requests to the supplied model.');
const raw=JSON.parse(await fs.readFile(path.resolve(option('--config')),'utf8'));
const config={baseUrl:raw.baseUrl,model:raw.model,authMode:raw.authMode||'none',apiKey:raw.apiKey||'',reasoningEffort:raw.reasoningEffort,deploymentRevision:raw.deploymentRevision,reasoningConfigVersion:raw.reasoningConfigVersion};
const language=option('--language'),f=fixture(language),client=createArkClient(),out=path.resolve(option('--output')||'acceptance-results/model-probe-'+language);await fs.mkdir(out,{recursive:true});
let requests=0;
const traceNodes=[];const audit={async step(node,input,operation){if(node==='model'||node.endsWith('-model'))requests++;try{const value=await operation();traceNodes.push({node,status:'completed',...(node.includes('validation')?{output:value}:{})});return value;}catch(error){traceNodes.push({node,status:'failed',code:error.code||'ERROR'});throw error;}};
const report={stage:2,scope:'Synthetic NP only; not business-rule accuracy acceptance.',language,createdAt:new Date().toISOString(),sourceOriginal:f.session.turns,externalRequests:0};
try{
 const caps=await executeSceneCapabilities({session:f.session,snapshot:f.snapshot,config,client,nativeContext:f.context,trace:audit,retryDelayMs:500,maxAttempts:3});report.capabilities=caps;
 for(let attempt=1;attempt<=3;attempt++)try{report.inspection=await client.inspect({session:f.session,basis:f.basis,config,nativeContext:{...f.context,attempt,maxAttempts:3},sceneSnapshot:f.snapshot,sceneCapabilities:caps,trace:audit});break;}catch(e){if(attempt===3||e.code!=='INVALID_OUTPUT')throw e;}
 report.status=report.inspection.results.every(r=>r.languageValidation?.status==='verified')&&caps.outputs.demandSummary.languageValidation?.status==='verified'?'language-check-passed':'review-required';
}catch(e){report.status='failed';report.errorCode=e.code||'ERROR';process.exitCode=1;}
report.externalRequests=requests;report.nodes=traceNodes;await fs.writeFile(path.join(out,'model-probe.json'),JSON.stringify(report,null,2));console.log(`Synthetic probe: ${report.status}; ${requests} requests. Report: ${path.join(out,'model-probe.json')}`);
if(report.status!=='language-check-passed')process.exitCode=1;
