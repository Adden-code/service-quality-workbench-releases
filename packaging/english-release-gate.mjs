import fs from 'node:fs/promises';
import path from 'node:path';
import {checkEnglishUi,englishUiFingerprint} from '../scripts/check-english-ui.mjs';
import {REQUIRED_ENGLISH_VIEWS} from '../tests/english-ui-coverage.mjs';

export function validateEnglishReleaseProof(proof,{version,sourceFingerprint,requiredViews=REQUIRED_ENGLISH_VIEWS}){
 if(proof?.status!=='passed'||proof.version!==version||proof.sourceFingerprint!==sourceFingerprint)throw new Error('English release gate is missing, failed or stale. Run npm run test:i18n for the current source and product version.');
 if(proof.untranslatedCount!==0||!Array.isArray(proof.pageErrors)||proof.pageErrors.length)throw new Error('English release gate contains untranslated UI or browser errors.');
 if(!Array.isArray(proof.coveredViews)||requiredViews.some(view=>!proof.coveredViews.includes(view)))throw new Error('English release gate does not cover every required page and dialog.');
 return proof;
}

export async function requireEnglishReleaseGate({projectRoot,version,proofFile=process.env.WORKBENCH_ENGLISH_GATE_PROOF}){
 if(!proofFile)throw new Error('Set WORKBENCH_ENGLISH_GATE_PROOF to the current successful English browser verification.json before building an installer.');
 const staticCheck=await checkEnglishUi({root:path.join(projectRoot,'public')});
 if(staticCheck.status!=='passed')throw new Error(`English static UI check failed (${staticCheck.findings.length} findings). Run npm run check:i18n.`);
 const sourceFingerprint=await englishUiFingerprint({projectRoot});
 const proof=JSON.parse(await fs.readFile(proofFile,'utf8'));
 validateEnglishReleaseProof(proof,{version,sourceFingerprint});
 return {status:'passed',version,sourceFingerprint,coveredViews:proof.coveredViews.length,staticFiles:staticCheck.files};
}
