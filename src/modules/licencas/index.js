/* Controle de Licenças Office — módulo do canivete.
   Regras: cada conta de e-mail tem até 5 vagas (uma por máquina); vaga ativo | disponivel | reservado.
   Toda escrita passa por RPCs do Supabase (o banco confere perfil e registra no histórico). */
import { sb, rpc, fetchAll, callFn } from '../../core/supabase.js';
import { $, ic, esc, todayIso, norm, plural, nf, timeHM, relTime, errMsg, toast, copy, busy, modal, closeModal, confirmBox, pageHead, emptyBox } from '../../core/ui.js';

let ctx = null;
// Namespace dos handlers inline (onclick="LIC.openAccount(3)").
const LIC = window.LIC = {};
const S = { accounts:[], byId:{}, slotById:{}, loadedAt:0, view:'painel', uid:null, mounted:false };
const canEdit = () => ctx.canEdit();
const isAdmin = () => ctx.isAdmin();
const go = v => ctx.go('licencas/' + v);

const fmt = d => d ? d.split('-').reverse().join('/') : '—';
const ageDays = d => d ? Math.floor((Date.now() - new Date(d + 'T00:00:00')) / 864e5) : null;
const ageTxt = n => n == null ? '—' : n < 31 ? `${n} dia${n===1?'':'s'}` : n < 365 ? `${Math.floor(n/30)} ${Math.floor(n/30)===1?'mês':'meses'}` : (y => `${y.replace('.',',')} ano${+y>=2?'s':''}`)((n/365).toFixed(1));
const num = e => parseInt((String(e).match(/(\d+)@/) || [0,0])[1], 10);
const user = e => String(e).split('@')[0];
const domain = e => '@' + String(e).split('@')[1];
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;

/* =====================================================================
   DADOS
   ===================================================================== */
// Base de equipamentos (módulo Equipamentos): sem acesso ou sem base, a aba "Retornou ao estoque" avisa.
const loadEquip = () => import('../equipamentos/index.js').then(async m => {
  const [map, cls] = await Promise.all([m.equipPorSerial(), m.equipClientes()]);
  S.eqClients = cls;
  S.equipErr = map ? '' : 'Nenhuma base de equipamentos publicada.';
  return map;
}).catch(e => { console.error('Equipamentos:', e); S.eqClients = null; S.equipErr = 'Não foi possível ler a base de equipamentos: ' + errMsg(e); return null; });
async function loadData(){
  const [contas, vagas, equip] = await Promise.all([
    fetchAll((a,b) => sb.from('contas').select('id,email').order('id').range(a,b)),
    fetchAll((a,b) => sb.from('vagas').select('id,conta_id,n,status,hostname,serial,data_ativacao,proposta,obs,atualizado_em,clientes(nome)').order('id').range(a,b)),
    loadEquip()
  ]);
  S.equip = equip;
  const by = {}, sl = {};
  contas.forEach(c => by[c.id] = {id:c.id, email:c.email, slots:[]});
  vagas.forEach(v => {
    const a = by[v.conta_id]; if (!a) return;
    const s = {id:v.id, n:v.n, st:v.status, cli:v.clientes ? v.clientes.nome : '', serial:v.serial||'', host:v.hostname||'',
               data:v.data_ativacao, prop:v.proposta||'', obs:v.obs||'', upd:v.atualizado_em, a};
    a.slots.push(s); sl[s.id] = s;
  });
  const accs = Object.values(by);
  accs.forEach(a => { a.slots.sort((x,y) => x.n - y.n); a.c = cnt(a); });
  accs.sort((a,b) => num(a.email) - num(b.email) || a.email.localeCompare(b.email));
  S.accounts = accs; S.byId = by; S.slotById = sl; S.loadedAt = Date.now();
  computeDerived();
}
function cnt(a){
  let u = 0, f = 0, r = 0;
  a.slots.forEach(s => { if (s.st === 'ativo') u++; else if (s.st === 'disponivel') f++; else r++; });
  return {u, f, r, t:a.slots.length};
}
function computeDerived(){
  const act = [], m = {};
  S.accounts.forEach(a => a.slots.forEach(s => { if (s.st === 'ativo'){ act.push(s); m[s.cli] = (m[s.cli] || 0) + 1; } }));
  S.active = act;
  S.clients = Object.entries(m).sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]));
  const serialMap = {};
  act.forEach(s => { if (s.serial) (serialMap[s.serial.toUpperCase()] ||= []).push(s); });
  S.q = {
    dup: Object.entries(serialMap).filter(([k,v]) => v.length > 1),
    noHost: act.filter(s => !s.host),
    noSerial: act.filter(s => !s.serial),
    noDate: act.filter(s => !s.data),
    noClient: act.filter(s => /N[ÃA]O ENCONTRADO|VERIFICAR|DESCONHECIDO/i.test(s.cli)),
    estoque: act.filter(s => (s.eq = retornou(s)))
  };
  S.qn = S.q.dup.length + S.q.noClient.length + S.q.estoque.length;
  // Gravidade por conta, com as mesmas cores das abas de Qualidade: vermelho (duplicado/estoque) e amarelo (demais).
  S.accounts.forEach(a => { a.qs = ''; a.slots.forEach(s => s.qs = ''); });
  const mark = (s, lv) => { if (lv === 'bad' || !s.qs) s.qs = lv; if (lv === 'bad' || !s.a.qs) s.a.qs = lv; };
  S.q.dup.forEach(([, v]) => v.forEach(s => mark(s, 'bad')));
  S.q.estoque.forEach(s => mark(s, 'bad'));
  ['noClient','noHost','noSerial','noDate'].forEach(k => S.q[k].forEach(s => mark(s, 'warn')));
  let u = 0, f = 0, r = 0, t = 0;
  S.accounts.forEach(a => { u += a.c.u; f += a.c.f; r += a.c.r; t += a.c.t; });
  S.tot = {u, f, r, t};
}
/* Máquina licenciada que voltou ao estoque: o serial está na base de equipamentos, mas o status
   não é "EM OPERACAO NO CLIENTE" e/ou a localidade é o armazém. A licença pode ser liberada.
   Se o serial aparece mais de uma vez na base, basta uma linha em operação fora do armazém. */
const txt = v => norm(v).trim().replace(/\s+/g, ' ');
const emOperacao = r => txt(r.Status) === 'em operacao no cliente' && txt(r.Localidade) !== 'multilog brasil armazem geral';
function retornou(s){
  const rows = S.equip && s.serial ? S.equip.get(s.serial.trim().toUpperCase()) : null;
  return rows && !rows.some(emOperacao) ? rows[0] : null;
}
async function reload(quiet){
  try {
    await loadData();
    renderView(); if (S.drawer) drawAccount();
    updateSync();
    if (!quiet) toast('Dados atualizados');
  } catch(e){ if (!quiet) toast('Erro ao atualizar: ' + errMsg(e), 'err'); }
}

function pager(total, page, size, fn){
  const pages = Math.ceil(total / size);
  if (pages <= 1) return `<div class="pager"><span>${plural(total, 'item', 'itens')}</span></div>`;
  return `<div class="pager"><span>${nf(page*size+1)}–${nf(Math.min(total,(page+1)*size))} de ${nf(total)}</span><div class="pg">
    <button class="btn sm" ${page ? '' : 'disabled'} onclick="LIC.${fn}(${page-1})">Anterior</button>
    <button class="btn sm" ${page < pages-1 ? '' : 'disabled'} onclick="LIC.${fn}(${page+1})">Próxima</button></div></div>`;
}
const cellsHtml = (a, lg) => `<span class="cells ${lg?'lg':''}">${a.slots.map(s => `<i class="cell ${s.st==='disponivel'?'f':s.st==='reservado'?'r':''}" title="Vaga ${s.n}: ${s.st==='ativo' ? esc(s.cli) : s.st==='disponivel' ? 'livre' : 'reservada'}"></i>`).join('')}</span>`;
const dateTag = s => s.data ? fmt(s.data) : '<span class="muted">sem data</span>';
const slotRef = s => `${esc(user(s.a.email))} <span class="muted">· vaga ${s.n}</span>`;
function statusBadges(c){
  return (c.r ? `<span class="badge b-res">${ic('lock')}${c.r} reserv.</span> ` : '') +
         (c.f ? `<span class="badge b-ok dotb">${plural(c.f,'livre')}</span>` : (!c.r ? '<span class="badge">cheia</span>' : ''));
}

/* =====================================================================
   PAINEL
   ===================================================================== */
function vPainel(){
  const T = S.tot, A = S.accounts;
  const withFree = A.filter(a => a.c.f > 0).sort((a,b) => b.c.f - a.c.f || num(a.email) - num(b.email));
  const cl = S.clients, max = cl[0] ? cl[0][1] : 1;
  const old = S.active.filter(s => s.data).sort((a,b) => a.data.localeCompare(b.data)).slice(0, 6);
  const q = S.q, hi = new Date().getHours();
  const hello = hi < 12 ? 'Bom dia' : hi < 18 ? 'Boa tarde' : 'Boa noite';
  $('#view').innerHTML = pageHead(`${hello}, ${esc(ctx.me.nome.split(' ')[0])}`, 'Resumo das licenças Office neste momento.',
    canEdit() ? `<button class="btn primary" onclick="LIC.go('ativar')">${ic('plus')} Nova ativação</button>` : '') + `
  <div class="grid kpis">
    ${kpi('key','var(--text-2)','var(--surface-2)','Contas de e-mail', nf(A.length), `${nf(T.t)} vagas no total`)}
    ${kpi('pc','var(--accent)','var(--accent-soft)','Máquinas ativas', nf(T.u), `${pct(T.u,T.t)}% da capacidade`)}
    ${kpi('unlock','var(--ok)','var(--ok-soft)','Vagas livres', nf(T.f), `em ${plural(withFree.length,'conta')}`, 'var(--ok)')}
    ${kpi('lock','var(--res)','var(--res-soft)','Reservadas', nf(T.r), 'outro departamento', 'var(--res)')}
  </div>
  <div class="card" style="margin-top:16px"><div class="card-h"><h3>Ocupação</h3><span class="sub">${pct(T.u+T.r,T.t)}% ocupado</span></div><div class="card-b">
    <div class="stack"><i style="width:${T.u/T.t*100}%;background:var(--accent)"></i><i style="width:${T.r/T.t*100}%;background:var(--res)"></i><i style="width:${T.f/T.t*100}%;background:var(--ok-cell)"></i></div>
    <div class="legend"><span><i class="sw" style="background:var(--accent)"></i>Em uso <b>${nf(T.u)}</b></span><span><i class="sw" style="background:var(--res)"></i>Reservadas <b>${nf(T.r)}</b></span><span><i class="sw" style="background:var(--ok-cell)"></i>Livres <b>${nf(T.f)}</b></span></div>
    ${T.f < 15 ? `<div class="alert warn" style="margin-top:14px">${ic('alert')}<div>Restam só <b>${plural(T.f,'vaga livre','vagas livres')}</b>. As próximas ativações vão precisar de <a href="#/licencas/reciclar">reciclagem</a> das licenças mais antigas.</div></div>` : ''}
  </div></div>
  <div class="grid cols2" style="margin-top:16px">
    <div class="card"><div class="card-h"><h3>Contas com vaga livre</h3><a class="small" href="#/licencas/contas" onclick="LIC.CV.f='vaga'">Ver todas</a></div><div class="card-b"><div class="mini">
      ${withFree.length ? withFree.slice(0,6).map(a => `<div class="mini-row" onclick="LIC.openAccount(${a.id})">${cellsHtml(a)}<div class="mr-m"><div class="mr-t mono trunc">${esc(a.email)}</div></div><span class="badge b-ok">${plural(a.c.f,'livre')}</span></div>`).join('')
        : emptyBox('rec','Nenhuma vaga livre','Use a reciclagem para liberar licenças antigas.')}
    </div></div></div>
    <div class="card"><div class="card-h"><h3>Clientes com mais máquinas</h3><a class="small" href="#/licencas/maquinas">Ver máquinas</a></div><div class="card-b"><div class="blist">
      ${cl.slice(0,8).map(([n,c], i) => `<div class="brow" onclick="LIC.goCli(${i})"><span class="nm trunc" title="${esc(n)}">${esc(n)}</span><span class="t"><i style="width:${c/max*100}%"></i></span><span class="n">${c}</span></div>`).join('') || emptyBox('pc','Nenhuma máquina ativa')}
    </div></div></div>
    <div class="card"><div class="card-h"><h3>Ativações mais antigas</h3><a class="small" href="#/licencas/reciclar">Reciclagem</a></div><div class="card-b"><div class="mini">
      ${old.map(s => `<div class="mini-row" onclick="LIC.openAccount(${s.a.id})"><div class="mr-m"><div class="mr-t trunc">${esc(s.cli)}</div><div class="mr-s trunc"><span class="mono">${esc(s.host||'sem hostname')}</span> · ${slotRef(s)}</div></div><div class="right"><div class="small strong">${fmt(s.data)}</div><div class="mr-s">${ageTxt(ageDays(s.data))}</div></div></div>`).join('') || emptyBox('clock','Sem ativações com data')}
    </div></div></div>
    <div class="card"><div class="card-h"><h3>Atenção nos dados</h3><a class="small" href="#/licencas/qualidade">Detalhes</a></div><div class="card-b">
      ${[['dup','Seriais duplicados','b-bad'],['estoque','Retornou ao estoque','b-bad'],['noDate','Máquinas sem data','b-warn'],['noClient','Cliente não identificado','b-warn'],['noHost','Máquinas sem hostname','b-warn'],['noSerial','Máquinas sem serial','b-warn']]
        .map(([k,l,c]) => `<div class="check-row" onclick="LIC.QV.tab='${k}';LIC.go('qualidade')"><span>${l}</span><span class="badge ${q[k].length ? c : 'b-ok'}">${q[k].length ? q[k].length : ic('check')}</span></div>`).join('')}
    </div></div>
  </div>
  <div class="card" style="margin-top:16px"><div class="card-h"><h3>Atividade recente</h3><a class="small" href="#/licencas/historico">Histórico completo</a></div><div class="card-b"><div class="mini" id="recent"><div class="skel" style="height:120px"></div></div></div></div>`;
  loadRecent();
}
function kpi(icon, fg, bg, label, value, sub, color){
  return `<div class="card kpi"><div class="l"><span class="ico" style="color:${fg};background:${bg}">${ic(icon,'sm')}</span>${label}</div>
    <div class="v" ${color ? `style="color:${color}"` : ''}>${value}</div><div class="s">${sub}</div></div>`;
}
async function loadRecent(){
  const {data, error} = await sb.from('historico').select('quando,usuario_nome,acao,detalhe').order('quando', {ascending:false}).limit(6);
  const el = $('#recent'); if (!el) return;
  if (error){ el.innerHTML = `<div class="muted small">Não foi possível carregar: ${esc(errMsg(error))}</div>`; return; }
  el.innerHTML = (data || []).map(l => `<div class="mini-row" style="cursor:default"><span class="avatar" style="width:30px;height:30px;font-size:12px">${esc((l.usuario_nome||'?')[0].toUpperCase())}</span>
    <div class="mr-m"><div class="small"><b>${esc(l.usuario_nome || 'Sistema')}</b> · ${esc(l.acao)}</div><div class="mr-s trunc">${esc(l.detalhe)}</div></div><span class="mr-s nowrap">${relTime(l.quando)}</span></div>`).join('')
    || emptyBox('clock','Nenhuma ação registrada ainda');
}
function goCli(i){ MV.cli = S.clients[i][0]; MV.page = 0; go('maquinas'); }

/* =====================================================================
   CONTAS
   ===================================================================== */
const CV = {q:'', f:'todas', mode:(() => { try { return localStorage.getItem('contasModo') || 'grade'; } catch(e){ return 'grade'; } })()};
function contasFilter(a, f){
  const c = a.c;
  if (f === 'vaga') return c.f > 0;
  if (f === 'cheia') return !c.f;
  if (f === 'reservada') return c.r > 0;
  return true;
}
function vContas(){
  const chips = [['todas','Todas'],['vaga','Com vaga'],['cheia','Cheias'],['reservada','Com reservadas']];
  $('#view').innerHTML = pageHead('Contas', 'Cada conta de e-mail comporta até 5 máquinas. Clique em uma conta para ver a senha e as vagas.',
    canEdit() ? `<button class="btn" onclick="LIC.newAccountForm()">${ic('plus')} Nova conta</button>` : '') + `
  <div class="toolbar">
    <div class="searchbox">${ic('search','sm')}<input class="input" type="search" id="cq" placeholder="Buscar e-mail, cliente, hostname ou serial" value="${esc(CV.q)}" oninput="LIC.CV.q=this.value;LIC.vContasBody()"></div>
    <div class="chips" id="cchips">${chips.map(([k,l]) => `<button class="chip ${CV.f===k?'on':''}" onclick="LIC.CV.f='${k}';LIC.vContas()">${l}<span class="n">${S.accounts.filter(a => contasFilter(a,k)).length}</span></button>`).join('')}</div>
    <div class="grow"></div>
    <div class="chips"><button class="chip ${CV.mode==='grade'?'on':''}" title="Grade" onclick="LIC.setMode('grade')">${ic('grid','sm')}</button><button class="chip ${CV.mode==='lista'?'on':''}" title="Lista" onclick="LIC.setMode('lista')">${ic('list','sm')}</button></div>
  </div><div id="cbody"></div>`;
  vContasBody();
}
function setMode(m){ CV.mode = m; try { localStorage.setItem('contasModo', m); } catch(e){} vContas(); }
function vContasBody(){
  const q = norm(CV.q);
  const L = S.accounts.filter(a => contasFilter(a, CV.f) && (!q || norm(a.email + ' ' + a.slots.map(s => [s.cli,s.host,s.serial].join(' ')).join(' ')).includes(q)));
  const clis = a => [...new Set(a.slots.filter(s => s.st==='ativo').map(s => s.cli))];
  if (!L.length){ $('#cbody').innerHTML = `<div class="tbl-wrap">${emptyBox('search','Nenhuma conta encontrada','Tente outro termo ou filtro.')}</div>`; return; }
  if (CV.mode === 'grade'){
    $('#cbody').innerHTML = `<div class="acc-grid">${L.map(a => { const c = clis(a); return `
      <button class="acc ${a.qs ? 'q-' + a.qs : ''}" ${a.qs ? 'title="Dados com problema: veja Qualidade dos dados"' : ''} onclick="LIC.openAccount(${a.id})">
        <div class="acc-top"><div style="min-width:0"><div class="acc-n mono trunc">${esc(user(a.email))}</div><div class="acc-d">${esc(domain(a.email))}</div></div><span class="small strong" style="font-variant-numeric:tabular-nums">${a.c.u}/${a.c.t}</span></div>
        ${cellsHtml(a, true)}
        <div class="acc-cli trunc">${c.length ? esc(c.slice(0,3).join(' · ')) + (c.length > 3 ? ` <span class="muted">+${c.length-3}</span>` : '') : '<span class="muted">Sem máquinas ativas</span>'}</div>
        <div>${statusBadges(a.c)}</div>
      </button>`; }).join('')}</div><div class="muted small" style="margin-top:12px">${plural(L.length,'conta')} de ${S.accounts.length}</div>`;
  } else {
    $('#cbody').innerHTML = `<div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr><th>Conta</th><th>Uso</th><th class="hide-sm">Clientes</th><th>Situação</th><th class="hide-sm">Última ativação</th></tr></thead><tbody>
    ${L.map(a => { const c = clis(a), last = a.slots.filter(s => s.data && s.st==='ativo').map(s => s.data).sort().pop(); return `
      <tr class="click ${a.qs ? 'q-' + a.qs : ''}" onclick="LIC.openAccount(${a.id})"><td class="mono">${esc(a.email)}</td><td class="nowrap">${cellsHtml(a)} <span class="small muted">${a.c.u}/${a.c.t}</span></td>
      <td class="small hide-sm">${esc(c.slice(0,2).join(', '))}${c.length>2?` <span class="muted">+${c.length-2}</span>`:''}</td><td class="nowrap">${statusBadges(a.c)}</td><td class="hide-sm">${fmt(last)}</td></tr>`; }).join('')}
    </tbody></table></div><div class="pager"><span>${plural(L.length,'conta')} de ${S.accounts.length}</span></div></div>`;
  }
}
function newAccountForm(){
  if (!canEdit()) return;
  const next = Math.max(0, ...S.accounts.map(a => num(a.email))) + 1;
  const dom = S.accounts[0] ? domain(S.accounts[0].email) : '@lowcost.com.br';
  const m = modal({title:'Nova conta de licença', sub:'A conta é criada com 5 vagas livres. A senha fica criptografada no cofre do Supabase.', icon:'mail', body:`
    <div class="form">
      <div class="field"><label>E-mail da conta</label><input class="input mono" id="ne" value="lowcost${next}${esc(dom)}"></div>
      <div class="field"><label>Senha da conta Microsoft</label><div class="pw"><input class="input mono" type="password" id="np" autocomplete="new-password">
        <button type="button" class="ibtn" onclick="const i=LIC.$('#np');i.type=i.type==='password'?'text':'password'">${ic('eye')}</button></div></div>
      <div class="alert err hidden" id="nerr"></div>
    </div>`, foot:`<button class="btn" onclick="LIC.closeModal()">Cancelar</button><button class="btn primary" id="nok">Criar conta</button>`});
  $('#nok', m).onclick = e => busy(e.currentTarget, async () => {
    const em = $('#ne').value.trim().toLowerCase(), pw = $('#np').value;
    const er = t => { const x = $('#nerr'); x.classList.remove('hidden'); x.innerHTML = ic('alert') + `<span>${esc(t)}</span>`; };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return er('E-mail inválido.');
    if (S.accounts.some(a => a.email.toLowerCase() === em)) return er('Essa conta já existe.');
    if (!pw) return er('Informe a senha da conta.');
    try {
      const id = await rpc('criar_conta', {p_email:em, p_senha:pw});
      await loadData(); closeModal(); toast('Conta criada'); renderView(); openAccount(id);
    } catch(err){ er(errMsg(err)); }
  });
  setTimeout(() => $('#np').focus(), 50);
}

/* =====================================================================
   DETALHE DA CONTA (drawer)
   ===================================================================== */
let PW = {on:false, txt:null, timer:null};
function openAccount(id){
  S.drawer = id; PW = {on:false, txt:null, timer:null};

  drawAccount();
}
function drawAccount(){
  const a = S.byId[S.drawer]; if (!a){ closeDrawer(); return; }
  let el = $('#drawer');
  if (!el){
    $('#layer').insertAdjacentHTML('beforeend', `<div class="scrim" id="dscrim" onclick="LIC.closeDrawer()"></div><aside class="drawer" id="drawer" role="dialog" aria-modal="true"></aside>`);
    el = $('#drawer');
  }
  const c = a.c, edit = canEdit();
  el.innerHTML = `
    <div class="drawer-h">
      <span class="brand-mark" style="width:36px;height:36px">${ic('mail')}</span>
      <div style="min-width:0;flex:1"><div class="mono strong trunc" style="font-size:14.5px">${esc(a.email)}</div><div class="small muted">${c.u} em uso · ${plural(c.f,'livre')}${c.r ? ` · ${c.r} reservada${c.r>1?'s':''}` : ''}</div></div>
      <button class="ibtn" onclick="LIC.closeDrawer()" title="Fechar (Esc)">${ic('x')}</button>
    </div>
    <div class="drawer-b">
      <div>
        <div class="sec-t">Acesso à conta Microsoft${edit ? `<button class="btn sm ghost" onclick="LIC.changePwForm(${a.id})">${ic('edit','sm')} Alterar senha</button>` : ''}</div>
        <div class="card" style="overflow:hidden">
          <div class="cred"><span class="k">E-mail</span><span class="v mono trunc">${esc(a.email)}</span><button class="ibtn" title="Copiar e-mail" onclick="LIC.copy('${esc(a.email)}','E-mail copiado')">${ic('copy','sm')}</button></div>
          <div class="cred"><span class="k">Senha</span><span class="v mono trunc" id="pwv">${PW.on ? esc(PW.txt) : '<span class="muted">••••••••••••</span>'}</span>
            <button class="ibtn" title="${PW.on ? 'Ocultar' : 'Mostrar'}" onclick="LIC.togglePw(this)">${ic(PW.on ? 'eyeoff' : 'eye','sm')}</button>
            <button class="ibtn" title="Copiar senha" onclick="LIC.copyPw(this)">${ic('copy','sm')}</button></div>
          ${PW.on ? '<div class="pwbar"></div>' : ''}
        </div>
        <div class="small muted" style="margin-top:6px;display:flex;gap:6px;align-items:center">${ic('info','sm')}Cada visualização da senha fica registrada no histórico.</div>
      </div>
      <div>
        <div class="sec-t">Vagas ${cellsHtml(a)}</div>
        <div class="grid" style="gap:10px">${a.slots.map(s => slotCard(s, edit)).join('')}</div>
      </div>
      ${MS365_ATIVO ? `<div>
        <div class="sec-t">Microsoft 365${MS[a.id] && !MS[a.id].loading ? `<button class="btn sm ghost" onclick="LIC.loadMs(${a.id})">${ic('refresh','sm')} Atualizar</button>` : ''}</div>
        ${msHtml(a)}
      </div>` : ''}
      ${isAdmin() ? `<div>
        <div class="sec-t" style="color:var(--bad)">Zona de perigo</div>
        <div class="slot" style="border-color:color-mix(in srgb,var(--bad) 35%,var(--line))"><div class="slot-h"><div class="grow"><div class="strong">Excluir esta conta</div><div class="small muted">Remove a conta, as 5 vagas e a senha guardada. Não dá para desfazer.</div></div>
          <button class="btn sm danger" onclick="LIC.excluirConta(${a.id})">${ic('x','sm')} Excluir</button></div></div>
      </div>` : ''}
    </div>`;
}
// Exclusão de conta: só administrador, com confirmação digitando o e-mail (o banco confere de novo).
function excluirConta(id){
  const a = S.byId[id]; if (!a || !isAdmin()) return;
  const act = a.slots.filter(s => s.st === 'ativo');
  const m = modal({title:'Excluir conta de licença?', sub:a.email, icon:'alert', tone:'bad', body:`<div class="form">
    <div class="alert err">${ic('alert')}<span>A conta <b>${esc(a.email)}</b>, as ${a.c.t} vagas e a senha guardada serão <b>apagadas de vez</b>. O histórico registra o que havia nela.</span></div>
    ${act.length ? `<div><div class="small strong" style="margin-bottom:6px">${plural(act.length,'máquina ativa vai','máquinas ativas vão')} perder o registro:</div>
      <ul class="small" style="margin:0;padding-left:18px">${act.map(s => `<li><b>${esc(s.cli)}</b> · <span class="mono">${esc(s.host || 'sem hostname')}</span> · vaga ${s.n}</li>`).join('')}</ul></div>` : '<div class="small muted">Nenhuma máquina ativa nesta conta.</div>'}
    <div class="field"><label>Para confirmar, digite o e-mail da conta</label><input class="input mono" id="xce" placeholder="${esc(a.email)}" autocomplete="off" spellcheck="false"
      oninput="LIC.$('#xcok').disabled = this.value.trim().toLowerCase() !== '${esc(a.email.toLowerCase())}'"></div>
    <div class="alert err hidden" id="xcerr"></div>
  </div>`, foot:`<button class="btn" onclick="LIC.closeModal()">Cancelar</button><button class="btn danger" id="xcok" disabled>Excluir conta</button>`});
  $('#xcok', m).onclick = e => busy(e.currentTarget, async () => {
    try {
      await rpc('excluir_conta', {p_conta:id, p_confirmacao:$('#xce').value});
      closeModal(); closeDrawer(); await loadData(); renderView(); toast('Conta excluída');
    } catch(err){ const x = $('#xcerr'); x.classList.remove('hidden'); x.innerHTML = ic('alert') + `<span>${esc(errMsg(err))}</span>`; }
  });
  setTimeout(() => $('#xce').focus(), 50);
}

/* ---- Dispositivos e ativações no Microsoft 365 (somente leitura, via Edge Function "microsoft365") ---- */
// Seção escondida até a Edge Function "microsoft365" estar publicada e configurada (ver supabase/MICROSOFT365.md).
// Para ligar: troque para true.
const MS365_ATIVO = false;
const MS = {};   // cache por conta: {loading, data, err}
async function loadMs(id){
  MS[id] = {loading:true};
  if (S.drawer === id) drawAccount();
  try {
    const {data, error} = await sb.functions.invoke('microsoft365', {body:{acao:'dispositivos', email:S.byId[id].email}});
    if (error){
      let m = error.message;
      try { const j = await error.context.json(); if (j && j.error) m = j.error; } catch(e){}
      if (/Failed to send|fetch/i.test(m)) m = 'Não foi possível falar com o servidor. Tente de novo.';
      throw new Error(m);
    }
    MS[id] = {data};
  } catch(e){ MS[id] = {err:errMsg(e)}; }
  if (S.drawer === id) drawAccount();
}
const dtBR = t => t ? new Date(t).toLocaleDateString('pt-BR') : '—';
const TRUST = {AzureAd:'Ingressado no Entra', ServerAd:'Ingressado no AD', Workplace:'Registrado'};
function msHtml(a){
  const st = MS[a.id];
  if (!st) return `<div class="slot free"><div class="slot-h"><div class="grow"><div class="strong">Dispositivos conectados</div><div class="small muted">Consulta na Microsoft os computadores e ativações do Office desta conta</div></div>
    <button class="btn sm" onclick="LIC.loadMs(${a.id})">${ic('search','sm')} Consultar</button></div></div>`;
  if (st.loading) return `<div class="slot"><div class="small muted" style="display:flex;gap:8px;align-items:center">${ic('clock','sm')} Consultando a Microsoft…</div></div>`;
  if (st.err) return `<div class="alert err">${ic('alert')}<span>${esc(st.err)}</span></div>`;
  const d = st.data, hosts = new Map(a.slots.filter(s => s.st === 'ativo' && s.host).map(s => [norm(s.host).trim(), s.n]));
  const devs = [...d.dispositivos].sort((x, y) => String(y.ultimo_login||'').localeCompare(String(x.ultimo_login||'')));
  const prods = (d.ativacoes && d.ativacoes.produtos) || [];
  const cont = p => [['Windows',p.windows],['Mac',p.mac],['Android',p.android],['iOS',p.ios],['Windows Mobile',p.windows_mobile]].filter(([,v]) => v).map(([k,v]) => `${v} ${k}`).join(' · ') || 'nenhuma';
  return `
    ${d.usuario && d.usuario.ativo === false ? `<div class="alert warn" style="margin-bottom:10px">${ic('alert')}<span>A conta está <b>bloqueada para entrar</b> no Microsoft 365.</span></div>` : ''}
    ${(d.avisos||[]).map(t => `<div class="alert warn" style="margin-bottom:10px">${ic('alert')}<span>${esc(t)}</span></div>`).join('')}
    <div class="small muted" style="margin:0 0 6px">Ativações do Office${d.ativacoes && d.ativacoes.data_relatorio ? ` · relatório de ${fmt(d.ativacoes.data_relatorio)}` : ''}</div>
    <div class="grid" style="gap:10px;margin-bottom:14px">${prods.length ? prods.map(p => `<div class="slot"><div class="slot-h"><div class="grow strong trunc">${esc(p.produto)}</div><span class="badge b-acc">${cont(p)}</span></div>
      <div class="kv"><span>Última ativação</span><span>${p.ultima_ativacao ? fmt(p.ultima_ativacao) : '—'}</span>${p.compartilhado ? `<span>Compartilhado</span><span>${p.compartilhado}</span>` : ''}</div></div>`).join('')
      : `<div class="small muted">${d.ativacoes ? 'Nenhuma ativação no relatório.' : 'Relatório indisponível.'}</div>`}</div>
    <div class="small muted" style="margin:0 0 6px">Dispositivos no Entra ID · ${plural(devs.length,'dispositivo')}</div>
    <div class="grid" style="gap:10px">${devs.length ? devs.map(v => { const n = hosts.get(norm(v.nome).trim()); return `<div class="slot"><div class="slot-h"><div class="grow" style="min-width:0"><div class="strong mono trunc">${esc(v.nome)}</div><div class="small muted trunc">${esc([v.so, v.versao].filter(Boolean).join(' '))}</div></div>
      ${n ? `<span class="badge b-ok">${ic('check')}Vaga ${n}</span>` : `<span class="badge b-warn" title="Nenhuma vaga em uso tem este hostname">Fora das vagas</span>`}</div>
      <div class="kv"><span>Último acesso</span><span>${dtBR(v.ultimo_login)}${v.ultimo_login ? ` <span class="muted small">· ${ageTxt(Math.floor((Date.now() - new Date(v.ultimo_login)) / 864e5))} atrás</span>` : ''}</span><span>Registrado em</span><span>${dtBR(v.registrado_em)}</span><span>Tipo</span><span>${esc(TRUST[v.tipo] || v.tipo || '—')}${v.ativo === false ? ' · <span style="color:var(--bad)">desativado</span>' : ''}</span></div></div>`; }).join('')
      : `<div class="small muted">Nenhum dispositivo registrado no Entra com esta conta.</div>`}</div>
    <div class="small muted" style="margin-top:8px;display:flex;gap:6px;align-items:center">${ic('info','sm')}Consultado ${relTime(d.consultado_em)}. A lista "Microsoft Office" do admin center pode ter máquinas que não aparecem no Entra.</div>`;
}
function closeDrawer(){
  clearTimeout(PW.timer); PW = {on:false, txt:null, timer:null};
  S.drawer = null;
  ['#drawer','#dscrim'].forEach(s => { const e = $(s); if (e) e.remove(); });
}
async function fetchPw(){
  try { return await rpc('obter_senha', {p_conta:S.drawer}); }
  catch(e){ toast(errMsg(e), 'err'); return null; }
}
async function togglePw(btn){
  clearTimeout(PW.timer);
  if (PW.on){ PW = {on:false, txt:null, timer:null}; drawAccount(); return; }
  const t = await busy(btn, fetchPw); if (t === null) return;
  PW = {on:true, txt:t, timer:setTimeout(() => { if (PW.on && S.drawer){ PW = {on:false, txt:null, timer:null}; drawAccount(); } }, 30000)};
  drawAccount();
}
async function copyPw(btn){ const t = PW.on ? PW.txt : await busy(btn, fetchPw); if (t !== null) copy(t, 'Senha copiada'); }
function changePwForm(id){
  const a = S.byId[id];
  const m = modal({title:'Alterar senha da conta', sub:a.email, icon:'lock', body:`
    <div class="form">
      <div class="alert info">${ic('info')}<span>Altere aqui <b>depois</b> de trocar a senha no portal da Microsoft. Isto só atualiza o que fica guardado no sistema.</span></div>
      <div class="field"><label>Nova senha</label><div class="pw"><input class="input mono" type="password" id="cp1" autocomplete="new-password"><button type="button" class="ibtn" onclick="const i=LIC.$('#cp1');i.type=i.type==='password'?'text':'password'">${ic('eye')}</button></div></div>
      <div class="alert err hidden" id="cperr"></div>
    </div>`, foot:`<button class="btn" onclick="LIC.closeModal()">Cancelar</button><button class="btn primary" id="cpok">Salvar senha</button>`});
  $('#cpok', m).onclick = e => busy(e.currentTarget, async () => {
    const p = $('#cp1').value;
    const er = t => { const x = $('#cperr'); x.classList.remove('hidden'); x.innerHTML = ic('alert') + `<span>${esc(t)}</span>`; };
    if (!p) return er('Informe a nova senha.');
    try { await rpc('definir_senha_conta', {p_conta:id, p_senha:p}); closeModal(); PW = {on:false, txt:null, timer:null}; drawAccount(); toast('Senha atualizada'); }
    catch(err){ er(errMsg(err)); }
  });
  setTimeout(() => $('#cp1').focus(), 50);
}
function slotCard(s, edit){
  const adm = isAdmin();
  const resBtn = `<button class="btn sm" style="color:var(--res)" onclick="LIC.reservarVaga(${s.id})">${ic('lock','sm')} Reservar</button>`;
  if (s.st === 'reservado') return `<div class="slot res"><div class="slot-h"><span class="slot-n">${s.n}</span><div class="grow strong">Reservada</div><span class="badge b-res">${ic('lock')}Outro departamento</span></div>
    <div class="small muted" style="margin-top:8px">${adm ? 'Reservada para outro departamento. Só administradores podem tirar a reserva.' : 'Esta vaga pertence a outro departamento e não pode ser usada nem alterada.'}</div>
    ${adm ? `<div class="slot-a"><button class="btn sm" onclick="LIC.tirarReserva(${s.id})">${ic('unlock','sm')} Tirar reserva</button></div>` : ''}</div>`;
  if (s.st === 'disponivel') return `<div class="slot free"><div class="slot-h"><span class="slot-n">${s.n}</span><div class="grow"><div class="strong">Vaga livre</div><div class="small muted">Pronta para uma nova ativação</div></div>
    ${adm ? resBtn : ''}${edit ? `<button class="btn sm primary" onclick="LIC.slotForm(${s.id})">${ic('plus','sm')} Ativar</button>` : ''}</div></div>`;
  return `<div class="slot ${s.qs ? 'q-' + s.qs : ''}"><div class="slot-h"><span class="slot-n">${s.n}</span><div class="grow" style="min-width:0"><div class="strong trunc">${esc(s.cli)}</div><div class="small muted mono trunc">${esc(s.host) || 'sem hostname'}</div></div><span class="badge b-acc dotb">Em uso</span></div>
    <div class="kv"><span>Serial</span><span class="mono">${esc(s.serial) || '<span class="muted">—</span>'}</span><span>Ativada em</span><span>${dateTag(s)}${s.data ? ` <span class="muted small">· ${ageTxt(ageDays(s.data))}</span>` : ''}</span>
      ${s.prop ? `<span>Proposta</span><span>${esc(s.prop)}</span>` : ''}${s.obs ? `<span>Observação</span><span>${esc(s.obs)}</span>` : ''}</div>
    ${edit ? `<div class="slot-a"><button class="btn sm" onclick="LIC.slotForm(${s.id})">${ic('edit','sm')} Editar</button><button class="btn sm" style="color:var(--bad)" onclick="LIC.confirmRelease(${s.id})">${ic('unlock','sm')} Liberar vaga</button>${adm ? resBtn : ''}</div>` : ''}</div>`;
}

/* =====================================================================
   MODAIS
   ===================================================================== */

/* ---------- ativar / editar / liberar vaga ---------- */
/* Seletor de cliente com busca. A lista vem da base de equipamentos; sem base, usa os clientes que já têm licença.
   O valor escolhido fica num <input hidden id="${id}">, lido como um input comum. */
const clientNames = () => S.eqClients && S.eqClients.length ? S.eqClients : S.clients.map(([n]) => n);
const CP = {items:[], on:0};
function clientPicker(id, value){
  return `<div class="cpick" id="${id}-w"><input type="hidden" id="${id}" value="${esc(value)}">
    <button type="button" class="input cpick-b" onclick="LIC.cpToggle('${id}')"><span class="trunc ${value ? '' : 'muted'}" id="${id}-t">${value ? esc(value) : 'Escolha o cliente'}</span><span class="muted" style="font-size:11px">▾</span></button>
    <div class="cpick-p hidden" id="${id}-p"><input class="input cpick-s" id="${id}-s" placeholder="Pesquisar cliente…" autocomplete="off" oninput="LIC.cpRender('${id}')" onkeydown="LIC.cpKey(event,'${id}')"><div class="cpick-l" id="${id}-l"></div></div></div>`;
}
function cpToggle(id){
  const p = $('#' + id + '-p'), open = p.classList.contains('hidden');
  document.querySelectorAll('.cpick-p').forEach(x => x.classList.add('hidden'));
  if (!open) return;
  p.classList.remove('hidden');
  const s = $('#' + id + '-s'); s.value = ''; cpRender(id); s.focus();
}
function cpRender(id){
  const q = norm($('#' + id + '-s').value.trim()), all = clientNames();
  const hit = all.filter(n => !q || norm(n).includes(q));
  CP.items = hit.slice(0, 80); CP.on = 0;
  $('#' + id + '-l').innerHTML = CP.items.map((n, i) => `<div class="cpick-i ${i ? '' : 'on'}" onmousedown="LIC.cpPick('${id}',${i})">${esc(n)}</div>`).join('')
    + (hit.length > 80 ? `<div class="cpick-m">+${nf(hit.length - 80)} clientes: refine a busca</div>` : '')
    + (hit.length ? '' : `<div class="cpick-m">Nenhum cliente encontrado na base de equipamentos</div>`);
}
function cpKey(e, id){
  const n = CP.items.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
    e.preventDefault(); if (!n) return;
    CP.on = (CP.on + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    const rows = document.querySelectorAll('#' + id + '-l .cpick-i');
    rows.forEach((r, i) => r.classList.toggle('on', i === CP.on)); rows[CP.on].scrollIntoView({block:'nearest'});
  } else if (e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); if (n) cpPick(id, CP.on); }
  else if (e.key === 'Escape'){ e.stopPropagation(); $('#' + id + '-p').classList.add('hidden'); }
}
function cpPick(id, i){
  const v = CP.items[i]; if (v == null) return;
  $('#' + id).value = v;
  const t = $('#' + id + '-t'); t.textContent = v; t.classList.remove('muted');
  $('#' + id + '-w .cpick-b').classList.remove('bad');
  $('#' + id + '-p').classList.add('hidden');
}
document.addEventListener('mousedown', e => { if (!e.target.closest('.cpick')) document.querySelectorAll('.cpick-p').forEach(x => x.classList.add('hidden')); });
function serialOwner(serial, exceptId){
  if (!serial) return null;
  const u = serial.toUpperCase();
  return S.active.find(s => s.id !== exceptId && s.serial.toUpperCase() === u) || null;
}
function checkSerial(inp, exceptId, helpSel){
  const o = serialOwner(inp.value.trim(), exceptId), h = $(helpSel);
  inp.classList.toggle('bad', !!o);
  if (h){ h.className = 'help' + (o ? ' bad' : ''); h.textContent = o ? `Já em uso: ${o.cli} · ${o.a.email} vaga ${o.n}` : ''; }
  return o;
}
function slotForm(id){
  if (!canEdit()) return;
  const s = S.slotById[id], edit = s.st === 'ativo';
  const m = modal({title: edit ? 'Editar máquina' : 'Ativar máquina', sub:`${s.a.email} · vaga ${s.n}`, icon: edit ? 'edit' : 'pc', body:`
    <div class="form">
      <div class="field"><label>Cliente *</label>${clientPicker('fc', s.cli)}</div>
      <div class="two"><div class="field"><label>Hostname</label><input class="input mono" id="fh" value="${esc(s.host)}" placeholder="ex.: LC-NOTE-042"></div>
        <div class="field"><label>Serial</label><input class="input mono" id="fs" value="${esc(s.serial)}" oninput="LIC.checkSerial(this,${s.id},'#fsh')"><span class="help" id="fsh"></span></div></div>
      <div class="two"><div class="field"><label>Data da ativação</label><input class="input" type="date" id="fd" value="${s.data || todayIso()}" max="${todayIso()}"></div>
        <div class="field"><label>Proposta</label><input class="input" id="fp" value="${esc(s.prop)}"></div></div>
      <div class="field"><label>Observação</label><input class="input" id="fo" value="${esc(s.obs)}"></div>
      <div class="alert err hidden" id="fe"></div>
    </div>`, foot:`<button class="btn" onclick="LIC.closeModal()">Cancelar</button><button class="btn primary" id="fok">${edit ? 'Salvar alterações' : 'Ativar máquina'}</button>`});
  $('#fok', m).onclick = e => busy(e.currentTarget, () => saveSlot(id));
  setTimeout(() => $('#fc-w .cpick-b').focus(), 50);
}
async function saveSlot(id){
  const s = S.slotById[id], was = s.st === 'ativo';
  const er = t => { const x = $('#fe'); x.classList.remove('hidden'); x.innerHTML = ic('alert') + `<span>${esc(t)}</span>`; };
  const cli = $('#fc').value.trim().toUpperCase(), serial = $('#fs').value.trim().toUpperCase();
  if (!cli){ $('#fc-w .cpick-b').classList.add('bad'); return er('Informe o cliente.'); }
  const dup = serialOwner(serial, s.id);
  if (dup) return er(`O serial ${serial} já está em uso na conta ${dup.a.email} (${dup.cli}).`);
  try {
    await rpc(was ? 'editar_vaga' : 'ativar_vaga', {p_vaga:s.id, p_cliente:cli, p_hostname:$('#fh').value.trim(), p_serial:serial, p_data:$('#fd').value || null, p_proposta:$('#fp').value.trim(), p_obs:$('#fo').value.trim()});
    await loadData(); closeModal(); toast(was ? 'Alterações salvas' : 'Máquina ativada'); renderView(); if (S.drawer) drawAccount();
  } catch(e){ er(errMsg(e)); }
}
async function confirmRelease(id){
  const s = S.slotById[id];
  const btn = await confirmBox({title:`Liberar a vaga ${s.n}?`, tone:'bad', icon:'unlock', ok:'Liberar vaga',
    text:`A máquina <b>${esc(s.cli)}</b> (<span class="mono">${esc(s.host || 'sem hostname')}</span>) sai da conta <span class="mono">${esc(s.a.email)}</span> e a vaga fica livre.<div class="alert warn" style="margin-top:12px">${ic('alert')}<span>Lembre de desativar o Office nessa máquina.</span></div>`});
  if (!btn) return;
  await busy(btn, async () => {
    try { await rpc('liberar_vaga', {p_vaga:id}); await loadData(); closeModal(); toast('Vaga liberada'); renderView(); if (S.drawer) drawAccount(); }
    catch(e){ closeModal(); toast(errMsg(e), 'err'); }
  });
}
// Reservas: só administrador (o banco também confere).
async function reservarVaga(id){
  const s = S.slotById[id], inUse = s.st === 'ativo';
  const btn = await confirmBox({title:`Reservar a vaga ${s.n}?`, tone: inUse ? 'bad' : 'warn', icon:'lock', ok:'Reservar',
    text:`A vaga ${s.n} de <span class="mono">${esc(s.a.email)}</span> fica reservada para outro departamento e deixa de ser oferecida em ativações e reciclagens.` +
      (inUse ? `<div class="alert warn" style="margin-top:12px">${ic('alert')}<span>Ela está em uso por <b>${esc(s.cli)}</b> (<span class="mono">${esc(s.host || 'sem hostname')}</span>). A máquina perde a licença; lembre de desativar o Office nela.</span></div>` : '')});
  if (!btn) return;
  await busy(btn, async () => {
    try { await rpc('reservar_vaga', {p_vaga:id}); await loadData(); closeModal(); toast('Vaga reservada'); renderView(); if (S.drawer) drawAccount(); }
    catch(e){ closeModal(); toast(errMsg(e), 'err'); }
  });
}
async function tirarReserva(id){
  const s = S.slotById[id];
  const btn = await confirmBox({title:`Tirar a reserva da vaga ${s.n}?`, icon:'unlock', ok:'Tirar reserva',
    text:`A vaga ${s.n} de <span class="mono">${esc(s.a.email)}</span> volta a ficar <b>livre</b> e pode ser usada em novas ativações. Confirme com o outro departamento antes.`});
  if (!btn) return;
  await busy(btn, async () => {
    try { await rpc('tirar_reserva', {p_vaga:id}); await loadData(); closeModal(); toast('Reserva retirada'); renderView(); if (S.drawer) drawAccount(); }
    catch(e){ closeModal(); toast(errMsg(e), 'err'); }
  });
}

/* =====================================================================
   MÁQUINAS
   ===================================================================== */
const MV = {q:'', cli:'', sort:'data', dir:-1, page:0};
const PAGE = 50;
function vMaquinas(){
  $('#view').innerHTML = pageHead('Máquinas', 'Todas as máquinas com Office ativado.', `<button class="btn" onclick="LIC.exportCsv()">${ic('dl')} Exportar CSV</button>`) + `
  <div class="toolbar">
    <div class="searchbox">${ic('search','sm')}<input class="input" type="search" placeholder="Buscar cliente, hostname, serial, conta ou proposta" value="${esc(MV.q)}" oninput="LIC.MV.q=this.value;LIC.MV.page=0;LIC.vMaqBody()"></div>
    <select class="input" onchange="LIC.MV.cli=this.value;LIC.MV.page=0;LIC.vMaqBody()"><option value="">Todos os clientes</option>${S.clients.map(([n,c]) => `<option value="${esc(n)}" ${MV.cli===n?'selected':''}>${esc(n)} (${c})</option>`).join('')}</select>
  </div><div id="mbody"></div>`;
  vMaqBody();
}
function maqList(){
  const q = norm(MV.q);
  const key = {cli:s => s.cli, host:s => s.host, serial:s => s.serial, conta:s => num(s.a.email)*10 + s.n, data:s => s.data || ''}[MV.sort];
  return S.active.filter(s => (!MV.cli || s.cli === MV.cli) && (!q || norm([s.cli,s.host,s.serial,s.a.email,s.prop,s.obs].join(' ')).includes(q)))
    .sort((a,b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * MV.dir; });
}
function mSort(k){ if (MV.sort === k) MV.dir *= -1; else { MV.sort = k; MV.dir = k === 'data' ? -1 : 1; } vMaqBody(); }
function mPage(p){ MV.page = p; vMaqBody(); $('#mbody').scrollIntoView({block:'start', behavior:'smooth'}); }
function vMaqBody(){
  const L = maqList(), pg = L.slice(MV.page*PAGE, (MV.page+1)*PAGE);
  const th = (k, l, cls='') => `<th class="sort ${cls}" onclick="LIC.mSort('${k}')">${l}${MV.sort===k ? `<span class="arr">${MV.dir>0?'↑':'↓'}</span>` : ''}</th>`;
  $('#mbody').innerHTML = `<div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr>${th('cli','Cliente')}${th('host','Hostname')}${th('serial','Serial','hide-sm')}${th('conta','Conta')}${th('data','Ativada em')}</tr></thead><tbody>
  ${pg.map(s => `<tr class="click" onclick="LIC.openAccount(${s.a.id})"><td><div class="strong">${esc(s.cli)}</div>${s.prop ? `<div class="sub">Proposta ${esc(s.prop)}</div>` : ''}</td>
    <td class="mono">${esc(s.host) || '<span class="muted">—</span>'}</td><td class="mono hide-sm">${esc(s.serial) || '<span class="muted">—</span>'}</td>
    <td class="mono small nowrap">${slotRef(s)}</td><td class="nowrap">${dateTag(s)}</td></tr>`).join('') || `<tr><td colspan="5">${emptyBox('search','Nada encontrado','Ajuste a busca ou os filtros.')}</td></tr>`}
  </tbody></table></div>${pager(L.length, MV.page, PAGE, 'mPage')}</div>`;
}
function exportCsv(){
  const rows = [['Cliente','Hostname','Serial','Conta','Vaga','Data ativação','Proposta','Observação']].concat(
    maqList().map(s => [s.cli, s.host, s.serial, s.a.email, s.n, s.data ? fmt(s.data) : '', s.prop, s.obs]));
  const csv = '﻿' + rows.map(r => r.map(c => '"' + String(c).replace(/"/g,'""') + '"').join(';')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
  a.download = `maquinas-office-${todayIso()}.csv`; document.body.appendChild(a); a.click(); a.remove();
  toast('CSV gerado (sem senhas)');
}

/* =====================================================================
   NOVA ATIVAÇÃO
   ===================================================================== */
const NA = {cli:'', qtd:1, data:'', plan:null};
function vAtivar(){
  if (!NA.data) NA.data = todayIso();
  $('#view').innerHTML = pageHead('Nova ativação', 'Informe o cliente e quantas máquinas. A ferramenta escolhe as vagas e, se faltar espaço, sugere reciclar as ativações mais antigas.') + `
  <div class="steps"><span class="${NA.plan ? '' : 'on'}"><b>1</b>Pedido</span>${ic('arrow','sm')}<span class="${NA.plan ? 'on' : ''}"><b>2</b>Conferir e confirmar</span></div>
  <div class="card" style="max-width:860px"><div class="card-b" style="padding-top:18px">
    <div class="form"><div style="display:grid;grid-template-columns:minmax(0,2fr) 120px 170px;gap:14px" class="na-grid">
      <div class="field"><label>Cliente *</label>${clientPicker('ac', NA.cli)}</div>
      <div class="field"><label>Máquinas</label><input class="input" type="number" id="aq" min="1" max="20" value="${NA.qtd}" onkeydown="if(event.key==='Enter')LIC.makePlan()"></div>
      <div class="field"><label>Data da ativação</label><input class="input" type="date" id="ad" value="${NA.data}" max="${todayIso()}"></div>
    </div>
    <div class="alert err hidden" id="ae"></div>
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><button class="btn primary" onclick="LIC.makePlan()">${ic('zap','sm')} Sugerir vagas</button>
      <span class="small muted">${plural(S.tot.f,'vaga livre','vagas livres')} no momento · reservadas nunca são usadas</span></div></div>
  </div></div><div id="plan"></div>
  <style>@media (max-width:640px){.na-grid{grid-template-columns:1fr 1fr!important}.na-grid>.field:first-child{grid-column:1/-1}}</style>`;
  if (NA.plan) drawPlan();
}
function makePlan(){
  const cli = $('#ac').value.trim().toUpperCase(), qtd = Math.max(1, Math.min(20, parseInt($('#aq').value) || 1));
  NA.data = $('#ad').value || todayIso();
  if (!cli){ const e = $('#ae'); e.classList.remove('hidden'); e.innerHTML = ic('alert') + '<span>Informe o cliente.</span>'; $('#ac-w .cpick-b').classList.add('bad'); return; }
  NA.cli = cli; NA.qtd = qtd;
  const withFree = S.accounts.map(a => ({a, f:a.slots.filter(s => s.st === 'disponivel'), has:a.slots.some(s => s.st === 'ativo' && s.cli === cli)})).filter(x => x.f.length);
  let picks = [];
  const fit = withFree.filter(x => x.f.length >= qtd).sort((x,y) => (y.has - x.has) || (x.f.length - y.f.length) || num(x.a.email) - num(y.a.email))[0];
  if (fit) picks = fit.f.slice(0, qtd);
  else {
    withFree.sort((x,y) => (y.has - x.has) || (y.f.length - x.f.length) || num(x.a.email) - num(y.a.email));
    for (const x of withFree) for (const s of x.f) if (picks.length < qtd) picks.push(s);
  }
  const plan = picks.map(s => ({type:'livre', id:s.id, host:'', serial:''}));
  const need = qtd - plan.length;
  if (need > 0){
    S.active.slice().sort((x,y) => (x.data ? 0 : 1) - (y.data ? 0 : 1) || (x.data||'').localeCompare(y.data||''))
      .slice(0, need).forEach(s => plan.push({type:'reciclar', id:s.id, host:'', serial:''}));
  }
  NA.plan = plan; NA.pw = {};
  vAtivar();
  loadPlanPws(plan);
  setTimeout(() => { const p = $('#plan'); if (p) p.scrollIntoView({behavior:'smooth', block:'start'}); const f = $('#ph0'); if (f) f.focus({preventScroll:true}); }, 60);
}
function drawPlan(){
  const P2 = NA.plan, rec = P2.filter(p => p.type === 'reciclar').length;
  const existing = S.active.filter(s => s.cli === NA.cli).length;
  $('#plan').innerHTML = `<div class="card" style="max-width:860px;margin-top:16px">
    <div class="card-h"><h3>${esc(NA.cli)} · ${plural(P2.length,'máquina')}</h3><span class="sub">${existing ? `já tem ${plural(existing,'máquina ativa','máquinas ativas')}` : 'cliente novo'}</span></div>
    <div class="card-b">
      ${rec ? `<div class="alert warn" style="margin-bottom:6px">${ic('alert')}<div>Só ${plural(P2.length-rec,'vaga livre','vagas livres')}. <b>${plural(rec,'ativação antiga','ativações antigas')}</b> abaixo ${rec>1?'serão recicladas':'será reciclada'}: a máquina atual perde a licença e a vaga passa para ${esc(NA.cli)}. Confira antes de confirmar.</div></div>`
            : `<div class="alert ok" style="margin-bottom:6px">${ic('check')}<span>Há vagas livres suficientes. Nenhuma reciclagem necessária.</span></div>`}
      ${P2.map((p,i) => { const s = S.slotById[p.id]; return `<div class="plan-row">
        <div style="min-width:0"><div class="mono strong trunc">${esc(s.a.email)} <span class="muted" style="font-weight:400">· vaga ${s.n}</span></div>
          <div class="small" style="display:flex;align-items:center;gap:4px;margin:2px 0 4px"><span class="muted">Senha:</span>
            <span class="mono trunc">${NA.pw && NA.pw[s.a.id] != null ? esc(NA.pw[s.a.id]) : '<span class="muted">••••••••••••</span>'}</span>
            <button class="ibtn" title="${NA.pw && NA.pw[s.a.id] != null ? 'Ocultar' : 'Mostrar'} senha" onclick="LIC.planPw(this,${s.a.id})">${ic(NA.pw && NA.pw[s.a.id] != null ? 'eyeoff' : 'eye','sm')}</button>
            <button class="ibtn" title="Copiar senha" onclick="LIC.planPwCopy(this,${s.a.id})">${ic('copy','sm')}</button></div>
          ${p.type === 'livre' ? '<span class="badge b-ok dotb">vaga livre</span>' : `<span class="badge b-warn">${ic('rec')}reciclar</span> <span class="small muted">${esc(s.cli)} · <span class="mono">${esc(s.host||'sem hostname')}</span> · ${fmt(s.data)}${s.data ? ` (${ageTxt(ageDays(s.data))})` : ''}</span>`}</div>
        <input class="input mono" id="ph${i}" placeholder="Hostname" value="${esc(p.host)}" oninput="LIC.NA.plan[${i}].host=this.value">
        <div class="field"><input class="input mono" id="ps${i}" placeholder="Serial" value="${esc(p.serial)}" oninput="LIC.NA.plan[${i}].serial=this.value;LIC.checkSerial(this,null,'#psh${i}')"><span class="help" id="psh${i}"></span></div>
      </div>`; }).join('')}
      <div class="alert err hidden" id="pe" style="margin-top:10px"></div>
    </div>
    <div class="card-f" style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap">
      <button class="btn" onclick="LIC.NA.plan=null;LIC.NA.pw={};LIC.vAtivar()">Cancelar</button>
      ${canEdit() ? `<button class="btn primary" id="pok" onclick="LIC.confirmPlan(this)">${ic('check','sm')} Confirmar ${plural(P2.length,'ativação','ativações')}</button>` : '<span class="small muted">Seu perfil é somente consulta.</span>'}
    </div></div>`;
}
// Senha da conta direto no plano: carregada ao sugerir as vagas (cada visualização fica no histórico).
async function loadPlanPws(plan){
  const ids = [...new Set(plan.map(p => S.slotById[p.id].a.id))];
  const res = await Promise.all(ids.map(id => rpc('obter_senha', {p_conta:id}).then(t => [id, t], e => { toast(errMsg(e), 'err'); return [id, null]; })));
  if (NA.plan !== plan) return;
  res.forEach(([id, t]) => { if (t !== null) NA.pw[id] = t; });
  if (!$('#plan')) return;
  const f = document.activeElement, fid = f && f.id, pos = f && f.selectionStart;
  drawPlan();
  const g = fid && document.getElementById(fid);
  if (g){ g.focus({preventScroll:true}); if (pos != null) g.setSelectionRange(pos, pos); }
}
async function planPwGet(btn, id){
  NA.pw = NA.pw || {};
  if (NA.pw[id] != null) return NA.pw[id];
  const t = await busy(btn, async () => { try { return await rpc('obter_senha', {p_conta:id}); } catch(e){ toast(errMsg(e), 'err'); return null; } });
  return t;
}
async function planPw(btn, id){
  NA.pw = NA.pw || {};
  if (NA.pw[id] != null){ delete NA.pw[id]; drawPlan(); return; }
  const t = await planPwGet(btn, id); if (t === null) return;
  NA.pw[id] = t; drawPlan();
}
async function planPwCopy(btn, id){ const t = await planPwGet(btn, id); if (t !== null) copy(t, 'Senha copiada'); }
async function confirmPlan(btn){
  const er = t => { const x = $('#pe'); x.classList.remove('hidden'); x.innerHTML = ic('alert') + `<span>${esc(t)}</span>`; };
  const seen = new Set();
  for (const p of NA.plan){
    const sr = p.serial.trim().toUpperCase(); if (!sr) continue;
    if (seen.has(sr)) return er(`O serial ${sr} foi digitado duas vezes.`);
    const o = serialOwner(sr, null);
    if (o && !(p.type === 'reciclar' && o.id === p.id)) return er(`O serial ${sr} já está em uso na conta ${o.a.email} (${o.cli}).`);
    seen.add(sr);
  }
  const rec = NA.plan.filter(p => p.type === 'reciclar');
  if (rec.length){
    const b = await confirmBox({title:`Reciclar ${plural(rec.length,'licença','licenças')}?`, tone:'warn', icon:'rec', ok:'Reciclar e ativar',
      text:`Estas máquinas vão perder a licença:<ul style="margin:10px 0 0;padding-left:18px">${rec.map(p => { const s = S.slotById[p.id]; return `<li><b>${esc(s.cli)}</b> · <span class="mono">${esc(s.host||'sem hostname')}</span> · ${fmt(s.data)}</li>`; }).join('')}</ul>
        <div class="alert warn" style="margin-top:12px">${ic('alert')}<span>Lembre de desativar o Office nelas.</span></div>`});
    if (!b) return;
    closeModal();
  }
  const items = NA.plan.map(p => ({vaga_id:p.id, reciclar:p.type === 'reciclar', cliente:NA.cli, hostname:p.host.trim(), serial:p.serial.trim().toUpperCase(), data:NA.data}));
  await busy(btn, async () => {
    try {
      const n = await rpc('ativar_lote', {p_itens:items});
      await loadData();
      const ids = items.map(i => i.vaga_id);
      NA.plan = null; NA.pw = {}; NA.cli = ''; NA.qtd = 1;
      toast(`${plural(n || items.length,'ativação registrada','ativações registradas')}`);
      vAtivar();
      $('#plan').innerHTML = `<div class="card" style="max-width:860px;margin-top:16px"><div class="card-b" style="padding-top:18px">
        <div class="alert ok">${ic('check')}<span>Pronto! Use estas contas para ativar o Office:</span></div>
        <div class="mini" style="margin-top:10px">${ids.map(id => { const s = S.slotById[id]; return `<div class="mini-row" onclick="LIC.openAccount(${s.a.id})"><div class="mr-m"><div class="mr-t mono">${esc(s.a.email)}</div><div class="mr-s">vaga ${s.n} · <span class="mono">${esc(s.host||'sem hostname')}</span></div></div><span class="btn sm">${ic('key','sm')} Ver senha</span></div>`; }).join('')}</div>
      </div></div>`;
    } catch(e){ er(errMsg(e)); }
  });
}

/* =====================================================================
   RECICLAGEM
   ===================================================================== */
const RV = {q:'', age:'180', cli:'', page:0};
let SEL = new Set();
function vReciclar(){
  $('#view').innerHTML = pageHead('Reciclagem', 'Libere as ativações mais antigas para reaproveitar licenças. Vagas reservadas e máquinas sem data ficam de fora.') + `
  <div class="toolbar">
    <div class="searchbox">${ic('search','sm')}<input class="input" type="search" placeholder="Buscar cliente, hostname ou conta" value="${esc(RV.q)}" oninput="LIC.RV.q=this.value;LIC.RV.page=0;LIC.vRecBody()"></div>
    <select class="input" onchange="LIC.RV.age=this.value;LIC.RV.page=0;LIC.vRecBody()">${[['0','Qualquer idade'],['90','Mais de 3 meses'],['180','Mais de 6 meses'],['270','Mais de 9 meses'],['365','Mais de 1 ano'],['730','Mais de 2 anos']].map(([v,l]) => `<option value="${v}" ${RV.age===v?'selected':''}>${l}</option>`).join('')}</select>
    <select class="input" onchange="LIC.RV.cli=this.value;LIC.RV.page=0;LIC.vRecBody()"><option value="">Todos os clientes</option>${S.clients.map(([n,c]) => `<option value="${esc(n)}" ${RV.cli===n?'selected':''}>${esc(n)} (${c})</option>`).join('')}</select>
  </div><div id="rbody"></div><div id="selbar"></div>`;
  vRecBody();
}
function recList(){
  const q = norm(RV.q), min = parseInt(RV.age);
  return S.active.filter(s => s.data && ageDays(s.data) >= min && (!RV.cli || s.cli === RV.cli) && (!q || norm([s.cli,s.host,s.a.email].join(' ')).includes(q)))
    .sort((a,b) => a.data.localeCompare(b.data));
}
function rPage(p){ RV.page = p; vRecBody(); }
function vRecBody(){
  const L = recList(), pg = L.slice(RV.page*PAGE, (RV.page+1)*PAGE), ed = canEdit();
  const allOn = pg.length && pg.every(s => SEL.has(s.id));
  $('#rbody').innerHTML = `<div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr>
    <th style="width:40px">${ed ? `<input type="checkbox" title="Selecionar página" ${allOn?'checked':''} onchange="LIC.selPage(this.checked)">` : ''}</th><th>Cliente</th><th>Hostname</th><th class="hide-sm">Conta</th><th>Ativada em</th><th>Idade</th></tr></thead><tbody>
  ${pg.map(s => `<tr class="${SEL.has(s.id)?'sel':''} ${ed?'click':''}" ${ed ? `onclick="if(event.target.tagName!=='INPUT')LIC.selOne(${s.id})"` : ''}>
    <td>${ed ? `<input type="checkbox" ${SEL.has(s.id)?'checked':''} onchange="LIC.selOne(${s.id})">` : ''}</td><td class="strong">${esc(s.cli)}</td><td class="mono">${esc(s.host)||'<span class="muted">—</span>'}</td>
    <td class="mono small hide-sm nowrap">${slotRef(s)}</td><td class="nowrap">${dateTag(s)}</td><td><span class="badge ${ageDays(s.data) >= 365 ? 'b-warn' : ''}">${ageTxt(ageDays(s.data))}</span></td></tr>`).join('')
    || `<tr><td colspan="6">${emptyBox('rec','Nenhuma ativação neste filtro','Diminua a idade mínima ou limpe a busca.')}</td></tr>`}
  </tbody></table></div>${pager(L.length, RV.page, PAGE, 'rPage')}</div>`;
  drawSelbar();
}
function selOne(id){ SEL.has(id) ? SEL.delete(id) : SEL.add(id); vRecBody(); }
function selPage(on){ recList().slice(RV.page*PAGE, (RV.page+1)*PAGE).forEach(s => on ? SEL.add(s.id) : SEL.delete(s.id)); vRecBody(); }
function drawSelbar(){
  [...SEL].forEach(id => { const s = S.slotById[id]; if (!s || s.st !== 'ativo') SEL.delete(id); });
  const b = $('#selbar'); if (!b) return;
  b.innerHTML = SEL.size ? `<div class="selbar"><span class="strong">${plural(SEL.size,'selecionada','selecionadas')}</span>
    <button class="btn sm ghost" onclick="LIC.SEL.clear();LIC.vRecBody()">Limpar</button><button class="btn sm danger" onclick="LIC.confirmBulk()">${ic('unlock','sm')} Liberar ${SEL.size}</button></div>` : '';
}
async function confirmBulk(){
  const ids = [...SEL];
  const sample = ids.slice(0, 6).map(id => S.slotById[id]);
  const btn = await confirmBox({title:`Liberar ${plural(ids.length,'vaga','vagas')}?`, tone:'bad', icon:'unlock', ok:`Liberar ${ids.length}`,
    text:`As vagas ficam livres para novas ativações e a ação vai para o histórico.<ul style="margin:10px 0 0;padding-left:18px">${sample.map(s => `<li><b>${esc(s.cli)}</b> · <span class="mono">${esc(s.host||'sem hostname')}</span> · ${fmt(s.data)}</li>`).join('')}${ids.length > 6 ? `<li class="muted">e mais ${ids.length-6}</li>` : ''}</ul>
      <div class="alert warn" style="margin-top:12px">${ic('alert')}<span>Lembre de desativar o Office nessas máquinas.</span></div>`});
  if (!btn) return;
  await busy(btn, async () => {
    try { const n = await rpc('liberar_lote', {p_vagas:ids}); SEL.clear(); await loadData(); closeModal(); toast(`${plural(n,'vaga liberada','vagas liberadas')}`); renderView(); }
    catch(e){ closeModal(); toast(errMsg(e), 'err'); }
  });
}

/* =====================================================================
   QUALIDADE DOS DADOS
   ===================================================================== */
const QV = {tab:'dup', page:0};
function vQualidade(){
  const q = S.q;
  const tabs = [['dup','Seriais duplicados',q.dup.length],['estoque','Retornou ao estoque',q.estoque.length],['noClient','Cliente não identificado',q.noClient.length],['noHost','Sem hostname',q.noHost.length],['noSerial','Sem serial',q.noSerial.length],['noDate','Sem data',q.noDate.length]];
  $('#view').innerHTML = pageHead('Qualidade dos dados', 'Itens que merecem revisão. Corrigir aqui deixa a reciclagem mais confiável.') + `
  <div class="tabs">${tabs.map(([k,l,n]) => `<button class="tab ${QV.tab===k?'on':''}" onclick="LIC.QV.tab='${k}';LIC.QV.page=0;LIC.vQualidade()">${l}<span class="badge ${n ? (k==='dup'||k==='estoque'?'b-bad':'b-warn') : 'b-ok'}">${n}</span></button>`).join('')}</div>
  <div id="qbody"></div>`;
  vQualBody();
}
function qPage(p){ QV.page = p; vQualBody(); }
function vQualBody(){
  const q = S.q, ed = canEdit();
  const rowsBasic = arr => {
    const pg = arr.slice(QV.page*PAGE, (QV.page+1)*PAGE);
    return `<div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr><th>Cliente</th><th>Hostname</th><th class="hide-sm">Serial</th><th>Conta</th><th>Ativada em</th></tr></thead><tbody>
    ${pg.map(s => `<tr class="click" onclick="LIC.openAccount(${s.a.id})"><td class="strong">${esc(s.cli)}</td><td class="mono">${esc(s.host)||'<span class="muted">—</span>'}</td><td class="mono hide-sm">${esc(s.serial)||'<span class="muted">—</span>'}</td><td class="mono small nowrap">${slotRef(s)}</td><td class="nowrap">${dateTag(s)}</td></tr>`).join('')
      || `<tr><td colspan="5">${emptyBox('check','Tudo certo','Nenhum item nesta categoria.')}</td></tr>`}
    </tbody></table></div>${arr.length ? pager(arr.length, QV.page, PAGE, 'qPage') : ''}</div>`;
  };
  let html = '';
  if (QV.tab === 'dup'){
    html = `<div class="alert warn" style="margin-bottom:14px">${ic('alert')}<span>O mesmo serial aparece em mais de uma vaga ativa. Normalmente é a mesma máquina ativada duas vezes. Libere a vaga que sobra.</span></div>
    <div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr><th>Serial</th><th>Onde aparece</th></tr></thead><tbody>
    ${q.dup.map(([k,v]) => `<tr><td class="mono strong">${esc(k)}</td><td><div class="mini">${v.map(s => `<div class="mini-row" onclick="LIC.openAccount(${s.a.id})"><div class="mr-m"><div class="mr-t">${esc(s.cli)}</div><div class="mr-s"><span class="mono">${esc(s.host||'sem hostname')}</span> · ${slotRef(s)} · ${fmt(s.data)}</div></div></div>`).join('')}</div></td></tr>`).join('')
      || `<tr><td colspan="2">${emptyBox('check','Nenhum serial duplicado')}</td></tr>`}
    </tbody></table></div></div>`;
  } else if (QV.tab === 'estoque'){
    const pg = q.estoque.slice(QV.page*PAGE, (QV.page+1)*PAGE);
    html = `<div class="alert ${S.equipErr ? 'warn' : 'info'}" style="margin-bottom:14px">${ic('alert')}<span>${S.equipErr ? esc(S.equipErr)
      : 'Máquinas com licença ativa cujo serial, na base de equipamentos, não está <b>EM OPERACAO NO CLIENTE</b> e/ou está no <b>MULTILOG BRASIL ARMAZEM GERAL</b>. O equipamento já voltou ao estoque: libere a vaga.'}</span></div>
    <div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr><th>Cliente</th><th>Hostname</th><th>Serial</th><th>Status do equipamento</th><th class="hide-sm">Localidade</th><th>Conta</th></tr></thead><tbody>
    ${pg.map(s => `<tr class="click" onclick="LIC.openAccount(${s.a.id})"><td class="strong">${esc(s.cli)}</td><td class="mono">${esc(s.host)||'<span class="muted">—</span>'}</td><td class="mono">${esc(s.serial)}</td><td><span class="badge b-warn">${esc(s.eq.Status||'sem status')}</span></td><td class="small hide-sm">${esc(s.eq.Localidade||'—')}</td><td class="mono small nowrap">${slotRef(s)}</td></tr>`).join('')
      || `<tr><td colspan="6">${emptyBox('check','Tudo certo','Nenhuma máquina licenciada voltou ao estoque.')}</td></tr>`}
    </tbody></table></div>${q.estoque.length ? pager(q.estoque.length, QV.page, PAGE, 'qPage') : ''}</div>`;
  } else html = rowsBasic(q[QV.tab]);
  $('#qbody').innerHTML = html;
}
/* =====================================================================
   HISTÓRICO
   ===================================================================== */
const HV = {q:'', acao:'', page:0};
const ACOES = ['Máquina ativada','Máquina editada','Vaga liberada','Reciclagem (liberada)','Senha visualizada','Senha da conta alterada','Conta criada','Vaga reservada','Reserva retirada','Conta excluída','Usuário criado','Senha de usuário redefinida','Datas confirmadas','Base de equipamentos atualizada'];
function vHistorico(){
  $('#view').innerHTML = pageHead('Histórico', 'Tudo o que foi feito na ferramenta: quem, o quê e quando.') + `
  <div class="toolbar">
    <div class="searchbox">${ic('search','sm')}<input class="input" type="search" placeholder="Buscar usuário ou detalhe (cliente, conta, hostname)" value="${esc(HV.q)}" oninput="clearTimeout(LIC.HV.t);LIC.HV.t=setTimeout(()=>{LIC.HV.q=this.value;LIC.HV.page=0;LIC.loadHist()},300)"></div>
    <select class="input" onchange="LIC.HV.acao=this.value;LIC.HV.page=0;LIC.loadHist()"><option value="">Todas as ações</option>${ACOES.map(a => `<option ${HV.acao===a?'selected':''}>${a}</option>`).join('')}</select>
  </div><div id="hbody"><div class="skel" style="height:260px"></div></div>`;
  loadHist();
}
function hPage(p){ HV.page = p; loadHist(); }
async function loadHist(){
  let qy = sb.from('historico').select('quando,usuario_nome,acao,detalhe', {count:'exact'}).order('quando', {ascending:false}).range(HV.page*PAGE, (HV.page+1)*PAGE - 1);
  if (HV.acao) qy = qy.eq('acao', HV.acao);
  const t = HV.q.trim().replace(/[,()%*\\]/g, ' ').trim();
  if (t) qy = qy.or(`detalhe.ilike.*${t}*,usuario_nome.ilike.*${t}*`);
  const {data, error, count} = await qy;
  const el = $('#hbody'); if (!el || S.view !== 'historico') return;
  if (error){ el.innerHTML = `<div class="alert err">${ic('alert')}<span>${esc(errMsg(error))}</span></div>`; return; }
  const tone = a => /Senha/.test(a) ? 'b-res' : /liberad/i.test(a) ? 'b-warn' : /ativada|criada/i.test(a) ? 'b-ok' : 'b-acc';
  el.innerHTML = `<div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Detalhe</th></tr></thead><tbody>
  ${(data||[]).map(l => `<tr><td class="nowrap"><div class="small">${new Date(l.quando).toLocaleDateString('pt-BR')}</div><div class="sub">${timeHM(l.quando)}</div></td>
    <td class="nowrap">${esc(l.usuario_nome || '—')}</td><td><span class="badge ${tone(l.acao)}">${esc(l.acao)}</span></td><td class="small">${esc(l.detalhe)}</td></tr>`).join('')
    || `<tr><td colspan="4">${emptyBox('clock','Nenhuma ação encontrada')}</td></tr>`}
  </tbody></table></div>${pager(count || 0, HV.page, PAGE, 'hPage')}</div>`;
}

/* =====================================================================
   USUÁRIOS

/* =====================================================================
   INTEGRAÇÃO COM O SHELL
   ===================================================================== */
const VIEWS = {painel:vPainel, contas:vContas, maquinas:vMaquinas, ativar:vAtivar, reciclar:vReciclar, qualidade:vQualidade, historico:vHistorico};
function renderView(){
  if (!S.mounted || !$('#view')) return;
  ctx.setBadge('licencas/qualidade', S.qn || 0);
  (VIEWS[S.view] || vPainel)();
}
function updateSync(){ const e = $('#lsync'); if (e && S.loadedAt) e.textContent = 'Atualizado às ' + timeHM(S.loadedAt); }
function topbar(){
  ctx.setTopbar(`<span class="sync" id="lsync"></span><button class="ibtn" title="Atualizar dados" id="lref">${ic('refresh')}</button>`);
  $('#lref').onclick = e => busy(e.currentTarget, () => reload());
  updateSync();
}
const onFocus = () => { if (S.mounted && Date.now() - S.loadedAt > 60000) reload(true); };
const onEsc = () => { if ($('#drawer')) closeDrawer(); };
// Busca global (Ctrl+K): contas, máquinas e clientes. Fora do módulo, abre Licenças antes.
function here(sub){ if (!S.mounted) go(sub); }
function search(q){
  const items = [];
  S.accounts.filter(a => norm(a.email).includes(q)).slice(0, 6).forEach(a => items.push({g:'Contas de licença', icon:'mail', t:a.email, s:`${a.c.u} em uso · ${plural(a.c.f,'livre')}`, mono:true, act:() => { here('contas'); openAccount(a.id); }}));
  (S.active || []).filter(s => norm([s.cli,s.host,s.serial].join(' ')).includes(q)).slice(0, 8).forEach(s => items.push({g:'Máquinas com Office', icon:'pc', t:`${s.cli} · ${s.host || 'sem hostname'}`, s:`${s.serial || 'sem serial'} · ${s.a.email} vaga ${s.n}`, act:() => { here('maquinas'); openAccount(s.a.id); }}));
  (S.clients || []).filter(([n]) => norm(n).includes(q)).slice(0, 5).forEach(([n,c]) => items.push({g:'Clientes', icon:'users', t:n, s:plural(c,'máquina'), act:() => { MV.cli = n; MV.q = ''; MV.page = 0; go('maquinas'); }}));
  return items;
}

export default {
  async mount(el, c, sub){
    ctx = c;
    S.view = VIEWS[sub] ? sub : 'painel';
    if (S.uid !== ctx.me.id || !S.loadedAt){
      S.uid = ctx.me.id; S.loadedAt = 0;
      el.innerHTML = `<div class="skel" style="height:110px;margin-bottom:16px"></div><div class="skel" style="height:340px"></div>`;
      await loadData();
    } else if (Date.now() - S.loadedAt > 60000){
      try { await loadData(); } catch(e){ toast('Erro ao atualizar: ' + errMsg(e), 'err'); }
    }
    S.mounted = true;
    topbar();
    renderView();
    window.addEventListener('focus', onFocus);
    window.addEventListener('canivete:esc', onEsc);
    ctx.registerSearch('licencas', search);
  },
  update(sub){ S.view = VIEWS[sub] ? sub : 'painel'; closeDrawer(); closeModal(); renderView(); },
  unmount(){
    S.mounted = false;
    closeDrawer();
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('canivete:esc', onEsc);
  }
};

Object.assign(LIC, {ACOES,CV,HV,MS,MV,NA,PAGE,PW,QV,RV,SEL,TRUST,cellsHtml,changePwForm,checkSerial,closeDrawer,cpKey,cpPick,cpRender,cpToggle,cnt,computeDerived,confirmBulk,confirmPlan,confirmRelease,contasFilter,copyPw,dateTag,drawAccount,drawPlan,drawSelbar,dtBR,excluirConta,exportCsv,fetchPw,goCli,hPage,kpi,loadData,loadHist,loadMs,loadPlanPws,loadRecent,mPage,mSort,makePlan,maqList,msHtml,newAccountForm,openAccount,pager,planPw,planPwCopy,planPwGet,qPage,rPage,recList,reload,reservarVaga,saveSlot,selOne,selPage,serialOwner,setMode,slotCard,slotForm,slotRef,statusBadges,tirarReserva,togglePw,vAtivar,vContas,vContasBody,vHistorico,vMaqBody,vMaquinas,vPainel,vQualBody,vQualidade,vRecBody,vReciclar, S, $, ic, copy, busy, closeModal, go, reload, toast});
