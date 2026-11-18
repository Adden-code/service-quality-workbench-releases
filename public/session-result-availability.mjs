// Shared validation of persisted results; does not mutate or promote judgments.
import {isRawTranscriptSession} from './raw-transcript.mjs';
import {validateRawResultAssurance} from './raw-evidence.mjs';
const VERDICTS=['符合','不符合','无法判定','不适用'];
export function hasCompletedAI(session){
  const expected=session.expectedRuleIds;
  if(!expected)return session.aiResults.some(result=>VERDICTS.includes(result.verdict));
  return session.aiExecution?.status==='completed'&&Array.isArray(expected)&&expected.length>0&&new Set(expected).size===expected.length&&session.aiResults.length===expected.length&&new Set(session.aiResults.map(result=>result.ruleId)).size===expected.length&&session.aiResults.every(result=>expected.includes(result.ruleId)&&VERDICTS.includes(result.verdict)&&typeof result.reason==='string'&&result.reason.trim()&&Array.isArray(result.evidence)&&(isRawTranscriptSession(session)?result.rawValidation?.status!=='program-fallback'&&validateRawResultAssurance(result,session).valid:result.evidence.every(id=>session.turns.some(turn=>turn.id===id))));
}
export const hasRawFallback=session=>isRawTranscriptSession(session)&&session.aiExecution?.status==='failed'&&session.aiResults?.length===session.expectedRuleIds?.length&&new Set(session.aiResults.map(result=>result.ruleId)).size===session.expectedRuleIds.length&&session.aiResults.every(result=>session.expectedRuleIds.includes(result.ruleId)&&result.verdict==='无法判定'&&result.rawValidation?.status==='program-fallback'&&validateRawResultAssurance(result,session).valid);
