/* Página inicial: atalhos para cada ferramenta com um número-resumo de cada uma. */
import { NAV } from '../registry.js';
import { $, ic, esc, nf } from '../../core/ui.js';

const TONES = {
  backlog:['var(--bad)','var(--bad-soft)'], equipamentos:['var(--info)','var(--info-soft)'], laudos:['var(--ok)','var(--ok-soft)'],
  formularios:['var(--res)','var(--res-soft)'], 'licencas/painel':['var(--accent)','var(--accent-soft)'], usuarios:['var(--warn)','var(--warn-soft)']
};
let alive = false;

export default {
  async mount(el, ctx){
    alive = true;
    const hi = new Date().getHours(), hello = hi < 12 ? 'Bom dia' : hi < 18 ? 'Boa tarde' : 'Boa noite';
    const tools = NAV.filter(n => n.desc);
    tools.push({path:'usuarios', title:'Usuários', icon:'users', desc: ctx.isAdmin() ? 'Crie acessos, defina perfis e redefina senhas.' : 'Veja quem tem acesso e o perfil de cada um.'});
    el.innerHTML = `
      <div class="hero"><div><h2>${hello}, ${esc(ctx.me.nome.split(' ')[0])}</h2>
        <p>Todas as ferramentas do CRC em um lugar. Use a busca (<kbd>Ctrl</kbd> <kbd>K</kbd>) para pular direto para uma ferramenta, conta ou máquina.</p></div>
        <a class="btn primary" href="#/licencas/ativar">${ic('plus','sm')} Nova ativação de Office</a></div>
      <div class="tools">${tools.map(t => { const [fg, bg] = TONES[t.path] || TONES.usuarios; return `
        <a class="card tool" href="#/${t.path}" style="text-decoration:none">
          <span class="ti" style="color:${fg};background:${bg}">${ic(t.icon)}</span>
          <h3>${t.path === 'licencas/painel' ? 'Licenças Office' : t.title}</h3><p>${t.desc}</p>
          <div class="stat" id="st-${t.path.replace('/', '-')}"><span class="skel" style="width:120px;height:14px"></span></div>
        </a>`; }).join('')}</div>`;
    if (!ctx.canEdit()) { const b = $('.hero .btn', el); if (b) b.remove(); }
    const put = (id, html) => { const e = $('#st-' + id); if (alive && e) e.innerHTML = html; };

    import('../backlog/index.js').then(m => m.backlogResumo()).then(r => put('backlog', r
      ? `<b>${nf(r.ativos)}</b> ativos · <b style="color:var(--bad)">${nf(r.criticos)}</b> críticos`
      : 'Nenhum CSV carregado neste navegador')).catch(() => put('backlog', '—'));
    import('../equipamentos/index.js').then(m => m.equipResumo()).then(r => put('equipamentos', r
      ? `<b>${nf(r.total)}</b> equipamentos na base`
      : 'Nenhuma planilha carregada')).catch(() => put('equipamentos', '—'));
    put('laudos', 'Doação ou descarte em PDF');
    put('formularios', 'Exporta PNG e JSON');
    put('usuarios', ctx.isAdmin() ? 'Você é administrador' : 'Perfil: ' + esc(ctx.me.perfil));

    try {
      const [free, act] = await Promise.all(['disponivel', 'ativo'].map(st => ctx.sb.from('vagas').select('id', {count:'exact', head:true}).eq('status', st)));
      if (free.error || act.error) throw free.error || act.error;
      put('licencas-painel', `<b>${nf(act.count)}</b> máquinas · <b style="color:var(--ok)">${nf(free.count)}</b> vagas livres`);
    } catch(e){ put('licencas-painel', 'Não foi possível consultar agora'); }
  },
  unmount(){ alive = false; }
};
