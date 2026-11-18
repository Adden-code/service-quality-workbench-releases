import {workbook} from './io.mjs';
import {EC_HEADERS} from './ecommerce-schema.mjs';

export const ECOMMERCE_RULE_DESCRIPTIONS=[
  ['回复时效','北京时间连续自然时间，含晚间、周末；超过24小时不通过，恰好24小时通过。时间缺失、无效或倒置时待判定。'],
  ['文本质量','实际回复存在明显拼写、语法、标点、表情、通顺性或歧义问题，任一项成立即不通过。'],
  ['针对性及批次重复','回复须针对具体问题、诉求或夸赞；完全无关，或本次导入批次内同一管理员至少3条相同或高度相似回复，任一项成立即不通过。'],
  ['操作步骤结构','至少3个操作、排查或解决步骤且未按1、2、3顺序编号时不通过；普通列举和礼貌用语不自动算操作步骤。'],
  ['公开回复隐私','实际公开回复披露个人隐私信息时不通过；输入材料中的订单号本身不等于公开泄露。'],
];
export function createEcommerceTemplate(){
  const standards=Array(22).fill('');
  ECOMMERCE_RULE_DESCRIPTIONS.forEach(([,description],index)=>{standards[15+index]=description;});
  standards[21]='第2行为判断标准；第3行起填写业务评论。可更改工作表名称；核心22列顺序不变，扩展列追加在后并原样留存。原人工参考可留空，仅用于后续对照。';
  return workbook([{name:'Sheet4',headers:[...EC_HEADERS],rows:[standards]}]);
}
