// ═══════════════════════════════════════
//  BARRA INFERIOR (telemóvel) — 4 atalhos dinâmicos + "Mais"
//  Os atalhos são os últimos módulos usados por cada utilizador (guardado por utilizador
//  neste dispositivo). Um módulo novo entra no lugar do atalho menos recente; os restantes
//  não mudam de posição. Os módulos que ficam de fora aparecem no painel "Mais".
// ═══════════════════════════════════════
import { S } from '../state.js';
import { canAccessSection } from './permissions.js';

const SVG = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const CAT = {
  historico:    { label:'Folha Ponto',  icon:SVG('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>') },
  compras:      { label:'Compras',      icon:SVG('<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>') },
  combustivel:  { label:'Combustível',  icon:SVG('<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>') },
  producao:     { label:'Produção',     icon:SVG('<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>') },
  equipamentos: { label:'Equipamentos', icon:SVG('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>') },
  'mapa-ferias':{ label:'Férias',       icon:SVG('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>') },
  utilizadores: { label:'Utilizadores', icon:SVG('<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>') },
};
const PADRAO = ['historico','compras','combustivel','producao'];
const N = 4;

const chave = () => 'plandese-bnav:' + (S.currentUser?.key || S.currentUser?.username || 'anon');
function ler(){
  try{ const o = JSON.parse(localStorage.getItem(chave())); if(o && Array.isArray(o.slots)) return { slots:o.slots, used:o.used||{} }; }catch(e){}
  return { slots:[...PADRAO], used:{} };
}
function gravar(st){ try{ localStorage.setItem(chave(), JSON.stringify(st)); }catch(e){} }

// Atalhos a mostrar: os guardados a que o perfil tem acesso, completados com os mais usados / por omissão
function visiveis(st){
  const ok = id => CAT[id] && canAccessSection(id);
  const s = st.slots.filter((id,i,a) => ok(id) && a.indexOf(id)===i);
  const extra = [...Object.keys(st.used).sort((a,b)=>st.used[b]-st.used[a]), ...PADRAO, ...Object.keys(CAT)].filter(id => ok(id) && !s.includes(id));
  while(s.length<N && extra.length) s.push(extra.shift());
  return s.slice(0,N);
}

export function bnavRegistar(id){
  if(!CAT[id] || !canAccessSection(id)) return;
  const st = ler();
  st.used[id] = Date.now();
  const vis = visiveis(st);
  if(!vis.includes(id)){
    if(vis.length<N) vis.push(id);
    else { let k = 0; vis.forEach((x,i)=>{ if((st.used[x]||0) < (st.used[vis[k]]||0)) k = i; }); vis[k] = id; }
  }
  st.slots = vis;
  gravar(st);
}

export function bnavRender(){
  const nav = document.getElementById('bottom-nav'), mais = document.getElementById('bnav-mais');
  if(!nav || !mais) return;
  const st = ler(), vis = visiveis(st);
  const atual = (document.querySelector('.section.active')?.id || '').replace(/^sec-/,'');
  nav.querySelectorAll('.bnav-btn:not(#bnav-mais)').forEach(b=>b.remove());
  vis.forEach(id => mais.insertAdjacentHTML('beforebegin',
    `<button class="bnav-btn${id===atual?' active':''}" onclick="goTo('${id}',this)" data-bnav="${id}" type="button">${CAT[id].icon}${CAT[id].label}</button>`));
  // "Mais" fica realçado quando se está num módulo que não tem atalho (excepto a página principal)
  mais.classList.toggle('active', !!atual && !vis.includes(atual) && atual!=='analise' && atual!=='painel');

  // Painel "Mais": módulos sem atalho
  const painel = document.getElementById('settings-panel');
  if(!painel) return;
  let box = document.getElementById('mais-mods');
  if(!box){
    box = document.createElement('div'); box.id = 'mais-mods'; box.className = 'mais-mods';
    const sep = painel.querySelector('.settings-sep'); if(sep) sep.after(box); else painel.prepend(box);
  }
  const resto = Object.keys(CAT).filter(id => !vis.includes(id) && canAccessSection(id));
  box.innerHTML = resto.length
    ? resto.map(id => `<button class="settings-item" onclick="goTo('${id}');toggleSettingsPanel()" type="button">${CAT[id].icon}${CAT[id].label}</button>`).join('') + '<div class="settings-sep"></div>'
    : '';
}

// Logo Plandese → página principal (telemóvel: Análise; computador: Painel)
export function irParaInicio(){
  window.goTo?.(document.body.classList.contains('device-mobile') ? 'analise' : 'painel');
}
