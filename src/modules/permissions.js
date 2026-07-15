// ═══════════════════════════════════════
//  PERMISSÕES DE ACESSO
// ═══════════════════════════════════════
import { ROLE_ACCESS, NAV_CHAPTERS } from '../config.js';
import { showToast } from './navigation.js';
import { sb } from '../supabase.js';

// Chave (linha) na tabela app_config onde a matriz de permissões é partilhada entre dispositivos
const PERM_CONFIG_KEY = 'role_permissions';

const CONFIGURABLE_ROLES = [
  {key:'diretor_obra', label:'Diretor de Obra'},
  {key:'compras',      label:'Compras'},
  {key:'financeiro',   label:'Financeiro'},
];

const DEFAULT_PERMISSIONS = {
  diretor_obra: ['rh','cmp','fin','log','prod'],
  compras:      ['cmp'],
  financeiro:   ['fin','cmp'],
};

// v2: granularidade por capítulo (rh/cmp/fin/log/prod/def) em vez de por secção individual
const PERM_STORAGE_KEY = 'plandese_role_permissions_v2';

export function loadPermissions(){
  try {
    const raw = localStorage.getItem(PERM_STORAGE_KEY);
    if(raw) return JSON.parse(raw);
  } catch(e){}
  return JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS));
}

// Lê a matriz partilhada do Supabase e sincroniza para o localStorage local.
// O servidor é a fonte de verdade — chamado no login para todos os dispositivos verem o mesmo.
export async function loadPermissionsFromServer(){
  try {
    const { data, error } = await sb.from('app_config')
      .select('value').eq('key', PERM_CONFIG_KEY).maybeSingle();
    if(error) throw error;
    if(data && data.value && typeof data.value === 'object'){
      try { localStorage.setItem(PERM_STORAGE_KEY, JSON.stringify(data.value)); } catch(e){}
      return data.value;
    }
  } catch(e){ /* sem ligação — cai no localStorage/default */ }
  return null;
}

export async function savePermissions(){
  const perms = readPermMatrixState();
  try { localStorage.setItem(PERM_STORAGE_KEY, JSON.stringify(perms)); } catch(e){}
  CONFIGURABLE_ROLES.forEach(r=>{
    if(ROLE_ACCESS[r.key]){
      ROLE_ACCESS[r.key].chapters = perms[r.key] || [];
      ROLE_ACCESS[r.key].default  = 'painel';
    }
  });
  let serverOk = true;
  try {
    const { error } = await sb.from('app_config').upsert(
      { key: PERM_CONFIG_KEY, value: perms, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    if(error) throw error;
  } catch(e){ serverOk = false; }
  const msg = document.getElementById('perm-saved-msg');
  if(msg){ msg.classList.add('show'); setTimeout(()=>msg.classList.remove('show'),2500); }
  showToast(serverOk ? 'Permissões guardadas ✓' : '⚠️ Guardado localmente — falhou no servidor');
}

export async function resetPermissions(){
  if(!confirm('Repor todas as permissões para os valores predefinidos?')) return;
  try { localStorage.removeItem(PERM_STORAGE_KEY); } catch(e){}
  CONFIGURABLE_ROLES.forEach(r=>{
    if(ROLE_ACCESS[r.key]){
      ROLE_ACCESS[r.key].chapters = [...(DEFAULT_PERMISSIONS[r.key]||[])];
      ROLE_ACCESS[r.key].default  = 'painel';
    }
  });
  try {
    await sb.from('app_config').upsert(
      { key: PERM_CONFIG_KEY, value: DEFAULT_PERMISSIONS, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
  } catch(e){ /* servidor indisponível — reposição só local */ }
  renderPermMatrix();
  showToast('Permissões repostas ✓');
}

export function readPermMatrixState(){
  const perms = {};
  CONFIGURABLE_ROLES.forEach(r=>{ perms[r.key]=[]; });
  document.querySelectorAll('.perm-chk').forEach(chk=>{
    if(chk.checked){
      const role = chk.dataset.role;
      const ch   = chk.dataset.ch;
      if(perms[role]) perms[role].push(ch);
    }
  });
  return perms;
}

export function renderPermMatrix(){
  const perms = loadPermissions();
  const thead = document.getElementById('perm-matrix-head');
  if(!thead) return;
  thead.innerHTML = '<tr><th>Perfil</th>' +
    NAV_CHAPTERS.map(c=>`<th>${c.label}</th>`).join('') +
    '</tr>';
  const tbody = document.getElementById('perm-matrix-body');
  tbody.innerHTML = CONFIGURABLE_ROLES.map(role=>{
    const roleChapters = perms[role.key] || [];
    const cells = NAV_CHAPTERS.map(ch=>{
      const checked = roleChapters.includes(ch.id);
      return `<td>
        <label class="perm-toggle" title="${checked?'Acesso permitido':'Acesso bloqueado'}">
          <input type="checkbox" class="perm-chk"
            data-role="${role.key}" data-ch="${ch.id}"
            ${checked?'checked':''}
            onchange="onPermChange(this)"/>
          <span class="perm-slider"></span>
        </label>
      </td>`;
    }).join('');
    return `<tr><td>${role.label}</td>${cells}</tr>`;
  }).join('');
  const adminCells = NAV_CHAPTERS.map(()=>`<td>
    <label class="perm-toggle">
      <input type="checkbox" checked disabled/>
      <span class="perm-slider"></span>
    </label>
  </td>`).join('');
  tbody.innerHTML += `<tr style="opacity:.6"><td>Administrador <span style="font-size:10px;color:var(--gray-400);font-weight:400">(total)</span></td>${adminCells}</tr>`;
}

export function onPermChange(chk){
  chk.closest('tr').style.background = 'var(--blue-50)';
  setTimeout(()=>{ chk.closest('tr').style.background=''; }, 800);
}

export function switchUtilTab(tab, btn){
  document.querySelectorAll('.sec-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.sec-tab-pane').forEach(p=>p.classList.remove('active'));
  if(btn) btn.classList.add('active');
  document.getElementById('util-pane-'+tab)?.classList.add('active');
  const btnNovo = document.getElementById('btn-novo-utilizador');
  if(btnNovo) btnNovo.style.display = tab==='users' ? '' : 'none';
  if(tab==='perms') renderPermMatrix();
  if(tab==='notifs' && window.renderNotifSubs) window.renderNotifSubs();
}

export function applyStoredPermissions(){
  const perms = loadPermissions();
  CONFIGURABLE_ROLES.forEach(r=>{
    if(ROLE_ACCESS[r.key]){
      const chs = perms[r.key];
      if(chs){
        ROLE_ACCESS[r.key].chapters = chs;
        ROLE_ACCESS[r.key].default  = 'painel';
      }
    }
  });
}

function chapterOfSection(sec){
  const ch = NAV_CHAPTERS.find(c=>c.sections.includes(sec));
  return ch ? ch.id : null;
}

export function applyRolePermissions(role){
  // repor tudo visível antes de reaplicar (necessário ao trocar de utilizador sem recarregar a página)
  document.querySelectorAll('.nav-lbl[data-grp],.nav-group[data-grp],.bnav-btn[onclick]').forEach(el=>{ el.style.display=''; });
  if(role === 'admin') return; // admin vê tudo
  const access = ROLE_ACCESS[role];
  if(!access) return;
  const allowed = access.chapters || [];
  // Esconder capítulos inteiros (grupo + toggle) não permitidos na sidebar
  NAV_CHAPTERS.forEach(ch=>{
    if(allowed.includes(ch.id)) return;
    document.querySelectorAll('.nav-lbl[data-grp="'+ch.id+'"],.nav-group[data-grp="'+ch.id+'"]').forEach(el=>{ el.style.display='none'; });
  });
  // Esconder atalhos da barra de navegação inferior (mobile) cujo capítulo não é permitido
  document.querySelectorAll('.bnav-btn[onclick]').forEach(btn=>{
    const m = btn.getAttribute('onclick').match(/goTo\('([^']+)'/);
    const sec = m && m[1];
    const chId = sec && chapterOfSection(sec);
    if(chId && !allowed.includes(chId)) btn.style.display='none';
  });
}
