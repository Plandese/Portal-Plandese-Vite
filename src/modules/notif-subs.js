// ═══════════════════════════════════════
//  GESTÃO DE SUBSCRIÇÕES DE NOTIFICAÇÕES
//  Matriz utilizadores × secções (opção B)
// ═══════════════════════════════════════
import { S } from '../state.js';
import { NOTIF_SECTIONS } from '../config.js';
import { sbLoadSubscriptions, sbSetSubscription } from '../db.js';
import { showToast } from './navigation.js';

// Conjunto de subscrições ativas em memória: "destinatario|seccao"
let _subs = new Set();

function escapeHtml(s){
  return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export async function renderNotifSubs(){
  const head = document.getElementById('notif-matrix-head');
  const body = document.getElementById('notif-matrix-body');
  if(!head||!body) return;

  // Carrega subscrições atuais
  const rows = await sbLoadSubscriptions();
  _subs = new Set((rows||[]).map(r=>r.destinatario+'|'+r.seccao));

  const secEntries = Object.entries(NOTIF_SECTIONS); // [ [key,label], ... ]

  head.innerHTML = '<tr><th>Utilizador</th>' +
    secEntries.map(([,label])=>`<th>${escapeHtml(label)}</th>`).join('') +
    '</tr>';

  // Utilizadores não-admin (admin recebe sempre tudo)
  const users = Object.entries(S.USERS||{})
    .filter(([,u])=>u.role!=='admin')
    .sort((a,b)=>(a[1].nome||a[0]).localeCompare(b[1].nome||b[0]));

  body.innerHTML = users.map(([username,u])=>{
    const cells = secEntries.map(([secKey])=>{
      const on = _subs.has(username+'|'+secKey);
      return `<td>
        <label class="perm-toggle" title="${on?'Recebe notificações':'Não recebe'}">
          <input type="checkbox" ${on?'checked':''}
            onchange="toggleNotifSub('${username}','${secKey}',this.checked)"/>
          <span class="perm-slider"></span>
        </label>
      </td>`;
    }).join('');
    return `<tr><td>${escapeHtml(u.nome||username)} <span style="font-size:10px;color:var(--gray-400)">(${escapeHtml(u.role||'')})</span></td>${cells}</tr>`;
  }).join('');

  // Linha admin (sempre tudo, desativada)
  const adminCells = secEntries.map(()=>`<td>
    <label class="perm-toggle"><input type="checkbox" checked disabled/><span class="perm-slider"></span></label>
  </td>`).join('');
  body.innerHTML += `<tr style="opacity:.6"><td>Administrador <span style="font-size:10px;color:var(--gray-400);font-weight:400">(tudo)</span></td>${adminCells}</tr>`;
}

export async function toggleNotifSub(destinatario, seccao, ativo){
  const key = destinatario+'|'+seccao;
  if(ativo) _subs.add(key); else _subs.delete(key);
  await sbSetSubscription(destinatario, seccao, ativo);
  showToast(ativo?'Subscrição ativada ✓':'Subscrição removida');
}
