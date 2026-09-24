// ═══════════════════════════════════════
//  CENTRO DE NOTIFICAÇÕES (persistido + realtime)
// ═══════════════════════════════════════
import { S, R } from '../state.js';
import { sb } from '../supabase.js';
import {
  sbLoadNotificacoes, sbInsertNotificacoes, sbMarkNotifRead,
  sbMarkAllNotifRead, sbSubscribeNotificacoes
} from '../db.js';
import { canAccessSection, roleCanAccessSection } from './permissions.js';

let _realtimeCh = null;

// Notificação visível = sem secção associada, ou secção a que o utilizador tem acesso.
// Notificações de departamentos bloqueados nunca chegam à lista, ao badge nem ao toast.
function _notifPermitida(n){
  return !n.seccao || canAccessSection(n.seccao);
}

export async function initNotifications(){
  // Carrega notificações reais do utilizador autenticado
  await loadNotificacoes();
  renderNotifPanel();

  // Liga entrega em tempo real
  const me = S.currentUser?.key;
  if(me){
    if(_realtimeCh){ try{ sb.removeChannel(_realtimeCh); }catch(e){} }
    _realtimeCh = sbSubscribeNotificacoes(me, onRealtimeInsert);
  }

  document.addEventListener('click', function(e){
    if(S.notifPanelOpen
      && !e.target.closest('.notif-wrap')
      && !e.target.closest('#notif-panel')){
      closeNotifPanel();
    }
  });
}

export async function loadNotificacoes(){
  const me = S.currentUser?.key;
  if(!me){ S.NOTIFICACOES = []; return; }
  const todas = await sbLoadNotificacoes(me);
  S.NOTIFICACOES = todas.filter(_notifPermitida);
}

function onRealtimeInsert(row){
  // Evita duplicados (caso já exista)
  if(S.NOTIFICACOES.some(n=>n.id===row.id)) return;
  if(!_notifPermitida(row)) return;
  S.NOTIFICACOES.unshift(row);
  renderNotifPanel();
  R.ntfOnInsert?.(row);
  if(window.showToast) window.showToast('🔔 '+row.acao);
}

// ── EMISSÃO DE EVENTOS ──────────────────────────────────────────────
// Chamar sempre que alguém faz algo no portal:
//   R.emitEvent({ acao:'Novo pedido de compra · Obra X', seccao:'compras' })
export async function emitEvent({ acao, seccao }){
  try {
    const actor = S.currentUser?.key || null;
    const actor_nome = S.currentUser?.nome || 'Sistema';

    // Destinatários = utilizadores subscritos a esta secção ∪ todos os admins
    const { data: subs } = await sb.from('notif_subscriptions')
      .select('destinatario').eq('seccao', seccao);
    const recipients = new Set((subs||[]).map(s=>s.destinatario));

    // Admins recebem tudo por omissão
    Object.entries(S.USERS||{}).forEach(([username,u])=>{
      if(u.role==='admin') recipients.add(username);
    });

    // Não notificar o próprio autor da acção
    if(actor) recipients.delete(actor);

    // Só notificar quem tem acesso à secção (subscrições antigas de perfis entretanto bloqueados)
    [...recipients].forEach(dest=>{
      const role = S.USERS?.[dest]?.role;
      if(!roleCanAccessSection(role, seccao)) recipients.delete(dest);
    });

    if(recipients.size===0) return;

    const rows = [...recipients].map(destinatario => ({
      actor, actor_nome, acao, seccao, destinatario
    }));
    await sbInsertNotificacoes(rows);

    // Entrega Web Push real (Central de Notificações do telemóvel) — não bloqueia
    // nem quebra o fluxo se a função falhar (ex. sem subscrições).
    sb.functions.invoke('send-push', {
      body: { recipients: [...recipients], acao, seccao, actor_nome }
    }).catch(e => console.warn('send-push falhou:', e));
  } catch(e){ console.warn('emitEvent falhou:', e); }
}

// ── RENDER ──────────────────────────────────────────────────────────
function fmtNotifTime(iso){
  if(!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString()===now.toDateString();
  const hm = d.toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'});
  if(sameDay) return hm;
  return d.toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit'})+' '+hm;
}

export function renderNotifPanel(){
  const list = document.getElementById('notif-list');
  const badge = document.getElementById('notif-badge');
  if(!list||!badge) return;

  const unread = S.NOTIFICACOES.filter(n=>!n.lida).length;
  if(unread>0){
    badge.textContent = unread>9?'9+':unread;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }

  if(S.NOTIFICACOES.length===0){
    list.innerHTML='<div class="notif-empty">Sem notificações de momento</div>';
    return;
  }

  list.innerHTML = S.NOTIFICACOES.map(n=>`
    <div class="notif-item ${n.lida?'':'unread'}" onclick="notifClick('${n.id}','${n.seccao||''}')">
      <div class="notif-dot"></div>
      <div class="notif-content">
        <div class="notif-msg">${escapeHtml(n.acao)}</div>
        <div class="notif-time">${n.actor_nome?escapeHtml(n.actor_nome)+' · ':''}${fmtNotifTime(n.created_at)}</div>
      </div>
    </div>`).join('');
}

function escapeHtml(s){
  return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Navega para a secção (usado pelo clique numa notificação, dentro ou fora da app)
export function goToSection(section){
  if(section && canAccessSection(section)){
    const btn = document.querySelector(`.sidebar .nav-btn[onclick*="'${section}'"]`);
    window.goTo(section, btn);
  }
}

export function notifClick(id, section){
  const n = S.NOTIFICACOES.find(x=>String(x.id)===String(id));
  if(n && !n.lida){ n.lida = true; sbMarkNotifRead(n.id); }
  renderNotifPanel();
  closeNotifPanel();
  goToSection(section);
}

export async function toggleNotifPanel(){
  S.notifPanelOpen = !S.notifPanelOpen;
  const panel = document.getElementById('notif-panel');
  if(S.notifPanelOpen){
    const btn = document.getElementById('notif-btn');
    const rect = btn.getBoundingClientRect();
    panel.style.top  = (rect.bottom + 8) + 'px';
    panel.style.right = (window.innerWidth - rect.right) + 'px';
    await loadNotificacoes();
    renderNotifPanel();
    panel.classList.add('open');
  } else {
    panel.classList.remove('open');
  }
}

export function closeNotifPanel(){
  S.notifPanelOpen = false;
  document.getElementById('notif-panel')?.classList.remove('open');
}

export async function markAllRead(){
  const me = S.currentUser?.key;
  S.NOTIFICACOES.forEach(n=>n.lida=true);
  if(me) await sbMarkAllNotifRead(me);
  renderNotifPanel();
}

// Mantida por compatibilidade (já não usada para construir a lista falsa)
export function agora(){
  return new Date().toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'});
}
export function buildNotifications(){ /* substituído por loadNotificacoes() */ }
export function addNotification(){ /* substituído por emitEvent() */ }
