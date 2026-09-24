// ═══════════════════════════════════════
//  PÁGINA DE NOTIFICAÇÕES — histórico completo + preferências do utilizador
// ═══════════════════════════════════════
import { S } from '../state.js';
import { NOTIF_SECTIONS } from '../config.js';
import {
  sbLoadNotificacoes, sbSetNotifLida, sbMarkAllNotifRead, sbDeleteNotif,
  sbDeleteNotifsLidas, sbLoadSubscriptions, sbSetSubscription
} from '../db.js';
import { canAccessSection, roleCanAccessSection } from './permissions.js';
import { renderNotifPanel, goToSection } from './notifications.js';
import { showToast } from './navigation.js';

const LIMITE = 500;
let _todas = [];
let _filtro = 'all';
let _subs = new Set();

function escapeHtml(s){
  return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function fmtData(iso){
  if(!iso) return '';
  const d = new Date(iso);
  const hm = d.toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'});
  if(d.toDateString()===new Date().toDateString()) return 'Hoje, '+hm;
  const ontem = new Date(); ontem.setDate(ontem.getDate()-1);
  if(d.toDateString()===ontem.toDateString()) return 'Ontem, '+hm;
  return d.toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit',year:'numeric'})+', '+hm;
}

// Mantém o sino (S.NOTIFICACOES) coerente com as alterações feitas nesta página
function _syncSino(){
  const porId = new Map(_todas.map(n=>[String(n.id), n]));
  S.NOTIFICACOES = S.NOTIFICACOES.filter(n=>porId.has(String(n.id)));
  S.NOTIFICACOES.forEach(n=>{ n.lida = porId.get(String(n.id)).lida; });
  renderNotifPanel();
}

// Chamado pelo hook goTo('notificacoes')
export async function initNotifPage(){
  const me = S.currentUser?.key;
  if(!me) return;
  const [todas, subs] = await Promise.all([
    sbLoadNotificacoes(me, LIMITE),
    sbLoadSubscriptions()
  ]);
  _todas = todas.filter(n=>!n.seccao || canAccessSection(n.seccao));
  _subs = new Set((subs||[]).filter(r=>r.destinatario===me).map(r=>r.seccao));

  const sel = document.getElementById('ntf-seccao');
  if(sel){
    const atual = sel.value;
    sel.innerHTML = '<option value="">Todas as secções</option>' +
      Object.entries(NOTIF_SECTIONS)
        .filter(([k])=>canAccessSection(k))
        .map(([k,l])=>`<option value="${k}">${escapeHtml(l)}</option>`).join('');
    sel.value = atual;
  }
  renderNotifPage();
  renderNotifPrefs();
}

// Notificação nova em tempo real (vinda de notifications.js)
export function ntfOnInsert(row){
  if(_todas.some(n=>n.id===row.id)) return;
  _todas.unshift(row);
  if(document.getElementById('sec-notificacoes')?.classList.contains('active')) renderNotifPage();
}

export function ntfFiltro(f){
  _filtro = f;
  renderNotifPage();
}

export function renderNotifPage(){
  const list = document.getElementById('ntf-list');
  if(!list) return;

  document.querySelectorAll('#sec-notificacoes .pt-chip[data-nf]')
    .forEach(c=>c.setAttribute('aria-pressed', c.dataset.nf===_filtro));

  const unread = _todas.filter(n=>!n.lida).length;
  const sub = document.getElementById('ntf-sub');
  if(sub) sub.textContent = `${_todas.length} notificaç${_todas.length===1?'ão':'ões'} · ${unread} por ler`;

  const sec = document.getElementById('ntf-seccao')?.value || '';
  const q = (document.getElementById('ntf-q')?.value || '').trim().toLowerCase();

  const vis = _todas.filter(n=>{
    if(_filtro==='unread' && n.lida) return false;
    if(_filtro==='read' && !n.lida) return false;
    if(sec && n.seccao!==sec) return false;
    if(q && !((n.acao||'')+' '+(n.actor_nome||'')).toLowerCase().includes(q)) return false;
    return true;
  });

  if(vis.length===0){
    list.innerHTML = `<div class="notif-empty">${_todas.length?'Nenhuma notificação corresponde aos filtros':'Sem notificações'}</div>`;
    return;
  }

  list.innerHTML = vis.map(n=>{
    const id = escapeHtml(n.id);
    const secLbl = n.seccao ? (NOTIF_SECTIONS[n.seccao] || n.seccao) : '';
    return `
    <div class="ntf-item ${n.lida?'':'unread'}">
      <div class="notif-dot"></div>
      <div class="ntf-body" ${n.seccao?`onclick="ntfAbrir('${id}')" title="Abrir ${escapeHtml(secLbl)}"`:''}>
        <div class="ntf-msg">${escapeHtml(n.acao)}</div>
        <div class="ntf-meta">
          ${secLbl?`<span class="ntf-tag">${escapeHtml(secLbl)}</span>`:''}
          ${n.actor_nome?escapeHtml(n.actor_nome)+' · ':''}${fmtData(n.created_at)}
        </div>
      </div>
      <div class="ntf-actions">
        <button class="ntf-act" type="button" onclick="ntfToggleLida('${id}')" title="${n.lida?'Marcar como não lida':'Marcar como lida'}">
          ${n.lida
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'}
        </button>
        <button class="ntf-act ntf-act-del" type="button" onclick="ntfApagar('${id}')" title="Apagar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

function _find(id){ return _todas.find(n=>String(n.id)===String(id)); }

export async function ntfToggleLida(id){
  const n = _find(id); if(!n) return;
  n.lida = !n.lida;
  renderNotifPage(); _syncSino();
  await sbSetNotifLida(n.id, n.lida);
}

export async function ntfApagar(id){
  const n = _find(id); if(!n) return;
  _todas = _todas.filter(x=>x!==n);
  renderNotifPage(); _syncSino();
  await sbDeleteNotif(n.id);
  showToast('Notificação apagada');
}

export function ntfAbrir(id){
  const n = _find(id); if(!n) return;
  if(!n.lida){ n.lida = true; sbSetNotifLida(n.id, true); _syncSino(); }
  goToSection(n.seccao);
}

export async function ntfMarcarTodasLidas(){
  const me = S.currentUser?.key; if(!me) return;
  if(!_todas.some(n=>!n.lida)){ showToast('Não há notificações por ler'); return; }
  _todas.forEach(n=>n.lida=true);
  renderNotifPage(); _syncSino();
  await sbMarkAllNotifRead(me);
  showToast('Todas marcadas como lidas ✓');
}

export async function ntfApagarLidas(){
  const me = S.currentUser?.key; if(!me) return;
  const lidas = _todas.filter(n=>n.lida).length;
  if(!lidas){ showToast('Não há notificações lidas para apagar'); return; }
  if(!confirm(`Apagar ${lidas} notificaç${lidas===1?'ão lida':'ões lidas'}? Esta acção não pode ser desfeita.`)) return;
  _todas = _todas.filter(n=>!n.lida);
  renderNotifPage(); _syncSino();
  await sbDeleteNotifsLidas(me);
  showToast('Notificações lidas apagadas');
}

// ── Preferências: de que secções o próprio utilizador quer ser notificado ──
export function renderNotifPrefs(){
  const box = document.getElementById('ntf-prefs-list');
  const sub = document.getElementById('ntf-prefs-sub');
  if(!box) return;
  const role = S.currentUser?.role;
  const isAdmin = role==='admin';
  if(sub) sub.textContent = isAdmin
    ? 'Como administrador recebe sempre as notificações de todas as secções.'
    : 'Escolha as secções de que quer ser avisado.';

  const secs = Object.entries(NOTIF_SECTIONS).filter(([k])=>roleCanAccessSection(role, k));
  if(!secs.length){ box.innerHTML = '<div class="notif-empty">Sem secções disponíveis</div>'; return; }

  box.innerHTML = secs.map(([k,l])=>{
    const on = isAdmin || _subs.has(k);
    return `<label class="ntf-pref">
      <span>${escapeHtml(l)}</span>
      <span class="perm-toggle">
        <input type="checkbox" ${on?'checked':''}${isAdmin?' disabled':''} onchange="ntfTogglePref('${k}',this.checked)"/>
        <span class="perm-slider"></span>
      </span>
    </label>`;
  }).join('');
}

export async function ntfTogglePref(seccao, ativo){
  const me = S.currentUser?.key; if(!me) return;
  if(ativo) _subs.add(seccao); else _subs.delete(seccao);
  await sbSetSubscription(me, seccao, ativo);
  showToast(ativo ? `Vai receber notificações de ${NOTIF_SECTIONS[seccao]} ✓` : `Deixa de receber notificações de ${NOTIF_SECTIONS[seccao]}`);
}
