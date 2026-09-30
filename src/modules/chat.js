// ═══════════════════════════════════════
//  CHAT INTERNO — canal geral + conversas privadas (sem encarregados) + quem está online
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S } from '../state.js';

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
  renderChat(true);
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
  const sel = $('cw-conv');
  if(sel){
    const por = naoLidas();
    const op = (k, nome) => `<option value="${esc(k)}"${(k || null) === _conv ? ' selected' : ''}>${esc(nome)}${por[k] ? ` (${por[k]})` : ''}</option>`;
    sel.innerHTML = op('', 'Geral — toda a equipa') + membros().filter(m => m.key !== me()).map(m => op(m.key, m.nome)).join('');
  }
}

function renderOnlineBar(){
  const n = membros().filter(m => _online.has(m.key)).length;
  const txt = n ? `${n} online agora` : 'Ninguém online';
  ['chat-online-sub','cw-online'].forEach(id => { const el = $(id); if(el) el.textContent = txt; });
}

function renderPessoas(){
  renderConvTitulo();
  const el = $('chat-pessoas'); if(!el) return;
  const por = naoLidas();
  const lista = membros().filter(m => m.key !== me()).sort((a, b) =>
    (_online.has(b.key) - _online.has(a.key)) || a.nome.localeCompare(b.nome));
  const bdg = k => por[k] ? `<span class="chat-nl">${por[k]}</span>` : '';
  const geral = `<button type="button" class="chat-pessoa chat-pessoa-geral on${_conv === null ? ' sel' : ''}" onclick="chatSetConv('')">
      <div class="chat-av">#</div>
      <div class="chat-pessoa-tx"><b>Geral</b><small>Toda a equipa</small></div>${bdg('')}</button>`;
  el.innerHTML = geral + lista.map(m => {
    const on = _online.has(m.key);
    return `<button type="button" class="chat-pessoa${on ? ' on' : ''}${_conv === m.key ? ' sel' : ''}" onclick="chatSetConv('${esc(m.key)}')">
      <div class="chat-av">${esc(m.initials)}<i class="chat-dot"></i></div>
      <div class="chat-pessoa-tx"><b>${esc(m.nome)}</b>
      <small>${on ? 'Online' : 'Offline'} · ${esc(ROLE_LBL[m.role] || m.role)}</small></div>${bdg(m.key)}
    </button>`;
  }).join('');
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
  pn.innerHTML = `<div class="cw-hdr"><div><b>Chat da equipa</b><small id="cw-online"></small><select id="cw-conv" onchange="chatSetConv(this.value)"></select></div>
      <div class="cw-acts"><button type="button" title="Abrir em página inteira" onclick="goTo('chat');chatTogglePainel(false)">⤢</button>
      <button type="button" title="Fechar" onclick="chatTogglePainel(false)">×</button></div></div>
    <div class="chat-msgs" id="cw-msgs"></div>
    <div class="chat-compose"><textarea id="cw-in" rows="1" placeholder="Escreva uma mensagem…" onkeydown="chatKey(event)" oninput="chatAutoH(this)"></textarea>
    <button class="btn btn-primary btn-sm" type="button" onclick="chatEnviar('cw-in')">Enviar</button></div>`;
  document.body.append(fab, pn);

  const ini = lerPos() || { x: window.innerWidth - FAB - 18, y: window.innerHeight - FAB - 90 };
  aplicarPos(fab, ini);

  let drag = null;
  fab.addEventListener('pointerdown', e => {
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
