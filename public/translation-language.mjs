/** A bounded target-language check, not a translation-quality or meaning check.
 * English must dominate; retained source-script names must be short and grounded.
 * Shared by the translation job service and legacy report-cache reuse.
 */
export function plausibleEnglishTranslation(text,original){
 if(typeof text!=='string'||typeof original!=='string')return false;
 const letters=[...text].filter(character=>/\p{L}/u.test(character)),latin=letters.filter(character=>/\p{Script=Latin}/u.test(character)).length;
 if(!letters.length||latin/letters.length<0.6)return false;
 const retained=text.match(/[^\p{Script=Latin}\P{L}](?:[^\p{Script=Latin}\P{L}]|\p{M})*/gu)||[];
 if(!retained.every(value=>[...value].length<=32&&original.includes(value)))return false;
 // Bounded name exception, not a semantic language detector: every line with
 // CJK text needs English prose (>=60% Latin letters). An isolated CJK line is
 // explicitly missing, even if it could be a legitimate company name.
 const cjk=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
 for(const line of text.split(/\r\n|[\n\r\u2028\u2029]/u))if(cjk.test(line)){
  const script=[...line].filter(character=>/\p{L}/u.test(character));
  if(script.filter(character=>/\p{Script=Latin}/u.test(character)).length/script.length<0.6)return false;
 }
 // Punctuation, digits and whitespace cannot split a copied paragraph into
 // separate names. In each such CJK cluster allow <=2 distinct grounded names,
 // <=32 code points after deduplication. Repeats do not consume another budget;
 // real English words separate clusters, so conversations have no global cap.
 const clusters=text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}][\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{M}\p{N}\p{P}\p{Z}\s]*/gu)||[];
 return clusters.every(cluster=>{const names=[...new Set(cluster.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}](?:[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|\p{M})*/gu)||[])];return names.length<=2&&names.reduce((count,name)=>count+[...name].length,0)<=32;});
}

export function reusableEnglishBaseTranslation(source,entry){
 if(typeof source!=='string'||!source.trim()||typeof entry?.text!=='string'||!entry.text.trim()||entry.sourceText!==undefined&&entry.sourceText!==source)return false;
 const sourceLetters=[...source].filter(character=>/\p{L}/u.test(character)),onlyLatin=sourceLetters.every(character=>/\p{Script=Latin}/u.test(character));
 // Same-language results must actually correspond to this source. The inherited
 // parser's English detection permits Latin-script letters only for same=true.
 if(entry.status==='same')return entry.detectedLanguage==='en'&&entry.text===source&&sourceLetters.length>0&&onlyLatin;
 if(entry.status!=='translated')return false;
 // "und" is reserved for unchanged literals; it cannot bypass translation of
 // Chinese or other non-Latin source text, even with an English-looking output.
 if(entry.detectedLanguage==='und')return entry.text===source&&onlyLatin;
 if(!sourceLetters.length)return entry.text===source;
 return plausibleEnglishTranslation(entry.text,source);
}
