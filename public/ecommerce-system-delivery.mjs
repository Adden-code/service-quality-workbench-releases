import {defaultScenePackage,resolveSceneRuntime} from './scene-configuration.mjs';
// Render old-config/new-input combinations without mutating their frozen task.
// Physical source columns still come from systemSource, never the engine adapter.
export function systemDeliveryView(snapshot){
 if(snapshot.sourceFormat!=='business-export-23.v1'||snapshot.executionSnapshot)return snapshot;
 const basis={rules:snapshot.basis.ruleVersions.map(r=>({id:r.id,version:r.version,title:r.label})),policies:[]},pkg=defaultScenePackage({id:'电商评论回复',name:'电商评论回复',engine:'ecommerce'},basis);
 pkg.template.renderMode='configured';pkg.template.columns=pkg.template.columns.filter(c=>!/^historical(?::|Overall)/.test(c.field||''));
 return{...snapshot,executionSnapshot:{configuration:pkg.configuration,template:pkg.template,runtime:resolveSceneRuntime(pkg.configuration)},sceneAudit:snapshot.records.map(r=>({id:r.id,externalId:r.externalId||r.id,product:r.raw22[7],agent:r.raw22[11],ai:r.ai.map(x=>({...x,ruleId:x.id})),review:{status:r.confirmed.some(x=>x.source==='confirmed')?'已确认':'待审核',drafts:{},history:[]}}))};
}
