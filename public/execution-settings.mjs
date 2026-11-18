export const DEFAULT_EXECUTION_SETTINGS=Object.freeze({concurrency:1,batchSize:20,maxWorkBytes:64000});
export const DEFAULT_RAW_EXECUTION_SETTINGS=Object.freeze({...DEFAULT_EXECUTION_SETTINGS,concurrency:4});
export function normalizeExecutionSettings(value={}, {raw=false}={}){
  const settings={...(raw?DEFAULT_RAW_EXECUTION_SETTINGS:DEFAULT_EXECUTION_SETTINGS),...value};
  for(const [key,min,max,label] of [['concurrency',1,4,'同时处理记录数'],['batchSize',1,100,'每段记录数'],['maxWorkBytes',4096,250000,'每段工作量']]){
    if(!Number.isSafeInteger(settings[key])||settings[key]<min||settings[key]>max)throw new Error(`${label}须为${min}至${max}的整数。`);
  }
  return {concurrency:settings.concurrency,batchSize:settings.batchSize,maxWorkBytes:settings.maxWorkBytes};
}
