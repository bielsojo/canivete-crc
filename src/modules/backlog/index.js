/* Backlog de chamados (GLPI) — BI com filtros cruzados, dias úteis em aberto e insights.
   Os dados vêm do CSV exportado do GLPI (enriquecido pelo process_backlog.py) e ficam só neste
   navegador (IndexedDB); nada é enviado para o servidor. */
import Papa from 'papaparse';
import { donut, hbar, vbar, series } from '../../core/charts.js';
import { cssVar } from '../../core/theme.js';
import { dbStore } from '../../core/db.js';
import { $, $$, ic, esc, nf, plural, toast, ask, alertBox, progress, pageHead, emptyBox, pagerNums, dropzone, download } from '../../core/ui.js';

const PAGE_SIZE = 50;
const B = {
  raw:[], filtered:[], rows:[], charts:{}, cross:{}, kpi:null, page:1, sortCol:'days', sortDir:'desc',
  tab:'metricas', base:null, loaded:false, el:null, q:''
};

/* =====================================================================
   UTILITÁRIOS (mesma lógica do SojoBacklog v1.7)
   ===================================================================== */
const clean = s => { if (!s) return ''; return String(s).replace(/[\r\n]+/g, ' ').trim().replace(/^"|"$/g, ''); };
function parseDate(s){
  if (!s) return null;
  s = s.trim();
  let m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4] || 0, +m[5] || 0);
  m = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:\s+(\d{2}):(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4] || 0, +m[5] || 0);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
// Dias úteis (seg–sex) entre duas datas, sem contar o dia inicial.
function workingDaysBetween(a, b){
  if (!a || !b) return 0;
  const d1 = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const d2 = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  if (d1 >= d2) return 0;
  let n = 0; const cur = new Date(d1.getTime());
  while (cur < d2){ cur.setDate(cur.getDate() + 1); const w = cur.getDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}
const fmtDate = d => d ? d.toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit', year:'numeric'}) : '—';
function statusBadge(s){
  const l = (s || '').toLowerCase();
  const c = l.includes('atribuído') || l.includes('atribuido') ? 'b-acc' : l.includes('pendente') ? 'b-warn' : l.includes('solucionado') || l.includes('fechado') ? 'b-ok' : l.includes('planejado') ? 'b-res' : l.includes('novo') ? 'b-info' : '';
  return `<span class="badge ${c}">${esc(s || '—')}</span>`;
}
function prioBadge(p){
  const l = (p || '').toLowerCase();
  const c = l.includes('crit') ? 'b-bad' : l.includes('alta') ? 'b-warn' : l.includes('média') || l.includes('media') ? 'b-acc' : '';
  return p ? `<span class="badge ${c}">${esc(p)}</span>` : '<span class="muted">—</span>';
}
function counter(arr, key){ const c = {}; arr.forEach(r => { const v = r[key] || '(vazio)'; c[v] = (c[v] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]); }
function shortCat(c){ if (!c) return '(vazio)'; const p = c.split('>').map(s => s.trim()); return p.length > 2 ? p.slice(-2).join(' > ') : p.join(' > '); }
function shortEntity(e){ if (!e) return '(vazio)'; const p = e.split('>').map(s => s.trim()); return p[p.length - 1] || p[0]; }
function parseDuration(s){ if (!s || s === '0 segundo') return 0; let h = 0; const dm = s.match(/(\d+)\s*dia/); if (dm) h += +dm[1] * 24; const hm = s.match(/(\d+)\s*hora/); if (hm) h += +hm[1]; const mm = s.match(/(\d+)\s*minuto/); if (mm) h += +mm[1] / 60; return h; }
function fmtHours(h){ if (h === 0) return '0m'; const d = Math.floor(h / 24), rh = Math.floor(h % 24), rm = Math.round((h % 1) * 60); let s = ''; if (d) s += d + 'd '; if (rh) s += rh + 'h '; if (rm || !s) s += rm + 'm'; return s.trim(); }
const pct = (a, b) => b ? ((a / b) * 100).toFixed(1) : 0;

const RANGES = [
  {label:'0-3d',   min:0,  max:3,        color:'var(--ok)'},
  {label:'4-7d',   min:4,  max:7,        color:'var(--ok-cell)'},
  {label:'8-10d',  min:8,  max:10,       color:'var(--c3)'},
  {label:'11-19d', min:11, max:19,       color:'var(--warn)'},
  {label:'20-29d', min:20, max:29,       color:'color-mix(in srgb,var(--bad) 70%,var(--warn))'},
  {label:'30-89d', min:30, max:89,       color:'var(--bad)'},
  {label:'90+',    min:90, max:Infinity, color:'color-mix(in srgb,var(--bad) 70%,var(--text))'}
];
const FIELD_LABEL = {_status:'Status', _priority:'Prioridade', _tech:'Técnico', _requester:'Requerente', _category:'Categoria', _entity:'Entidade', _daysOpenRange:'Dias em aberto'};
const KPI_LABEL = {active:'Backlog ativo', solved:'Solucionados', stale:'Críticos (≥20d)', pending:'Pendentes'};

/* =====================================================================
   CARGA DO CSV
   ===================================================================== */
function processRows(data){
  const NOW = new Date();
  return data.map(row => {
    const r = {}; for (const k in row) r[clean(k)] = clean(row[k]);
    r._id = (r['ID'] || '').replace(/\s/g, '');
    r._status = r['Status'] || ''; r._priority = r['Prioridade'] || '';
    // o process_backlog.py junta vários técnicos com <br>
    r._tech = (r['Atribuído - Técnico'] || r['Atribuido - Tecnico'] || '').replace(/\s*<br\s*\/?>\s*/gi, ', ');
    r._requester = r['Requerente - Requerente'] || '';
    r._category = r['Categoria'] || ''; r._entity = r['Entidade'] || '';
    r._title = r['Título'] || r['Titulo'] || '';
    r._openDt = parseDate(r['Data de abertura']);
    r._updDt = parseDate(r['Última atualização'] || r['Ultima atualizacao'] || '');
    r._solTime = parseDuration(r['Estatísticas - Tempo de solução'] || r['Estatisticas - Tempo de solucao'] || '');
    const st = r._status.toLowerCase();
    r._isActive = !st.includes('solucionado') && !st.includes('fechado');
    r._daysOpen = r._openDt ? (r._isActive ? workingDaysBetween(r._openDt, NOW) : workingDaysBetween(r._openDt, r._updDt || NOW)) : null;
    r._isStale = r._isActive && r._daysOpen !== null && r._daysOpen >= 20;
    return r;
  }).filter(r => r._id);
}
function loadFile(file){
  progress(true, 'Lendo o CSV do GLPI', file.name, 30);
  Papa.parse(file, {
    delimiter:';', header:true, skipEmptyLines:'greedy', encoding:'UTF-8', transformHeader:h => clean(h),
    complete(res){
      const rows = processRows(res.data);
      progress(false);
      if (!rows.length){ alertBox('CSV sem chamados', 'Não encontrei a coluna <b>ID</b> ou o arquivo está vazio. Use a exportação CSV do GLPI (separada por ponto e vírgula).'); return; }
      B.base = {filename:file.name, dateStr:new Date().toLocaleString('pt-BR')};
      setData(rows);
      dbStore.save('backlog', B.base.filename, B.base.dateStr, B.raw).catch(e => console.error('IndexedDB backlog:', e));
      toast(`${nf(rows.length)} chamados carregados`);
    },
    error(err){ progress(false); toast('Erro ao ler o CSV: ' + err.message, 'err'); }
  });
}
function setData(rows){
  B.raw = rows; B.cross = {}; B.kpi = null; B.page = 1; B.loaded = true;
  draw();
}
async function loadCache(){
  try {
    const c = await dbStore.get('backlog');
    if (c && c.data && c.data.length){
      // recalcula dias úteis com a data de hoje
      const NOW = new Date();
      c.data.forEach(r => {
        r._daysOpen = r._openDt ? (r._isActive ? workingDaysBetween(r._openDt, NOW) : workingDaysBetween(r._openDt, r._updDt || NOW)) : null;
        r._isStale = r._isActive && r._daysOpen !== null && r._daysOpen >= 20;
      });
      B.base = {filename:c.filename, dateStr:c.dateStr};
      B.raw = c.data; B.loaded = true;
    }
  } catch(e){ console.error('IndexedDB backlog:', e); }
}
// Resumo usado pela página inicial.
export async function backlogResumo(){
  if (!B.loaded) await loadCache();
  if (!B.loaded) return null;
  return {total:B.raw.length, ativos:B.raw.filter(r => r._isActive).length, criticos:B.raw.filter(r => r._isStale).length, base:B.base};
}

/* =====================================================================
   TELA
   ===================================================================== */
function draw(){
  const el = B.el; if (!el) return;
  destroyCharts();
  if (!B.loaded){
    el.innerHTML = pageHead('Backlog de chamados', 'Painel de BI dos chamados do GLPI: carregue o CSV exportado para começar.') + `
      <button class="drop big" id="bdrop">${ic('up')}<b>Solte aqui o CSV do GLPI ou clique para escolher</b><span class="small">Exportação "CSV" da lista de chamados (separador ponto e vírgula). Os dados ficam só neste navegador.</span></button>
      <input type="file" id="bfile" accept=".csv" hidden>
      <div class="alert info" style="max-width:640px;margin:16px auto 0">${ic('info')}<span>Para preencher os técnicos que o GLPI não exporta, rode antes o <b>executar_backlog.bat</b> na pasta BACKLOG.</span></div>`;
    dropzone($('#bdrop'), $('#bfile'), f => loadFile(f[0]));
    return;
  }
  const opts = k => [...new Set(B.raw.map(r => r[k]))].filter(Boolean).sort();
  const sel = (id, label, all, k) => `<div class="field"><label for="${id}">${label}</label><select class="input" id="${id}" data-f="${k}"><option value="">${all}</option>${opts(k).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select></div>`;
  el.innerHTML = pageHead('Backlog de chamados', `${plural(B.raw.length, 'chamado')} · base <b>${esc(B.base.filename)}</b> (${esc(B.base.dateStr)})`,
    `<button class="btn" id="bup">${ic('up','sm')} Atualizar CSV</button><button class="btn ghost" id="bclr" title="Apaga os dados salvos neste navegador">${ic('trash','sm')} Limpar dados</button>`) + `
    <input type="file" id="bfile" accept=".csv" hidden>
    <div class="tabs"><button class="tab ${B.tab==='metricas'?'on':''}" data-tab="metricas">${ic('chart','sm')} Métricas</button><button class="tab ${B.tab==='insights'?'on':''}" data-tab="insights">${ic('bulb','sm')} Insights automáticos</button></div>
    <div class="fbar" id="bfilters">
      ${sel('fst','Status','Todos','_status')}${sel('fpr','Prioridade','Todas','_priority')}${sel('ftc','Técnico','Todos','_tech')}${sel('frq','Requerente','Todos','_requester')}
      <div class="field" style="max-width:140px"><label for="fdays">Mín. dias úteis</label><input class="input" type="number" min="0" id="fdays" placeholder="0"></div>
      <div class="field" style="max-width:170px"><label for="ffrom">Aberto de</label><input class="input" type="date" id="ffrom"></div>
      <div class="field" style="max-width:170px"><label for="fto">Até</label><input class="input" type="date" id="fto"></div>
      <button class="btn ghost" id="freset">${ic('x','sm')} Limpar filtros</button>
    </div>
    <div class="fchips hidden" id="bchips"></div>
    <div id="bbody"></div>`;
  $('#bup').onclick = () => $('#bfile').click();
  $('#bfile').onchange = e => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; };
  $('#bclr').onclick = async () => {
    if (!await ask('Limpar dados do backlog?', 'Os chamados salvos neste navegador serão apagados. Você pode carregar o CSV de novo depois.', 'Limpar', 'bad')) return;
    await dbStore.clear('backlog'); B.raw = []; B.loaded = false; B.base = null; draw();
  };
  $$('.tab', el).forEach(t => t.onclick = () => { B.tab = t.dataset.tab; $$('.tab', el).forEach(x => x.classList.toggle('on', x === t)); drawBody(); });
  $$('#bfilters select, #bfilters input', el).forEach(i => i.addEventListener(i.type === 'number' ? 'input' : 'change', applyFilters));
  $('#freset').onclick = () => { $$('#bfilters select, #bfilters input', el).forEach(i => i.value = ''); B.cross = {}; B.kpi = null; applyFilters(); };
  $('#bchips').addEventListener('click', e => {
    const b = e.target.closest('[data-rm]'); if (!b) return;
    if (b.dataset.rm === '__kpi') B.kpi = null; else delete B.cross[b.dataset.rm];
    applyFilters();
  });
  applyFilters();
}

function applyFilters(){
  const v = id => ($('#' + id) || {}).value || '';
  const st = v('fst'), pr = v('fpr'), tc = v('ftc'), rq = v('frq'), minDays = v('fdays');
  const from = v('ffrom') ? new Date(v('ffrom') + 'T00:00:00') : null;
  const to = v('fto') ? new Date(v('fto') + 'T23:59:59') : null;
  B.filtered = B.raw.filter(r => {
    if (st && r._status !== st) return false;
    if (pr && r._priority !== pr) return false;
    if (tc && r._tech !== tc) return false;
    if (rq && r._requester !== rq) return false;
    if (minDays){ if (r._daysOpen === null || r._daysOpen < parseInt(minDays)) return false; }
    if (from && r._openDt && r._openDt < from) return false;
    if (to && r._openDt && r._openDt > to) return false;
    for (const [field, item] of Object.entries(B.cross)){
      if (field === '_daysOpenRange'){
        const rg = RANGES.find(x => x.label === item.value);
        if (rg && (r._daysOpen === null || r._daysOpen < rg.min || r._daysOpen > rg.max)) return false;
      } else {
        const rv = r[field], fv = item.value;
        const emptyF = fv === '(vazio)' || fv === '(não atribuído)' || !fv;
        const emptyR = !rv || rv === '(vazio)' || rv === '(não atribuído)';
        if (emptyF ? !emptyR : rv !== fv) return false;
      }
    }
    if (B.kpi === 'active' && !r._isActive) return false;
    if (B.kpi === 'solved' && !r._status.toLowerCase().includes('solucionado')) return false;
    if (B.kpi === 'stale' && !r._isStale) return false;
    if (B.kpi === 'pending' && !r._status.toLowerCase().includes('pendente')) return false;
    return true;
  });
  B.page = 1;
  drawChips();
  drawBody();
}
function setCross(field, value, label){
  if (B.cross[field] && B.cross[field].value === value) delete B.cross[field];
  else B.cross[field] = {value, label};
  applyFilters();
}
function drawChips(){
  const c = $('#bchips'); if (!c) return;
  const chips = Object.entries(B.cross).map(([f, it]) => `<span class="fchip"><span>${FIELD_LABEL[f] || f}: <b>${esc(it.label)}</b></span><button data-rm="${f}" title="Remover filtro">${ic('x','sm')}</button></span>`);
  if (B.kpi) chips.push(`<span class="fchip"><span>Indicador: <b>${KPI_LABEL[B.kpi]}</b></span><button data-rm="__kpi" title="Remover filtro">${ic('x','sm')}</button></span>`);
  c.classList.toggle('hidden', !chips.length);
  c.innerHTML = chips.length ? `<span class="small muted strong">${ic('filter','sm')}</span>` + chips.join('') : '';
}

function drawBody(){
  destroyCharts();
  const body = $('#bbody'); if (!body) return;
  if (B.tab === 'insights'){ body.innerHTML = `<div class="ins-grid">${insights()}</div>`; return; }
  const F = B.filtered;
  const t = F.length, a = F.filter(r => r._isActive).length, s = t - a;
  const stale = F.filter(r => r._isStale).length, pend = F.filter(r => r._status.toLowerCase().includes('pendente')).length;
  const sols = F.filter(r => r._solTime > 0).map(r => r._solTime), avg = sols.length ? sols.reduce((x, y) => x + y, 0) / sols.length : 0;
  const k = (key, icon, fg, bg, label, value, sub) => `<button class="card kpi ${key ? 'click' : ''} ${key && B.kpi === key ? 'on' : ''}" ${key ? `data-kpi="${key}"` : ''}>
    <div class="l"><span class="ico" style="color:${fg};background:${bg}">${ic(icon,'sm')}</span>${label}</div><div class="v">${value}</div><div class="s">${sub}</div></button>`;
  const card = (title, sub, inner, extra='') => `<div class="card"><div class="card-h"><h3>${title}</h3><span class="sub">${sub}</span></div><div class="card-b">${inner}</div>${extra}</div>`;
  body.innerHTML = `
    <div class="grid kpis6">
      ${k('all','inbox','var(--text-2)','var(--surface-2)','Total de chamados', nf(t), 'clique para limpar filtros')}
      ${k('active','fire','var(--bad)','var(--bad-soft)','Backlog ativo', nf(a), `${pct(a, t)}% do total`)}
      ${k('solved','check','var(--ok)','var(--ok-soft)','Solucionados', nf(s), `${pct(s, t)}% do total`)}
      ${k('','clock','var(--info)','var(--info-soft)','Tempo médio de solução', fmtHours(avg), plural(sols.length, 'amostra'))}
      ${k('stale','alert','var(--warn)','var(--warn-soft)','Críticos (≥20 dias úteis)', nf(stale), `${pct(stale, a)}% do backlog ativo`)}
      ${k('pending','pause','var(--res)','var(--res-soft)','Pendentes', nf(pend), 'aguardando retorno')}
    </div>
    <div style="margin-top:16px">${card('Dias em aberto (úteis)', `${nf(a)} ativos · média ${avgOpen(F)}d · clique numa faixa para filtrar`, `<div class="hist" id="bhist">${histHtml(F)}</div>`)}</div>
    <div class="grid cols3e" style="margin-top:16px">
      ${card('Status', 'clique para filtrar', '<div class="chart-box donut"><canvas id="cStatus"></canvas></div>')}
      ${card('Prioridade', 'clique para filtrar', '<div class="chart-box donut"><canvas id="cPrio"></canvas></div>')}
      ${card('Saúde do backlog', 'solucionados × ativos por idade', '<div class="chart-box donut"><canvas id="cHealth"></canvas></div>')}
    </div>
    <div class="grid cols2" style="margin-top:16px">
      ${card('Chamados por técnico', 'top 12 · clique para filtrar', '<div class="chart-box"><canvas id="cTech"></canvas></div>')}
      ${card('Top requerentes', 'top 12 · clique para filtrar', '<div class="chart-box"><canvas id="cReq"></canvas></div>')}
      ${card('Top categorias', 'top 10 · clique para filtrar', '<div class="chart-box"><canvas id="cCat"></canvas></div>')}
      ${card('Top entidades', 'top 10 · clique para filtrar', '<div class="chart-box"><canvas id="cEnt"></canvas></div>')}
      ${card('Abertura por dia', 'últimos 30 dias com registros', '<div class="chart-box"><canvas id="cTime"></canvas></div>')}
      ${card('Críticos por técnico', 'abertos há 20 dias úteis ou mais', '<div class="chart-box"><canvas id="cStale"></canvas></div>')}
    </div>
    <div class="tbl-wrap" style="margin-top:16px" id="btable">
      <div class="tbl-head"><h3 id="btitle"></h3><div style="display:flex;gap:8px;flex-wrap:wrap;flex:1;justify-content:flex-end">
        <div class="searchbox">${ic('search','sm')}<input class="input" type="search" id="bq" placeholder="Buscar ID, título, técnico, requerente, entidade" value="${esc(B.q)}"></div>
        <button class="btn" id="bexp">${ic('dl','sm')} Exportar CSV</button></div></div>
      <div class="tbl-scroll"><table><thead><tr id="bth"></tr></thead><tbody id="btb"></tbody></table></div>
      <div id="bpg"></div>
    </div>`;
  $$('[data-kpi]', body).forEach(b => b.onclick = () => {
    if (b.dataset.kpi === 'all'){ B.cross = {}; B.kpi = null; }
    else B.kpi = B.kpi === b.dataset.kpi ? null : b.dataset.kpi;
    applyFilters();
  });
  $('#bhist').addEventListener('click', e => { const b = e.target.closest('[data-range]'); if (b) setCross('_daysOpenRange', b.dataset.range, b.dataset.range); });
  $('#bq').addEventListener('input', e => { B.q = e.target.value; B.page = 1; drawTable(); });
  $('#bexp').onclick = exportCsv;
  $('#bth').addEventListener('click', e => {
    const th = e.target.closest('[data-col]'); if (!th) return;
    const c = th.dataset.col;
    if (B.sortCol === c) B.sortDir = B.sortDir === 'asc' ? 'desc' : 'asc';
    else { B.sortCol = c; B.sortDir = ['days','opened','updated'].includes(c) ? 'desc' : 'asc'; }
    B.page = 1; drawTable();
  });
  $('#bpg').addEventListener('click', e => { const b = e.target.closest('[data-pg]'); if (b && !b.disabled){ B.page = +b.dataset.pg; drawTable(); $('#btable').scrollIntoView({block:'start', behavior:'smooth'}); } });
  renderCharts();
  drawTable();
}
const avgOpen = F => { const l = F.filter(r => r._isActive && r._daysOpen !== null).map(r => r._daysOpen); return l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : 0; };
function histHtml(F){
  const act = F.filter(r => r._isActive), tot = act.length;
  const counts = RANGES.map(rg => ({...rg, n:act.filter(r => r._daysOpen !== null && r._daysOpen >= rg.min && r._daysOpen <= rg.max).length}));
  const max = Math.max(...counts.map(c => c.n), 1), on = B.cross._daysOpenRange && B.cross._daysOpenRange.value;
  return counts.map(c => `<button data-range="${c.label}" class="${on === c.label ? 'on' : ''}" title="${c.n} chamados com ${c.label} úteis em aberto">
    <span class="v">${nf(c.n)}</span><span class="p">${tot ? Math.round(c.n / tot * 100) : 0}%</span>
    <span class="bar" style="height:${Math.max(2, Math.round(c.n / max * 120))}px;background:${c.color}"></span><span class="l">${c.label}</span></button>`).join('');
}

function destroyCharts(){ Object.values(B.charts).forEach(c => c.destroy()); B.charts = {}; }
function renderCharts(){
  destroyCharts();
  if (!$('#cStatus')) return;
  const F = B.filtered, C = series();
  const pick = (field, labels, originals) => i => setCross(field, originals[i], labels[i]);
  const top = (key, n, lab) => { const L = [], V = [], O = []; counter(F, key).slice(0, n).forEach(([k, v]) => { L.push(lab(k)); V.push(v); O.push(k === '(vazio)' ? '' : k); }); return [L, V, O]; };

  const sd = counter(F, '_status');
  B.charts.status = donut($('#cStatus'), sd.map(d => d[0]), sd.map(d => d[1]), C, pick('_status', sd.map(d => d[0]), sd.map(d => d[0])));
  const pd = counter(F, '_priority');
  B.charts.prio = donut($('#cPrio'), pd.map(d => d[0]), pd.map(d => d[1]), [C[0], C[2], C[3], C[1], C[4], C[5]], pick('_priority', pd.map(d => d[0]), pd.map(d => d[0])));
  const act = F.filter(r => r._isActive && r._daysOpen !== null);
  B.charts.health = donut($('#cHealth'), ['Solucionados', 'Saudável (0-7d)', 'Atenção (8-19d)', 'Crítico (≥20d)'],
    [F.filter(r => !r._isActive).length, act.filter(r => r._daysOpen <= 7).length, act.filter(r => r._daysOpen >= 8 && r._daysOpen <= 19).length, act.filter(r => r._daysOpen >= 20).length],
    [cssVar('--ok'), cssVar('--ok-cell'), cssVar('--warn'), cssVar('--bad')]);

  let [L, V, O] = top('_tech', 12, k => k === '(vazio)' ? '(não atribuído)' : k);
  B.charts.tech = hbar($('#cTech'), L, V, C[0], pick('_tech', L, O));
  [L, V, O] = top('_requester', 12, k => k === '(vazio)' ? '(não informado)' : k);
  B.charts.req = hbar($('#cReq'), L, V, C[4], pick('_requester', L, O));
  [L, V, O] = top('_category', 10, shortCat);
  B.charts.cat = hbar($('#cCat'), L, V, C[6], pick('_category', L, O));
  [L, V, O] = top('_entity', 10, shortEntity);
  B.charts.ent = hbar($('#cEnt'), L, V, C[1], pick('_entity', L, O));

  const dc = {}; F.forEach(r => { if (r._openDt){ const k = isoDay(r._openDt); dc[k] = (dc[k] || 0) + 1; } });
  const td = Object.entries(dc).sort((a, b) => a[0].localeCompare(b[0])).slice(-30);
  B.charts.time = vbar($('#cTime'), td.map(d => new Date(d[0] + 'T12:00:00').toLocaleDateString('pt-BR', {day:'2-digit', month:'short'})), td.map(d => d[1]), C[0]);
  const st = {}; F.filter(r => r._isStale).forEach(r => { const t = r._tech || '(não atribuído)'; st[t] = (st[t] || 0) + 1; });
  const sbt = Object.entries(st).sort((a, b) => b[1] - a[1]).slice(0, 10);
  B.charts.stale = hbar($('#cStale'), sbt.map(d => d[0]), sbt.map(d => d[1]), cssVar('--bad'));
}
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const COLS = [['id','ID'],['title','Título'],['opened','Abertura'],['updated','Última ação'],['days','Dias úteis'],['status','Status'],['tech','Técnico'],['requester','Requerente'],['priority','Prioridade']];
function drawTable(){
  const q = B.q.toLowerCase();
  const L = B.filtered.filter(r => !q || r._id.toLowerCase().includes(q) || r._title.toLowerCase().includes(q) || r._tech.toLowerCase().includes(q) || r._requester.toLowerCase().includes(q) || r._entity.toLowerCase().includes(q));
  const dir = B.sortDir === 'asc' ? 1 : -1;
  const key = {id:r => r._id, title:r => r._title, opened:r => +(r._openDt || 0), updated:r => +(r._updDt || 0), days:r => r._daysOpen || 0, status:r => r._status, tech:r => r._tech, requester:r => r._requester, priority:r => r._priority}[B.sortCol] || (r => r._daysOpen || 0);
  L.sort((a, b) => { const x = key(a), y = key(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir; });
  B.rows = L;
  const title = B.kpi === 'stale' ? 'Chamados críticos (≥20 dias úteis)' : B.kpi === 'active' ? 'Backlog ativo' : B.kpi === 'solved' ? 'Chamados solucionados' : B.kpi === 'pending' ? 'Chamados pendentes'
    : Object.keys(B.cross).length ? 'Filtrado por: ' + Object.values(B.cross).map(i => i.label).join(' + ') : 'Lista de chamados';
  $('#btitle').innerHTML = `${ic('list','sm')} ${esc(title)} <span class="badge b-acc">${nf(L.length)}</span>`;
  $('#bth').innerHTML = COLS.map(([c, l]) => `<th class="sort ${B.sortCol === c ? 'on' : ''}" data-col="${c}">${l}${B.sortCol === c ? `<span class="arr">${B.sortDir === 'asc' ? '↑' : '↓'}</span>` : ''}</th>`).join('');
  const pg = L.slice((B.page - 1) * PAGE_SIZE, B.page * PAGE_SIZE);
  $('#btb').innerHTML = pg.map(r => {
    const d = r._daysOpen, dc = d >= 20 ? 'critical' : d >= 8 ? 'warning' : 'ok';
    return `<tr><td class="mono strong">${esc(r._id)}</td><td class="cut" title="${esc(r._title)}">${esc(r._title)}</td><td class="nowrap">${fmtDate(r._openDt)}</td><td class="nowrap">${fmtDate(r._updDt)}</td>
      <td><span class="days ${dc}">${d !== null ? d + 'd' : '—'}</span></td><td class="nowrap">${statusBadge(r._status)}</td><td class="small">${esc(r._tech) || '<span class="muted">—</span>'}</td>
      <td class="small">${esc(r._requester) || '<span class="muted">—</span>'}</td><td class="nowrap">${prioBadge(r._priority)}</td></tr>`;
  }).join('') || `<tr><td colspan="9">${emptyBox('search','Nenhum chamado encontrado','Ajuste a busca ou os filtros.')}</td></tr>`;
  $('#bpg').innerHTML = L.length ? pagerNums(L.length, B.page, PAGE_SIZE) : '';
}
function exportCsv(){
  if (!B.rows.length){ toast('Nenhum chamado no filtro para exportar', 'err'); return; }
  const data = B.rows.map(r => { const o = {}; for (const k in r) if (!k.startsWith('_')) o[k] = r[k]; return o; });
  download(new Blob(['﻿' + Papa.unparse(data, {delimiter:';'})], {type:'text/csv;charset=utf-8'}), `glpi_backlog_filtrado_${isoDay(new Date())}.csv`);
  toast('CSV exportado');
}

/* =====================================================================
   INSIGHTS AUTOMÁTICOS
   ===================================================================== */
function bars(list, color, label = n => n){
  const max = list.length ? list[0][1] : 1;
  return `<div class="blist">${list.map(([n, v]) => `<div class="brow"><span class="nm trunc" title="${esc(label(n))}">${esc(label(n))}</span><span class="t"><i style="width:${max ? v / max * 100 : 0}%;background:${color}"></i></span><span class="n">${v}</span></div>`).join('')}</div>`;
}
function insights(){
  const D = B.filtered, total = D.length;
  if (!total) return `<div class="card" style="grid-column:1/-1">${emptyBox('filter','Nenhum chamado nos filtros ativos')}</div>`;
  const active = D.filter(r => r._isActive), solved = D.filter(r => !r._isActive), stale = D.filter(r => r._isStale);
  const solTimes = D.filter(r => r._solTime > 0).map(r => r._solTime).sort((a, b) => a - b);
  const avgSol = solTimes.length ? solTimes.reduce((a, b) => a + b, 0) / solTimes.length : 0;
  const medianSol = solTimes.length ? solTimes[Math.floor(solTimes.length / 2)] : 0;
  const out = [];
  const card = (sev, icon, title, body) => out.push(`<div class="card ins ${sev}"><h4>${ic(icon)}${title}</h4>${body}</div>`);
  const groupStale = key => { const m = {}; stale.forEach(r => { const v = r[key] || '(vazio)'; m[v] = (m[v] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };

  const pSolved = pct(solved.length, total), pStale = pct(stale.length, active.length);
  const score = Math.max(0, Math.round(100 - (+pStale * 0.6) - ((100 - +pSolved) * 0.4)));
  card(score >= 70 ? 'positive' : score >= 40 ? 'warning' : 'critical', 'heart', 'Índice de saúde do backlog', `
    <p>Índice geral: <span class="m ${score >= 70 ? 'green' : score >= 40 ? 'yellow' : 'red'}">${score}/100</span></p>
    <p><b>${nf(total)}</b> chamados, <b>${nf(solved.length)}</b> solucionados (${pSolved}%) e <b>${nf(stale.length)}</b> críticos, abertos há 20 dias úteis ou mais (${pStale}% do backlog ativo).</p>
    <div class="reco"><b>Leitura:</b> ${score >= 70 ? 'backlog em condições razoáveis, com poucos chamados críticos.' : score >= 40 ? 'precisa de atenção: há volume relevante de chamados abertos há mais de 20 dias.' : 'situação crítica: a maior parte do backlog ativo está aberta há mais de 20 dias.'}</div>`);

  const ts = groupStale('_tech');
  if (ts.length){
    const [n, c] = ts[0], p = pct(c, stale.length);
    card(+p > 50 ? 'critical' : 'warning', 'user', 'Gargalo de técnico', `
      <p><b>${esc(n === '(vazio)' ? '(não atribuído)' : n)}</b> concentra <span class="m red">${c} críticos</span>, ${p}% de todos os chamados críticos.</p>
      ${bars(ts.slice(0, 5), 'var(--bad)', x => x === '(vazio)' ? '(não atribuído)' : x)}
      <div class="reco"><b>Sugestão:</b> verifique sobrecarga ou redistribua parte desses chamados.</div>`);
  }
  const cs = groupStale('_category');
  if (cs.length){
    const [n, c] = cs[0];
    card(+pct(c, stale.length) > 50 ? 'critical' : 'warning', 'layers', 'Categoria com maior gargalo', `
      <p>A categoria <b>${esc(shortCat(n))}</b> tem <span class="m yellow">${c} críticos</span>, ${pct(c, stale.length)}% do total de críticos.</p>
      ${bars(cs.slice(0, 5), 'var(--warn)', shortCat)}
      <div class="reco"><b>Sugestão:</b> analise o processo desta categoria em busca de bloqueios ou dependências externas.</div>`);
  }
  const crit = stale.filter(r => /crit|alta/i.test(r._priority)).sort((a, b) => (b._daysOpen || 0) - (a._daysOpen || 0));
  if (crit.length) card('critical', 'alert', 'Alta prioridade aberta há 20+ dias úteis', `
    <p><span class="m red">${crit.length} chamados</span> de prioridade <b>crítica ou alta</b> estão abertos há 20 dias úteis ou mais.</p>
    ${bars(crit.slice(0, 5).map(r => [`${r._id} — ${r._title.slice(0, 34)}`, r._daysOpen || 0]), 'var(--bad)')}
    <div class="reco"><b>Ação imediata:</b> tratar com prioridade e escalar para a gestão se necessário.</div>`);
  const old = stale.filter(r => r._daysOpen >= 60).sort((a, b) => b._daysOpen - a._daysOpen);
  if (old.length) card('critical', 'hour', 'Chamados abertos há mais de 60 dias úteis', `
    <p><span class="m red">${old.length} chamados</span> passaram de 60 dias úteis. O mais antigo está aberto há <b>${old[0]._daysOpen} dias úteis</b>.</p>
    ${bars(old.slice(0, 5).map(r => [r._id, r._daysOpen]), 'var(--bad)')}
    <div class="reco"><b>Sugestão:</b> avaliar se devem ser encerrados, escalados ou reclassificados.</div>`);

  const dc = {}; D.forEach(r => { if (r._openDt){ const k = isoDay(r._openDt); dc[k] = (dc[k] || 0) + 1; } });
  const days = Object.entries(dc).sort((a, b) => a[0].localeCompare(b[0]));
  if (days.length >= 6){
    const rec = days.slice(-5).map(d => d[1]), pri = days.slice(-10, -5).map(d => d[1]);
    const aR = rec.reduce((a, b) => a + b, 0) / rec.length, aP = pri.length ? pri.reduce((a, b) => a + b, 0) / pri.length : aR;
    const tr = aP > 0 ? ((aR - aP) / aP * 100).toFixed(0) : 0, up = +tr > 0;
    card(up && +tr > 30 ? 'warning' : !up ? 'positive' : 'info', up ? 'trend' : 'down', 'Tendência de abertura', `
      <p>Média dos últimos 5 dias com registro: <span class="m ${up ? 'yellow' : 'green'}">${aR.toFixed(1)}/dia</span>, contra <b>${aP.toFixed(1)}/dia</b> nos 5 anteriores.</p>
      <p>Variação: <span class="m ${up ? 'red' : 'green'}">${up ? '+' : ''}${tr}%</span></p>
      <div class="reco"><b>Leitura:</b> ${up ? 'volume crescendo — acompanhe se a equipe está absorvendo a demanda.' : 'volume estável ou em queda.'}</div>`);
  }
  if (solTimes.length > 5){
    const fast = solTimes.filter(t => t <= 2).length, slow = solTimes.filter(t => t > 24).length;
    card('info', 'clock', 'Tempo de solução', `
      <p>Dos <b>${solTimes.length}</b> chamados resolvidos com tempo registrado:</p>
      <p><span class="m green">até 2h: ${fast}</span> <span class="m blue">mediana: ${fmtHours(medianSol)}</span> <span class="m yellow">mais de 24h: ${slow}</span></p>
      <p>Média de <b>${fmtHours(avgSol)}</b>.</p>
      <div class="reco"><b>Nota:</b> ${avgSol > medianSol * 3 ? 'a média é bem maior que a mediana: poucos chamados muito demorados puxam a média. Investigue os casos extremos.' : 'média e mediana próximas: os tempos de solução são homogêneos.'}</div>`);
  }
  const un = active.filter(r => !r._tech || !r._tech.trim());
  if (un.length) card(un.length > 10 ? 'warning' : 'info', 'target', 'Chamados sem técnico', `
    <p><span class="m purple">${un.length} chamados ativos</span> estão sem técnico responsável.</p>
    <div class="reco"><b>Sugestão:</b> atribuir responsáveis para que não fiquem esquecidos.</div>`);
  const rq = counter(D, '_requester').slice(0, 5);
  if (rq.length) card('neutral', 'inbox', 'Requerentes mais frequentes', `<p>Os 5 que mais abrem chamados:</p>${bars(rq, 'var(--res)')}
    <div class="reco"><b>Nota:</b> muitos chamados do mesmo requerente podem indicar problema recorrente no equipamento ou cliente.</div>`);
  const es = groupStale('_entity');
  if (es.length){
    const [n, c] = es[0];
    card(+pct(c, stale.length) > 50 ? 'critical' : 'warning', 'building', 'Gargalo por entidade', `
      <p><b>${esc(shortEntity(n))}</b> concentra <span class="m red">${c} críticos</span>, ${pct(c, stale.length)}% de todos os críticos.</p>
      ${bars(es.slice(0, 5), 'var(--c7)', shortEntity)}
      <div class="reco"><b>Sugestão:</b> veja se há pendências de aprovação, faturamento ou alocação nesta unidade.</div>`);
  }
  return out.join('');
}

const onTheme = () => { if (B.el && B.tab === 'metricas') renderCharts(); };

export default {
  async mount(el){
    B.el = el;
    if (!B.loaded){ el.innerHTML = '<div class="skel" style="height:320px"></div>'; await loadCache(); }
    draw();
    window.addEventListener('canivete:theme', onTheme);
  },
  unmount(){ destroyCharts(); B.el = null; window.removeEventListener('canivete:theme', onTheme); }
};
