// Report evidence scope only. This never changes imported turns or quality results.
export const CUSTOMER_ONLY='customer_only';
export const CONVERSATION_UNVERIFIED='conversation_unverified';
export function normalizeRoleEvidenceMode(value=CUSTOMER_ONLY){
 if(![CUSTOMER_ONLY,CONVERSATION_UNVERIFIED].includes(value))throw new Error('角色引用口径无效，请选择客户角色原声或会话原文（角色未核验）。');
 return value;
}
export const unverifiedRoleEvidence=snapshot=>snapshot?.deliveryType==='consultation-v1'&&(snapshot.inputMode==='raw-transcript-v1'||normalizeRoleEvidenceMode(snapshot.roleEvidenceMode)===CONVERSATION_UNVERIFIED);
export function assertRoleEvidenceSupport(snapshot,config){
 const mode=snapshot?.inputMode==='raw-transcript-v1'?CONVERSATION_UNVERIFIED:normalizeRoleEvidenceMode(snapshot?.roleEvidenceMode);
 if(mode===CONVERSATION_UNVERIFIED&&(snapshot?.deliveryType!=='consultation-v1'||snapshot?.inputMode!=='raw-transcript-v1'&&config?.customFields?.some(field=>field.type==='quote')))throw new Error('会话原文（角色未核验）仅支持会话报告主分析；不支持电商报告或自定义客户原声字段，请修正源角色后使用客户角色口径。');
 return mode;
}
export function roleEvidenceNotice(language='zh',snapshot){
 if(snapshot?.inputMode==='raw-transcript-v1')return language==='en'?'Raw original row evidence · Roles unverified. Exact quotations are anchored to this archived row. Conversation concern leads do not establish the speaker or confirmed customer VOC. Source agent accounts are metadata, and no turn or role is invented.':'归档原文逐字证据 · 角色未核验。引文锚定本行原始单元格，会话诉求线索不证明发言方或已确认客户原声。源表客服账号仅是关联元数据，不补造角色或轮次。';
 return language==='en'?'Conversation evidence · Roles unverified. These are conversation concern leads awaiting speaker verification, not verified customer VOC. Original roles and source columns are preserved. Existing AI agent-behavior judgments are historical reference and may be affected by source role errors. This option does not change AI or human quality results. Correct source roles, create a new task and rerun quality checks and reports.':'会话原文 · 角色未核验：仅生成待核验发言方的会话诉求线索，不能作为已核验客户VOC。保留原角色和源列；旧AI客服行为结果可能受源角色错误影响，仅作历史参考。本选项不修改AI或人工质检结果；请修正源角色后新建任务，重新质检并生成报告。';
}
export function groundedConversationQuote(record,quote,turnId){
 if(record?.inputMode==='raw-transcript-v1')return typeof quote==='string'&&Boolean(quote.trim())&&typeof record.conversation==='string'&&record.conversation.includes(quote)&&record.rawTranscript?.text===record.conversation;
 return typeof quote==='string'&&Boolean(quote.trim())&&typeof record?.conversation==='string'&&record.conversation.includes(quote)&&Array.isArray(record.turns)&&record.turns.some(turn=>Number.isSafeInteger(turn.id)&&(turnId===undefined||turn.id===turnId)&&typeof turn.text==='string'&&turn.text.includes(quote));
}
