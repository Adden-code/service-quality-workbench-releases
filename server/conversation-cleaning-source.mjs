import {inspectConversationCleaningFile} from '../public/conversation-cleaning.mjs';
/** Confirm audit rows against the immutable, content-addressed source file. */
export async function validateCleaningSource(snapshot,bytes,source){
 const parsed=await inspectConversationCleaningFile({name:source.name,size:bytes.length,arrayBuffer:async()=>bytes},{scene:snapshot.scene,sheet:snapshot.sheet,headerRow:snapshot.headerRow,idColumn:snapshot.columns.id,agentColumn:snapshot.columns.agent,textColumn:snapshot.columns.text,timezone:snapshot.timezone});
 if(!parsed.valid||parsed.draft.rows.length!==snapshot.rows.length)throw new Error('清洗报告与保存的原件行数或结构不一致。');
 for(let i=0;i<parsed.draft.rows.length;i++){const original=parsed.draft.rows[i],saved=snapshot.rows[i];if(original.row!==saved.row||['id','agent','text'].some(key=>original.original[key]!==saved.original?.[key]))throw new Error('清洗报告的原文与保存的源单元格不一致。');}
 return true;
}
