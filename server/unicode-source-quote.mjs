// Evidence repair is restricted to canonical Unicode composition and Arabic
// display shaping. Do NOT fold alef/hamza, remove vowel marks, bidi controls or
// use edit distance. Persist the original source slice, never the model variant.
const fold=value=>Array.from(value,c=>/[\uFB50-\uFDFF\uFE70-\uFEFF]/u.test(c)&&/\p{Letter}/u.test(c)?c.normalize('NFKC'):c).join('').replace(/\u0640/g,'').replace(/\r\n/g,'\n').normalize('NFC');
const segmenter=new Intl.Segmenter('ar',{granularity:'grapheme'});
export function unicodeSourceQuoteFinder(text){
 let comparison='',starts=new Map(),ends=new Map();
 for(const {segment,index} of segmenter.segment(text)){
  const value=fold(segment);if(!value)continue;
  starts.set(comparison.length,index);comparison+=value;ends.set(comparison.length,index+segment.length);
 }
 return quote=>{
  if(typeof quote!=='string')return null;const needle=fold(quote);if(!needle.trim())return null;
  let from=0,found=null;
  while(from<=comparison.length-needle.length){
   const i=comparison.indexOf(needle,from);if(i<0)break;from=i+1;
   if(!starts.has(i)||!ends.has(i+needle.length))continue;
   // Ambiguous normalized variants must remain a human decision.
   if(found)return null;
   const start=starts.get(i),end=ends.get(i+needle.length);found={start,end,quote:text.slice(start,end)};
  }
  return found;
 };
}
