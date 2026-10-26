/* Catálogo das ferramentas do canivete. Cada item da navegação aponta para um módulo
   (carregado sob demanda) e, opcionalmente, para uma sub-tela dele.
   Contrato do módulo: export default { mount(el, ctx, sub), update?(sub), unmount?() } */
const load = {
  inicio:       () => import('./inicio/index.js'),
  backlog:      () => import('./backlog/index.js'),
  equipamentos: () => import('./equipamentos/index.js'),
  laudos:       () => import('./laudos/index.js'),
  formularios:  () => import('./formularios/index.js'),
  licencas:     () => import('./licencas/index.js'),
  usuarios:     () => import('./usuarios/index.js')
};

export const NAV = [
  {path:'inicio', mod:'inicio', title:'Início', icon:'home', group:''},
  {path:'backlog', mod:'backlog', title:'Backlog de chamados', icon:'ticket', group:'Operação', desc:'BI dos chamados do GLPI: filtros cruzados, gráficos e insights automáticos.'},
  {path:'equipamentos', mod:'equipamentos', title:'Equipamentos', icon:'box', group:'Operação', desc:'Busca no inventário de ativos, com filtros, colunas e exportação XLSX.'},
  {path:'laudos', mod:'laudos', title:'Gerador de laudos', icon:'file', group:'Documentos', desc:'Declaração de doação ou descarte em PDF, com NFs e RATs anexados.'},
  {path:'formularios', mod:'formularios', title:'Formulários', icon:'form', group:'Documentos', full:true, desc:'Monte formulários no visual do GLPI e exporte em PNG ou JSON.'},
  {path:'licencas/painel', mod:'licencas', sub:'painel', title:'Painel', icon:'dash', group:'Licenças Office', desc:'Contas, vagas e ativações do Office.'},
  {path:'licencas/contas', mod:'licencas', sub:'contas', title:'Contas', icon:'key', group:'Licenças Office'},
  {path:'licencas/maquinas', mod:'licencas', sub:'maquinas', title:'Máquinas', icon:'pc', group:'Licenças Office'},
  {path:'licencas/ativar', mod:'licencas', sub:'ativar', title:'Nova ativação', icon:'plusc', group:'Licenças Office'},
  {path:'licencas/reciclar', mod:'licencas', sub:'reciclar', title:'Reciclagem', icon:'rec', group:'Licenças Office'},
  {path:'licencas/qualidade', mod:'licencas', sub:'qualidade', title:'Qualidade dos dados', icon:'shield', group:'Licenças Office'},
  {path:'licencas/historico', mod:'licencas', sub:'historico', title:'Histórico', icon:'clock', group:'Licenças Office'},
  {path:'usuarios', mod:'usuarios', title:'Usuários', icon:'users', group:'Administração'}
];

const cache = {};
export async function getModule(id){
  if (!cache[id]) cache[id] = load[id]().then(m => m.default);
  return cache[id];
}
