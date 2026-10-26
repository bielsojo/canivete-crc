/* Tema claro/escuro. A escolha fica em localStorage 'tema' (a mesma chave do Controle de Licenças,
   e lida também pela ferramenta de formulários dentro do iframe). */
export function isDark(){
  const t = document.documentElement.getAttribute('data-theme');
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
export function toggleTheme(){
  const t = isDark() ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('tema', t); } catch(e){}
  window.dispatchEvent(new CustomEvent('canivete:theme', {detail:{dark:t === 'dark'}}));
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!document.documentElement.getAttribute('data-theme')) window.dispatchEvent(new CustomEvent('canivete:theme', {detail:{dark:isDark()}}));
});
// Lê um token CSS (ex.: '--accent') já resolvido para o tema atual — usado pelos gráficos.
export const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
