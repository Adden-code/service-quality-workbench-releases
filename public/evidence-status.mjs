import {nativeLanguageIssue} from './native-language-validation.mjs';
// Evidence verification is independent of the model's business verdict.
import {validateRawResultAssurance} from './raw-evidence.mjs';
export function hasUnverifiedEvidence(result){
 return result?.rawValidation?.status==='unverified-quote'||result?.evidenceValidation?.status==='unverified'||result?.origin==='unverified'||(result?.sceneDependencies||[]).some(hasUnverifiedEvidence);
}
export function evidenceStatus(result,{human=false}={}){
 if(human&&result&&result.source!=='AI接受')return 'manual';
 if(!result||hasUnverifiedEvidence(result)||['degraded','program-fallback'].includes(result.rawValidation?.status))return 'unverified';
 return result.rawValidation?.status==='manual-provided'?'manual':result.rawValidation?.status==='verified'||result.evidenceValidation?.status==='verified'||result.evidenceQuotes?.length?'verified':'unverified';
}
export function evidenceStatusLabel(result,{human=false,english=false}={}){
 return (english?{verified:'Verified',unverified:'Unverified',manual:'Human provided'}:{verified:'已核验',unverified:'未核验',manual:'人工提供'})[evidenceStatus(result,{human})];
}
export function hasVerifiableAIEvidence(result,session){
 if(!result||hasUnverifiedEvidence(result)||nativeLanguageIssue(result))return false;
 if(session.rawTranscript)return result.rawValidation?.status==='verified'&&Boolean(result.evidenceQuotes?.length)&&validateRawResultAssurance(result,session).valid;
 if(result.ruleId==='EC-TIME'&&session.ecommerce)return result.verdict!=='无法判定'&&Boolean(result.timeFacts);
 return Array.isArray(result.evidenceQuotes)&&result.evidenceQuotes.length>0&&result.evidenceQuotes.every(q=>{const turn=session.turns?.find(t=>t.id===q.turnId);return turn&&typeof q.quote==='string'&&q.quote.trim()&&turn.text.includes(q.quote)&&result.evidence?.includes(q.turnId)&&(q.role===undefined||q.role===turn.role);});
}
