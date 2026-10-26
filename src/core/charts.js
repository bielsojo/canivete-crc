/* Gráficos com Chart.js usando as cores do tema atual (lidas dos tokens CSS). */
import Chart from 'chart.js/auto';
import { cssVar } from './theme.js';

export const series = () => ['--c1','--c2','--c3','--c4','--c5','--c6','--c7','--c8'].map(cssVar);

function applyDefaults(){
  Chart.defaults.color = cssVar('--muted');
  Chart.defaults.font.family = "Inter, system-ui, sans-serif";
  Chart.defaults.font.size = 11.5;
  Chart.defaults.borderColor = cssVar('--grid');
  const l = Chart.defaults.plugins.legend.labels;
  l.boxWidth = 10; l.boxHeight = 10; l.padding = 12; l.usePointStyle = true; l.pointStyle = 'rectRounded';
  const t = Chart.defaults.plugins.tooltip;
  t.backgroundColor = cssVar('--text'); t.titleColor = cssVar('--bg'); t.bodyColor = cssVar('--bg');
  t.padding = 10; t.cornerRadius = 8; t.displayColors = true; t.boxPadding = 4;
}

// onPick(index) é chamado ao clicar num segmento/barra.
function clickable(onPick){
  if (!onPick) return {};
  return {
    onClick: (evt, els) => { if (els.length) onPick(els[0].index); },
    onHover: (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; }
  };
}

export function donut(canvas, labels, data, colors, onPick){
  applyDefaults();
  return new Chart(canvas, {
    type:'doughnut',
    data:{labels, datasets:[{data, backgroundColor:colors || series(), borderWidth:2, borderColor:cssVar('--surface'), hoverOffset:6}]},
    options:{cutout:'66%', responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom'}}, ...clickable(onPick)}
  });
}

export function hbar(canvas, labels, data, color, onPick){
  applyDefaults();
  return new Chart(canvas, {
    type:'bar',
    data:{labels, datasets:[{label:'Chamados', data, backgroundColor:color, borderRadius:5, borderSkipped:false, barPercentage:.78, categoryPercentage:.9}]},
    options:{indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
      scales:{x:{grid:{color:cssVar('--grid')}, ticks:{precision:0}, border:{display:false}}, y:{grid:{display:false}, border:{display:false}, ticks:{font:{size:11}, callback(v){ const s = this.getLabelForValue(v); return s.length > 28 ? s.slice(0, 27) + '…' : s; }}}},
      ...clickable(onPick)}
  });
}

export function vbar(canvas, labels, data, color){
  applyDefaults();
  return new Chart(canvas, {
    type:'bar',
    data:{labels, datasets:[{label:'Chamados', data, backgroundColor:color, borderRadius:5, borderSkipped:false, barPercentage:.72}]},
    options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
      scales:{y:{grid:{color:cssVar('--grid')}, ticks:{precision:0}, border:{display:false}}, x:{grid:{display:false}, border:{display:false}}}}
  });
}
