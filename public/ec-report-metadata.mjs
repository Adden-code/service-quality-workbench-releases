import {operatorSite,systemValue} from './ecommerce-system-source.mjs';
// Batch labels describe the report only. Never feed them into row projections,
// operator-country detection, classification or timing calculations.
export function normalizeEcReportMetadata(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['schemaVersion','samplingPeriod','reportRegion'].includes(key))||value.schemaVersion!==undefined&&value.schemaVersion!==1)throw new Error('电商批次报告信息结构无效。');
 const out={schemaVersion:1};
 for(const [key,label,max] of [['samplingPeriod','抽检周期',120],['reportRegion','报告地区',120]]){
  const text=value[key]??'';
  if(typeof text!=='string'||text.length>max||/[\u0000-\u001f\u007f]/.test(text))throw new Error(`${label}须为不超过${max}字符的单行文本。`);
  out[key]=text.trim();
 }
 return out;
}
export function validateEcReportMetadata(value){
 const normalized=normalizeEcReportMetadata(value);
 if(Object.keys(value).length!==3||Object.keys(normalized).some(key=>value[key]!==normalized[key]))throw new Error('电商批次报告信息须完整规范化保存。');
 return normalized;
}
const unique=values=>[...new Set(values.filter(value=>typeof value==='string'&&value.trim()).map(value=>value.trim()))];
export function ecReportMetadataSummary(metadata,records){
 validateEcReportMetadata(metadata);
 const countries=unique(records.map(record=>record.raw22?.[3]??record.ecommerce?.raw?.[3]));
 const sources=records.map(record=>record.systemSource??record.ecommerce?.systemSource).filter(Boolean);
 const fallbackCountries=unique(sources.map(source=>operatorSite(systemValue(source,4),source.batchSite)).filter(site=>site.origin==='batch-manual').map(site=>site.value));
 return{samplingPeriods:metadata.samplingPeriod?[metadata.samplingPeriod]:[],reportRegions:metadata.reportRegion?[metadata.reportRegion]:countries,reportRegionSource:metadata.reportRegion?'batch-manual-override':countries.length?'source-country':'missing',ecReportMetadataAudit:{samplingPeriodSource:metadata.samplingPeriod?'batch-manual':'missing',reportRegionSource:metadata.reportRegion?'batch-manual-override':countries.length?'source-country':'missing',manualReportRegion:metadata.reportRegion,sourceCountries:countries,unrecognizedSiteFallbacks:fallbackCountries}};
}
export function ecReportMetadataAuditRows(snapshot,language='zh'){
 const metadata=snapshot.ecReportMetadata;if(!metadata)return[];
 const english=language==='en',L=(zh,en)=>english?en:zh,audit=snapshot.basis?.ecReportMetadataAudit??ecReportMetadataSummary(metadata,snapshot.records||[]).ecReportMetadataAudit;
 return[
  [L('批次抽检周期','Batch sampling period'),metadata.samplingPeriod||L('未提供；不以生成时间替代','Not provided; generation time is not a substitute')],
  [L('报告地区','Report region'),(snapshot.basis?.reportRegions||[]).join(' · ')||L('未提供','Not provided')],
  [L('报告地区来源','Report region source'),audit.reportRegionSource==='batch-manual-override'?L('批次手工覆盖（仅报告地区）','Manual batch override (report region only)'):audit.reportRegionSource==='source-country'?L('来源国家去重汇总（运营商识别；未识别记录可用本批站点补充）','Distinct source countries (operator detection; batch site fallback for unrecognized rows)'):L('未提供','Not provided')],
  [L('原始识别国家汇总','Source country summary'),audit.sourceCountries.join(' · ')||L('未提供','Not provided')],
  [L('报告地区适用范围','Report region scope'),L('只用于报告顶部；不改变原始数据、逐条站点和时效依据。','Report banner only; source data, row sites and timing evidence are unchanged.')],
 ];
}
