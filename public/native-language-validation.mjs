// Offline, conservative prose check. This is not a fluency/semantic-equivalence
// classifier: short or ambiguous text stays uncertain and cannot authorize B6.
export const NATIVE_LANGUAGE_VALIDATOR='native-prose-v1';
const english=new Set('the a an this that these those is are was were be been being to of for from with without and or but because as on in at by not no has have had does do did can cannot should must customer agent reply response request product service rule evidence conversation asked asks states shows provides provided mentioned specifically applicable information unavailable missing insufficient verified unclear issue inquiry need needs confirmed offered details explains addresses'.split(' '));
const foreign=new Set('el la los las del una uno por para pero porque como que gracias usted cliente respuesta producto servicio hola este esta muy mais avec une les des pour merci vous votre est pas und der die das mit nicht danke'.split(' '));
export function checkNativeProse(text,language,{sourceQuotes=[],names=[]}={}){
 if(typeof text!=='string'||!text.trim())return{status:'uncertain',reasonCode:'empty-prose'};
 let prose=text.normalize('NFC');
 for(const q of [...sourceQuotes,...names].filter(s=>typeof s==='string'&&s.trim()).sort((a,b)=>b.length-a.length))prose=prose.split(q.normalize('NFC')).join(' ');
 prose=prose.replace(/https?:\/\/\S+|\b[A-Z]{2,}[\w.-]*\b|\b\d+(?:[.,]\d+)*\b/g,' ');
 const han=(prose.match(/\p{Script=Han}/gu)||[]).length,other=(prose.match(/[\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Devanagari}]/gu)||[]).length,words=(prose.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g)||[]),en=words.filter(w=>english.has(w)).length,non=words.filter(w=>foreign.has(w)).length;
 if(language==='zh')return other||non>=2||words.length>5&&en>=3?{status:'mismatch',reasonCode:'foreign-prose'}:han>=4?{status:'verified',reasonCode:'chinese-prose'}:{status:'uncertain',reasonCode:'insufficient-language-evidence'};
 if(language!=='en')return{status:'uncertain',reasonCode:'unsupported-language'};
 if(han||other||non>=2&&non>=en)return{status:'mismatch',reasonCode:'foreign-prose'};
 return words.length>=4&&en>=2&&en>non?{status:'verified',reasonCode:'english-prose'}:{status:'uncertain',reasonCode:'insufficient-language-evidence'};
}
export function nativeLanguageIssue(result){
 return Boolean(result?.languageValidation&&result.languageValidation.status!=='verified'||(result?.sceneDependencies||[]).some(nativeLanguageIssue));
}
export function validateLanguageAssurance(value){
 if(value===undefined)return;
 if(!value||value.version!==NATIVE_LANGUAGE_VALIDATOR||!['zh','en'].includes(value.language)||!['verified','mismatch','uncertain'].includes(value.status)||value.requiresHumanReview!==(value.status!=='verified')||!Array.isArray(value.fields)||value.fields.some(f=>typeof f.path!=='string'||!['verified','mismatch','uncertain'].includes(f.status)))throw new Error('Invalid native language assurance.');
 const expected=value.fields.some(f=>f.status==='mismatch')?'mismatch':value.fields.some(f=>f.status==='uncertain')?'uncertain':'verified';
 if(!value.fields.length||value.status!==expected)throw new Error('Native language assurance status does not match its field findings.');
}
