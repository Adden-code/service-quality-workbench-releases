import {html as uiHtml,uiLiteral,uiAttributes,t as uiT,translateError as uiError} from './i18n.mjs';
import {e} from './ui.mjs';

// Shared by overview and offline management exports. Both series count sessions.
export function reviewTrendChart(points=[]){
  if(!points.length||!points.some(point=>point.reviewed))return uiLiteral('<div class="chart-empty">暂无人工已确认结果，完成审核后展示会话趋势。</div>');
  const width=640,height=216,pad={left:38,right:25,top:23,bottom:34};
  const max=Math.ceil(Math.max(4,...points.map(point=>point.reviewed||0))/4)*4;
  const x=index=>pad.left+index*(width-pad.left-pad.right)/Math.max(1,points.length-1);
  const y=value=>height-pad.bottom-value/max*(height-pad.top-pad.bottom);
  const line=key=>points.map((point,index)=>`${index?'L':'M'}${x(index).toFixed(1)},${y(point[key]||0).toFixed(1)}`).join(' ');
  const ticks=new Set(Array.from({length:Math.min(6,points.length)},(_,index)=>Math.round(index*(points.length-1)/Math.max(1,Math.min(6,points.length)-1))));
  return uiHtml`<div class="trend-scroll"><svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="已审核会话数与问题会话数趋势，单位：条">
    <desc>按审核完成日期汇总。问题会话为至少含一项人工最终不符合结果的会话，每条最多计一次。</desc>
    <text class="chart-axis" x="4" y="13">条</text>
    ${[0,1,2,3,4].map(index=>{const value=max*index/4;return uiHtml`<line class="grid" x1="${pad.left}" y1="${y(value)}" x2="${width-pad.right}" y2="${y(value)}"/><text class="chart-axis" x="24" y="${y(value)+5}" text-anchor="end">${uiT(value)}</text>`;}).join('')}
    <path class="series" data-series="reviewed" d="${line('reviewed')}" fill="none" stroke="#b42332" stroke-width="2.2"/>
    <path class="series-secondary" data-series="problems" d="${line('problems')}" fill="none" stroke="#71869e" stroke-width="2.2" stroke-dasharray="5 4"/>
    ${points.map((point,index)=>uiHtml`<g tabindex="0" data-date="${e(point.label)}" data-reviewed="${point.reviewed||0}" data-problems="${point.problems||0}" aria-label="${e(point.label)}，已审核${point.reviewed||0}条，问题会话${point.problems||0}条"><title>${e(point.label)} · 已审核 ${point.reviewed||0} 条 · 问题会话 ${point.problems||0} 条</title><circle cx="${x(index)}" cy="${y(point.reviewed||0)}" r="3.2" fill="#fff" stroke="#b42332" stroke-width="1.7"/><circle cx="${x(index)}" cy="${y(point.problems||0)}" r="2.1" fill="#71869e"/></g>${ticks.has(index)?uiHtml`<text class="chart-axis" x="${x(index)}" y="${height-7}" text-anchor="middle">${e(String(point.label).slice(-5).replace('-','.'))}</text>`:''}`).join('')}
  </svg></div>`;
}
