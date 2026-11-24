import {ruleAdvisory} from './rule-advisory.mjs';
import {newProductContentGaps} from './rule-content-health.mjs';
import {ruleKindOf} from './rule-kind.mjs';
import {d as businessText,businessContent,translationControls} from './content-translation-ui.mjs';
import {html as uiHtml,uiLiteral,uiAttributes,t as uiT,translateError as uiError,getLocale} from './i18n.mjs';
import {e,icon,badge,empty} from './ui.mjs';
import {pageHead} from './views.mjs';
import {catalogScenes,catalogRecordMatchesScene,UNASSIGNED_SCENE} from './catalog-scenes.mjs';
import {sceneOwnershipLabel} from './catalog-scene-ui.mjs';
import {findScenario,scenarioForTask} from './scenarios.mjs';

function usesEcommerceRuleSets(catalog,ui,state){
  if(ui.catalogScene)return findScenario(state,ui.catalogScene)?.engine==='ecommerce';
  if(catalog.ruleSets?.length||state.tasks?.some(task=>scenarioForTask(task)?.engine==='ecommerce'))return true;
  const records=[...(catalog.rules||[]),...(catalog.policies||[])];
  // Built-in scenarios are always registered; actual ownership determines the
  // entry in an unfiltered, consultation-only workspace.
  return !records.length||records.some(record=>catalogScenes(state).some(scene=>findScenario(state,scene.id)?.engine==='ecommerce'&&catalogRecordMatchesScene(record,scene.id,{state,catalog,kind:catalog.rules?.includes(record)?'rules':'policies'})));
}

export const kindLabel=kind=>kind==='rules'?'规则':'资料';
export const validityLabel=(record,date=new Date(Date.now()+8*3600000).toISOString().slice(0,10))=>record.effectiveAt>date?'未到生效日':record.expiresAt&&record.expiresAt<=date?'已过有效期':'有效期内';
export const versionSort=(a,b)=>{const aa=a.version.slice(1).split('.').map(Number),bb=b.version.slice(1).split('.').map(Number);return bb[0]-aa[0]||bb[1]-aa[1];};
export function versionOptions(records,selected){return records.slice().sort(versionSort).map(record=>uiHtml`<option value="${e(record.version)}" ${record.version===selected?'selected':''}>${e(record.version)} · ${e(uiT(record.status))}</option>`).join('');}
export function catalogPage(catalog,kind,ui,warning='',state={}){
  const records=catalog[kind],query=(ui.catalogQuery||'').toLowerCase(),category=ui.catalogCategory||'',status=ui.catalogStatus||'';
  const groups=[...new Set(records.map(record=>record.id))].map(id=>{
    const versions=records.filter(record=>record.id===id).sort(versionSort);
    const selected=versions.find(record=>(!ui.catalogScene||catalogRecordMatchesScene(record,ui.catalogScene,{state,catalog,kind}))&&(status?record.status===status:record.status!=='已弃用')&&(!category||record.category===category)&&`${record.title} ${record.id} ${record.scope} ${record.sections?.map(section=>section.text).join(' ')}`.toLowerCase().includes(query));
    return selected?{record:selected,versions}:null;
  }).filter(Boolean);
  if(kind==='rules')groups.sort((a,b)=>Number(ruleKindOf(a.record)==='meta')-Number(ruleKindOf(b.record)==='meta'));
  const builtinDelivery=state.sceneConfigurationEvents?.some(event=>['builtin-install','builtin-upgrade'].includes(event.action));
  const gaps=kind==='rules'?newProductContentGaps({rules:groups.map(g=>g.record).filter(r=>r.status==='已发布')}):[];
  if(gaps.length)warning+=(warning?'\n':'')+(getLocale()==='en'?'Incomplete NP rule content: ':'新品规则内容缺项：')+gaps.join('、')+(getLocale()==='en'?'. In Scenario Management, load the bundled update, then create a new task or reinspect. Frozen old tasks remain unchanged.':'。装载新版后请新建任务或重检；旧任务冻结依据保持不变。');
  const label=kindLabel(kind),policies=kind==='policies',categories=[...new Set(records.map(record=>record.category))],ecommerce=usesEcommerceRuleSets(catalog,ui,state);
  const updateEntry=kind==='rules'&&(builtinDelivery||gaps.length)?`<div class="soft-note builtin-update-entry"><span>${getLocale()==='en'?'Bundled rule updates preserve frozen task history.':'安装包规则更新通过新版本发布，保留历史任务依据。'}</span><button class="btn small" data-act="scfg-builtin-open" data-scene="新品产品咨询">${getLocale()==='en'?'Load bundled update':'从安装包装载新版'}</button></div>`:'';
  return uiHtml`${updateEntry}${pageHead(policies?'政策与知识':'质检规则',policies?'统一维护资料、条款和发布版本。':'维护检查标准、适用范围和版本变更。',policies?uiHtml`<button class="btn" data-act="catalog-template">${icon('file',14)}下载模板</button><button class="btn" data-act="catalog-export">${icon('export',14)}导出资料</button><button class="btn primary" data-act="catalog-import">${icon('plus',14)}导入资料</button>`:uiHtml`<button class="btn" data-act="calibration-open">规则级标定与免审</button><button class="btn" data-act="catalog-deletions">规则删除审计</button>${ecommerce?state.sceneConfigurations?.some(c=>c.sceneId==='电商评论回复'&&c.status==='published'&&c.basis?.executionProfile==='ec-business-v1')?uiHtml`<button class="btn" data-act="scfg-open" data-id="电商评论回复">电商检核口径与配置</button>`:uiHtml`<button class="btn" data-act="ruleset-list">电商检核口径</button>`:''}<button class="btn" data-act="catalog-rule-template">下载规则模板</button><button class="btn" data-act="catalog-rule-import">导入规则模板</button>${builtinDelivery?'':uiHtml`<button class="btn" data-act="rule-import-open">规则导入（模型辅助）</button>`}<button class="btn primary" data-act="catalog-new-rule">${icon('plus',14)}新增规则</button>`)}
    ${translationControls({kind:'catalog',section:kind})}
    ${ui.hasSuspendedTaskDraft?uiHtml`<div class="catalog-task-resume soft-note"><span>已上传的任务草稿保留在当前页面会话中。</span><button class="btn" data-act="new-resume-draft">返回任务向导</button></div>`:''}
    ${warning?uiHtml`<div class="storage-warning">${e(warning)}</div>`:''}
    <div class="catalog-boundary">${icon('info',15)}<span>已发布的有效版本可绑定新任务；已有任务保留创建时的依据。${ecommerce?uiT('电商检核口径仅用于电商评论回复；会话检核规则在本目录维护。'):''}</span></div>
    <div class="catalog-summary"><span><b>${new Set(records.map(record=>record.id)).size}</b> ${uiT(label)}</span><span><b>${records.filter(record=>record.status==='草稿').length}</b> 草稿</span><span><b>${records.length}</b> 历史版本</span><span class="catalog-summary-tail">版本管理 · 本机工作区保存</span></div>
    <div class="section-toolbar catalog-toolbar"><div class="search">${icon('search',15)}<input id="catalog-search" value="${e(ui.catalogQuery||'')}" placeholder="搜索名称、标识或内容" aria-label="搜索${uiT(label)}"></div><div class="toolbar-group"><select class="compact-select" id="catalog-scene" aria-label="场景筛选"><option value="">全部场景</option><option value="${UNASSIGNED_SCENE}" ${ui.catalogScene===UNASSIGNED_SCENE?'selected':''}>未分配</option>${catalogScenes(state).map(scene=>uiHtml`<option value="${e(scene.id)}" ${ui.catalogScene===scene.id?'selected':''}>${e(uiT(scene.name))}</option>`).join('')}</select><select class="compact-select" id="catalog-category" aria-label="${uiT(label)}类别"><option value="">全部类别</option>${categories.map(value=>uiHtml`<option value="${e(value)}" ${category===value?'selected':''}>${e(uiT(value))}</option>`).join('')}</select><select class="compact-select" id="catalog-status" aria-label="版本状态"><option value="">全部状态</option>${['草稿','已发布','已停用','已弃用'].map(value=>uiHtml`<option value="${e(value)}" ${status===value?'selected':''}>${uiT(value)}</option>`).join('')}</select></div></div>
    <div class="catalog-grid managed-catalog">${groups.length?groups.map(({record,versions},index)=>uiHtml`${kind==='rules'&&(index===0||ruleKindOf(groups[index-1].record)!==ruleKindOf(record))?uiHtml`<h2 class="catalog-scope-heading">${uiT(ruleKindOf(record)==='meta'?'交付物要求':'会话检核')}</h2>`:''}<article class="catalog-card"><div class="catalog-card-head"><span class="mono">${e(record.id)}</span>${badge(record.status,record.status==='已发布'?'success':record.status==='草稿'?'blue':'muted')}</div><h3>${e(getLocale()==='en'&&record.english?record.english.title:businessText(record.title))}</h3>${getLocale()==='en'&&record.english?uiHtml`<p class="rule-english-summary">${e(record.english.summary)}</p>`:''}${kind==='rules'?badge(ruleKindOf(record)==='meta'?'交付物要求':'会话检核',ruleKindOf(record)==='meta'?'muted':'blue'):''}<p>${e(getLocale()==='en'&&record.english?record.english.scope:businessText(record.scope))}</p>${kind==='rules'&&ruleKindOf(record)!=='meta'&&ruleAdvisory(record)?uiHtml`<div class="soft-note warning" data-rule-advisory>${e(ruleAdvisory(record))}</div>`:''}<div class="catalog-record-meta"><span>${e(sceneOwnershipLabel(record,{state,catalog,kind}))}</span><span>${e(businessText(record.category))}</span><span>${e(record.version)} · 生效 ${e(record.effectiveAt)}</span><span>维护人 ${e(businessText(record.owner))} · ${uiT(validityLabel(record))}</span></div><div class="card-footer"><span>${versions.length} 个版本${record.status==='草稿'?uiT(' · 未发布'):''}</span><button class="text-btn" data-act="catalog-open" data-kind="${kind}" data-id="${e(record.id)}" data-version="${e(record.version)}">查看与管理${icon('chevron',12)}</button></div></article>`).join(''):!records.length&&kind==='rules'?uiHtml`<div class="empty"><h3>规则目录为空。先下载规则模板，填写并导入草稿，再核对发布。</h3><p>下载模板 → 填写规则 → 导入草稿 → 核对发布</p><p>也可使用“新增规则”逐项填写，规则整理为可选的模型辅助入口。</p><div class="toolbar-group"><button class="btn" data-act="catalog-rule-template">下载规则模板</button><button class="btn primary" data-act="catalog-rule-import">导入规则模板</button></div></div>`:empty('没有匹配的规则或资料','可以调整搜索、类别或版本状态。')}</div>`;
}
