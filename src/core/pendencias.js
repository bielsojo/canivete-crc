/* Senha de licença usada sem ativação registrada.
   O banco guarda a pendência (pendencias_senha, 13_pendencia_senha.sql) a cada senha mostrada ou copiada
   e a tira quando a pessoa ativa uma vaga na conta ou justifica. Enquanto houver pendência, a janela de
   justificativa aparece em qualquer tela, ao recarregar, ao entrar de novo e ao tentar sair.
   O módulo de licenças registra ganchos: emAtivacao() (não cobra no meio da ativação), voltar(ids) e depois(). */
import { rpc } from './supabase.js';
import { $, ic, esc, toast, busy, errMsg, modal, closeModal } from './ui.js';

const P = {list:[], hooks:{}};
export const pendHooks = h => Object.assign(P.hooks, h);
export const temPendencia = () => P.list.length > 0;
export function marcarPendencia(id, email){ if (!P.list.some(x => x.conta_id === id)) P.list.push({conta_id:id, email}); }
export function limparPendencia(ids){ P.list = P.list.filter(x => !ids.includes(x.conta_id)); }
export function zerarPendencias(){ P.list = []; }
// Sem o 13_pendencia_senha.sql, fica só com as pendências marcadas nesta sessão.
export async function carregarPendencias(){
  try { P.list = (await rpc('minhas_pendencias_senha', {})) || []; } catch(e){ console.error('pendencias_senha:', e); }
  return P.list.length;
}
window.addEventListener('beforeunload', e => { if (P.list.length){ e.preventDefault(); e.returnValue = ''; } });

// Mostra a janela se houver pendência. force: cobra mesmo no meio de uma ativação (ex.: ao sair do sistema).
// Devolve true quando a janela está aberta.
export async function cobrarPendencia({recarregar = false, force = false} = {}){
  if (recarregar) await carregarPendencias();
  if (!P.list.length) return false;
  if ($('#pgyes')) return true;
  if (!force && P.hooks.emAtivacao && P.hooks.emAtivacao()) return false;
  abrir();
  return true;
}

function abrir(){
  const ids = P.list.map(x => x.conta_id), emails = P.list.map(x => x.email);
  const m = modal({title:'Esqueceu de registrar a ativação?', icon:'alert', tone:'warn', sub:emails.join(', '), body:`<div class="form">
    <div style="color:var(--text-2)">Você mostrou ou copiou a senha de ${emails.length > 1 ? 'contas' : 'uma conta'} e não registrou nenhuma ativação nela:
      <ul class="small mono" style="margin:8px 0 0;padding-left:18px">${emails.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>
    <div class="form hidden" id="pgj"><div class="field"><label>Justificativa *</label><textarea class="input" id="pgt" rows="3" placeholder="Por que a senha foi usada sem registrar uma ativação?"></textarea></div>
      <div class="small muted" style="display:flex;gap:6px;align-items:center">${ic('info','sm')}Fica registrada no histórico e o administrador é avisado.</div>
      <div class="alert err hidden" id="pge"></div></div>
  </div>`, foot:`<button class="btn" id="pgno">Não, vou justificar</button><button class="btn primary" id="pgyes">Sim, registrar agora</button><button class="btn primary hidden" id="pgsend">Enviar justificativa</button>`});
  // Janela obrigatória: sem X, sem fechar clicando fora nem com Esc (ver shell.js).
  const w = $('#mdl'); w.dataset.fixo = '1';
  const x = $('.modal-h [data-close]', m); if (x) x.remove();
  w.addEventListener('click', e => { if (e.target === w) e.stopImmediatePropagation(); }, true);
  $('#pgyes', m).onclick = () => { closeModal(); voltar(ids); };
  $('#pgno', m).onclick = () => {
    $('#pgj').classList.remove('hidden'); $('#pgno').classList.add('hidden'); $('#pgsend').classList.remove('hidden');
    const y = $('#pgyes'); y.classList.remove('primary'); y.textContent = 'Voltar para a ativação';
    $('#pgt').focus();
  };
  $('#pgsend', m).onclick = e => busy(e.currentTarget, async () => {
    const t = $('#pgt').value.trim(), er = msg => { const b = $('#pge'); b.classList.remove('hidden'); b.innerHTML = ic('alert') + `<span>${esc(msg)}</span>`; };
    if (t.length < 5) return er('Escreva a justificativa.');
    try {
      await rpc('justificar_senha', {p_contas:ids, p_justificativa:t});
      limparPendencia(ids); closeModal(); toast('Justificativa registrada. O administrador foi avisado.');
      if (P.hooks.depois) P.hooks.depois();
    } catch(err){ er(errMsg(err)); }
  });
}
// "Sim": o módulo de licenças volta para o plano ou abre a conta; sem ele carregado, abre a conta pela rota.
function voltar(ids){
  if (P.hooks.voltar && P.hooks.voltar(ids)) return;
  try { sessionStorage.setItem('canivete:abrirConta', String(ids[0])); } catch(e){}
  location.hash = '#/licencas/contas';
}
