/* Construtor de formulários. Roda isolado num iframe (public/tools/formularios) porque usa classes
   no <body>, um listener global de clique e layout de tela cheia. Mesma origem: o tema vem do
   localStorage 'tema' e o formulário fica salvo em localStorage 'fc-builder-v1'. */
import { ic } from '../../core/ui.js';
import { isDark } from '../../core/theme.js';

let frame = null;
const syncTheme = () => {
  try { frame && frame.contentDocument && frame.contentDocument.documentElement.setAttribute('data-theme', isDark() ? 'dark' : 'light'); } catch(e){}
};

export default {
  mount(el, ctx){
    el.innerHTML = `<iframe class="tool-frame" src="tools/formularios/index.html" title="Construtor de formulários"></iframe>`;
    frame = el.querySelector('iframe');
    frame.addEventListener('load', syncTheme);
    ctx.setTopbar(`<a class="btn sm ghost" href="tools/formularios/index.html" target="_blank" rel="noopener" title="Abrir em uma aba separada">${ic('ext','sm')}<span class="hide-sm">Nova aba</span></a>`);
    window.addEventListener('canivete:theme', syncTheme);
  },
  unmount(){ window.removeEventListener('canivete:theme', syncTheme); frame = null; }
};
