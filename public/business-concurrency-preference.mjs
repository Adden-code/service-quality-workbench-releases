export const DEFAULT_BUSINESS_CONCURRENCY=4;
export const BUSINESS_CONCURRENCY_STORAGE_KEY='service-quality.business-concurrency.v1';
export const validBusinessConcurrency=value=>[2,3,4].includes(value);

// localStorage is scoped to this browser profile and origin. Access itself can
// throw in restricted profiles, so neither reads nor writes may block exports.
export function readBusinessConcurrencyPreference(storage){
  try{
    const value=(storage===undefined?globalThis.localStorage:storage)?.getItem(BUSINESS_CONCURRENCY_STORAGE_KEY);
    return ['2','3','4'].includes(value)?Number(value):DEFAULT_BUSINESS_CONCURRENCY;
  }catch{return DEFAULT_BUSINESS_CONCURRENCY;}
}
export function writeBusinessConcurrencyPreference(value,storage){
  if(!validBusinessConcurrency(value))return false;
  try{const target=storage===undefined?globalThis.localStorage:storage;if(!target)return false;target.setItem(BUSINESS_CONCURRENCY_STORAGE_KEY,String(value));return true;}
  catch{return false;}
}
