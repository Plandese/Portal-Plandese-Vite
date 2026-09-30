// ═══════════════════════════════════════
//  CHAT INTERNO — canal geral da equipa (sem encarregados) + quem está online
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S } from '../state.js';

const ROLE_LBL = { admin:'Administrador', diretor_obra:'Diretor de Obra', compras:'Compras', financeiro:'Financeiro' };
const PAGE = 100;

let _msgs = [];
let _msgCh = null, _presCh = null;
let _online = new Set();
let _started = false;

const $ = id => document.getElementById(id);
const ESC = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const me = () => S.currentUser?.key;
const lastKey = () => 'plandese_chat_lido_' + me();
const aChatAberto = () => $('sec-chat')?.classList.contains('active');

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
      if(aChatAberto()){ renderMsgs(true); marcarLido(); } else badge();
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
  badge();
  if(aChatAberto()) renderChat();
}

export function chatStop(){
  if(_msgCh){ try{ sb.removeChannel(_msgCh); }catch(e){} _msgCh = null; }
  if(_presCh){ try{ sb.removeChannel(_presCh); }catch(e){} _presCh = null; }
  _msgs = []; _online = new Set(); _started = false;
  const b = $('nb-chat'); if(b) b.hidden = true;
  const g = $('chat-gear-dot'); if(g) g.hidden = true;
}

// ── Não lidas ──────────────────────────────────────────────────────
function lidoAte(){ try{ return localStorage.getItem(lastKey()) || ''; }catch(e){ return ''; } }
function marcarLido(){
  const ult = _msgs[_msgs.length - 1];
  try{ if(ult) localStorage.setItem(lastKey(), ult.criado_em); }catch(e){}
  badge();
}
function badge(){
  const l = lidoAte();
  const n = _msgs.filter(m => m.autor !== me() && m.criado_em > l).length;
  const b = $('nb-chat'); if(!b) return;
  b.textContent = n > 99 ? '99+' : n;
  b.hidden = !n || aChatAberto();
  const g = $('chat-gear-dot'); if(g) g.hidden = b.hidden;
}

// ── Página ─────────────────────────────────────────────────────────
export function renderChat(){
  if(!_started){ initChat(); return; }
  renderPessoas();
  renderOnlineBar();
  renderMsgs(true);
  marcarLido();
  setTimeout(() => $('chat-in')?.focus(), 50);
}

function renderOnlineBar(){
  const el = $('chat-online-sub'); if(!el) return;
  const n = membros().filter(m => _online.has(m.key)).length;
  el.textContent = n ? `${n} online agora` : 'Ninguém online';
}

function renderPessoas(){
  const el = $('chat-pessoas'); if(!el) return;
  const lista = membros().sort((a, b) =>
    (_online.has(b.key) - _online.has(a.key)) || a.nome.localeCompare(b.nome));
  el.innerHTML = lista.map(m => {
    const on = _online.has(m.key);
    return `<div class="chat-pessoa${on ? ' on' : ''}">
      <div class="chat-av">${esc(m.initials)}<i class="chat-dot"></i></div>
      <div class="chat-pessoa-tx"><b>${esc(m.nome)}${m.key === me() ? ' (eu)' : ''}</b>
      <small>${on ? 'Online' : 'Offline'} · ${esc(ROLE_LBL[m.role] || m.role)}</small></div>
    </div>`;
  }).join('') || '<div class="chat-vazio">Sem utilizadores</div>';
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
  const box = $('chat-msgs'); if(!box) return;
  const perto = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  let dia = '', autor = '', t = 0, html = '';
  _msgs.forEach(m => {
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
  box.innerHTML = html || '<div class="chat-vazio">Ainda não há mensagens. Escreva a primeira!</div>';
  if(descer || perto) box.scrollTop = box.scrollHeight;
}

export async function chatEnviar(){
  const inp = $('chat-in'); if(!inp) return;
  const texto = inp.value.trim();
  if(!texto) return;
  inp.value = ''; chatAutoH(inp);
  const { data, error } = await sb.from('chat_mensagens').insert({ texto }).select().single();
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
  if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); chatEnviar(); }
}
export function chatAutoH(el){
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}
