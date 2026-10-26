/* Buscador de equipamentos — inventário de ativos.
   A base é única e compartilhada (Supabase): todos com acesso consultam; só administrador
   publica uma planilha nova (XLSX/XLS/CSV). Duplo clique numa célula copia o valor. */
import * as XLSX from 'xlsx';
import { sb, rpc, fetchAll } from '../../core/supabase.js';
import { dbStore } from '../../core/db.js';
import { $, $$, ic, esc, nf, norm, plural, relTime, errMsg, toast, copy, ask, busy, progress, pageHead, emptyBox, pagerNums, dropzone } from '../../core/ui.js';

let ctx = null;
const isAdmin = () => !!ctx && ctx.isAdmin();

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
const collator = new Intl.Collator('pt-BR', {sensitivity:'base'});
function setRows(rows, base){
  // texto de busca pré-calculado: filtrar 50 mil linhas a cada tecla fica instantâneo
  for (const r of rows) Object.defineProperty(r, '_k', {value:SEARCH.map(f => String(r[f] ?? '')).join('').toLowerCase(), enumerable:false, configurable:true});
  E.raw = rows; E.loaded = true; E.base = base; E.page = 1;
  E.status = {}; [...new Set(E.raw.map(r => String(r.Status || '').trim()))].filter(Boolean).sort().forEach(s => E.status[s] = true);
}

/* ---------- base compartilhada no Supabase ----------
   equip_base guarda qual lote é o oficial; equip_itens guarda as linhas (jsonb).
   O IndexedDB só serve de cache: se o lote não mudou, não baixa tudo de novo. */
const PACK = 10000;   // equipamentos por pacote (uma linha de equip_itens)
/* Pacote: só as colunas usadas, e cada coluna com dicionário de valores (Cliente, Modelo, Status…
   se repetem muito). 50 mil equipamentos viram 5 linhas e uma única requisição. */
function pack(rows){
  const dict = COLS.map(() => []), idx = COLS.map(() => new Map());
  const out = rows.map(row => COLS.map((c, j) => {
    const v = row[c] ?? '';
    let i = idx[j].get(v);
    if (i === undefined){ i = dict[j].length; dict[j].push(v); idx[j].set(v, i); }
    return i;
  }));
  return {v:2, cols:COLS, dict, rows:out};
}
function unpack(items){
  const rows = [];
  for (const d of items){
    if (d && d.v === 2){
      for (const a of d.rows){ const o = {}; d.cols.forEach((c, j) => { const v = d.dict[j][a[j]]; if (v !== '') o[c] = v; }); rows.push(o); }
    } else rows.push(d);   // base antiga: um equipamento por linha
  }
  return rows;
}
async function fetchBase(){
  const {data, error} = await sb.from('equip_base').select('lote,arquivo,total,atualizado_em,atualizado_por_nome').eq('id', 1).maybeSingle();
  if (error) throw error;
  return data && data.lote ? data : null;
}
// Uma carga por vez: a página inicial e a tela de equipamentos pedem ao mesmo tempo
let carregando = null;
function loadShared(force){
  if (!carregando) carregando = doLoadShared(force).finally(() => { carregando = null; });
  return carregando;
}
async function doLoadShared(force){
  const base = await fetchBase();
  if (!base){ E.raw = []; E.loaded = false; E.base = null; E.checked = Date.now(); return; }
  if (!force && E.loaded && E.base && E.base.lote === base.lote){ E.base = base; E.checked = Date.now(); return; }
  try {
    const c = await dbStore.get('equipamentos');
    if (!force && c && c.filename === base.lote && c.data && c.data.length){ setRows(c.data, base); E.checked = Date.now(); return; }
  } catch(e){ console.error('IndexedDB equipamentos:', e); }
  const rows = await fetchAll((a, b) => sb.from('equip_itens').select('dados').eq('lote', base.lote).order('id').range(a, b));
  setRows(unpack(rows.map(r => r.dados)), base);
  E.checked = Date.now();
  dbStore.save('equipamentos', base.lote, base.atualizado_em, E.raw).catch(e => console.error('IndexedDB equipamentos:', e));
}
// Só administrador: lê a planilha, confirma e publica para todos.
function loadFile(file){
  progress(true, 'Lendo a planilha de equipamentos', file.name, 15);
  const reader = new FileReader();
  reader.onload = async evt => {
    let rows;
    try {
      const wb = XLSX.read(new Uint8Array(evt.target.result), {type:'array', cellDates:true});
      rows = normalizeRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:''}));
      if (!rows.length) throw new Error('A planilha está vazia.');
    } catch(err){ progress(false); console.error(err); toast('Erro ao ler planilha: ' + err.message, 'err'); return; }
    progress(false);
    const atual = E.base ? `A base atual (<b>${esc(E.base.arquivo)}</b>, ${nf(E.base.total)} equipamentos) será substituída.` : 'Ainda não existe base publicada.';
    if (!await ask('Publicar nova base de equipamentos?', `<b>${nf(rows.length)}</b> equipamentos de <b>${esc(file.name)}</b> ficarão disponíveis para todos os usuários do canivete. ${atual}`, 'Publicar para todos')) return;
    await publish(rows, file.name);
  };
  reader.readAsArrayBuffer(file);
}
async function publish(rows, filename){
  const lote = crypto.randomUUID();
  try {
    for (let i = 0; i < rows.length; i += PACK){
      progress(true, 'Publicando a base de equipamentos', `Enviando ${nf(Math.min(i + PACK, rows.length))} de ${nf(rows.length)}…`, Math.round(i / rows.length * 90));
      await rpc('equip_carregar', {p_lote:lote, p_linhas:[pack(rows.slice(i, i + PACK))]});
    }
    progress(true, 'Publicando a base de equipamentos', 'Trocando a base para todos…', 95);
    const n = await rpc('equip_publicar', {p_lote:lote, p_arquivo:filename});
    await loadShared(true);
    toast(`Base publicada: ${nf(n)} equipamentos`);
    draw();
  } catch(e){
    console.error(e);
    toast('Não foi possível publicar: ' + (/equip_carregar|equip_publicar|function/i.test(e.message || '') ? 'a base de equipamentos ainda não foi criada no Supabase (rode o 07_equipamentos.sql).' : errMsg(e)), 'err');
  } finally { progress(false); }
}
export async function equipResumo(){
  if (!E.loaded || Date.now() - (E.checked || 0) > 60000) await loadShared().catch(() => {});
  return E.loaded ? {total:E.raw.length, base:E.base} : null;
}

function draw(){
  const el = E.el; if (!el) return;
  if (!E.loaded){
    el.innerHTML = pageHead('Equipamentos', 'Busque e filtre o inventário de ativos.') + (isAdmin() ? `
      <button class="drop big" id="edrop">${ic('sheet')}<b>Solte aqui a planilha de equipamentos ou clique para escolher</b><span class="small">.xlsx, .xls ou .csv · colunas Cliente, Localidade, Modelo, Serial, Status… A base fica disponível para todos os usuários do canivete.</span></button>
      <input type="file" id="efile" accept=".xls,.xlsx,.csv" hidden>`
      : `<div class="card">${emptyBox('box', 'Nenhuma base de equipamentos publicada', 'Um administrador precisa carregar a planilha de equipamentos.')}</div>`);
    if (isAdmin()) dropzone($('#edrop'), $('#efile'), f => loadFile(f[0]));
    return;
  }
  const b = E.base, quando = b.atualizado_em ? `${new Date(b.atualizado_em).toLocaleString('pt-BR', {dateStyle:'short', timeStyle:'short'})} (${relTime(b.atualizado_em)})` : '';
  // quem não é admin vê só quando a base foi atualizada (sem arquivo, total nem autor)
  el.innerHTML = pageHead('Equipamentos', isAdmin()
      ? `${nf(E.raw.length)} ${E.raw.length === 1 ? 'equipamento' : 'equipamentos'} · base <b>${esc(b.arquivo)}</b>, atualizada em ${quando}${b.atualizado_por_nome ? ` por ${esc(b.atualizado_por_nome)}` : ''}`
      : (quando ? `Atualizada em ${quando}` : ''),
    (isAdmin() ? `<button class="btn primary" id="eup" title="Substitui a base para todos os usuários">${ic('up','sm')} Atualizar base</button>` : '') +
    `<button class="btn" id="eexp">${ic('dl','sm')} Exportar XLSX</button>`) + `

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
  if (isAdmin()){
    $('#eup').onclick = () => $('#efile').click();
    $('#efile').onchange = e => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; };
  }
  $('#eexp').onclick = exportXlsx;
  let qt; $('#eq').addEventListener('input', e => { clearTimeout(qt); qt = setTimeout(() => { E.q = e.target.value; E.page = 1; apply(); }, 120); });
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
  const filtraSt = all.length && sel.length !== all.length, selSet = new Set(sel);
  E.filtered = E.raw.filter(row => {
    if (E.func && !norm(row.Cliente).includes('funcionario')) return false;
    if (filtraSt && !selSet.has(String(row.Status || '').trim())) return false;
    return terms.every(t => row._k.includes(t));
  });
  const c = E.sortCol, dir = E.sortDir === 'asc' ? 1 : -1;
  const numeric = c === 'Numerador' || c === 'Idade do Equipamento';
  const num = v => parseFloat(String(v ?? '').replace(/[^\d.-]/g, '')) || 0;
  E.filtered.sort(numeric ? (a, b) => (num(a[c]) - num(b[c])) * dir
    : (a, b) => collator.compare(String(a[c] ?? '').trim(), String(b[c] ?? '').trim()) * dir);
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
  async mount(el, c){
    ctx = c; E.el = el;
    if (!E.loaded) el.innerHTML = '<div class="skel" style="height:320px"></div>';
    try { await loadShared(); }
    catch(e){
      console.error(e);
      if (!E.loaded){
        const semTabela = /equip_base|schema cache|does not exist/i.test(e.message || '');
        el.innerHTML = pageHead('Equipamentos', 'Busque e filtre o inventário de ativos.') + `<div class="alert err">${ic('alert')}<span>${semTabela
          ? 'A base de equipamentos ainda não foi criada no Supabase. Um administrador precisa rodar o arquivo <b>07_equipamentos.sql</b> no SQL Editor.'
          : 'Não foi possível carregar a base: ' + esc(errMsg(e))}</span></div>`;
        return;
      }
      toast('Não foi possível atualizar a base: ' + errMsg(e), 'err');
    }
    if (E.el !== el) return;
    ctx.setTopbar(`<button class="ibtn" title="Buscar atualização da base" id="eref">${ic('refresh')}</button>`);
    $('#eref').onclick = e => busy(e.currentTarget, async () => {
      const lote = E.base && E.base.lote;
      try { await loadShared(); toast(E.base && E.base.lote !== lote ? 'Base atualizada' : 'A base já está atualizada', 'info'); draw(); }
      catch(err){ toast(errMsg(err), 'err'); }
    });
    draw();
    document.addEventListener('click', closeMenus);
    window.addEventListener('canivete:esc', closeMenus);
  },
  unmount(){ E.el = null; document.removeEventListener('click', closeMenus); window.removeEventListener('canivete:esc', closeMenus); }
};
