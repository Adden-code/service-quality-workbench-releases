import {ecommerceTimeDependencies} from '../public/ecommerce-time-results.mjs';
import {isRawTranscriptSession,RAW_INPUT_MODE,RAW_EVIDENCE_VERSION} from '../public/raw-transcript.mjs';

/** Persistence/cache-only view. Local O-column type and cutoff never enter workflowInput's model projection. */
export function workflowDependencies(session,{basis,inspectionAt,rawImportOptions,promptVersion,modelConfigFingerprint}={}){
 const input=workflowInput(session),localTime=ecommerceTimeDependencies(session,basis,inspectionAt);
 if(isRawTranscriptSession(session))return {...input,rawExecution:{inspectionAt:inspectionAt??null,outputLanguage:rawImportOptions?.outputLanguage??'zh',promptVersion:promptVersion??'raw-direct-quote-v1',modelConfigFingerprint:modelConfigFingerprint??null,basis:structuredClone(basis??null)}};
 return localTime?{...input,localTime}:input;
}

export function workflowInput(session){
  const keys=['id','externalId','scene','topic','startedAt','product','channel','customer','agent','completeness','missingNote','contextFields','reviewPolicy'];
  const value=Object.fromEntries(keys.filter(k=>session[k]!==undefined).map(k=>[k,structuredClone(session[k])]));
  if(isRawTranscriptSession(session)){
    value.inputMode=RAW_INPUT_MODE;value.evidenceContractVersion=RAW_EVIDENCE_VERSION;
    value.rawTranscript=structuredClone(session.rawTranscript);
    value.turns=[];
    return value;
  }
  value.turns=session.turns.map(t=>Object.fromEntries(['id','role','speaker','at','text'].filter(k=>t[k]!==undefined).map(k=>[k,t[k]])));
  if(session.ecommerce)value.source={fileSha256:session.ecommerce.fileSha256,sheet:session.ecommerce.sheet,row:session.ecommerce.row,thresholdHours:session.ecommerce.thresholdHours};
  return value;
}
