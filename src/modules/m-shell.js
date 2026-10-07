// ═══════════════════════════════════════
//  M-SHELL — estrutura da app em telemóvel (administração), inspirada na app da CP
//    · cabeçalho com menu / logo / sino e título do ecrã
//    · 4 separadores: Pesquisar · Módulos · Favoritos · myPlandese
//    · menu lateral, ecrã de notificações (X + ?) e favoritos por utilizador
//  Só atua em body.device-mobile (a app dos encarregados não passa por aqui).
// ═══════════════════════════════════════
import { S } from '../state.js';
import { NAV_CHAPTERS, ROLE_LABELS } from '../config.js';
import { fmt } from '../utils/helpers.js';
import { canAccessSection } from './permissions.js';
import { showToast } from './navigation.js';
import { setDeviceMode } from './auth.js';
import { I, emptyHtml } from './m-art.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ativo = () => document.body.classList.contains('device-mobile') && !document.body.classList.contains('enc-mode');
const toast = m => showToast(m);

// ── Catálogo de módulos: lido da sidebar (fonte única de verdade) ─────────────
let CAT = null;
function catalogo() {
  if (CAT) return CAT;
  const c = {};
  document.querySelectorAll('.sidebar .nav-btn').forEach(b => {
    const m = (b.getAttribute('onclick') || '').match(/goTo\('([^']+)'/);
    if (!m || m[1] === 'painel') return;
    const id = m[1], ch = NAV_CHAPTERS.find(x => x.sections.includes(id));
    c[id] = {
      id, ch: ch ? ch.id : null,
      label: (b.querySelector('.nav-label')?.textContent || id).trim(),
      icon: b.querySelector('svg')?.outerHTML || I.grid,
    };
  });
  // ecrãs que não são módulos da sidebar mas precisam de título/ícone
  [['analise', 'Análise de dados', I.chart], ['chat', 'Chat da equipa', I.chat], ['calendario', 'Calendário', I.calendar],
   ['notificacoes', 'Notificações', I.bell], ['m-defs', 'Definições', I.gear], ['painel', 'Painel Principal', I.grid]]
    .forEach(([id, label, icon]) => { if (!c[id]) c[id] = { id, ch: null, label, icon }; });
  return (CAT = c);
}

function modulosPorCapitulo() {
  const cat = catalogo();
  return NAV_CHAPTERS
    .map(ch => ({ ch, itens: ch.sections.map(id => cat[id]).filter(m => m && canAccessSection(m.id)) }))
    .filter(g => g.itens.length);
}

// ── Obras ─────────────────────────────────────────────────────────────────────
// O099 (centro de custos) não é uma empreitada
const obrasAtivas = () => (S.OBRAS || []).filter(o => o.ativa !== false && !/^O099/.test(o.nome || ''));
const splitObra = nome => { const m = String(nome || '').match(/^(O\d+)\s*[-–]\s*(.+)$/); return m ? { cod: m[1], nome: m[2] } : { cod: '', nome: nome || '' }; };

// ── Preferências por utilizador (favoritos + atividade recente) ───────────────
const FAVS_INICIAIS = ['historico', 'compras', 'combustivel', 'producao'];
let _p = null, _pk = '';
const chave = () => 'plandese-m:' + (S.currentUser?.key || 'anon');
function prefs() {
  const k = chave();
  if (_p && _pk === k) return _p;
  let o = null;
  try { o = JSON.parse(localStorage.getItem(k)); } catch (e) { /* sem acesso ao armazenamento */ }
  if (!o || typeof o !== 'object') o = { favs: { mods: [...FAVS_INICIAIS], obras: [] }, used: {} };
  o.favs = o.favs && typeof o.favs === 'object' ? o.favs : {};
  o.favs.mods = Array.isArray(o.favs.mods) ? o.favs.mods : [];
  o.favs.obras = Array.isArray(o.favs.obras) ? o.favs.obras : [];
  o.used = o.used && typeof o.used === 'object' ? o.used : {};
  _p = o; _pk = k;
  return o;
}
function gravar() { try { localStorage.setItem(_pk || chave(), JSON.stringify(_p)); } catch (e) { /* ignora */ } }
const isFav = (k, id) => prefs().favs[k].includes(id);
const favMods = () => prefs().favs.mods.filter(id => catalogo()[id]?.ch && canAccessSection(id));
const favObras = () => prefs().favs.obras.filter(id => obrasAtivas().some(o => o.id === id));

function registarUso(id) {
  const m = catalogo()[id];
  if (!m || !m.ch) return;
  const u = prefs().used, a = u[id] || { n: 0 };
  u[id] = { ts: Date.now(), n: (a.n || 0) + 1 };
  gravar();
}

// ── Estado de navegação ───────────────────────────────────────────────────────
const RAIZ = { analise: 'pesquisar', 'm-modulos': 'modulos', 'm-favoritos': 'favoritos', 'm-conta': 'conta' };
const TAB_ALVO = { pesquisar: 'analise', modulos: 'm-modulos', favoritos: 'm-favoritos', conta: 'm-conta' };
const SEG = { mod: 'mods', fav: 'mods' };
let _tab = 'pesquisar', _atual = 'analise', _hist = [], _voltando = false, _cfg = null, _pickKind = null;

const primeiroNome = () => String(S.currentUser?.nome || '').trim();
const iniciais = () => (S.currentUser?.initials || String(S.currentUser?.nome || '?').split(' ').map(w => w[0]).join('').slice(0, 2)).toUpperCase();

function ecraDe(id) {
  if (id === 'analise') return 'home';
  if (id === 'm-modulos') return 'modulos';
  if (id === 'm-favoritos') return 'favoritos';
  if (id === 'm-conta') return 'conta';
  if (id === 'notificacoes') return 'notif';
  if (id === 'chat') return 'chat';
  return 'child';
}

function cfgHeader(id) {
  const cat = catalogo();
  switch (id) {
    case 'analise':      return { variant: 'plain', left: 'menu', right: 'bell' };
    case 'm-modulos':    return { variant: 'color', left: 'menu', right: 'bell', title: 'Módulos', icon: I.grid };
    case 'm-favoritos':  return { variant: 'color', left: 'menu', right: 'bell', title: 'Favoritos', icon: I.star };
    case 'm-conta':      return { variant: 'color', left: 'menu', right: 'bell', title: 'Bem-vindo(a), ' + primeiroNome(), icon: '' };
    case 'notificacoes': return { variant: 'color', left: 'close', right: 'help', title: 'Notificações', icon: I.bell };
    default: {
      const m = cat[id];
      return { variant: 'color', left: 'back', right: 'bell', title: m ? m.label : '', icon: m ? m.icon : '' };
    }
  }
}

function aplicarHeader(cfg) {
  _cfg = cfg;
  const h = $('m-hdr'); if (!h) return;
  h.classList.toggle('is-plain', cfg.variant === 'plain');
  const hl = $('m-hl');
  hl.innerHTML = cfg.left === 'menu' ? I.menu : cfg.left === 'back' ? I.back : I.close;
  hl.setAttribute('aria-label', cfg.left === 'menu' ? 'Menu' : cfg.left === 'back' ? 'Voltar' : 'Fechar');
  const hr = $('m-hr');
  if (cfg.right === 'help') {
    hr.innerHTML = I.help; hr.setAttribute('aria-label', 'Ajuda');
  } else {
    hr.innerHTML = I.bell + '<span class="m-badge" id="m-bell-badge" hidden></span>'; hr.setAttribute('aria-label', 'Notificações');
    mSyncBell();
  }
  $('m-hdr-title').innerHTML = cfg.title ? `${cfg.icon || ''}<span>${esc(cfg.title)}</span>` : '';
  document.body.dataset.mVariant = cfg.variant;
  mSyncChat();
  const tc = document.querySelector('meta[name="theme-color"]');
  if (tc) tc.setAttribute('content', cfg.variant === 'plain' ? '#ffffff' : '#173f9f');
}

// Sino: mesmo contador do painel de notificações do computador
export function mSyncBell() {
  const b = $('m-bell-badge'); if (!b) return;
  const n = (S.NOTIFICACOES || []).filter(x => !x.lida).length;
  b.textContent = n > 9 ? '9+' : n;
  b.hidden = !n;
  document.querySelectorAll('.js-ntf-count').forEach(e => { e.textContent = n > 99 ? '99+' : n; e.hidden = !n; });
}
export function mSyncChat() {
  const nb = $('nb-chat');
  $('m-hl')?.classList.toggle('dot', !!nb && !nb.hidden);
  document.querySelectorAll('.js-chat-count').forEach(e => { e.textContent = nb ? nb.textContent : ''; e.hidden = !nb || nb.hidden; });
}

// ── Ligação ao goTo ───────────────────────────────────────────────────────────
export function mOnGoTo(id) {
  if (!ativo()) return;
  const veio = _atual;
  if (RAIZ[id]) { _hist = []; _tab = RAIZ[id]; }
  else if (!_voltando && veio && veio !== id) { _hist.push(veio); if (_hist.length > 12) _hist.shift(); }
  const voltou = _voltando;
  _voltando = false;
  _atual = id;
  if (!voltou) registarUso(id);

  aplicarHeader(cfgHeader(id));
  document.body.dataset.mScreen = ecraDe(id);
  document.querySelectorAll('#bottom-nav .bnav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === _tab));
  if (id === 'notificacoes') mNtfSeg('hist');
  if (id === 'm-modulos') renderModulos();
  else if (id === 'm-favoritos') renderFavoritos();
  else if (id === 'm-conta') renderConta();
  else if (id === 'm-defs') renderDefs();
  else if (id === 'analise') renderHome();
  document.querySelector('#admin-app .admin-main')?.scrollTo(0, 0);
}

export function mTab(t) {
  const alvo = TAB_ALVO[t];
  if (alvo) window.goTo(alvo);
}

export function mBack() {
  const alvo = _hist.pop() || TAB_ALVO[_tab] || 'analise';
  _voltando = true;
  try { window.goTo(alvo); } finally { _voltando = false; }
}
export function mLeft() { if (!_cfg || _cfg.left === 'menu') mDrawer(true); else mBack(); }
export function mRight() { if (_cfg && _cfg.right === 'help') mAjuda(); else mAbrirNotificacoes(); }
export function mAbrirNotificacoes() { window.goTo('notificacoes'); }
export function irParaInicio() {
  mDrawer(false);
  window.goTo(ativo() ? 'analise' : 'painel');
}
export function mAbrir(id) { window.goTo(id); }
export function mAbrirObra(id) { window.goTo('producao'); if (_atual === 'producao') window.coAbrir?.(id); }
export function mAbrirPessoa(n) {
  const d = new Date(); d.setHours(12, 0, 0, 0);
  window.abrirResumoPonto?.(n, fmt(d));
}

// ── Controlo segmentado ───────────────────────────────────────────────────────
const segHtml = (nome, cur, ops) =>
  `<div class="m-seg">${ops.map(([v, l]) => `<button type="button" class="${v === cur ? 'on' : ''}" onclick="mSeg('${nome}','${v}')">${l}</button>`).join('')}</div>`;
const OPS = [['mods', 'Módulos'], ['obras', 'Obras']];

export function mSeg(nome, v) {
  SEG[nome] = v;
  if (nome === 'mod') renderModulos(); else renderFavoritos();
}

// ── Linhas ────────────────────────────────────────────────────────────────────
const starBtn = (k, id) => `<button type="button" class="m-star${isFav(k, id) ? ' on' : ''}" onclick="event.stopPropagation();mFavToggle('${k}','${id}')" aria-label="${isFav(k, id) ? 'Remover dos favoritos' : 'Guardar nos favoritos'}">${isFav(k, id) ? I.starFill : I.star}</button>`;
const rowMod = (m, star = true) =>
  `<div class="m-row" onclick="mAbrir('${m.id}')"><span class="m-row-ic">${m.icon}</span><span class="m-row-tx"><b>${esc(m.label)}</b></span>${star ? starBtn('mods', m.id) : ''}<span class="m-row-chev">${I.chev}</span></div>`;
const rowObra = (o, star = true) => {
  const s = splitObra(o.nome);
  return `<div class="m-row" onclick="mAbrirObra('${o.id}')"><span class="m-row-ic">${I.building}</span><span class="m-row-tx"><b>${esc(s.nome)}</b><small>${esc(s.cod)}${o.local ? (s.cod ? ' · ' : '') + esc(o.local) : ''}</small></span>${star ? starBtn('obras', o.id) : ''}<span class="m-row-chev">${I.chev}</span></div>`;
};
const rowAcao = (ic, label, onclick, extra = '', cls = '') =>
  `<div class="m-row ${cls}" onclick="${onclick}"><span class="m-row-ic ${cls === 'red' ? 'red' : ''}">${ic}</span><span class="m-row-tx"><b>${esc(label)}</b></span>${extra}<span class="m-row-chev">${I.chev}</span></div>`;

// ── Módulos ───────────────────────────────────────────────────────────────────
function renderModulos() {
  const box = $('m-mods'); if (!box) return;
  let h = segHtml('mod', SEG.mod, OPS);
  if (SEG.mod === 'mods') {
    const gs = modulosPorCapitulo();
    h += gs.length
      ? gs.map(g => `<div class="m-grp">${esc(g.ch.label)}</div>${g.itens.map(m => rowMod(m)).join('')}`).join('')
      : emptyHtml('Sem módulos disponíveis', 'O seu perfil ainda não tem acesso a nenhum módulo.');
  } else {
    const os = obrasAtivas();
    h += os.length ? os.map(o => rowObra(o)).join('') : emptyHtml('Sem obras ativas', 'As obras ativas aparecem aqui.');
  }
  box.innerHTML = h;
}

// ── Favoritos ─────────────────────────────────────────────────────────────────
function renderFavoritos() {
  const box = $('m-favs'); if (!box) return;
  let h = segHtml('fav', SEG.fav, OPS);
  if (SEG.fav === 'mods') {
    const l = favMods();
    h += l.length ? l.map(id => rowMod(catalogo()[id])).join('')
      : emptyHtml('Nenhum módulo guardado', 'Guarde os módulos que mais utiliza para que consiga aceder aos mesmos mais rápido.');
  } else {
    const os = obrasAtivas().filter(o => isFav('obras', o.id));
    h += os.length ? os.map(o => rowObra(o)).join('')
      : emptyHtml('Nenhuma obra guardada', 'Guarde as suas obras preferidas para que consiga aceder às mesmas mais rápido.');
  }
  box.innerHTML = h;
}

export function mFavToggle(k, id) {
  const f = prefs().favs[k], i = f.indexOf(id);
  if (i >= 0) f.splice(i, 1); else f.push(id);
  gravar();
  toast(i >= 0 ? 'Removido dos favoritos' : 'Guardado nos favoritos ★');
  refrescar();
}
function refrescar() {
  if (_atual === 'm-modulos') renderModulos();
  if (_atual === 'm-favoritos') renderFavoritos();
  if (_atual === 'm-conta') renderConta();
  if (_atual === 'analise') { renderHome(); mPesquisa($('m-q')?.value); }
  if (_pickKind) renderPicker();
}

// ── Folha inferior (adicionar favoritos / ajuda) ──────────────────────────────
function abrirSheet(titulo, sub, corpo, botao) {
  $('m-sheet-h').textContent = titulo;
  const s = $('m-sheet-s'); s.textContent = sub || ''; s.hidden = !sub;
  $('m-sheet-b').innerHTML = corpo;
  $('m-sheet-ok').textContent = botao || 'Concluir';
  $('m-sheet').classList.add('open'); $('m-sheet-bg').classList.add('open');
}
export function mSheetClose() {
  _pickKind = null;
  $('m-sheet')?.classList.remove('open'); $('m-sheet-bg')?.classList.remove('open');
}
export function mFavAdd() {
  _pickKind = SEG.fav;
  abrirSheet(_pickKind === 'mods' ? 'Adicionar módulos' : 'Adicionar obras', 'Toque na estrela para guardar nos favoritos.', '', 'Concluir');
  renderPicker();
}
function renderPicker() {
  const b = $('m-sheet-b'); if (!b || !_pickKind) return;
  const top = b.scrollTop;
  let h = '';
  if (_pickKind === 'mods') {
    h = modulosPorCapitulo().map(g => `<div class="m-grp">${esc(g.ch.label)}</div>${g.itens.map(m =>
      `<div class="m-row" onclick="mFavToggle('mods','${m.id}')"><span class="m-row-ic">${m.icon}</span><span class="m-row-tx"><b>${esc(m.label)}</b></span>${starBtn('mods', m.id)}</div>`).join('')}`).join('');
  } else {
    h = obrasAtivas().map(o => {
      const s = splitObra(o.nome);
      return `<div class="m-row" onclick="mFavToggle('obras','${o.id}')"><span class="m-row-ic">${I.building}</span><span class="m-row-tx"><b>${esc(s.nome)}</b><small>${esc(s.cod)}${o.local ? (s.cod ? ' · ' : '') + esc(o.local) : ''}</small></span>${starBtn('obras', o.id)}</div>`;
    }).join('') || '<div class="m-res-empty">Sem obras ativas</div>';
  }
  b.innerHTML = h; b.scrollTop = top;
}
export function mAjuda() {
  abrirSheet('Notificações', '',
    '<p style="font-size:15.5px;line-height:1.55;color:#454d5e;padding:6px 0 4px">Recebe aqui os avisos do que a equipa regista nas secções que subscreveu (ponto, compras, combustível, produção…).</p>' +
    '<p style="font-size:15.5px;line-height:1.55;color:#454d5e;padding:6px 0">Em <b>Preferências</b> escolha as secções de que quer ser avisado e ative as notificações no telemóvel.</p>', 'Percebi');
}

// ── Pesquisar (página inicial) ────────────────────────────────────────────────
function renderHome() {
  const cat = catalogo(), used = prefs().used;
  let ids = Object.keys(used).filter(id => cat[id]?.ch && canAccessSection(id)).sort((a, b) => used[b].ts - used[a].ts).slice(0, 5);
  if (!ids.length) ids = favMods().slice(0, 4);
  const box = $('m-recents'), lbl = $('m-recents-l');
  if (box) box.innerHTML = ids.map(id => `<button type="button" class="m-chip" onclick="mAbrir('${id}')">${cat[id].icon}<span>${esc(cat[id].label)}</span></button>`).join('');
  if (lbl) lbl.hidden = !ids.length;
  const p = $('m-pill'); if (p) p.hidden = !canAccessSection('producao');
}

export function mPesquisa(q) {
  q = norm((q || '').trim());
  const res = $('m-results'), corpo = $('m-home-body'), x = $('m-search-x');
  if (!res || !corpo) return;
  if (x) x.hidden = !q;
  document.body.dataset.mSearch = q ? '1' : '';
  const pn = document.querySelector('.m-home-panel'); if (pn) pn.classList.toggle('has-q', !!q);
  if (!q) { res.hidden = true; corpo.hidden = false; return; }
  const cat = catalogo();
  const mods = Object.values(cat).filter(m => m.ch && canAccessSection(m.id) && norm(m.label).includes(q));
  const obras = obrasAtivas().filter(o => norm(o.nome + ' ' + (o.local || '')).includes(q)).slice(0, 8);
  const pessoas = canAccessSection('historico')
    ? (S.COLABORADORES || []).filter(c => c.ativo && norm(c.nome + ' ' + (c.func || '')).includes(q)).slice(0, 8) : [];
  let h = '';
  if (mods.length) h += `<div class="m-grp">Módulos</div>${mods.map(m => rowMod(m, false)).join('')}`;
  if (obras.length) h += `<div class="m-grp">Obras</div>${obras.map(o => rowObra(o, false)).join('')}`;
  if (pessoas.length) h += `<div class="m-grp">Pessoas</div>${pessoas.map(c =>
    `<div class="m-row" onclick="mAbrirPessoa(${c.n})"><span class="m-av">${esc(c.nome.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase())}</span><span class="m-row-tx"><b>${esc(c.nome)}</b><small>${esc(c.func || '')}</small></span><span class="m-row-chev">${I.chev}</span></div>`).join('')}`;
  res.innerHTML = h || '<div class="m-res-empty">Sem resultados para a sua pesquisa.</div>';
  res.hidden = false; corpo.hidden = true;
}
export function mPesquisaLimpar() {
  const i = $('m-q'); if (i) { i.value = ''; i.focus(); }
  mPesquisa('');
}

// ── myPlandese (conta) ────────────────────────────────────────────────────────
function quando(ts) {
  const d = new Date(ts), hm = d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return 'Hoje, ' + hm;
  const o = new Date(); o.setDate(o.getDate() - 1);
  if (d.toDateString() === o.toDateString()) return 'Ontem, ' + hm;
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function renderConta() {
  const box = $('m-acc'); if (!box) return;
  const u = S.currentUser || {}, cat = catalogo(), used = prefs().used;
  const ult = Object.keys(used).filter(id => cat[id]?.ch && canAccessSection(id)).sort((a, b) => used[b].ts - used[a].ts)[0];
  const chLbl = id => NAV_CHAPTERS.find(c => c.id === cat[id].ch)?.label || '';
  const card = ult
    ? `<div class="m-card" onclick="mAbrir('${ult}')"><div class="m-card-main"><div class="m-card-t">${cat[ult].icon}<span>${esc(cat[ult].label)}</span></div>
        <div class="m-card-s">${esc(chLbl(ult))}</div>
        <div class="m-card-g"><small>Último acesso</small><small>Acessos</small><b>${esc(quando(used[ult].ts))}</b><b>${used[ult].n || 1}</b></div></div><span class="m-row-chev">${I.chev}</span></div>`
    : '<div class="m-card m-card-empty">Ainda sem atividade. Os módulos que abrir aparecem aqui.</div>';
  box.innerHTML = `
    <div class="m-acc-top"><div class="m-avatar">${esc(iniciais())}</div><div><div class="m-acc-name">${esc(u.nome || '')}</div><div class="m-acc-role">${esc(ROLE_LABELS[u.role] || u.role || '')}</div><button type="button" class="m-link" onclick="openProfileModal()">Editar perfil</button></div></div>
    <div class="m-acc-sec"><h3>Última atividade</h3><button type="button" class="m-link" onclick="mTab('modulos')">Ver todos</button></div>
    ${card}
    <div>
      ${rowAcao(I.bell, 'Notificações', 'mAbrirNotificacoes()', '<span class="m-row-n js-ntf-count" hidden></span>')}
      ${canAccessSection('chat') ? rowAcao(I.chat, 'Chat da equipa', "mAbrir('chat')", '<span class="m-row-n js-chat-count" hidden></span>') : ''}
      ${rowAcao(I.calendar, 'Calendário', "mAbrir('calendario')")}
      ${rowAcao(I.user, 'Definições da conta', "mAbrir('m-defs')")}
      ${rowAcao(I.logout, 'Terminar sessão', 'doLogout()', '', 'red')}
    </div>`;
  mSyncBell(); mSyncChat();
}

// ── Definições ────────────────────────────────────────────────────────────────
function renderDefs() {
  const box = $('m-defs-box'); if (!box) return;
  box.innerHTML = `
    ${rowAcao(I.user, 'Dados pessoais e password', 'openProfileModal()')}
    ${rowAcao(I.monitor, 'Modo de visualização', 'escolherModoDispositivo()')}
    ${rowAcao(I.bell, 'Notificações no telemóvel', 'requestPushPermission()')}
    ${rowAcao(I.sliders, 'Personalizar análise', 'abrirPersonalizarAnalise()')}
    ${rowAcao(I.refresh, 'Atualizar dados', 'refreshPortal()')}
    <p style="font-size:12.5px;color:#7c8496;margin:22px 2px 0;line-height:1.5">Plandese, SA · Portal da empresa</p>`;
}

// ── Menu lateral ──────────────────────────────────────────────────────────────
function renderDrawer() {
  const p = $('m-drawer-panel'); if (!p) return;
  const desk = !document.body.classList.contains('device-mobile');
  const item = (ic, label, js, extra = '', cls = '') => rowAcao(ic, label, `mDrawer(false);${js}`, extra, cls).replace(`<span class="m-row-chev">${I.chev}</span>`, '');
  p.innerHTML = `
    <button type="button" class="m-drawer-x" onclick="mDrawer(false)" aria-label="Fechar menu">${I.close}</button>
    <div class="m-drawer-top">
      <div class="m-modo"><button type="button" class="${desk ? '' : 'on'}" onclick="mModo('mobile')">Móvel</button><i></i><button type="button" class="${desk ? 'on' : ''}" onclick="mModo('desktop')">PC</button></div>
      <div class="m-avatar">${esc(iniciais())}</div>
    </div>
    <nav class="m-drawer-nav">
      ${canAccessSection('producao') ? item(I.nav, 'As minhas obras', "mAbrir('producao')") : ''}
      ${canAccessSection('chat') ? item(I.chat, 'Chat da equipa', "mAbrir('chat')", '<span class="m-row-n js-chat-count" hidden></span>') : ''}
      ${item(I.calendar, 'Calendário', "mAbrir('calendario')")}
      ${item(I.userCirc, 'Perfil', 'openProfileModal()')}
      ${item(I.gear, 'Definições', "mAbrir('m-defs')")}
      ${item(I.logout, 'Terminar sessão', 'doLogout()', '', 'red')}
    </nav>
    <div class="m-drawer-links">
      ${item(I.bell, 'Notificações', 'mAbrirNotificacoes()', '<span class="m-row-n js-ntf-count" hidden></span>')}
      ${canAccessSection('pendentes-tavira') ? item(I.help, 'Pendentes Tavira', "mAbrir('pendentes-tavira')") : ''}
      ${item(I.refresh, 'Atualizar dados', 'refreshPortal()')}
    </div>
    <div class="m-drawer-foot"><b>Plandese, SA</b>Portal da empresa</div>`;
  mSyncBell(); mSyncChat();
}
export function mDrawer(abrir) {
  const d = $('m-drawer'); if (!d) return;
  if (abrir) renderDrawer();
  d.classList.toggle('open', !!abrir);
  d.setAttribute('aria-hidden', abrir ? 'false' : 'true');
}
export function mModo(modo) {
  mDrawer(false);
  if (modo === 'desktop') { setDeviceMode('desktop'); window.goTo('painel'); }
}

// ── Notificações: Histórico | Preferências ────────────────────────────────────
export function mNtfSeg(v) {
  const s = $('sec-notificacoes'); if (s) s.dataset.seg = v;
  document.querySelectorAll('#m-ntf-seg button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
}

// Chamado no logout: volta ao estado inicial
export function mShellReset() {
  _tab = 'pesquisar'; _atual = 'analise'; _hist = []; _voltando = false; _p = null; _pk = '';
  SEG.mod = SEG.fav = 'mods';
  mDrawer(false); mSheetClose();
  const q = $('m-q'); if (q) q.value = '';
  delete document.body.dataset.mVariant; delete document.body.dataset.mScreen;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#103060');
}

// Ao rodar/redimensionar o ecrã o modo pode mudar: sai de ecrãs que só existem num dos modos
window.addEventListener('resize', () => setTimeout(() => {
  if (!document.body.classList.contains('app-ativa') || document.body.classList.contains('enc-mode')) return;
  const id = document.querySelector('.section.active')?.id.replace(/^sec-/, '') || '';
  if (!ativo() && (id.startsWith('m-') || id === 'analise')) window.goTo('painel');
  else if (ativo() && id === 'painel') window.goTo('analise');
}, 60));

Object.assign(window, {
  mTab, mBack, mLeft, mRight, mDrawer, mModo, mSeg, mAbrir, mAbrirObra, mAbrirPessoa, mAbrirNotificacoes,
  mFavToggle, mFavAdd, mSheetClose, mAjuda, mPesquisa, mPesquisaLimpar, mNtfSeg, irParaInicio,
  mSyncBell, mSyncChat,
});
