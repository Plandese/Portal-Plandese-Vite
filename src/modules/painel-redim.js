// ═══════════════════════════════════════
//  PAINÉIS QUE ABREM PELA DIREITA — largura ajustável
//  Regra única: arrastar a borda esquerda alarga/estreita; a largura fica
//  guardada por painel neste navegador; duplo clique repõe a largura original.
//  Para incluir um painel novo basta acrescentar o seletor a PAINEIS.
// ═══════════════════════════════════════
const PAINEIS = {
  '#ag-panel': 'agente',
  '.d-drawer': 'gaveta',
  '#sec-pendentes-tavira .pt-det': 'posvenda',
  '#notif-panel': 'notificacoes',
};
const MIN = 340;
const naoMovel = () => !document.body.classList.contains('device-mobile');
const maxW = () => Math.round(window.innerWidth * 0.92);

function ligar(el, nome){
  if(el.dataset.prResize) return;
  el.dataset.prResize = '1';
  const KEY = 'plandese_pw_' + nome;
  const aplicar = w => { if(naoMovel()) el.style.width = Math.max(MIN, Math.min(maxW(), w)) + 'px'; };
  try{ const g = parseInt(localStorage.getItem(KEY), 10); if(g) aplicar(g); }catch(e){}
  const h = document.createElement('div');
  h.className = 'pr-resize'; h.title = 'Arraste para ajustar a largura (duplo clique repõe)';
  el.prepend(h);
  h.addEventListener('pointerdown', ev => {
    ev.preventDefault(); h.setPointerCapture(ev.pointerId); document.body.classList.add('pr-resizing');
    const mover = e => aplicar(window.innerWidth - e.clientX);
    const fim = () => {
      h.removeEventListener('pointermove', mover); h.removeEventListener('pointerup', fim); h.removeEventListener('pointercancel', fim);
      document.body.classList.remove('pr-resizing');
      try{ if(el.style.width) localStorage.setItem(KEY, parseInt(el.style.width, 10)); }catch(e){}
    };
    h.addEventListener('pointermove', mover); h.addEventListener('pointerup', fim); h.addEventListener('pointercancel', fim);
  });
  h.addEventListener('dblclick', () => { el.style.width = ''; try{ localStorage.removeItem(KEY); }catch(e){} });
  window.addEventListener('resize', () => { if(el.style.width) aplicar(parseInt(el.style.width, 10)); });
}

function varrer(){
  Object.entries(PAINEIS).forEach(([sel, nome]) => document.querySelectorAll(sel).forEach(el => ligar(el, nome)));
}

export function initPainelRedim(){
  varrer();
  // painéis criados mais tarde (ex.: assistente IA)
  let t; new MutationObserver(() => { clearTimeout(t); t = setTimeout(varrer, 200); })
    .observe(document.body, {childList:true, subtree:true});
}
