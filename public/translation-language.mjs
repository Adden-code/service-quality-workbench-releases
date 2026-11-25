/** Script gate for an English display value, not semantic language detection.
 * Source-language names and quotations stay in Original/audit fields. */
export function englishDisplayText(text){return typeof text==='string'&&Boolean(text.trim())&&![...text].some(character=>/\p{L}/u.test(character)&&!/\p{Script=Latin}/u.test(character));}
export function plausibleEnglishTranslation(text,original){
 return typeof original==='string'&&englishDisplayText(text)&&/\p{L}/u.test(text);
}

/** A bounded lexical exception for und, not language detection. Each token
 * containing letters must have an explicit code shape; prose still needs a
 * verified language result even when all its letters use the Latin script. */
export function languageNeutralLiteral(text){
 if(typeof text!=='string'||!text.trim())return false;
 return text.trim().split(/\s+/u).every(token=>{
  if(!/\p{L}/u.test(token))return true;
  if(!/^[A-Za-z0-9]+(?:[-_./:+][A-Za-z0-9]+)*$/.test(token))return false;
  return /[0-9]/.test(token)||/^[A-Z0-9]+(?:[-_./:+][A-Z0-9]+)+$/.test(token);
 });
}

export function reusableEnglishBaseTranslation(source,entry){
 if(typeof source!=='string'||!source.trim()||typeof entry?.text!=='string'||!entry.text.trim()||entry.sourceText!==undefined&&entry.sourceText!==source)return false;
 const sourceLetters=[...source].filter(character=>/\p{L}/u.test(character)),onlyLatin=sourceLetters.every(character=>/\p{Script=Latin}/u.test(character));
 // Same-language results must actually correspond to this source. The inherited
 // parser's English detection permits Latin-script letters only for same=true.
 if(entry.status==='same')return entry.detectedLanguage==='en'&&entry.text===source&&sourceLetters.length>0&&onlyLatin;
 if(entry.status!=='translated')return false;
 // "und" cannot bypass language confirmation for Latin-script prose either.
 if(entry.detectedLanguage==='und')return entry.text===source&&languageNeutralLiteral(source);
 if(!sourceLetters.length)return entry.text===source;
 return plausibleEnglishTranslation(entry.text,source);
}
