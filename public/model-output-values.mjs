const DECIMAL_NUMBER=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Normalize model wire values only; the caller still validates the 0–1 range. */
export function normalizeConfidenceValue(value){
  if(typeof value!=='string')return value;
  const source=value.trim();
  if(!DECIMAL_NUMBER.test(source))return value;
  const number=Number(source);
  return Number.isFinite(number)?number:value;
}
