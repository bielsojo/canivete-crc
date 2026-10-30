/* Catálogo das ferramentas do canivete. Cada item da navegação aponta para um módulo
   (carregado sob demanda) e, opcionalmente, para uma sub-tela dele.
   Contrato do módulo: export default { mount(el, ctx, sub), update?(sub), unmount?() }
   Acesso: "bloco" é o que o admin libera por usuário na tela Usuários (o nome exibido é o "group").
   Um bloco novo aparece sozinho na tela de usuários; o administrador sempre vê tudo.
   Itens sem bloco (Início) são de todos; "admin:true" é só do administrador. */
const load = {
  inicio:       () => import('./inicio/index.js'),
  backlog:      () => import('./backlog/index.js'),
  equipamentos: () => import('./equipamentos/index.js'),
  laudos:       () => import('./laudos/index.js'),
  formularios:  () => import('./formularios/index.js'),
  licencas:     () => import('./licencas/index.js'),
  usuarios:     () => import('./usuarios/index.js'),
  config:       () => import('./config/index.js')
};

export const NAV = [
  {path:'inicio', mod:'inicio', title:'Início', icon:'home', group:''},
  {path:'backlog', mod:'backlog', title:'Backlog de chamados', icon:'ticket', group:'Operação', bloco:'operacao', desc:'BI dos chamados do GLPI: filtros cruzados, gráficos e insights automáticos.'},
  {path:'equipamentos', mod:'equipamentos', title:'Equipamentos', icon:'box', group:'Operação', bloco:'operacao', desc:'Busca no inventário de ativos, com filtros, colunas e exportação XLSX.'},
  {path:'laudos', mod:'laudos', title:'Gerador de laudos', icon:'file', group:'Documentos', bloco:'documentos', desc:'Declaração de doação ou descarte em PDF, com NFs e RATs anexados.'},
  {path:'formularios', mod:'formularios', title:'Formulários', icon:'form', group:'Documentos', bloco:'documentos', full:true, desc:'Monte formulários no visual do GLPI e exporte em PNG ou JSON.'},
  {path:'licencas/painel', mod:'licencas', sub:'painel', title:'Painel', icon:'dash', group:'Licenças Office', bloco:'licencas', desc:'Contas, vagas e ativações do Office.'},
  {path:'licencas/contas', mod:'licencas', sub:'contas', title:'Contas', icon:'key', group:'Licenças Office', bloco:'licencas'},
  {path:'licencas/maquinas', mod:'licencas', sub:'maquinas', title:'Máquinas', icon:'pc', group:'Licenças Office', bloco:'licencas'},
  {path:'licencas/ativar', mod:'licencas', sub:'ativar', title:'Nova ativação', icon:'plusc', group:'Licenças Office', bloco:'licencas'},
  {path:'licencas/reciclar', mod:'licencas', sub:'reciclar', title:'Reciclagem', icon:'rec', group:'Licenças Office', bloco:'licencas'},
  {path:'licencas/alertas', mod:'licencas', sub:'alertas', title:'Alertas', icon:'alert', group:'Licenças Office', bloco:'licencas', admin:true},
  {path:'licencas/qualidade', mod:'licencas', sub:'qualidade', title:'Qualidade dos dados', icon:'shield', group:'Licenças Office', bloco:'licencas', admin:true},
  {path:'licencas/historico', mod:'licencas', sub:'historico', title:'Histórico', icon:'clock', group:'Licenças Office', bloco:'licencas'},
  {path:'usuarios', mod:'usuarios', title:'Usuários', icon:'users', group:'Administração', admin:true},
  {path:'config', mod:'config', title:'Configurações', icon:'tool', group:'Administração', admin:true}
];

// Blocos liberáveis, na ordem do menu: [{id, nome, ferramentas:[títulos]}]
export const BLOCOS = NAV.reduce((acc, n) => {
  if (!n.bloco || n.admin) return acc;
  let b = acc.find(x => x.id === n.bloco);
  if (!b) acc.push(b = {id:n.bloco, nome:n.group, ferramentas:[]});
  b.ferramentas.push(n.title);
  return acc;
}, []);

// Itens ocultados pelo administrador (valem para todos). Início e telas de administração nunca se ocultam.
export const OCULTOS = new Set();
export const ocultavel = n => !n.admin && n.path !== 'inicio';
export const setOcultos = l => { OCULTOS.clear(); (l || []).forEach(p => OCULTOS.add(p)); };

// O usuário pode abrir este item do menu?
export function podeVer(me, n){
  if (!me) return false;
  if (n.path && OCULTOS.has(n.path) && ocultavel(n)) return false;
  if (me.perfil === 'admin') return true;
  if (n.admin) return false;
  return !n.bloco || (me.acessos || []).includes(n.bloco);
}

const cache = {};
export async function getModule(id){
  if (!cache[id]) cache[id] = load[id]().then(m => m.default);
  return cache[id];
}
