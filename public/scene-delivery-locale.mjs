import {evidenceAuditSheet} from './evidence-audit.mjs';
import {resultProvenanceSheet} from './triage-export.mjs';
import {createReportLocale,englishReportValue} from './report-locale.mjs';

const labels={
 '证据核验状态':'Evidence verification status','AI证据核验状态':'AI evidence verification','证据核验审计':'Verification audit','证据核验明细':'Evidence verification','已核验':'Verified','未核验':'Unverified','人工提供':'Human provided',
 '译文与置信度':'Translations and confidence','翻译字段':'Translation field','原文语种':'Source language','翻译置信度':'Translation confidence','译文':'Translation',
 '评价归类复核与改判记录':'Evaluation classification review and correction history',
 '模型子项原判与合并策略':'Original model component and merge policy',
 '整体派生留痕':'Overall derivation audit','派生算法':'Derivation algorithm','子项结果快照':'Frozen component verdicts',
 '检核明细':'Inspection details','全部业务列':'All business columns','完整审计附页':'Full audit trail','辅助能力留痕':'Capability audit','固定声明':'Mandatory statements','原始数据':'Original data','来源物理行':'Source row','业务检核':'Business checks',
 '会话ID':'Session ID','原会话ID':'Source session ID','规则标识':'Rule ID','规则版本':'Rule version','最终结果':'Final verdict','判定来源':'Verdict source','AI原判':'Original AI verdict','AI置信度':'AI confidence','证据原文定位':'Original evidence locations','AI判定理由':'AI reason — original','人工复核与改判':'Human review and corrections — original','复核人':'Reviewer label','复核历史':'Review history — original','已处理待补充记录':'Resolved undetermined records','站点时效判定依据与时间来源':'Site timing basis and time source','站点识别依据与置信度':'Site evidence and confidence','AI执行记录':'AI execution record',
 '能力':'Capability','状态':'Status','值与原文依据':'Values and original evidence','项目':'Item','内容':'Content','来源声明':'Source statement','统计口径':'Statistical definitions','免责声明':'Disclaimer','AI/人工来源标识':'AI and human provenance','冻结版本':'Frozen configuration','输出语种':'Output languages','模板列规则':'Template column definitions','时效依据':'Timing basis','完整审计':'Full audit',
 '分组':'Group','规则':'Rule','版本':'Version','整体':'Overall','逐项依据':'Per-rule evidence','原因与建议':'Causes and recommendations','问题数':'Issue count','建议复核方向':'Suggested review','二级意图':'Secondary intent','一级销售环节':'Sales stage','会话数':'Sessions','占本批比例':'Share of batch','用户声音（原文依据随附录）':'Customer voice (source evidence in appendix)',
 '未执行':'Not executed','无法判定':'Undetermined','技术失败':'Technical failure','（同原文）':'(Same as original)','未提供':'Not provided',
 '每会话每规则一次；符合/(符合+不符合)，NA仅业务不适用；无法判定、未执行、待人工单列，不进入已确定分母。':'One verdict per rule per session. Pass rate = Pass / (Pass + Fail). NA means business inapplicability. Undetermined, not executed and awaiting human review remain separate and are excluded from the determined denominator.',
 'AI辅助结果须按业务审核策略使用；模型自评不是实测准确率。标定范围与统计证据必须核对。':'Use AI results under the approved review policy. Model confidence is not measured accuracy. Verify calibration scope and supporting samples.',
 '逐项来源、AI原判和人工改判分别留存；操作人是本机标签，无账号认证。':'Per-rule provenance, original AI verdicts and human corrections are retained separately. Operators are local labels without account authentication.',
 '站点字段优先；AI仅识别站点；阈值来自人工配置。等待按每次查询起止，次数按同一问题分组。':'Source site fields take precedence. AI identifies sites only; thresholds come from manual configuration. Waits are timed per query, and repeat queries are grouped by issue.',
 '主视图隐藏不删除完整字段、源列、原文定位、AI理由、复核记录和复核人。':'Hiding main-view columns does not remove complete fields, source columns, evidence locations, AI reasons, review records or reviewer labels.',
};

export function sceneReportLocale(snapshot,enrichment={},options={}){
 const locale=createReportLocale(snapshot,enrichment,options),english=locale.language==='en';
 const text=value=>{if(!english||typeof value!=='string')return value;if(Object.hasOwn(labels,value))return labels[value];const fixed=englishReportValue(value);if(fixed!==value)return fixed;if(!/[\u3400-\u9fff]/.test(value))return value;return locale.display(value);};
 const source=value=>english?locale.sourceLabel(value):value;
 function sheets(input){if(!english)return input;const t=snapshot.executionSnapshot.template;
  return input.map((sheet,index)=>{if(sheet.name==='证据核验明细')return evidenceAuditSheet(snapshot,true);if(sheet.name==='判定来源与分流')return resultProvenanceSheet(snapshot,'en');
   const result={...sheet,name:labels[sheet.name]||sheet.name.replace(/^原始数据/,'Original data '),headers:sheet.headers.map(text)};
   if(index===0){const sourceCount=sheet.headers.length-t.columns.filter(c=>c.visible).length-1-(snapshot.evidenceAudit?1:0);result.headers=sheet.headers.map((v,i)=>i<sourceCount?'Original data':text(v));result.rows=sheet.rows.map(row=>row.map((v,i)=>i<sourceCount?v:text(v)));}
   else if(index===1)result.rows=sheet.rows.map(row=>row.map((v,i)=>i===0?v:text(v)));
   else if(index===2)result.rows=sheet.rows.map(row=>row.map((v,i)=>[4,6].includes(i)?text(v):v));
   else if(index===4)result.rows=sheet.rows.map(([key,value])=>[text(key),key==='来源声明'?`${snapshot.source.name}; SHA256 ${snapshot.source.sha256}; local frozen snapshot`:['冻结版本','输出语种','模板列规则'].includes(key)?value:text(value)]);
   else if(index>=5){result.headers=sheet.name.startsWith('原始数据')?sheet.headers:sheet.headers.map(text);result.rows=sheet.rows;}
   return result;
  }).concat([{name:'Field Guide',headers:['Source field — original','English alias'],rows:input.filter(s=>s.name.startsWith('原始数据')).flatMap(s=>s.headers.map(h=>[h,text(h)]))}]);
 }
 return{...locale,english,text,source,sheets};
}
