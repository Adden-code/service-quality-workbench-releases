import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEnglishReleaseProof} from '../packaging/english-release-gate.mjs';

const current={version:'test-version',sourceFingerprint:'test-source',requiredViews:['review-pagination-next','policy-dialog']};
const passed={status:'passed',version:'test-version',sourceFingerprint:'test-source',untranslatedCount:0,pageErrors:[],coveredViews:['review-pagination-next','policy-dialog']};
test('release gate rejects stale source, product versions and incomplete page coverage',()=>{
 assert.equal(validateEnglishReleaseProof(passed,current),passed);
 for(const change of [{status:'failed'},{version:'older'},{sourceFingerprint:'older-code'},{untranslatedCount:1},{pageErrors:['Render failure']},{coveredViews:['policy-dialog']}])assert.throws(()=>validateEnglishReleaseProof({...passed,...change},current),/English release gate/);
});
