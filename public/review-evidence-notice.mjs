import {hasUnverifiedEvidence} from './evidence-status.mjs';
import {getLocale} from './i18n.mjs';
export function evidenceNotice(result){return hasUnverifiedEvidence(result)?`<p class="soft-note warning evidence-unverified">${getLocale()==='en'?'Evidence unverified. Review this conclusion using its reason and the original conversation. This item cannot be exempted from review.':'依据未核验：请按判定理由结合原文判断。本项保留AI原判，不能免审。'}</p>`:'';}
