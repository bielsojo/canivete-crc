/* Configurações do site (só administrador). Aba "Ocultar ou exibir": esconde ferramentas do menu,
   da página inicial e da busca para todos os usuários (salvo em config_site, chave "ocultos"). */
import { sb } from '../../core/supabase.js';
import { $, $$, ic, esc, toast, errMsg, pageHead } from '../../core/ui.js';
import { NAV, OCULTOS, ocultavel, setOcultos } from '../registry.js';

let ctx = null;

async function salvar(path, ocultar){
  const nova = new Set(OCULTOS);
  ocultar ? nova.add(path) : nova.delete(path);
  const {error} = await sb.from('config_site').upsert({chave:'ocultos', valor:[...nova], atualizado_em:new Date().toISOString()});
  if (error){
    toast(/config_site|relation|does not exist/i.test(error.message || '') ? 'Rode o 09_ocultar.sql no SQL Editor do Supabase para usar este recurso.' : errMsg(error), 'err');
    return false;
  }
  setOcultos([...nova]); ctx.refreshNav();
  return true;
}

function vOcultar(){
  let g = '', html = '';
  NAV.filter(ocultavel).forEach(n => {
    if (n.group !== g){ g = n.group; html += `<div class="nav-group" style="padding:12px 0 4px">${esc(g)}</div>`; }
    const off = OCULTOS.has(n.path);
    html += `<label class="check-row"><span><b>${esc(n.title)}</b>${n.desc ? `<br><span class="small muted">${esc(n.desc)}</span>` : ''}</span>
      <span style="display:flex;gap:10px;align-items:center"><span class="small ${off ? 'muted' : ''}" data-st>${off ? 'Oculto' : 'Visível'}</span><input type="checkbox" data-p="${esc(n.path)}" ${off ? '' : 'checked'}></span></label>`;
  });
  $('#cfbody').innerHTML = `<div class="alert info" style="margin-bottom:12px">${ic('info')}<span>Desmarque para <b>ocultar</b> uma ferramenta de todos os usuários: ela some do menu, da página inicial e da busca. Marque de novo para exibir.</span></div>
    <div class="card"><div class="card-b" style="padding:6px 14px">${html}</div></div>`;
  $$('#cfbody [data-p]').forEach(i => i.onchange = async () => {
    i.disabled = true;
    const ok = await salvar(i.dataset.p, !i.checked);
    i.disabled = false;
    if (!ok){ i.checked = !i.checked; return; }
    const st = i.closest('label').querySelector('[data-st]'); st.textContent = i.checked ? 'Visível' : 'Oculto'; st.classList.toggle('muted', !i.checked);
    toast(i.checked ? 'Item exibido' : 'Item oculto para todos');
  });
}

const ABAS = [{id:'ocultar', nome:'Ocultar ou exibir', icon:'eyeoff', fn:vOcultar}];
function aba(id){
  const a = ABAS.find(x => x.id === id) || ABAS[0];
  $$('#cftabs .tab').forEach(t => t.classList.toggle('on', t.dataset.t === a.id));
  a.fn();
}

export default {
  mount(el, c){
    ctx = c;
    el.innerHTML = pageHead('Configurações', 'Ajustes gerais do site, válidos para todos os usuários.') +
      `<div class="tabs" id="cftabs">${ABAS.map(a => `<button class="tab" data-t="${a.id}">${ic(a.icon,'sm')} ${a.nome}</button>`).join('')}</div><div id="cfbody"></div>`;
    $$('#cftabs .tab').forEach(t => t.onclick = () => aba(t.dataset.t));
    aba(ABAS[0].id);
  }
};
