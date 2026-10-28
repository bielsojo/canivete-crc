/* Usuários do canivete (perfis do Supabase). Tela só do administrador: cria, bloqueia, muda perfil,
   libera áreas (blocos do menu) e redefine senha (a Edge Function "usuarios" confere de novo no servidor). */
import { sb, callFn } from '../../core/supabase.js';
import { $, ic, esc, relTime, errMsg, toast, copy, busy, modal, closeModal, confirmBox, pageHead } from '../../core/ui.js';
import { PERFIL } from '../../core/shell.js';
import { BLOCOS } from '../registry.js';

let ctx = null;
const USR = window.USR = {};
const U = { users:[], mounted:false };
const isAdmin = () => ctx.isAdmin();

function areasCell(u){
  if (u.perfil === 'admin') return '<span class="badge b-res" title="Administrador sempre vê tudo">todas</span>';
  if (!u.acessos) return '<span class="muted small">—</span>';
  const l = BLOCOS.filter(b => u.acessos.includes(b.id)).map(b => b.nome);
  return l.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap">${l.map(n => `<span class="badge b-acc">${esc(n)}</span>`).join('')}</div>` : '<span class="badge b-warn">nenhuma</span>';
}
// Lista de blocos com caixa de seleção (usada no "Novo usuário" e em "Áreas")
function areasPick(sel){
  return `<div class="card"><div class="card-b" style="padding:10px 14px">${BLOCOS.map(b => `
    <label class="check-row"><span><b>${esc(b.nome)}</b><br><span class="small muted">${esc(b.ferramentas.join(', '))}</span></span>
      <input type="checkbox" data-bloco="${b.id}" ${sel.includes(b.id) ? 'checked' : ''}></label>`).join('')}</div></div>`;
}
const areasLidas = m => [...m.querySelectorAll('[data-bloco]:checked')].map(i => i.dataset.bloco);

async function vUsuarios(){
  const adm = isAdmin();
  $('#view').innerHTML = pageHead('Usuários', 'Quem pode entrar no canivete e o que cada um pode fazer.',
    adm ? `<button class="btn primary" onclick="USR.newUserForm()">${ic('plus')} Novo usuário</button>` : '') + '<div id="ubody"><div class="skel" style="height:180px"></div></div>';
  const {data, error} = await sb.rpc('listar_usuarios');
  const el = $('#ubody'); if (!el || !U.mounted) return;
  if (error){ el.innerHTML = `<div class="alert err">${ic('alert')}<span>${esc(errMsg(error))}</span></div>`; return; }
  U.users = data || [];
  el.innerHTML = `<div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr><th>Usuário</th><th>Perfil</th><th>Áreas</th><th>Acesso</th><th class="hide-sm">Último acesso</th>${adm ? '<th></th>' : ''}</tr></thead><tbody>
  ${U.users.map(u => { const self = u.id === ctx.me.id; return `<tr>
    <td><div style="display:flex;gap:10px;align-items:center"><span class="avatar">${esc((u.nome[0]||'?').toUpperCase())}</span><div style="min-width:0"><div class="strong">${esc(u.nome)} ${self ? '<span class="badge b-acc">você</span>' : ''}</div><div class="sub">${u.email ? esc(u.email) : 'desde ' + new Date(u.criado_em).toLocaleDateString('pt-BR')}</div></div></div></td>
    <td>${adm && !self ? `<select class="input" style="width:auto;height:32px" onchange="USR.setPerfil('${u.id}',this.value)">${Object.entries(PERFIL).map(([k,l]) => `<option value="${k}" ${u.perfil===k?'selected':''}>${l}</option>`).join('')}</select>`
        : `<span class="badge ${u.perfil==='admin'?'b-res':u.perfil==='operador'?'b-acc':''}">${PERFIL[u.perfil]}</span>`}</td>
    <td>${areasCell(u)}</td>
    <td class="nowrap">${!u.ativo ? '<span class="badge b-bad dotb">bloqueado</span>' : u.trocar_senha ? '<span class="badge b-warn dotb" title="Precisa criar a própria senha no próximo acesso">aguardando 1º acesso</span>' : '<span class="badge b-ok dotb">ativo</span>'}</td>
    <td class="hide-sm small">${u.ultimo_acesso ? relTime(u.ultimo_acesso) : '<span class="muted">nunca entrou</span>'}</td>
    ${adm ? `<td class="right nowrap">${u.perfil === 'admin' || !u.acessos ? '' : `<button class="btn sm" onclick="USR.editAreas('${u.id}')">${ic('shield','sm')} Áreas</button> `}<button class="btn sm" onclick="USR.renameUser('${u.id}')">${ic('edit','sm')} Nome</button>
      <button class="btn sm" onclick="USR.resetUserPw('${u.id}')">${ic('key','sm')} Senha</button>
      ${self ? '' : `<button class="btn sm" style="${u.ativo?'color:var(--bad)':''}" onclick="USR.setAtivo('${u.id}',${!u.ativo})">${u.ativo ? 'Bloquear' : 'Reativar'}</button>`}</td>` : ''}</tr>`; }).join('')}
  </tbody></table></div></div>
  ${U.users.length && !U.users[0].acessos ? `<div class="alert warn" style="margin-top:12px">${ic('alert')}<span>Para liberar áreas por usuário, rode o <b>08_acessos.sql</b> no SQL Editor do Supabase. Até lá, todos continuam vendo tudo.</span></div>` : ''}
  <div class="card" style="margin-top:16px;max-width:720px"><div class="card-h"><h3>O que cada perfil pode fazer</h3></div><div class="card-b">
    <p class="small muted" style="margin:0 0 10px">As <b>áreas</b> definem quais blocos do menu cada pessoa vê; o <b>perfil</b> define o que ela pode alterar dentro deles. Quando surgir um bloco novo no site, ele aparece aqui para você liberar.</p><div class="mini">
    <div class="mini-row" style="cursor:default"><span class="badge b-res">Administrador</span><span class="small">Tudo, em todas as áreas, inclusive criar e gerenciar usuários.</span></div>
    <div class="mini-row" style="cursor:default"><span class="badge b-acc">CRC</span><span class="small">Usa as áreas liberadas e altera licenças: ativar, editar, liberar, criar contas.</span></div>
    <div class="mini-row" style="cursor:default"><span class="badge b-acc">Logística</span><span class="small">Como o CRC, mas já nasce só com a área Licenças Office liberada.</span></div>
    <div class="mini-row" style="cursor:default"><span class="badge">Consulta</span><span class="small">Usa as áreas liberadas. Nas licenças, só visualiza contas, máquinas e senhas.</span></div>
  </div></div></div>`;
}
// Edge Function "usuarios": roda no Supabase com a chave de serviço; daqui só vai o login de quem usa.
const callUsuarios = body => callFn('usuarios', body);
function genPw(){
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', b = '!@#$%*?';
  const r = new Uint32Array(14); crypto.getRandomValues(r);
  const s = [...r].map((n, i) => i === 7 ? b[n % b.length] : a[n % a.length]).join('');
  return s.slice(0, 4) + '-' + s.slice(4, 9) + '-' + s.slice(9);
}
function pwField(id, val=''){
  return `<div style="display:flex;gap:8px"><input class="input mono grow" type="text" id="${id}" value="${esc(val)}" autocomplete="new-password" spellcheck="false">
    <button type="button" class="btn" onclick="USR.$('#${id}').value=USR.genPw()">${ic('refresh','sm')} Gerar</button></div>`;
}
function accessText(email, senha){ return `Acesso ao Canivete CRC\nSite: ${location.origin + location.pathname}\nE-mail: ${email}\nSenha: ${senha}`; }
function showAccess(title, email, senha, troca=true){
  const m = modal({title, icon:'check', body:`<div class="form">
    <div class="alert ok">${ic('check')}<span>Envie estes dados para a pessoa por um canal seguro.${troca ? ' No próximo acesso ela será obrigada a criar a própria senha.' : ''}</span></div>
    <div class="card" style="overflow:hidden">
      <div class="cred"><span class="k">E-mail</span><span class="v mono trunc">${esc(email)}</span></div>
      <div class="cred"><span class="k">Senha</span><span class="v mono trunc">${esc(senha)}</span></div>
    </div></div>`, foot:`<button class="btn" onclick="USR.closeModal()">Fechar</button><button class="btn primary" id="accp">${ic('copy','sm')} Copiar acesso</button>`});
  $('#accp', m).onclick = () => copy(accessText(email, senha), 'Acesso copiado');
}
function newUserForm(){
  if (!isAdmin()) return;
  const m = modal({title:'Novo usuário', sub:'A pessoa entra no site com este e-mail e senha.', icon:'user', body:`
    <div class="form">
      <div class="field"><label>Nome</label><input class="input" id="nun" placeholder="ex.: Maria Souza"></div>
      <div class="field"><label>E-mail</label><input class="input" type="email" id="nue" placeholder="maria@lowcost.com.br"></div>
      <div class="field"><label>Senha inicial</label>${pwField('nup', genPw())}<span class="help">Mínimo de 8 caracteres. "Gerar" cria uma senha forte.</span></div>
      <div class="field"><label>Perfil</label><select class="input" id="nuf">${Object.entries(PERFIL).map(([k,l]) => `<option value="${k}" ${k==='operador'?'selected':''}>${l}</option>`).join('')}</select></div>
      <div class="field" id="nuar"><label>Áreas liberadas</label>${areasPick([])}<span class="help">Administrador vê todas, independentemente desta escolha.</span></div>
      <div class="alert err hidden" id="nuerr"></div>
    </div>`, foot:`<button class="btn" onclick="USR.closeModal()">Cancelar</button><button class="btn primary" id="nuok">Criar usuário</button>`});
  $('#nuok', m).onclick = e => busy(e.currentTarget, async () => {
    const er = t => { const x = $('#nuerr'); x.classList.remove('hidden'); x.innerHTML = ic('alert') + `<span>${esc(t)}</span>`; };
    const nome = $('#nun').value.trim(), email = $('#nue').value.trim().toLowerCase(), senha = $('#nup').value, perfil = $('#nuf').value, areas = areasLidas(m);
    if (!nome) return er('Informe o nome.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return er('E-mail inválido.');
    if (senha.length < 8) return er('A senha precisa ter pelo menos 8 caracteres.');
    try {
      const r = await callUsuarios({acao:'criar', nome, email, senha, perfil});
      if (perfil !== 'admin' && r && r.id){
        const {error} = await sb.rpc('definir_acessos', {p_id:r.id, p_acessos:areas});
        if (error) toast('Usuário criado, mas as áreas não foram salvas: ' + errMsg(error), 'err');
      }
      toast('Usuário criado'); vUsuarios(); showAccess('Usuário criado', email, senha);
    } catch(err){ er(err.message); }
  });
  $('#nuf', m).onchange = e => {
    $('#nuar').classList.toggle('hidden', e.target.value === 'admin');
    // Logística nasce só com Licenças Office; o admin ainda pode ajustar antes de criar
    if (e.target.value === 'logistica') m.querySelectorAll('[data-bloco]').forEach(i => { i.checked = i.dataset.bloco === 'licencas'; });
  };
  setTimeout(() => $('#nun').focus(), 50);
}
function editAreas(id){
  const u = (U.users || []).find(x => x.id === id); if (!u) return;
  const m = modal({title:'Áreas liberadas', sub:u.nome, icon:'shield', body:`<div class="form">${areasPick(u.acessos || [])}
      <div class="small muted">A pessoa passa a ver só estes blocos no menu, na página inicial e na busca. O banco também bloqueia os dados das áreas não liberadas.</div></div>`,
    foot:`<button class="btn" onclick="USR.closeModal()">Cancelar</button><button class="btn primary" id="arok">Salvar</button>`});
  $('#arok', m).onclick = e => busy(e.currentTarget, async () => {
    const {error} = await sb.rpc('definir_acessos', {p_id:id, p_acessos:areasLidas(m)});
    if (error) return toast(errMsg(error), 'err');
    closeModal(); toast('Áreas atualizadas'); vUsuarios();
  });
}
function resetUserPw(id){
  const u = (U.users || []).find(x => x.id === id); if (!u) return;
  const m = modal({title:'Redefinir senha', sub:u.email || u.nome, icon:'key', body:`
    <div class="form">
      <div class="field"><label>Nova senha</label>${pwField('rup', genPw())}</div>
      ${id === ctx.me.id ? '' : `<label class="check-row" style="padding-top:0"><span>Exigir que a pessoa crie uma nova senha no próximo acesso<br><span class="small muted">Recomendado: assim só ela conhece a senha final.</span></span><input type="checkbox" id="rutr" checked></label>`}
      <div class="alert err hidden" id="ruerr"></div>
    </div>`, foot:`<button class="btn" onclick="USR.closeModal()">Cancelar</button><button class="btn primary" id="ruok">Salvar senha</button>`});
  $('#ruok', m).onclick = e => busy(e.currentTarget, async () => {
    const er = t => { const x = $('#ruerr'); x.classList.remove('hidden'); x.innerHTML = ic('alert') + `<span>${esc(t)}</span>`; };
    const senha = $('#rup').value;
    if (senha.length < 8) return er('A senha precisa ter pelo menos 8 caracteres.');
    const troca = id !== ctx.me.id && $('#rutr').checked;
    try {
      await callUsuarios({acao:'senha', id, senha});
      if (!troca && id !== ctx.me.id){
        // a Edge Function sempre marca a troca; aqui o admin escolheu dispensar
        const {error} = await sb.rpc('admin_dispensar_troca', {p_id:id});
        if (error) toast('Senha redefinida, mas a troca continua obrigatória: ' + errMsg(error), 'err');
      }
      toast('Senha redefinida'); vUsuarios(); showAccess('Senha redefinida', u.email || u.nome, senha, troca);
    }
    catch(err){ er(err.message); }
  });
}
async function setPerfil(id, perfil){
  const {error} = await sb.from('perfis').update({perfil}).eq('id', id);
  if (!error && perfil === 'logistica'){
    const r = await sb.rpc('definir_acessos', {p_id:id, p_acessos:['licencas']});
    if (r.error) toast('Perfil atualizado, mas as áreas não: ' + errMsg(r.error), 'err');
  }
  error ? toast(errMsg(error), 'err') : toast('Perfil atualizado'); vUsuarios();
}
async function setAtivo(id, ativo){
  if (!ativo){ const b = await confirmBox({title:'Bloquear usuário?', tone:'bad', icon:'lock', ok:'Bloquear', text:'A pessoa perde o acesso imediatamente. Você pode reativar depois.'}); if (!b) return; closeModal(); }
  const {error} = await sb.from('perfis').update({ativo}).eq('id', id);
  error ? toast(errMsg(error), 'err') : toast(ativo ? 'Usuário reativado' : 'Usuário bloqueado'); vUsuarios();
}
function renameUser(id){
  const u = (U.users || []).find(x => x.id === id); if (!u) return;
  const m = modal({title:'Nome do usuário', icon:'user', body:`<div class="field"><label>Nome exibido</label><input class="input" id="un" value="${esc(u.nome)}"></div>`,
    foot:`<button class="btn" onclick="USR.closeModal()">Cancelar</button><button class="btn primary" id="unok">Salvar</button>`});
  $('#unok', m).onclick = e => busy(e.currentTarget, async () => {
    const v = $('#un').value.trim(); if (!v) return;
    const {error} = await sb.from('perfis').update({nome:v}).eq('id', id);
    if (error) return toast(errMsg(error), 'err');
    closeModal(); toast('Nome atualizado');
    if (id === ctx.me.id) ctx.setMe({nome:v}); else vUsuarios();
  });
  setTimeout(() => { const i = $('#un'); i.focus(); i.select(); }, 50);
}

Object.assign(USR, {accessText, editAreas, genPw, newUserForm, pwField, renameUser, resetUserPw, setAtivo, setPerfil, showAccess, vUsuarios, $, closeModal});

export default {
  mount(el, c){ ctx = c; U.mounted = true; return vUsuarios(); },
  unmount(){ U.mounted = false; }
};
