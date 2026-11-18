import {html as uiHtml,t as uiT} from './i18n.mjs';
import {e} from './ui.mjs';
import {catalogScenes,catalogRecordSceneIds} from './catalog-scenes.mjs';

export function sceneAssignmentFields(state,selected=[],{name='catalog-scene-id'}={}){
  return uiHtml`<fieldset class="field-group catalog-scene-assignment"><legend class="field-label">场景归属</legend><div class="checks">${catalogScenes(state).map(scene=>uiHtml`<label><input type="checkbox" name="${e(name)}" value="${e(scene.id)}" ${selected.includes(scene.id)?'checked':''}><span>${e(uiT(scene.name))}${scene.enabled?'':uiT('（已停用）')}</span></label>`).join('')}</div><p class="hint">可选择多个场景；全部不选则保持未分配，新任务不会使用。</p></fieldset>`;
}
export function sceneOwnershipLabel(record,{state={},catalog={},kind='rules'}={}){
  const choices=catalogScenes(state),ids=catalogRecordSceneIds(record,{state,catalog,kind});
  return ids.map(id=>uiT(choices.find(scene=>scene.id===id)?.name||id)).join('、')||uiT('未分配');
}
