import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {workbook} from '../public/io.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';
const engineUrl=new URL('../server/ecommerce-engine.mjs',import.meta.url);
test('ecommerce engine preserves known failures and requires complete per-record semantic checks',async()=>{
  assert.ok(existsSync(engineUrl),'缺少电商评论批次检查引擎');
  const {mergeEcommerceResults,timeJudgment}=await import(engineUrl);
  const {EC_HEADERS,EC_RULE_IDS}=await import('../public/ecommerce-schema.mjs');
  const make=(id,agent='虚构小王',reply='感谢您对虚构商品的支持。',comment='虚构商品很好。')=>{
    const raw=Array(22).fill('');raw[8]=comment;raw[9]=reply;raw[11]=agent;raw[12]='2026-10-23 20:00:00';raw[13]='2026-10-24 21:00:00';
    raw[15]='HUMAN-ANSWER-DO-NOT-SEND';
    return{id,agent,scene:'电商评论回复',turns:[{id:1,role:'客户',text:comment},{id:2,role:'客服',text:reply}],contextFields:[],ecommerce:{schemaVersion:1,sheet:'Sheet4',row:3+Number(id.slice(1)),fileSha256:'a'.repeat(64),headers:[...EC_HEADERS],standards:Array(22).fill('测试标准'),raw,thresholdHours:24}};
  };
  const sessions=[make('s1'),make('s2'),make('s3'),make('s4','虚构小李'),make('s5','虚构小张')];
  const semanticResults=sessions.map(s=>({sessionId:s.id,results:EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:'符合',reason:'虚构语义核对',evidence:[2],referenceIds:[]}))}));
  const merged=mergeEcommerceResults({sessions,semanticResults,duplicateGroups:[]});
  assert.equal(timeJudgment(sessions[0]).verdict,'不符合');assert.match(timeJudgment(sessions[0]).reason,/25小时/);
  for(const s of sessions.slice(0,3)){assert.equal(merged.get(s.id).find(r=>r.ruleId==='EC-TARGET').verdict,'不符合');assert.deepEqual(merged.get(s.id).find(r=>r.ruleId==='EC-TARGET').batchEvidence[0].sessionIds,['s1','s2','s3']);}
  assert.equal(merged.get('s4').find(r=>r.ruleId==='EC-TARGET').verdict,'符合');
  const longSemantic=structuredClone(semanticResults);longSemantic[0].results.find(r=>r.ruleId==='EC-TARGET').reason='x'.repeat(20000);
  const longMerged=mergeEcommerceResults({sessions,semanticResults:longSemantic,duplicateGroups:[]}).get('s1').find(r=>r.ruleId==='EC-TARGET');
  assert.ok(longMerged.reason.length<=20000,'合并的合法模型理由不得超出保存上限');assert.equal(longMerged.semanticReason.length,20000);
  assert.throws(()=>mergeEcommerceResults({sessions,semanticResults:semanticResults.slice(1),duplicateGroups:[]}),/完整|覆盖|语义/);
  assert.throws(()=>mergeEcommerceResults({sessions,semanticResults,duplicateGroups:[{sessionIds:['s1','s2','s4'],reason:'伪造跨管理员组'}]}),/管理员|批次|重复/);
  sessions[0].ecommerce.raw[13]='2026-10-24 20:00:00';assert.equal(timeJudgment(sessions[0]).verdict,'符合');
  sessions[0].ecommerce.raw[12]=' '.repeat(15000)+'2026-10-23 20:00:00';sessions[0].ecommerce.raw[13]=' '.repeat(15000)+'2026-10-24 20:00:00';assert.ok(timeJudgment(sessions[0]).reason.length<=20000);
  sessions[0].ecommerce.raw[12]='2026-10-23 20:00:00';
  sessions[0].ecommerce.raw[13]='2026-02-30 20:00:00';assert.equal(timeJudgment(sessions[0]).verdict,'无法判定');
  sessions[0].ecommerce.raw[13]='2026-10-23 19:00:00';assert.equal(timeJudgment(sessions[0]).verdict,'无法判定');
  sessions[0].ecommerce.raw[9]='';sessions[0].turns=sessions[0].turns.slice(0,1);
  assert.equal(mergeEcommerceResults({sessions,semanticResults,duplicateGroups:[]}).get('s1').find(r=>r.ruleId==='EC-PRIVACY').verdict,'无法判定');
});

test('numeric and mixed date cells feed the real time judgment with strict 24-hour and millisecond boundaries', async () => {
  const { EC_HEADERS } = await import('../public/ecommerce-schema.mjs');
  const { timeJudgment } = await import(engineUrl);
  const examples = [
    ['46325.833333333336', String(46326 + (20 * 3600 - 1) / 86400), '符合', '23小时59分59秒'],
    ['46325.833333333336', '46326.833333333336', '符合', '24小时0分0秒'],
    ['46325.833333333336', String(46326 + (20 * 3600 + 1) / 86400), '不符合', '24小时0分1秒'],
    ['46325.833333333336', '2026-10-31T20:00:00.001+08:00', '不符合', '24小时0分0秒'],
    ['2026-10-30T20:00:00.00049+08:00', '46326.833333333336', '符合', '24小时0分0秒'],
    ['2026-10-30T20:00:00.0005+08:00', '2026-10-31T20:00:00.001+08:00', '符合', '24小时0分0秒'],
    ['0', '46326.833333333336', '无法判定', '格式无效'],
    ['73416', '46326.833333333336', '无法判定', '格式无效'],
    ['2026-02-30 09:00:00', '46326.833333333336', '无法判定', '格式无效'],
    ['NaN', '46326.833333333336', '无法判定', '格式无效'],
    ['46326.833333333336', '46325.833333333336', '无法判定', '早于'],
  ];
  const rows = examples.map(([commentTime, replyTime], i) => {
    const r = Array(22).fill(''); r[8] = `虚构评论${i}`; r[9] = '虚构回复'; r[11] = '虚构管理员'; r[12] = commentTime; r[13] = replyTime; return r;
  });
  const bytes = await workbook([{ name: 'Sheet4', headers: [...EC_HEADERS], rows: [Array(22).fill(''), ...rows] }]);
  const parsed = await parseEcommerceFile({ name: 'numeric-boundaries.xlsx', size: bytes.length, arrayBuffer: async () => bytes });
  assert.equal(parsed.valid, true, parsed.errors.join('；'));
  for (const [i, session] of parsed.sessions.entries()) {
    const result = timeJudgment(session);
    assert.equal(result.verdict, examples[i][2], `fixture row ${i + 3}`);
    assert.ok(result.reason.includes(examples[i][3]), result.reason);
    assert.deepEqual(result.fieldEvidence, ['commentTime', 'replyTime']);
    assert.equal(session.ecommerce.raw[12], examples[i][0]);
    assert.equal(session.ecommerce.raw[13], examples[i][1]);
  }
});
