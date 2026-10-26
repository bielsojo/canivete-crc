/* Shell do canivete: login Supabase (vale para todas as ferramentas), barra lateral,
   rotas por hash, busca rápida (Ctrl+K) e tema. As ferramentas são montadas dentro de #view. */
import { sb, CONFIGURADO } from './supabase.js';
import { $, $$, ic, esc, norm, toast, busy, errMsg, closeModal } from './ui.js';
import { isDark, toggleTheme } from './theme.js';
import { NAV, BLOCOS, getModule, podeVer } from '../modules/registry.js';

export const PERFIL = {admin:'Administrador', operador:'Operador', consulta:'Consulta', logistica:'Logística'};
const APP = {me:null, nav:null, modId:null, mod:null, searchers:new Map(), badges:{}, seq:0};
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

export const ctx = {
  sb,
  get me(){ return APP.me; },
  canEdit: () => !!APP.me && APP.me.perfil !== 'consulta',
  isAdmin: () => !!APP.me && APP.me.perfil === 'admin',
  pode: bloco => podeVer(APP.me, {bloco}),
  go,
  setTopbar(html){ const e = $('#topx'); if (e) e.innerHTML = html || ''; },
  setBadge(path, n){ APP.badges[path] = n; renderNav(); },
  registerSearch(id, fn){ APP.searchers.set(id, fn); },
  setMe(patch){ Object.assign(APP.me, patch); renderShell(); route(true); }
};

/* =====================================================================
   LOGIN / SESSÃO
   ===================================================================== */
export async function boot(){
  if (!CONFIGURADO){ renderLogin('Configuração pendente: preencha o arquivo .env com a URL e a chave anon do Supabase.'); return; }
  try {
    const {data:{session}} = await sb.auth.getSession();
    if (!session){ renderLogin(); return; }
    await enter();
  } catch(e){ renderLogin('Não foi possível conectar: ' + errMsg(e)); }
  sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && APP.me){ teardown(); renderLogin('Sua sessão terminou. Entre novamente.'); } });
}
const logos = cls => `<img class="logo-l ${cls}" src="logo.png" alt="Low Cost"><img class="logo-d ${cls}" src="logo-escuro.png" alt="Low Cost">`;
const eyeBtn = id => `<button type="button" class="ibtn" title="Mostrar senha" data-eye="${id}">${ic('eye')}</button>`;
function bindEyes(root){
  $$('[data-eye]', root).forEach(b => b.onclick = () => { const i = $('#' + b.dataset.eye); i.type = i.type === 'password' ? 'text' : 'password'; b.innerHTML = ic(i.type === 'password' ? 'eye' : 'eyeoff'); });
}
function renderLogin(msg=''){
  closeAll();
  $('#root').innerHTML = `
  <div class="auth"><div class="auth-card">
    <div class="auth-logo">${logos('')}</div>
    <h1>Canivete CRC</h1>
    <p class="muted">Backlog, equipamentos, laudos, formulários e licenças em um só lugar. Entre com o e-mail e a senha que o administrador cadastrou.</p>
    <form class="form" id="lf" novalidate>
      <div class="field"><label for="lu">E-mail</label><input class="input" type="email" id="lu" autocomplete="username" placeholder="voce@lowcost.com.br" autofocus></div>
      <div class="field"><label for="lp">Senha</label><div class="pw"><input class="input" type="password" id="lp" autocomplete="current-password" placeholder="••••••••">${eyeBtn('lp')}</div></div>
      <div class="alert err ${msg ? '' : 'hidden'}" id="le">${ic('alert')}<span>${esc(msg)}</span></div>
      <button class="btn primary lg block" id="lb" ${CONFIGURADO ? '' : 'disabled'}>Entrar</button>
    </form>
    <p class="auth-foot">Esqueceu a senha ou precisa de acesso? Fale com o administrador.</p>
  </div></div>`;
  bindEyes($('#root'));
  $('#lf').addEventListener('submit', doLogin);
}
function loginErr(m){ const e = $('#le'); e.classList.remove('hidden'); e.querySelector('span').textContent = m; }
async function doLogin(ev){
  ev.preventDefault();
  if (!CONFIGURADO) return;
  const em = $('#lu').value.trim(), p = $('#lp').value;
  if (!em || !p){ loginErr('Informe e-mail e senha.'); return; }
  await busy($('#lb'), async () => {
    const {error} = await sb.auth.signInWithPassword({email:em, password:p});
    if (error){ loginErr(/confirm/i.test(error.message) ? 'Este e-mail ainda não foi confirmado.' : /fetch/i.test(error.message) ? errMsg(error) : 'E-mail ou senha incorretos.'); return; }
    try { await enter(); } catch(err){ renderLogin('Erro ao carregar: ' + errMsg(err)); }
  });
}
async function enter(){
  $('#root').innerHTML = `<div class="boot"><div class="muted" style="display:flex;gap:10px;align-items:center"><span class="btn ghost busy" style="height:auto;padding:0"></span>Abrindo o canivete…</div></div>`;
  const {data:{user:u}} = await sb.auth.getUser();
  let {data:p, error} = await sb.from('perfis').select('id,nome,perfil,ativo,trocar_senha,acessos').eq('id', u.id).maybeSingle();
  if (error && /acessos/.test(error.message)){
    // banco ainda sem o 08_acessos.sql: mantém o acesso de antes (todos os blocos)
    ({data:p, error} = await sb.from('perfis').select('id,nome,perfil,ativo,trocar_senha').eq('id', u.id).maybeSingle());
    if (p) p.acessos = BLOCOS.map(b => b.id);
  }
  if (error || !p || !p.ativo){ await sb.auth.signOut(); APP.me = null; renderLogin('Seu usuário ainda não tem acesso. Peça ao administrador.'); return; }
  if (p.trocar_senha){ renderForcePw(p.nome || u.email, u.email); return; }
  APP.me = {id:p.id, nome:p.nome || u.email, email:u.email, perfil:p.perfil, acessos:p.acessos || []};
  renderShell();
  route(true);
}
// Primeiro acesso (ou senha redefinida pelo admin): só entra depois de criar a própria senha.
// O banco também bloqueia todos os dados até a troca (meu_perfil() fica nulo).
function renderForcePw(nome, email){
  closeAll();
  $('#root').innerHTML = `
  <div class="auth"><div class="auth-card">
    <div class="auth-logo">${logos('')}</div>
    <h1>Crie sua senha</h1>
    <p class="muted">Olá, ${esc(nome.split(' ')[0])}! Por segurança, troque a senha que o administrador definiu antes de continuar.</p>
    <form class="form" id="ff" novalidate>
      <input type="email" value="${esc(email)}" autocomplete="username" hidden>
      <div class="field"><label for="fp1">Nova senha</label><div class="pw"><input class="input" type="password" id="fp1" autocomplete="new-password" autofocus>${eyeBtn('fp1')}</div>
        <span class="help">Mínimo de 8 caracteres e diferente da senha atual.</span></div>
      <div class="field"><label for="fp2">Repita a nova senha</label><div class="pw"><input class="input" type="password" id="fp2" autocomplete="new-password">${eyeBtn('fp2')}</div></div>
      <div class="alert err hidden" id="fe2">${ic('alert')}<span></span></div>
      <button class="btn primary lg block" id="fb">Salvar e entrar</button>
    </form>
    <p class="auth-foot"><a href="#" id="fout">Sair</a></p>
  </div></div>`;
  bindEyes($('#root'));
  $('#fout').onclick = e => { e.preventDefault(); logout(); };
  $('#ff').addEventListener('submit', async ev => {
    ev.preventDefault();
    const er = t => { const e = $('#fe2'); e.classList.remove('hidden'); e.querySelector('span').textContent = t; };
    const a = $('#fp1').value, b = $('#fp2').value;
    if (a.length < 8) return er('A senha precisa ter pelo menos 8 caracteres.');
    if (a !== b) return er('As duas senhas não são iguais.');
    await busy($('#fb'), async () => {
      const {error} = await sb.auth.updateUser({password:a});
      if (error) return er(/different|same/i.test(error.message) ? 'A nova senha precisa ser diferente da atual.' : /weak|short|characters/i.test(error.message) ? 'Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.' : errMsg(error));
      const {error:e2} = await sb.rpc('senha_trocada');
      if (e2) return er(errMsg(e2));
      toast('Senha criada. Bem-vindo(a)!');
      try { await enter(); } catch(err){ renderLogin('Erro ao carregar: ' + errMsg(err)); }
    });
  });
}
export async function logout(){
  teardown();
  try { await sb.auth.signOut(); } catch(e){}
  renderLogin();
}
function teardown(){
  if (APP.mod && APP.mod.unmount) try { APP.mod.unmount(); } catch(e){ console.error(e); }
  APP.me = null; APP.mod = null; APP.modId = null; APP.nav = null; APP.searchers.clear(); APP.badges = {};
}

/* =====================================================================
   SHELL + NAVEGAÇÃO
   ===================================================================== */
function sideCollapsed(){ try { return localStorage.getItem('canivete:side') === '1'; } catch(e){ return false; } }
function renderShell(){
  const me = APP.me;
  $('#root').innerHTML = `
  <div class="app ${sideCollapsed() ? 'collapsed' : ''}" id="app">
    <aside class="side" id="side">
      <div class="brand-logo">${logos('')}<span class="mark" title="Canivete CRC">CC</span><span class="app-name">${ic('tool','sm')} Canivete CRC</span></div>
      <nav id="nav"></nav>
      <div class="me">
        <div class="avatar" title="${esc(me.nome)}">${esc((me.nome[0]||'?').toUpperCase())}</div>
        <div class="who"><div class="trunc">${esc(me.nome)}</div><div class="muted small">${esc(PERFIL[me.perfil] || me.perfil)}</div></div>
        <button class="ibtn keep" id="themeBtn" title="Alternar tema"></button>
        <button class="ibtn" id="outBtn" title="Sair">${ic('out')}</button>
      </div>
    </aside>
    <div class="main">
      <header class="top">
        <button class="ibtn menu" id="menuBtn" aria-label="Menu">${ic('menu')}</button>
        <button class="ibtn hide-sm" id="collapseBtn" title="Recolher menu" style="margin-left:-8px">${ic('side')}</button>
        <div style="min-width:0"><div class="crumb trunc" id="crumb"></div><h1 id="ttl" class="trunc"></h1></div>
        <div class="grow"></div>
        <button class="kbtn" id="kBtn">${ic('search','sm')}<span>Buscar ferramenta, conta, máquina…</span><kbd>${isMac ? '⌘' : 'Ctrl'} K</kbd></button>
        <div class="top-extra" id="topx"></div>
      </header>
      <div class="content" id="view"></div>
    </div>
  </div>`;
  $('#themeBtn').onclick = () => { toggleTheme(); paintTheme(); };
  $('#outBtn').onclick = logout;
  $('#menuBtn').onclick = toggleSide;
  $('#kBtn').onclick = openPalette;
  $('#collapseBtn').onclick = () => {
    const a = $('#app'); a.classList.toggle('collapsed');
    try { localStorage.setItem('canivete:side', a.classList.contains('collapsed') ? '1' : '0'); } catch(e){}
  };
  paintTheme();
  renderNav();
}
function paintTheme(){ const b = $('#themeBtn'); if (b) b.innerHTML = ic(isDark() ? 'sun' : 'moon'); }
function renderNav(){
  const n = $('#nav'); if (!n || !APP.me) return;
  let g = null, html = '';
  NAV.filter(it => podeVer(APP.me, it)).forEach(it => {
    if (it.group !== g){ g = it.group; html += g ? `<div class="nav-group">${g}</div><div class="nav-sep"></div>` : ''; }
    const b = APP.badges[it.path];
    html += `<a class="nav ${APP.nav && APP.nav.path === it.path ? 'on' : ''}" href="#/${it.path}" title="${esc(it.title)}">${ic(it.icon)}<span>${it.title}</span>${b ? `<span class="badge b-warn">${b}</span>` : ''}</a>`;
  });
  n.innerHTML = html;
}
export function go(path){ if (location.hash !== '#/' + path) location.hash = '#/' + path; else route(true); }
function findNav(){
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  const n = NAV.find(n => n.path === h) || NAV.find(n => h && n.path.startsWith(h + '/')) || NAV[0];
  if (podeVer(APP.me, n)) return n;
  toast('Você não tem acesso a essa área. Peça ao administrador.', 'err');
  return NAV[0];
}
async function route(force){
  if (!APP.me || !$('#view')) return;
  const nav = findNav(), seq = ++APP.seq;
  if (location.hash !== '#/' + nav.path) history.replaceState(null, '', '#/' + nav.path);
  closeSide(); closeModal(); closePalette();
  const same = APP.modId === nav.mod && APP.mod;
  APP.nav = nav;
  renderNav();
  $('#ttl').textContent = nav.title;
  $('#crumb').textContent = nav.group || 'Canivete CRC';
  document.title = `${nav.title} · Canivete CRC`;
  const view = $('#view');
  view.classList.toggle('full', !!nav.full);
  if (same && APP.mod.update && !force){ APP.mod.update(nav.sub); window.scrollTo(0, 0); return; }
  if (APP.mod && APP.mod.unmount) try { APP.mod.unmount(); } catch(e){ console.error(e); }
  APP.mod = null; APP.modId = null;
  ctx.setTopbar('');
  view.innerHTML = `<div class="skel" style="height:120px;margin-bottom:16px"></div><div class="skel" style="height:320px"></div>`;
  let mod;
  try { mod = await getModule(nav.mod); }
  catch(e){ console.error(e); view.innerHTML = `<div class="alert err">${ic('alert')}<span>Não foi possível abrir a ferramenta. Recarregue a página.</span></div>`; return; }
  if (seq !== APP.seq) return;  // o usuário já navegou para outra tela
  APP.mod = mod; APP.modId = nav.mod;
  view.innerHTML = '';
  window.scrollTo(0, 0);
  try { await mod.mount(view, ctx, nav.sub); }
  catch(e){
    console.error(e);
    if (seq !== APP.seq) return;
    // falhou: a próxima navegação monta de novo em vez de só trocar de sub-tela
    try { mod.unmount && mod.unmount(); } catch(_){}
    APP.mod = null; APP.modId = null;
    view.innerHTML = `<div class="alert err">${ic('alert')}<span>Erro ao abrir: ${esc(errMsg(e))}</span><button class="btn sm" style="margin-left:auto" id="retry">${ic('refresh','sm')} Tentar de novo</button></div>`;
    $('#retry').onclick = () => route(true);
  }
}
window.addEventListener('hashchange', () => route(false));
function toggleSide(){
  const s = $('#side'); s.classList.toggle('open');
  if (s.classList.contains('open')){ $('#layer').insertAdjacentHTML('beforeend', '<div class="scrim" id="sideScrim" style="z-index:39"></div>'); $('#sideScrim').onclick = closeSide; }
  else closeSide();
}
function closeSide(){ const s = $('#side'); if (s) s.classList.remove('open'); const k = $('#sideScrim'); if (k) k.remove(); }
function closeAll(){ closeModal(); closePalette(); closeSide(); }

/* =====================================================================
   BUSCA RÁPIDA (Ctrl+K) — ferramentas + o que cada módulo registrar
   ===================================================================== */
let PAL = {sel:0, items:[]};
function openPalette(){
  if (!APP.me || $('#pal')) return;
  closeSide();
  $('#layer').insertAdjacentHTML('beforeend', `<div class="scrim" id="pscrim" style="z-index:70"></div>
  <div class="palette" id="pal" role="dialog" aria-modal="true">
    <div class="palette-in">${ic('search')}<input id="pin" placeholder="Ferramenta, conta, cliente, hostname ou serial…" autocomplete="off"><kbd>Esc</kbd></div>
    <div class="palette-r" id="pres"></div>
    <div class="palette-f"><span><kbd>↑</kbd> <kbd>↓</kbd> navegar</span><span><kbd>Enter</kbd> abrir</span></div>
  </div>`);
  $('#pscrim').onclick = closePalette;
  const inp = $('#pin');
  inp.oninput = () => palSearch(inp.value);
  inp.onkeydown = palKey;
  $('#pres').addEventListener('click', e => { const r = e.target.closest('[data-i]'); if (r) palGo(+r.dataset.i); });
  $('#pres').addEventListener('mousemove', e => { const r = e.target.closest('[data-i]'); if (r && +r.dataset.i !== PAL.sel){ PAL.sel = +r.dataset.i; drawPal(); } });
  palSearch(''); inp.focus();
}
function closePalette(){ ['#pal','#pscrim'].forEach(s => { const e = $(s); if (e) e.remove(); }); }
function palSearch(v){
  const q = norm(v.trim());
  const items = [];
  if (q) APP.searchers.forEach(fn => { try { items.push(...fn(q)); } catch(e){ console.error(e); } });
  const pages = NAV.filter(n => podeVer(APP.me, n) && (!q || norm(n.title + ' ' + n.group).includes(q)))
    .map(n => ({g:'Ir para', icon:n.icon, t:n.title, s:n.group, act:() => go(n.path)}));
  items.push(...pages.slice(0, q ? 5 : 14));
  PAL = {sel:0, items};
  drawPal();
}
function drawPal(){
  let g = '', html = '';
  PAL.items.forEach((it, i) => {
    if (it.g !== g){ g = it.g; html += `<div class="pr-g">${esc(g)}</div>`; }
    html += `<div class="pr ${i===PAL.sel?'on':''}" data-i="${i}">${ic(it.icon)}<div style="min-width:0"><div class="t trunc ${it.mono?'mono':''}">${esc(it.t)}</div>${it.s ? `<div class="s trunc">${esc(it.s)}</div>` : ''}</div></div>`;
  });
  $('#pres').innerHTML = html || `<div class="empty" style="padding:28px">Nada encontrado.</div>`;
  const on = $('#pres .pr.on'); if (on) on.scrollIntoView({block:'nearest'});
}
function palKey(e){
  if (e.key === 'ArrowDown'){ e.preventDefault(); PAL.sel = Math.min(PAL.items.length-1, PAL.sel+1); drawPal(); }
  else if (e.key === 'ArrowUp'){ e.preventDefault(); PAL.sel = Math.max(0, PAL.sel-1); drawPal(); }
  else if (e.key === 'Enter'){ e.preventDefault(); palGo(PAL.sel); }
}
function palGo(i){ const it = PAL.items[i]; if (!it) return; closePalette(); it.act(); }

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'){ if (!APP.me) return; e.preventDefault(); $('#pal') ? closePalette() : openPalette(); return; }
  if (e.key === '/' && APP.me && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable){ e.preventDefault(); openPalette(); return; }
  if (e.key === 'Escape'){
    if ($('#pal')) closePalette();
    else if ($('#mdl')) closeModal();
    else if ($('#progress')) return;
    else { window.dispatchEvent(new CustomEvent('canivete:esc')); closeSide(); }
  }
});
window.addEventListener('canivete:theme', paintTheme);

// Só em desenvolvimento (npm run dev): abre o shell sem login para testar a interface.
// Não existe no build publicado. As telas que dependem do Supabase mostram erro de permissão.
if (import.meta.env.DEV) window.__caniveteDemo = (perfil = 'admin', acessos = BLOCOS.map(b => b.id)) => {
  APP.me = {id:'demo', nome:'Demonstração', email:'demo@local', perfil, acessos};
  renderShell(); route(true);
};
