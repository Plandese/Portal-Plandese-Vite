// ═══════════════════════════════════════
//  D-SHELL — estrutura do portal em computador (administração), na linguagem das apps
//    · cabeçalho azul com logo, pesquisa global (Ctrl K), chat, notificações e utilizador
//    · folha branca arredondada com o menu lateral (favoritos ★ + capítulos) e o conteúdo
//    · título de cada página com ícone
//  Só atua em body.device-desktop (a app dos encarregados e o modo telemóvel não passam por aqui).
//  Os favoritos são os mesmos da app de telemóvel (partilham as preferências do utilizador).
// ═══════════════════════════════════════
import { S, R } from '../state.js';
import { fmt } from '../utils/helpers.js';
import { canAccessSection } from './permissions.js';
import { mPrefs, mGravar } from './m-shell.js';
import { showToast } from './navigation.js';
import { setDeviceMode } from './auth.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ativo = () => document.body.classList.contains('device-desktop') && !document.body.classList.contains('enc-mode') && document.body.classList.contains('app-ativa');

const ICO = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.3-4.3"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.8l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.7l-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95z"/></svg>',
  starFill: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.8l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.7l-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95z"/></svg>',
  building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V8l7-4.5L19 8v13"/><path d="M9 21v-5h6v5M9 11h.01M15 11h.01M9 14h.01M15 14h.01"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
};

// ── Catálogo de módulos: lido da sidebar (fonte única de verdade) ───────────────
let CAT = null;
function catalogo() {
  if (CAT) return CAT;
  const c = {};
  document.querySelectorAll('.sidebar .nav-btn').forEach(b => {
    const m = (b.getAttribute('onclick') || '').match(/goTo\('([^']+)'/);
    if (!m || m[1] === 'painel') return;
    c[m[1]] = {
      id: m[1],
      label: (b.querySelector('.nav-label')?.textContent || m[1]).trim(),
      icon: b.querySelector('svg')?.outerHTML || '',
      grp: b.closest('.nav-group')?.dataset.grp || '',
    };
  });
  const painel = $('nav-painel');
  c.painel = { id: 'painel', label: 'Painel Principal', icon: painel?.querySelector('svg')?.outerHTML || '', grp: '' };
  return (CAT = c);
}
const grpLabel = key => (document.querySelector(`.sidebar .nav-lbl[data-grp="${key}"] .nav-lbl-txt`)?.textContent || '').trim();

const obrasAtivas = () => (S.OBRAS || []).filter(o => o.ativa !== false && !/^O099/.test(o.nome || ''));
const splitObra = nome => { const m = String(nome || '').match(/^(O\d+)\s*[-–]\s*(.+)$/); return m ? { cod: m[1], nome: m[2] } : { cod: '', nome: nome || '' }; };

// ── Favoritos + atividade (mesmas preferências da app de telemóvel) ───────────────
const favMods = () => mPrefs().favs.mods.filter(id => catalogo()[id] && id !== 'painel' && canAccessSection(id));
function toggleFav(id) {
  const f = mPrefs().favs.mods, i = f.indexOf(id);
  if (i >= 0) f.splice(i, 1); else f.push(id);
  mGravar();
  showToast(i >= 0 ? 'Removido dos favoritos' : 'Guardado nos favoritos ★');
  renderFavs();
}
function registarUso(id) {
  if (!catalogo()[id] || id === 'painel') return;
  const u = mPrefs().used, a = u[id] || { n: 0 };
  u[id] = { ts: Date.now(), n: (a.n || 0) + 1 };
  mGravar();
}

// ── Montagem do cabeçalho e do menu (uma só vez) ─────────────────────────────────
let montado = false;
function montar() {
  if (montado) return;
  const inner = document.querySelector('#admin-app .app-bar-inner');
  const side = document.querySelector('#admin-app .sidebar');
  if (!inner || !side) return;
  montado = true;

  // Círculos e pastilhas por trás do cabeçalho (como no mockup)
  const app = inner.closest('.app-bar');
  if (app && !app.querySelector('.d-deco')) app.insertAdjacentHTML('afterbegin', '<div class="d-deco" aria-hidden="true"><i></i><i></i></div>');

  // Nome da marca curto, como nas apps
  const nome = inner.querySelector('.app-bar-name'); if (nome) nome.textContent = 'Plandese';

  // Pesquisa global
  const title = inner.querySelector('.app-bar-title');
  const box = document.createElement('div');
  box.className = 'd-search'; box.id = 'd-search';
  box.innerHTML = `<div class="d-search-box">${ICO.search}<input id="d-q" class="d-ign" type="search" placeholder="Pesquisar módulos, obras, pessoas…" autocomplete="off" spellcheck="false" aria-label="Pesquisar"/><kbd>Ctrl K</kbd></div><div class="d-results" id="d-results" hidden></div>`;
  title ? title.after(box) : inner.appendChild(box);
  // Logótipo e nome → Painel Principal
  if (title) {
    title.setAttribute('role', 'link'); title.tabIndex = 0; title.title = 'Painel Principal';
    const ir = () => window.goTo?.('painel', document.getElementById('nav-painel'));
    title.addEventListener('click', ir);
    title.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ir(); } });
  }

  // Chat (atalho no cabeçalho)
  const right = inner.querySelector('.app-bar-right');
  if (right) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'd-chat-btn'; b.id = 'd-chat-btn'; b.title = 'Chat da equipa'; b.setAttribute('aria-label', 'Chat da equipa');
    b.innerHTML = ICO.chat + '<i class="d-dot" hidden></i>';
    b.onclick = () => window.goTo('chat');
    right.querySelector('.notif-wrap')?.after(b);
  }

  // Utilizador (dentro do botão das definições, que já abre o painel de definições)
  const sb = $('settings-btn');
  if (sb && !sb.querySelector('.d-user')) {
    sb.insertAdjacentHTML('beforeend', `<span class="d-user"><span class="d-user-av" id="d-user-av"></span><span class="d-user-tx"><b id="d-user-nm"></b><small id="d-user-role"></small></span><span class="d-user-chev">${ICO.chev}</span></span>`);
  }

  montarMenuUtilizador();

  // Menu lateral: bloco de favoritos + estrela em cada módulo
  const painel = $('nav-painel');
  const fav = document.createElement('div');
  fav.className = 'd-favs'; fav.id = 'd-favs';
  (painel || side.firstElementChild).after(fav);
  side.querySelectorAll('.nav-btn').forEach(b => {
    const m = (b.getAttribute('onclick') || '').match(/goTo\('([^']+)'/);
    if (!m || m[1] === 'painel' || b.querySelector('.d-star')) return;
    const s = document.createElement('span');
    s.className = 'd-star'; s.dataset.star = m[1]; s.setAttribute('role', 'button'); s.setAttribute('aria-label', 'Guardar nos favoritos');
    b.appendChild(s);
  });
  // a estrela não deve navegar: apanha o clique antes do onclick do botão
  side.addEventListener('click', e => {
    const s = e.target.closest('.d-star');
    if (!s) return;
    e.stopPropagation(); e.preventDefault();
    toggleFav(s.dataset.star);
  }, true);

  ligarPesquisa();

  // o ponto do chat muda sem navegação: acompanha o contador do painel de definições
  const nb = $('nb-chat');
  if (nb) new MutationObserver(syncChat).observe(nb, { attributes: true, attributeFilter: ['hidden'] });
}

// ── Menu do utilizador (painel das definições) como no mockup: Móvel | PC, ícones em traço e rótulos novos ──
const ICO_MENU = {
  perfil: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  tavira: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  calendario: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  notificacoes: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  atualizar: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/>',
  sair: '<circle cx="12" cy="12" r="10"/><path d="M7.5 12h9M13 8.2l3.8 3.8-3.8 3.8"/>',
};
function montarMenuUtilizador() {
  const panel = $('settings-panel');
  if (!panel || panel.querySelector('.d-modo')) return;
  // Móvel | PC
  const row = panel.querySelector('.settings-user-row');
  if (row) row.insertAdjacentHTML('afterend', '<div class="d-modo"><button type="button" onclick="dModo(\'mobile\')">Móvel</button><i></i><button type="button" class="on" aria-current="true">PC</button></div>');
  // ícones em traço e rótulos
  const troca = (sel, ico, txt) => {
    const b = panel.querySelector(sel); if (!b) return;
    const svg = b.querySelector('svg');
    if (svg) svg.outerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICO_MENU[ico]}</svg>`;
    if (txt) { const n = [...b.childNodes].find(c => c.nodeType === 3 && c.textContent.trim()); if (n) n.textContent = '\n      ' + txt + '\n      '; }
  };
  troca('.settings-item[onclick*="openProfileModal"]', 'perfil', 'Ajustes de perfil');
  troca('.settings-item[onclick*="pendentes-tavira"]', 'tavira');
  troca('.settings-item[onclick*="goTo(\'chat\'"]', 'chat');
  troca('.settings-item[onclick*="calendario"]', 'calendario');
  troca('.settings-item[onclick*="notificacoes"]', 'notificacoes');
  troca('.settings-item[onclick*="refreshPortal"]', 'atualizar', 'Atualizar dados');
  troca('.settings-item[onclick*="doLogout"]', 'sair', 'Terminar sessão');
}
// Móvel | PC no menu do utilizador (o PC é o modo atual; passar a Móvel leva ao início da app de telemóvel)
function dModo(modo) {
  document.getElementById('settings-panel')?.classList.remove('open');
  if (modo !== 'mobile') return;
  setDeviceMode('mobile');
  window.goTo('analise');
}
window.dModo = dModo;

function renderFavs() {
  const box = $('d-favs'); if (!box) return;
  const cat = catalogo(), ids = favMods();
  box.innerHTML = ids.length
    ? `<div class="d-favs-h"><span>${ICO.starFill}</span>Favoritos</div>` + ids.map(id => `<button type="button" class="nav-btn d-fav" data-fav="${id}" onclick="goTo('${id}')"><span class="d-fav-ic">${cat[id].icon}</span><span class="nav-label">${esc(cat[id].label)}</span><span class="d-star on" data-star="${id}" role="button" aria-label="Remover dos favoritos"></span></button>`).join('')
    : '';
  // estrelas dos módulos (ligadas/desligadas)
  renderAtalhos();
  const fs = new Set(ids);
  document.querySelectorAll('#admin-app .sidebar .d-star[data-star]').forEach(s => s.classList.toggle('on', fs.has(s.dataset.star)));
  marcarAtivo(document.querySelector('.section.active')?.id.replace(/^sec-/, '') || '');
}
function marcarAtivo(id) {
  document.querySelectorAll('#d-favs .d-fav').forEach(b => b.classList.toggle('active', b.dataset.fav === id));
}

// ── Painel Principal: atalhos para os módulos favoritos ──
function renderAtalhos() {
  const box = $('painel-atalhos'); if (!box) return;
  const cat = catalogo(), ids = favMods().slice(0, 6);
  if (!ids.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="pa-h"><span class="pa-ic">${ICO.starFill}</span><div><b>Favoritos</b><small>Os seus módulos de acesso rápido</small></div></div>
    <div class="pa-grid">${ids.map(id => `<button type="button" class="pa-b" onclick="goTo('${id}')">${cat[id].icon}<span>${esc(cat[id].label)}</span></button>`).join('')}</div>`;
}

// ── Utilizador ──────────────────────────────────────────────────────────────────────
function syncUser() {
  const set = (a, b) => { const x = $(a); if (x) x.textContent = b; };
  set('d-user-av', $('u-av')?.textContent || '');
  set('d-user-nm', $('u-nm')?.textContent || '');
  set('d-user-role', $('u-role')?.textContent || '');
}
function syncChat() {
  const nb = $('nb-chat'), d = document.querySelector('#d-chat-btn .d-dot'), b = $('d-chat-btn');
  if (d) d.hidden = !nb || nb.hidden;
  if (b) b.style.display = canAccessSection('chat') ? '' : 'none';   // o perfil pode mudar sem recarregar a página
}

// ── Pesquisa global ─────────────────────────────────────────────────────────────────
function renderRes() {
  const res = $('d-results'), qv = norm($('d-q').value.trim());
  if (!res) return;
  const cat = catalogo();
  const rowMod = m => `<button type="button" class="d-row" data-r="m:${m.id}"><span class="d-row-ic">${m.icon}</span><span class="d-row-tx"><b>${esc(m.label)}</b><small>${esc(grpLabel(m.grp) || 'Início')}</small></span></button>`;
  const rowObra = o => { const s = splitObra(o.nome); return `<button type="button" class="d-row" data-r="o:${esc(o.id)}"><span class="d-row-ic">${ICO.building}</span><span class="d-row-tx"><b>${esc(s.nome)}</b><small>${esc(s.cod)}${o.local ? (s.cod ? ' · ' : '') + esc(o.local) : ''}</small></span></button>`; };
  if (!qv) {
    const used = mPrefs().used;
    let ids = Object.keys(used).filter(id => cat[id] && id !== 'painel' && canAccessSection(id)).sort((a, b) => used[b].ts - used[a].ts).slice(0, 5);
    if (!ids.length) ids = favMods().slice(0, 4);
    res.innerHTML = (ids.length ? `<div class="d-res-l">Recentes</div><div class="d-chips">${ids.map(id => `<button type="button" class="d-chip" data-r="m:${id}">${cat[id].icon}<span>${esc(cat[id].label)}</span></button>`).join('')}</div>` : '')
      + (obrasAtivas().length ? `<div class="d-res-l">Obras</div>${obrasAtivas().slice(0, 4).map(rowObra).join('')}` : '');
    return;
  }
  const mods = Object.values(cat).filter(m => canAccessSection(m.id) && norm(m.label + ' ' + grpLabel(m.grp)).includes(qv)).slice(0, 8);
  const obras = obrasAtivas().filter(o => norm(o.nome + ' ' + (o.local || '')).includes(qv)).slice(0, 6);
  const pessoas = canAccessSection('historico') ? (S.COLABORADORES || []).filter(c => c.ativo && norm(c.nome + ' ' + (c.func || '')).includes(qv)).slice(0, 6) : [];
  let h = '';
  if (mods.length) h += `<div class="d-res-l">Módulos</div>${mods.map(rowMod).join('')}`;
  if (obras.length) h += `<div class="d-res-l">Obras</div>${obras.map(rowObra).join('')}`;
  if (pessoas.length) h += `<div class="d-res-l">Pessoas</div>${pessoas.map(c => `<button type="button" class="d-row" data-r="p:${c.n}"><span class="d-row-ic d-av">${esc(c.nome.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase())}</span><span class="d-row-tx"><b>${esc(c.nome)}</b><small>${esc(c.func || '')}</small></span></button>`).join('')}`;
  res.innerHTML = h || '<div class="d-res-empty">Sem resultados para a sua pesquisa.</div>';
}
function abrirPesquisa() { const r = $('d-results'); if (!r) return; $('d-search').classList.add('focus'); r.hidden = false; renderRes(); }
function fecharPesquisa() { $('d-search')?.classList.remove('focus'); const r = $('d-results'); if (r) r.hidden = true; }
function escolher(r) {
  const t = r.slice(0, 1), v = r.slice(2);
  const q = $('d-q'); q.value = ''; q.blur(); fecharPesquisa();
  if (t === 'm') window.goTo(v);
  else if (t === 'o') {
    window.goTo('producao');
    Promise.resolve(R.renderControloObras?.(true)).then(() => window.coAbrir?.(v));
  } else if (t === 'p') {
    const d = new Date(); d.setHours(12, 0, 0, 0);
    window.abrirResumoPonto?.(+v, fmt(d));
  }
}
function ligarPesquisa() {
  const q = $('d-q'), res = $('d-results');
  q.addEventListener('focus', abrirPesquisa);
  q.addEventListener('input', renderRes);
  q.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const first = res.querySelector('[data-r]'); if (first) escolher(first.dataset.r); }
    else if (e.key === 'Escape') { q.blur(); fecharPesquisa(); }
  });
  res.addEventListener('mousedown', e => e.preventDefault());
  res.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) escolher(b.dataset.r); });
  document.addEventListener('mousedown', e => { if (ativo() && !e.target.closest('#d-search')) fecharPesquisa(); });
  document.addEventListener('keydown', e => {
    if (!ativo()) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); q.focus(); q.select(); }
  });
}

// ── Título da página com ícone ───────────────────────────────────────────────────────
function tituloComIcone(id) {
  const sec = $('sec-' + id); if (!sec) return;
  const t = sec.querySelector('.pg-hdr .pg-title'); if (!t) return;
  const box = t.parentElement;
  box.classList.add('d-ttl');
  if (box.querySelector('.d-ttl-ic')) return;
  const m = catalogo()[id]; if (!m || !m.icon) return;
  box.insertAdjacentHTML('afterbegin', `<span class="d-ttl-ic">${m.icon}</span>`);
}

// ── Ligação ao goTo ──────────────────────────────────────────────────────────────────
export function dOnGoTo(id) {
  if (!ativo()) return;
  montar();
  if (!montado) return;
  syncUser(); syncChat();
  registarUso(id);
  tituloComIcone(id);
  renderFavs();
  marcarAtivo(id);
  document.querySelector('#admin-app .admin-main')?.scrollTo(0, 0);
}
