/* Buscador de equipamentos — inventário de ativos carregado de planilha (XLSX/XLS/CSV).
   Os dados ficam só neste navegador (IndexedDB). Duplo clique numa célula copia o valor. */
import * as XLSX from 'xlsx';
import { dbStore } from '../../core/db.js';
import { $, $$, ic, esc, nf, norm, plural, toast, copy, ask, progress, pageHead, emptyBox, pagerNums, dropzone } from '../../core/ui.js';

const PAGE_SIZE = 50;
const COLS = ['Cliente', 'Localidade', 'Modelo', 'Serial', 'Status', 'Idade do Equipamento', 'Numerador', 'Data de Compra', 'Classificação', 'Classificação Lab'];
const COLS_PADRAO = ['Cliente', 'Localidade', 'Modelo', 'Serial', 'Status'];
const SEARCH = ['Modelo', 'Cliente', 'Localidade', 'Serial', 'Classificação', 'Classificação Lab'];
const KEYMAP = {'cliente':'Cliente', 'localidade':'Localidade', 'modelo':'Modelo', 'serial':'Serial', 'status':'Status', 'idade do equipamento':'Idade do Equipamento',
  'numerador':'Numerador', 'data de compra':'Data de Compra', 'classificação':'Classificação', 'classificacao':'Classificação',
  'classificação lab':'Classificação Lab', 'classificacao lab':'Classificação Lab', 'classificacao_lab':'Classificação Lab', 'classificação_lab':'Classificação Lab'};
const E = {
  raw:[], filtered:[], loaded:false, base:null, el:null, page:1, sortCol:'Cliente', sortDir:'asc', q:'', func:false,
  cols:(() => { try { const c = JSON.parse(localStorage.getItem('canivete:equipCols')); return Array.isArray(c) && c.length ? c : [...COLS_PADRAO]; } catch(e){ return [...COLS_PADRAO]; } })(),
  status:{}
};

function normalizeRows(data){
  return data.map(row => {
    const o = {};
    for (const k in row){
      let v = row[k];
      if (v instanceof Date) v = `${String(v.getDate()).padStart(2,'0')}/${String(v.getMonth()+1).padStart(2,'0')}/${v.getFullYear()}`;
      o[KEYMAP[k.trim().toLowerCase()] || k.trim()] = v;
    }
    return o;
  });
}
function setRows(rows, filename, dateStr){
  E.raw = normalizeRows(rows); E.loaded = true; E.base = {filename, dateStr}; E.page = 1;
  E.status = {}; [...new Set(E.raw.map(r => String(r.Status || '').trim()))].filter(Boolean).sort().forEach(s => E.status[s] = true);
}
function loadFile(file){
  progress(true, 'Lendo a planilha de equipamentos', file.name, 30);
  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const wb = XLSX.read(new Uint8Array(evt.target.result), {type:'array', cellDates:true});
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:''});
      if (!rows.length) throw new Error('A planilha está vazia.');
      setRows(rows, file.name, new Date().toLocaleString('pt-BR'));
      dbStore.save('equipamentos', E.base.filename, E.base.dateStr, E.raw).catch(e => console.error('IndexedDB equipamentos:', e));
      toast(`${nf(E.raw.length)} equipamentos carregados`);
      draw();
    } catch(err){ console.error(err); toast('Erro ao ler planilha: ' + err.message, 'err'); }
    finally { progress(false); }
  };
  reader.readAsArrayBuffer(file);
}
async function loadCache(){
  try {
    const c = await dbStore.get('equipamentos');
    if (c && c.data && c.data.length) setRows(c.data, c.filename, c.dateStr);
  } catch(e){ console.error('IndexedDB equipamentos:', e); }
}
export async function equipResumo(){
  if (!E.loaded) await loadCache();
  return E.loaded ? {total:E.raw.length, base:E.base} : null;
}

function draw(){
  const el = E.el; if (!el) return;
  if (!E.loaded){
    el.innerHTML = pageHead('Equipamentos', 'Busque e filtre o inventário de ativos. Carregue a planilha para começar.') + `
      <button class="drop big" id="edrop">${ic('sheet')}<b>Solte aqui a planilha de equipamentos ou clique para escolher</b><span class="small">.xlsx, .xls ou .csv · colunas Cliente, Localidade, Modelo, Serial, Status… Os dados ficam só neste navegador.</span></button>
      <input type="file" id="efile" accept=".xls,.xlsx,.csv" hidden>`;
    dropzone($('#edrop'), $('#efile'), f => loadFile(f[0]));
    return;
  }
  el.innerHTML = pageHead('Equipamentos', `${plural(E.raw.length, 'equipamento')} · base <b>${esc(E.base.filename)}</b> (${esc(E.base.dateStr)})`,
    `<button class="btn" id="eup">${ic('up','sm')} Carregar planilha</button><button class="btn" id="eexp">${ic('dl','sm')} Exportar XLSX</button><button class="btn ghost" id="eclr" title="Apaga a planilha salva neste navegador">${ic('trash','sm')} Limpar dados</button>`) + `
    <input type="file" id="efile" accept=".xls,.xlsx,.csv" hidden>
    <div class="toolbar">
      <div class="searchbox">${ic('search','sm')}<input class="input" type="search" id="eq" placeholder="Modelo, cliente, serial, localidade… (vários termos)" value="${esc(E.q)}"></div>
      <div class="dd" id="ddst"><button class="btn" id="ebst">${ic('filter','sm')} <span id="estl"></span></button>
        <div class="dd-menu"><input class="input" id="estq" placeholder="Filtrar status…" style="height:32px;margin-bottom:8px">
          <div class="dd-acts"><button class="btn sm ghost" data-all="1">Marcar todos</button><button class="btn sm ghost" data-all="0">Desmarcar todos</button></div><div id="estlist"></div></div></div>
      <div class="dd" id="ddcol"><button class="btn" id="ebcol">${ic('cols','sm')} Colunas</button><div class="dd-menu" id="ecollist"></div></div>
      <label class="dd-item" style="padding:0 6px"><input type="checkbox" id="efunc" ${E.func ? 'checked' : ''}> Só equipamentos de funcionários</label>
    </div>
    <div class="tbl-wrap" id="etable">
      <div class="tbl-head"><h3>${ic('box','sm')} Equipamentos <span class="badge b-acc" id="ecount"></span></h3><span class="small muted">Duplo clique numa célula para copiar</span></div>
      <div class="tbl-scroll"><table><thead><tr id="eth"></tr></thead><tbody id="etb"></tbody></table></div>
      <div id="epg"></div>
    </div>`;
  $('#eup').onclick = () => $('#efile').click();
  $('#efile').onchange = e => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; };
  $('#eexp').onclick = exportXlsx;
  $('#eclr').onclick = async () => {
    if (!await ask('Limpar planilha de equipamentos?', 'A planilha salva neste navegador será apagada. Você pode carregá-la de novo depois.', 'Limpar', 'bad')) return;
    await dbStore.clear('equipamentos'); E.raw = []; E.loaded = false; E.base = null; draw();
  };
  $('#eq').addEventListener('input', e => { E.q = e.target.value; E.page = 1; apply(); });
  $('#efunc').onchange = e => { E.func = e.target.checked; E.page = 1; apply(); };
  // menus suspensos
  [['#ebst', '#ddst'], ['#ebcol', '#ddcol']].forEach(([b, d]) => $(b).onclick = e => { e.stopPropagation(); const o = $(d).classList.contains('open'); $$('.dd', el).forEach(x => x.classList.remove('open')); $(d).classList.toggle('open', !o); });
  $$('.dd-menu', el).forEach(m => m.addEventListener('click', e => e.stopPropagation()));
  $('#estq').oninput = e => { const t = norm(e.target.value); $$('#estlist .dd-item', el).forEach(i => i.style.display = norm(i.textContent).includes(t) ? '' : 'none'); };
  $$('[data-all]', el).forEach(b => b.onclick = () => { for (const s in E.status) E.status[s] = b.dataset.all === '1'; drawStatus(); E.page = 1; apply(); });
  $('#estlist').addEventListener('change', e => { const c = e.target.closest('[data-st]'); if (!c) return; E.status[c.dataset.st] = c.checked; drawStatusLabel(); E.page = 1; apply(); });
  $('#ecollist').addEventListener('change', e => {
    const c = e.target.closest('[data-col]'); if (!c) return;
    if (c.checked){ if (!E.cols.includes(c.dataset.col)) E.cols.push(c.dataset.col); }
    else if (E.cols.length > 1) E.cols = E.cols.filter(x => x !== c.dataset.col);
    else { c.checked = true; toast('Pelo menos uma coluna precisa ficar visível', 'err'); return; }
    E.cols.sort((a, b) => COLS.indexOf(a) - COLS.indexOf(b));
    try { localStorage.setItem('canivete:equipCols', JSON.stringify(E.cols)); } catch(e){}
    drawTable();
  });
  $('#eth').addEventListener('click', e => {
    const th = e.target.closest('[data-col]'); if (!th) return;
    if (E.sortCol === th.dataset.col) E.sortDir = E.sortDir === 'asc' ? 'desc' : 'asc'; else { E.sortCol = th.dataset.col; E.sortDir = 'asc'; }
    E.page = 1; apply();
  });
  $('#etb').addEventListener('dblclick', e => { const td = e.target.closest('td'); const t = td && td.textContent.trim(); if (t) copy(t, `Copiado: ${t.length > 24 ? t.slice(0, 24) + '…' : t}`); });
  $('#epg').addEventListener('click', e => { const b = e.target.closest('[data-pg]'); if (b && !b.disabled){ E.page = +b.dataset.pg; drawTable(); $('#etable').scrollIntoView({block:'start', behavior:'smooth'}); } });
  drawStatus();
  $('#ecollist').innerHTML = COLS.map(c => `<label class="dd-item"><input type="checkbox" data-col="${esc(c)}" ${E.cols.includes(c) ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('');
  apply();
}
function drawStatus(){
  $('#estlist').innerHTML = Object.keys(E.status).sort().map(s => `<label class="dd-item"><input type="checkbox" data-st="${esc(s)}" ${E.status[s] ? 'checked' : ''}><span>${esc(s)}</span></label>`).join('') || '<div class="small muted" style="padding:6px">Sem coluna Status.</div>';
  drawStatusLabel();
}
function drawStatusLabel(){
  const all = Object.keys(E.status), on = all.filter(s => E.status[s]);
  $('#estl').textContent = on.length === all.length ? 'Status: todos' : !on.length ? 'Status: nenhum' : on.length <= 2 ? 'Status: ' + on.join(', ') : `Status: ${on.length} selecionados`;
}
function apply(){
  const terms = E.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const all = Object.keys(E.status), sel = all.filter(s => E.status[s]);
  E.filtered = E.raw.filter(row => {
    if (E.func && !norm(row.Cliente).includes('funcionario')) return false;
    if (all.length && sel.length !== all.length && !sel.includes(String(row.Status || '').trim())) return false;
    return terms.every(t => SEARCH.some(f => String(row[f] || '').toLowerCase().includes(t)));
  });
  const c = E.sortCol, dir = E.sortDir === 'asc' ? 1 : -1;
  const numeric = c === 'Numerador' || c === 'Idade do Equipamento';
  E.filtered.sort((a, b) => {
    const va = a[c] ?? '', vb = b[c] ?? '';
    if (numeric) return ((parseFloat(String(va).replace(/[^\d.-]/g, '')) || 0) - (parseFloat(String(vb).replace(/[^\d.-]/g, '')) || 0)) * dir;
    return String(va).toLowerCase().trim().localeCompare(String(vb).toLowerCase().trim()) * dir;
  });
  drawTable();
}
function drawTable(){
  $('#ecount').textContent = nf(E.filtered.length);
  $('#eth').innerHTML = E.cols.map(c => `<th class="sort ${E.sortCol === c ? 'on' : ''}" data-col="${esc(c)}">${esc(c)}${E.sortCol === c ? `<span class="arr">${E.sortDir === 'asc' ? '↑' : '↓'}</span>` : ''}</th>`).join('');
  const pg = E.filtered.slice((E.page - 1) * PAGE_SIZE, E.page * PAGE_SIZE);
  $('#etb').innerHTML = pg.map(r => `<tr>${E.cols.map(c => { const v = r[c] ?? ''; return `<td class="${c === 'Serial' ? 'mono' : ''}" title="${esc(v)}">${c === 'Status' && v ? `<span class="badge">${esc(v)}</span>` : esc(v)}</td>`; }).join('')}</tr>`).join('')
    || `<tr><td colspan="${E.cols.length}">${emptyBox('search','Nenhum equipamento encontrado','Ajuste a busca ou os filtros.')}</td></tr>`;
  $('#epg').innerHTML = E.filtered.length ? pagerNums(E.filtered.length, E.page, PAGE_SIZE) : '';
}
function exportXlsx(){
  if (!E.filtered.length){ toast('Não há dados para exportar', 'err'); return; }
  const data = E.filtered.map(r => { const o = {}; E.cols.forEach(c => o[c] = r[c] ?? ''); return o; });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Equipamentos');
  XLSX.writeFile(wb, `equipamentos_filtrados_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast('Planilha exportada');
}
const closeMenus = () => { if (E.el) $$('.dd', E.el).forEach(d => d.classList.remove('open')); };

export default {
  async mount(el){
    E.el = el;
    if (!E.loaded){ el.innerHTML = '<div class="skel" style="height:320px"></div>'; await loadCache(); }
    draw();
    document.addEventListener('click', closeMenus);
    window.addEventListener('canivete:esc', closeMenus);
  },
  unmount(){ E.el = null; document.removeEventListener('click', closeMenus); window.removeEventListener('canivete:esc', closeMenus); }
};
