/* Utilidades de interface compartilhadas por todas as ferramentas:
   ícones, formatação, toast, modal, confirmação, cópia e botões ocupados. */

const P = {
  dash:'<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  key:'<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2"/><path d="m16 7 3 3"/>',
  pc:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  plusc:'<circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>',
  rec:'<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  clock:'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  lock:'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff:'<path d="M17.9 17.9A10.9 10.9 0 0 1 12 19c-6.5 0-10-7-10-7a18 18 0 0 1 5-5.9M9.9 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-2.2 3.2M1 1l22 22"/>',
  copy:'<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  x:'<path d="M18 6 6 18M6 6l12 12"/>',
  dl:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  up:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  out:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  edit:'<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  refresh:'<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12A9 9 0 0 1 18.5 5.8L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  alert:'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  info:'<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  mail:'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
  unlock:'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  cal:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  zap:'<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  ticket:'<path d="M3 8a2 2 0 0 0 2-2V5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v1a2 2 0 0 0 2 2v8a2 2 0 0 0-2 2v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-1a2 2 0 0 0-2-2z"/><path d="M9 9h6M9 15h6"/>',
  box:'<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15l2 2 4-4"/>',
  doc:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  form:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>',
  sheet:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  trash:'<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  img:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  bulb:'<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
  chart:'<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="5" rx="1"/><rect x="12" y="8" width="3" height="9" rx="1"/><rect x="17" y="5" width="3" height="12" rx="1"/>',
  trend:'<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  down:'<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
  fire:'<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.3.6 1.5 1.8 2.8 3.5 2.8z"/>',
  hour:'<path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/>',
  pause:'<circle cx="12" cy="12" r="10"/><path d="M10 15V9M14 15V9"/>',
  building:'<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
  target:'<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  inbox:'<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
  heart:'<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
  skull:'<circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M8 20v2h8v-2M12.5 17l-.5-1-.5 1zM16 20a2 2 0 0 0 1.6-3.2A9 9 0 1 0 6.4 16.8 2 2 0 0 0 8 20"/>',
  filter:'<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
  layers:'<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  cols:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/>',
  side:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  tool:'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
  ext:'<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'
};
export const ic = (n, cls='') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n]||''}</svg>`;

export const $ = (s, r=document) => r.querySelector(s);
export const $$ = (s, r=document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const todayIso = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset()*6e4).toISOString().slice(0,10); };
export const norm = s => String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
export const plural = (n, s, p) => `${n} ${n===1 ? s : (p || s + 's')}`;
export const nf = n => Number(n).toLocaleString('pt-BR');
export const timeHM = t => new Date(t).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
export function relTime(t){
  const s = (Date.now() - new Date(t)) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s/60)} min`;
  if (s < 86400) return `há ${Math.floor(s/3600)} h`;
  if (s < 172800) return 'ontem';
  return new Date(t).toLocaleDateString('pt-BR');
}
export const errMsg = e => {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sem conexão com o servidor. Verifique a internet.';
  if (/JWT expired/i.test(m)) return 'Sua sessão expirou. Entre novamente.';
  return m;
};

export function toast(msg, type='ok'){
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'err' ? ' err' : '');
  t.innerHTML = ic(type === 'err' ? 'alert' : type === 'info' ? 'info' : 'check') + `<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .25s'; t.style.opacity = 0; setTimeout(() => t.remove(), 260); }, type === 'err' ? 5000 : 2600);
}
export function copy(txt, label='Copiado'){
  const fb = () => { const t = document.createElement('textarea'); t.value = txt; t.style.position='fixed'; t.style.opacity='0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); toast(label); } catch(e){ toast('Não foi possível copiar', 'err'); } t.remove(); };
  try { navigator.clipboard.writeText(txt).then(() => toast(label), fb); } catch(e){ fb(); }
}
export async function busy(btn, fn){
  if (btn) btn.classList.add('busy');
  try { return await fn(); } finally { if (btn && btn.isConnected) btn.classList.remove('busy'); }
}
export function download(blob, name){
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- camadas: modal, confirmação, progresso ---------- */
export function modal({title, sub='', icon='', tone='acc', body='', foot='', wide=false}){
  closeModal();
  const tones = {acc:['var(--accent)','var(--accent-soft)'], bad:['var(--bad)','var(--bad-soft)'], warn:['var(--warn)','var(--warn-soft)']};
  const [fg, bg] = tones[tone] || tones.acc;
  $('#layer').insertAdjacentHTML('beforeend', `<div class="scrim" id="mscrim" style="z-index:69"></div><div class="modal-wrap" id="mdl">
    <div class="modal ${wide?'wide':''}" role="dialog" aria-modal="true">
      <div class="modal-h">${icon ? `<span class="m-ico" style="color:${fg};background:${bg}">${ic(icon)}</span>` : ''}<div style="min-width:0;flex:1"><h3>${title}</h3>${sub ? `<p class="trunc">${esc(sub)}</p>` : ''}</div><button class="ibtn" data-close>${ic('x')}</button></div>
      <div class="modal-b">${body}</div>${foot ? `<div class="modal-f">${foot}</div>` : ''}</div></div>`);
  const m = $('#mdl');
  m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) closeModal(); });
  return m;
}
export function closeModal(){ ['#mdl','#mscrim'].forEach(s => { const e = $(s); if (e) e.remove(); }); }
export function confirmBox({title, text, ok='Confirmar', no='Cancelar', tone='acc', icon='info'}){
  return new Promise(res => {
    const m = modal({title, icon, tone, body:`<div style="color:var(--text-2)">${text}</div>`,
      foot:`<button class="btn" id="cbno">${no}</button><button class="btn ${tone==='bad'?'danger':'primary'}" id="cbok">${ok}</button>`});
    $('#cbno', m).onclick = () => { closeModal(); res(null); };
    $('#cbok', m).onclick = e => res(e.currentTarget);
    $('.modal-h [data-close]', m).addEventListener('click', () => res(null));
    $('#cbok', m).focus();
  });
}
/* Confirmação simples (substitui confirm() nativo): resolve true/false e fecha sozinha. */
export async function ask(title, text, ok='Confirmar', tone='acc'){
  const b = await confirmBox({title, text, ok, tone, icon: tone === 'bad' ? 'alert' : 'info'});
  closeModal();
  return !!b;
}
export function alertBox(title, text, tone='warn'){
  return confirmBox({title, text, ok:'Entendi', tone, icon:'alert'}).then(() => closeModal());
}
export function progress(show, title='', sub='', pct=0){
  let p = $('#progress');
  if (!show){ if (p) p.remove(); return; }
  if (!p){ $('#layer').insertAdjacentHTML('beforeend', '<div class="progress" id="progress"><div class="box"><h3></h3><p></p><div class="track"><i></i></div></div></div>'); p = $('#progress'); }
  $('h3', p).textContent = title; $('p', p).textContent = sub; $('i', p).style.width = pct + '%';
}

export function pageHead(title, sub, actions=''){
  return `<div class="page-head"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}
export function emptyBox(icon, title, text=''){ return `<div class="empty">${ic(icon)}<b>${title}</b>${text}</div>`; }

/* Paginação numerada; onGo recebe a página (1-based). Retorna HTML com data-pg para delegação. */
export function pagerNums(total, page, size){
  const pages = Math.ceil(total / size);
  const start = total ? (page-1)*size + 1 : 0, end = Math.min(page*size, total);
  let h = `<button class="btn sm" data-pg="${page-1}" ${page <= 1 ? 'disabled' : ''}>‹</button>`;
  for (let i = 1; i <= pages; i++){
    if (pages > 7 && i > 2 && i < pages - 1 && Math.abs(i - page) > 1){ if (i === 3 || i === pages - 2) h += '<button class="btn sm" disabled>…</button>'; continue; }
    h += `<button class="btn sm ${i === page ? 'on' : ''}" data-pg="${i}">${i}</button>`;
  }
  h += `<button class="btn sm" data-pg="${page+1}" ${page >= pages ? 'disabled' : ''}>›</button>`;
  return `<div class="pager"><span>${nf(start)}–${nf(end)} de ${nf(total)}</span>${pages > 1 ? `<div class="pg-n">${h}</div>` : ''}</div>`;
}

/* Liga uma zona de upload (clique + arrastar/soltar) a um <input type=file>. */
export function dropzone(zone, input, onFiles){
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files); });
  input.addEventListener('change', e => { if (e.target.files.length) onFiles(e.target.files); e.target.value = ''; });
}
