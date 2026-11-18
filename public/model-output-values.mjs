const DECIMAL_NUMBER=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Model boundary only. Accept one complete JSON object, optionally fenced. */
export function parseModelJson(content){
  if(typeof content!=='string')throw new SyntaxError('Model output must be JSON text');
  const source=content.trim(),fence=source.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  return JSON.parse(fence?fence[1]:source);
}

/** Normalize model wire values only; the caller still validates the 0–1 range. */
export function normalizeConfidenceValue(value){
  if(typeof value!=='string')return value;
  const source=value.trim();
  if(!DECIMAL_NUMBER.test(source))return value;
  const number=Number(source);
  return Number.isFinite(number)?number:value;
}
