// ═══════════════════════════════════════
//  ADMIN — UTILIZADORES
// ═══════════════════════════════════════
import { S, R } from '../state.js';
import { sbSaveUser, sbSaveEncModulos } from '../db.js';
import { closeModal, flashAlert } from './navigation.js';
import { ROLE_LABELS, ENC_MODULES } from '../config.js';

export function renderUsers(){
  const ROLE_BADGE={admin:'b-blue',diretor_obra:'b-blue',compras:'b-orange',financeiro:'b-green',comercial:'b-gray',encarregado:'b-gray'};
  const tbody=document.getElementById('user-tbody');
  tbody.innerHTML='';
  Object.keys(S.USERS).forEach(key=>{
    const u=S.USERS[key];
    const roleLbl=ROLE_LABELS[u.role]||u.role;
    const badgeCls=ROLE_BADGE[u.role]||'b-gray';
    const tr=document.createElement('tr');
    tr.innerHTML=`<td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--gray-500)">${key}</td><td style="font-weight:500">${u.nome}</td><td><span class="badge ${badgeCls}">${roleLbl}</span></td><td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--gray-400)">••••••••</td><td><span class="badge b-green">Ativo</span></td><td><button class="btn btn-secondary btn-sm" onclick="editUser('${key}')">Editar</button></td>`;
    tbody.appendChild(tr);
  });
}

// modulos = array de ids permitidos, ou null/undefined (sem restrição = todos marcados)
export function renderEncModsCheckboxes(modulos){
  const grid=document.getElementById('mu-enc-mods-grid');
  if(!grid)return;
  grid.innerHTML=ENC_MODULES.map(m=>{
    const checked=!modulos||modulos.includes(m.id);
    return `<label style="display:flex;align-items:center;gap:7px;font-size:13px;font-weight:400;color:var(--gray-700);cursor:pointer">
      <input type="checkbox" class="mu-enc-mod" value="${m.id}" ${checked?'checked':''} style="width:15px;height:15px;flex-shrink:0"/>
      ${m.label}
    </label>`;
  }).join('');
}

function readEncModsCheckboxes(){
  const boxes=Array.from(document.querySelectorAll('.mu-enc-mod'));
  const checked=boxes.filter(b=>b.checked).map(b=>b.value);
  return checked.length===boxes.length ? null : checked; // null = sem restrições
}

export function onUserRoleChange(){
  const role=document.getElementById('mu-role').value;
  const wrap=document.getElementById('mu-enc-mods-wrap');
  if(wrap) wrap.hidden = role!=='encarregado';
}

export function editUser(key){
  const u=S.USERS[key];if(!u)return;
  document.getElementById('mu-title').textContent='Editar utilizador';
  document.getElementById('mu-key').value=key;
  document.getElementById('mu-nome').value=u.nome;
  document.getElementById('mu-user').value=key;
  document.getElementById('mu-pass').value='';
  document.getElementById('mu-pass').placeholder='Deixe em branco para manter a password atual';
  document.getElementById('mu-role').value=u.role;
  renderEncModsCheckboxes(u.encModulos);
  onUserRoleChange();
  document.getElementById('modal-user').classList.add('open');
}

export async function saveUser(){
  const nome=document.getElementById('mu-nome').value.trim();
  const user=document.getElementById('mu-user').value.trim().toLowerCase().replace(/\s/g,'.');
  const pass=document.getElementById('mu-pass').value.trim();
  const role=document.getElementById('mu-role').value;
  const editKey=document.getElementById('mu-key').value;
  if(!nome||!user||(!editKey&&!pass)){alert('Preencha todos os campos.');return;}
  const initials=nome.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
  const encModulos=role==='encarregado' ? readEncModsCheckboxes() : null;
  if(editKey&&editKey!==user)delete S.USERS[editKey];
  S.USERS[user]={nome,initials,role,encModulos};
  await sbSaveUser(user,{pass:pass||null,nome,initials,role});
  await sbSaveEncModulos(user,encModulos);
  closeModal('modal-user');renderUsers();flashAlert('user-alert');
  R.emitEvent?.({ acao:(editKey?'Utilizador atualizado':'Novo utilizador')+': '+nome, seccao:'utilizadores' });
}
