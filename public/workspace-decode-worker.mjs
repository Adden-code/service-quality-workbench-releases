import {createWorkspaceDecoderCore} from './workspace-decode-core.mjs';
const decoder=createWorkspaceDecoderCore();
self.onmessage=async({data})=>{try{self.postMessage({id:data.id,value:await decoder.decode(data.buffer,data.context)});}catch(error){self.postMessage({id:data.id,error:error.message});}};
