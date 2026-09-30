// ═══════════════════════════════════════
//  CHAT INTERNO — canal geral + conversas privadas (sem encarregados) + quem está online
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S } from '../state.js';
import { sbInsertNotificacoes, sbMarkNotifRead } from '../db.js';
import { renderNotifPanel } from './notifications.js';
import { roleCanAccessSection } from './permissions.js';

const ROLE_LBL = { admin:'Administrador', diretor_obra:'Diretor de Obra', compras:'Compras', financeiro:'Financeiro' };
const PAGE = 300;

let _msgs = [];
let _msgCh = null, _presCh = null;
let _online = new Set();
let _started = false;
let _conv = null; // null = canal geral; senão username do interlocutor

const $ = id => document.getElementById(id);
const ESC = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const me = () => S.currentUser?.key;
const lastKey = () => 'plandese_chat_lido_' + me();
const aChatAberto = () => !!$('sec-chat')?.classList.contains('active') || !!$('chat-fab-panel')?.classList.contains('open');

function membros(){
  return Object.entries(S.USERS || {})
    .filter(([, u]) => u.role && u.role !== 'encarregado')
    .map(([key, u]) => ({ key, nome: u.nome || key, initials: u.initials || '?', role: u.role }));
}
const nomeDe = k => S.USERS?.[k]?.nome || k;
const iniciaisDe = k => S.USERS?.[k]?.initials || (nomeDe(k)[0] || '?').toUpperCase();

// ── Arranque (chamado no login do admin) ───────────────────────────
export async function initChat(){
  if(!me() || S.currentUser.role === 'encarregado') return;
  chatStop();
  _started = true;
  try {
    const { data, error } = await sb.from('chat_mensagens').select('*')
      .order('criado_em', { ascending: false }).limit(PAGE);
    if(error) throw error;
    _msgs = (data || []).reverse();
  } catch(e){ console.warn('chat load:', e); _msgs = []; }

  _msgCh = sb.channel('chat-msgs')
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'chat_mensagens' }, p => {
      if(_msgs.some(m => m.id === p.new.id)) return;
      _msgs.push(p.new);
      if(aChatAberto() && convDe(p.new) === (_conv || '')){ renderMsgs(true); marcarLido(); }
      else { badge(); renderPessoas(); }
    })
    .on('postgres_changes', { event:'DELETE', schema:'public', table:'chat_mensagens' }, p => {
      _msgs = _msgs.filter(m => m.id !== p.old.id);
      if(aChatAberto()) renderMsgs(false);
      badge();
    })
    .subscribe();

  // Presença: quem tem o portal aberto neste momento
  _presCh = sb.channel('chat-presenca', { config: { presence: { key: me() } } });
  _presCh.on('presence', { event:'sync' }, () => {
    _online = new Set(Object.keys(_presCh.presenceState()));
    renderPessoas();
    renderOnlineBar();
  }).subscribe(async st => {
    if(st === 'SUBSCRIBED') await _presCh.track({ at: new Date().toISOString() });
  });
  criarFab();
  badge();
  renderPessoas();
  if(aChatAberto()) renderChat();
}

export function chatStop(){
  if(_msgCh){ try{ sb.removeChannel(_msgCh); }catch(e){} _msgCh = null; }
  if(_presCh){ try{ sb.removeChannel(_presCh); }catch(e){} _presCh = null; }
  _msgs = []; _online = new Set(); _started = false;
  $('chat-fab')?.remove(); $('chat-fab-panel')?.remove();
  const b = $('nb-chat'); if(b) b.hidden = true;
  const g = $('chat-gear-dot'); if(g) g.hidden = true;
}

// ── Conversas e não lidas ──────────────────────────────────────────
// Chave de conversa: '' = geral; senão o username do outro participante
const convDe = m => m.para == null ? '' : (m.autor === me() ? m.para : m.autor);
const msgsConv = () => _msgs.filter(m => convDe(m) === (_conv || ''));

function lidoMap(){
  try{
    const raw = localStorage.getItem(lastKey());
    if(!raw) return {};
    if(raw[0] === '{') return JSON.parse(raw);
    return { '': raw }; // formato antigo: só o canal geral
  }catch(e){ return {}; }
}
function marcarLido(){
  const ult = msgsConv().slice(-1)[0];
  if(ult){
    const l = lidoMap(); l[_conv || ''] = ult.criado_em;
    try{ localStorage.setItem(lastKey(), JSON.stringify(l)); }catch(e){}
  }
  badge();
  renderPessoas();
  limparNotifs();
}
function naoLidas(){
  const l = lidoMap(), por = {};
  _msgs.forEach(m => {
    if(m.autor === me()) return;
    const k = convDe(m);
    if(m.criado_em > (l[k] || '')) por[k] = (por[k] || 0) + 1;
  });
  return por;
}
function badge(){
  const por = naoLidas();
  // a conversa aberta conta como lida
  if(aChatAberto()) delete por[_conv || ''];
  const n = Object.values(por).reduce((a, b) => a + b, 0);
  const b = $('nb-chat') || document.createElement('span');
  b.textContent = n > 99 ? '99+' : n;
  b.hidden = !n;
  const g = $('chat-gear-dot'); if(g) g.hidden = b.hidden;
  const f = $('chat-fab-badge');
  if(f){ f.textContent = n > 99 ? '99+' : n; f.hidden = !n; }
}

export function chatSetConv(k){
  _conv = k || null;
  $('chat-layout')?.classList.add('em-conv');
  $('chat-fab-panel')?.classList.add('em-conv');
  renderChat(true);
}

export function chatVoltar(){
  $('chat-layout')?.classList.remove('em-conv');
  $('chat-fab-panel')?.classList.remove('em-conv');
}

// ── Página ─────────────────────────────────────────────────────────
export function renderChat(foco){
  if(!_started){ initChat(); return; }
  renderOnlineBar();
  renderConvTitulo();
  renderMsgs(true);
  marcarLido();
  if(foco !== false) setTimeout(() => ($('cw-in') && $('chat-fab-panel').classList.contains('open') ? $('cw-in') : $('chat-in'))?.focus(), 50);
}

function renderConvTitulo(){
  const t = $('chat-conv-title');
  if(t) t.textContent = _conv ? nomeDe(_conv) : 'Geral — toda a equipa';
  const sb2 = $('chat-conv-sub');
  if(sb2) sb2.textContent = _conv ? (_online.has(_conv) ? 'online' : 'offline') : membros().length + ' participantes';
  const av = $('chat-conv-av');
  if(av) av.textContent = _conv ? iniciaisDe(_conv) : '#';
  const wt = $('cw-conv-title');
  if(wt) wt.textContent = _conv ? nomeDe(_conv) : 'Geral — toda a equipa';
}

function renderOnlineBar(){
  const n = membros().filter(m => _online.has(m.key)).length;
  const txt = n ? `${n} online agora` : 'Ninguém online';
  ['chat-online-sub','cw-online'].forEach(id => { const el = $(id); if(el) el.textContent = txt; });
}

function ultimaDe(k){
  for(let i = _msgs.length - 1; i >= 0; i--) if(convDe(_msgs[i]) === k) return _msgs[i];
  return null;
}
function fmtLista(iso){
  const d = new Date(iso), h = new Date();
  if(d.toDateString() === h.toDateString()) return fmtHora(iso);
  const ontem = new Date(); ontem.setDate(h.getDate() - 1);
  if(d.toDateString() === ontem.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-PT', { day:'2-digit', month:'2-digit' });
}

function renderPessoas(){
  renderConvTitulo();
  const alvos = ['chat-pessoas', 'cw-pessoas'].map($).filter(Boolean);
  if(!alvos.length) return;
  const por = naoLidas();
  const itens = [{ k:'', nome:'Geral', ini:'#', geral:true }].concat(
    membros().filter(m => m.key !== me()).map(m => ({ k:m.key, nome:m.nome, ini:m.initials, role:m.role })));
  itens.forEach(i => { i.ult = ultimaDe(i.k); });
  const geral = itens.shift();
  itens.sort((a, b) =>
    ((b.ult?.criado_em || '') > (a.ult?.criado_em || '') ? 1 : (b.ult?.criado_em || '') < (a.ult?.criado_em || '') ? -1 : 0)
    || (_online.has(b.k) - _online.has(a.k)) || a.nome.localeCompare(b.nome));
  const html = [geral, ...itens].map(i => {
    const on = i.geral || _online.has(i.k);
    const prev = i.ult
      ? `${i.ult.autor === me() ? 'Eu: ' : (i.geral ? esc(nomeDe(i.ult.autor).split(' ')[0]) + ': ' : '')}${esc(i.ult.texto)}`
      : (i.geral ? 'Toda a equipa' : esc(ROLE_LBL[i.role] || i.role));
    return `<button type="button" class="chat-pessoa${on ? ' on' : ''}${i.geral ? ' chat-pessoa-geral' : ''}${(i.k || null) === _conv ? ' sel' : ''}" onclick="chatSetConv('${esc(i.k)}')">
      <div class="chat-av">${esc(i.ini)}<i class="chat-dot"></i></div>
      <div class="chat-pessoa-tx">
        <div class="chat-pessoa-l1"><b>${esc(i.nome)}</b>${i.ult ? `<span class="chat-pessoa-h${por[i.k] ? ' nl' : ''}">${fmtLista(i.ult.criado_em)}</span>` : ''}</div>
        <div class="chat-pessoa-l2"><small>${prev}</small>${por[i.k] ? `<span class="chat-nl">${por[i.k]}</span>` : ''}</div>
      </div></button>`;
  }).join('');
  alvos.forEach(el => { el.innerHTML = html; });
}

const fmtHora = iso => new Date(iso).toLocaleTimeString('pt-PT', { hour:'2-digit', minute:'2-digit' });
function fmtDia(iso){
  const d = new Date(iso), h = new Date();
  const ontem = new Date(); ontem.setDate(h.getDate() - 1);
  if(d.toDateString() === h.toDateString()) return 'Hoje';
  if(d.toDateString() === ontem.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-PT', { weekday:'long', day:'numeric', month:'long' });
}

function renderMsgs(descer){
  ['chat-msgs','cw-msgs'].forEach(id => renderMsgsEm($(id), descer));
}

function renderMsgsEm(box, descer){
  if(!box) return;
  const perto = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  let dia = '', autor = '', t = 0, html = '';
  msgsConv().forEach(m => {
    const d = new Date(m.criado_em).toDateString();
    if(d !== dia){ html += `<div class="chat-dia"><span>${esc(fmtDia(m.criado_em))}</span></div>`; dia = d; autor = ''; }
    const meu = m.autor === me();
    const tt = new Date(m.criado_em).getTime();
    const seguida = autor === m.autor && tt - t < 5 * 60000;
    autor = m.autor; t = tt;
    html += `<div class="chat-row${meu ? ' meu' : ''}${seguida ? ' seg' : ''}">
      ${!meu && !seguida ? `<div class="chat-av sm">${esc(iniciaisDe(m.autor))}</div>` : '<div class="chat-av-sp"></div>'}
      <div class="chat-bub">
        ${!meu && !seguida ? `<div class="chat-nome">${esc(nomeDe(m.autor))}</div>` : ''}
        <div class="chat-tx">${esc(m.texto).replace(/\n/g, '<br>')}</div>
        <div class="chat-meta">${fmtHora(m.criado_em)}${meu ? `<button type="button" class="chat-del" title="Apagar" onclick="chatApagar('${m.id}')">×</button>` : ''}</div>
      </div></div>`;
  });
  box.innerHTML = html || `<div class="chat-vazio">${_conv ? 'Conversa privada com ' + esc(nomeDe(_conv)) + '. Só vocês os dois a veem.' : 'Ainda não há mensagens. Escreva a primeira!'}</div>`;
  if(descer || perto) box.scrollTop = box.scrollHeight;
}

export async function chatEnviar(id){
  const inp = $(typeof id === 'string' ? id : 'chat-in'); if(!inp) return;
  const texto = inp.value.trim();
  if(!texto) return;
  inp.value = ''; chatAutoH(inp);
  const { data, error } = await sb.from('chat_mensagens').insert({ texto, para: _conv }).select().single();
  if(error){ inp.value = texto; window.showToast?.('Erro ao enviar mensagem'); return; }
  if(!_msgs.some(m => m.id === data.id)){ _msgs.push(data); renderMsgs(true); marcarLido(); }
  notificarChat(data);
}

export async function chatApagar(id){
  if(!confirm('Apagar esta mensagem?')) return;
  const { error } = await sb.from('chat_mensagens').delete().eq('id', id);
  if(error){ window.showToast?.('Erro ao apagar'); return; }
  _msgs = _msgs.filter(m => m.id !== id);
  renderMsgs(false);
}

export function chatKey(e){
  if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); chatEnviar(e.target.id); }
}
export function chatAutoH(el){
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ── Bolha flutuante (arrastável) + caixa de chat pequena ───────────
const FAB_POS_KEY = 'plandese_chat_fab_pos';
const FAB = 54;

function lerPos(){
  try{ const p = JSON.parse(localStorage.getItem(FAB_POS_KEY)); if(p && isFinite(p.x) && isFinite(p.y)) return p; }catch(e){}
  return null;
}
function limitar(x, y){
  return {
    x: Math.min(Math.max(8, x), window.innerWidth - FAB - 8),
    y: Math.min(Math.max(8, y), window.innerHeight - FAB - 8),
  };
}
function aplicarPos(fab, pos){
  if(modoMovel()){ fab.style.left = fab.style.top = ''; return pos; }
  const p = limitar(pos.x, pos.y);
  fab.style.left = p.x + 'px'; fab.style.top = p.y + 'px';
  posicionarPainel();
  return p;
}

function posicionarPainel(){
  const fab = $('chat-fab'), pn = $('chat-fab-panel');
  if(!fab || !pn) return;
  const r = fab.getBoundingClientRect();
  const pw = pn.offsetWidth || 340, ph = pn.offsetHeight || 440;
  let x = r.left + r.width / 2 > window.innerWidth / 2 ? r.right - pw : r.left;
  let y = r.top + r.height / 2 > window.innerHeight / 2 ? r.top - ph - 10 : r.bottom + 10;
  x = Math.min(Math.max(8, x), window.innerWidth - pw - 8);
  y = Math.min(Math.max(8, y), window.innerHeight - ph - 8);
  pn.style.left = x + 'px'; pn.style.top = y + 'px';
}

export function chatTogglePainel(abrir){
  const pn = $('chat-fab-panel'); if(!pn) return;
  const on = typeof abrir === 'boolean' ? abrir : !pn.classList.contains('open');
  pn.classList.toggle('open', on);
  if(on){
    renderPessoas();
    posicionarPainel();
    renderMsgs(true);
    renderOnlineBar();
    marcarLido();
    setTimeout(() => $('cw-in')?.focus(), 50);
  } else badge();
}

function criarFab(){
  if($('chat-fab')) return;
  const fab = document.createElement('button');
  fab.id = 'chat-fab'; fab.type = 'button'; fab.title = 'Chat da equipa';
  fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span class="chat-fab-badge" id="chat-fab-badge" hidden></span>';
  const pn = document.createElement('div');
  pn.id = 'chat-fab-panel';
  pn.innerHTML = `<div class="cw-hdr"><div><b>Chat da equipa</b><small id="cw-online"></small></div>
      <div class="cw-acts"><button type="button" title="Abrir em página inteira" onclick="goTo('chat');chatTogglePainel(false)">⤢</button>
      <button type="button" title="Fechar" onclick="chatTogglePainel(false)">×</button></div></div>
    <div class="cw-body">
      <div class="cw-side" id="cw-pessoas"></div>
      <div class="cw-conv">
        <div class="cw-conv-hdr"><button type="button" class="chat-back" onclick="chatVoltar()" title="Voltar">‹</button><b id="cw-conv-title">Geral — toda a equipa</b></div>
        <div class="chat-msgs" id="cw-msgs"></div>
        <div class="chat-compose"><textarea id="cw-in" rows="1" placeholder="Escreva uma mensagem…" onkeydown="chatKey(event)" oninput="chatAutoH(this)"></textarea>
        <button class="btn btn-primary btn-sm" type="button" onclick="chatEnviar('cw-in')">Enviar</button></div>
      </div>
    </div>`;
  document.body.append(fab, pn);

  if(modoMovel()) fab.style.left = fab.style.top = '';
  const ini = lerPos() || { x: window.innerWidth - FAB - 18, y: window.innerHeight - FAB - 90 };
  aplicarPos(fab, ini);

  let drag = null;
  fab.addEventListener('pointerdown', e => {
    if(modoMovel()) return;
    drag = { sx: e.clientX, sy: e.clientY, ox: fab.offsetLeft, oy: fab.offsetTop, moveu: false };
    fab.setPointerCapture(e.pointerId);
  });
  fab.addEventListener('pointermove', e => {
    if(!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if(!drag.moveu && Math.hypot(dx, dy) < 5) return;
    drag.moveu = true; fab.classList.add('drag');
    aplicarPos(fab, { x: drag.ox + dx, y: drag.oy + dy });
  });
  fab.addEventListener('click', () => { if(modoMovel()) chatAbrirMovel(); });
  fab.addEventListener('pointerup', e => {
    if(!drag) return;
    const d = drag; drag = null;
    fab.classList.remove('drag');
    try{ fab.releasePointerCapture(e.pointerId); }catch(_){}
    if(d.moveu){
      try{ localStorage.setItem(FAB_POS_KEY, JSON.stringify({ x: fab.offsetLeft, y: fab.offsetTop })); }catch(_){}
    } else chatTogglePainel();
  });
  fab.addEventListener('pointercancel', () => { drag = null; fab.classList.remove('drag'); });
  window.addEventListener('resize', () => { if($('chat-fab')) aplicarPos(fab, { x: fab.offsetLeft, y: fab.offsetTop }); });
}

// ── Notificações ───────────────────────────────────────────────────
// Privadas: avisam sempre o destinatário. Canal geral: só quem subscreveu "Chat"
// (Notificações → preferências) e os administradores.
const GERAL_TAG = '💬 Geral · ';
const cortar = t => { const x = String(t).replace(/\s+/g, ' ').trim(); return x.length > 90 ? x.slice(0, 87) + '…' : x; };

async function notificarChat(m){
  try {
    let dest = new Set();
    if(m.para){
      dest.add(m.para);
    } else {
      const { data: subs } = await sb.from('notif_subscriptions').select('destinatario').eq('seccao', 'chat');
      (subs || []).forEach(x => dest.add(x.destinatario));
      Object.entries(S.USERS || {}).forEach(([k, u]) => { if(u.role === 'admin') dest.add(k); });
    }
    dest.delete(me());
    [...dest].forEach(k => { if(!roleCanAccessSection(S.USERS?.[k]?.role, 'chat')) dest.delete(k); });
    if(!dest.size) return;
    const acao = (m.para ? '💬 ' : GERAL_TAG) + cortar(m.texto);
    const actor = me(), actor_nome = S.currentUser?.nome || actor;
    await sbInsertNotificacoes([...dest].map(destinatario => ({ actor, actor_nome, acao, seccao: 'chat', destinatario })));
    sb.functions.invoke('send-push', { body: { recipients: [...dest], acao, seccao: 'chat', actor_nome } })
      .catch(e => console.warn('send-push falhou:', e));
  } catch(e){ console.warn('notificarChat:', e); }
}

// Ao ler uma conversa, as notificações dela ficam lidas
function limparNotifs(){
  if(!aChatAberto()) return;
  let mudou = false;
  (S.NOTIFICACOES || []).forEach(n => {
    if(n.seccao !== 'chat' || n.lida) return;
    const geral = String(n.acao).startsWith(GERAL_TAG);
    if(geral ? _conv === null : n.actor === _conv){ n.lida = true; sbMarkNotifRead(n.id); mudou = true; }
  });
  if(mudou) renderNotifPanel();
}

// Clique numa notificação de chat → abre a conversa certa
export function chatAbrirNotif(n){
  _conv = String(n.acao).startsWith(GERAL_TAG) ? null : (n.actor || null);
  $('chat-layout')?.classList.add('em-conv');
  chatTogglePainel(false);
  window.goTo('chat');
}

// ── Telemóvel: botão fixo junto à barra inferior, chat em ecrã completo ──
const modoMovel = () => document.body.classList.contains('device-mobile');
let _prevSec = null;

function chatAbrirMovel(){
  _prevSec = document.querySelector('.section.active')?.id.replace(/^sec-/, '') || null;
  if(_prevSec === 'chat') _prevSec = null;
  chatVoltar(); // começa na lista de conversas, como no WhatsApp
  window.goTo('chat');
}

export function chatFechar(){
  window.goTo(_prevSec || (modoMovel() ? 'analise' : 'painel'));
}
