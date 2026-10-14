// ═══════════════════════════════════════
//  PERMISSÕES DE ACESSO
// ═══════════════════════════════════════
import { ROLE_ACCESS, NAV_CHAPTERS } from '../config.js';
import { showToast } from './navigation.js';
import { sb } from '../supabase.js';
import { S } from '../state.js';

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

// ── Overrides (granularidade fina) ──────────────────────────────────
// app_config/access_overrides = { roles:{<role>:{off:[secções]}}, users:{<username>:{chapters?:[...], off?:[...]}} }
//  • roles.<role>.off  — sub-páginas bloqueadas a todo o perfil (dentro dos capítulos permitidos)
//  • users.<u>.chapters — substitui os capítulos do perfil para essa pessoa (só existe se diferir)
//  • users.<u>.off      — substitui a lista de sub-páginas bloqueadas do perfil (só existe se diferir)
// Sem este registo tudo se comporta como a matriz simples (retrocompatível).
// No servidor, fn_cap() respeita users.<u>.chapters; o bloqueio por sub-página é aplicado no cliente.
const OVR_CONFIG_KEY  = 'access_overrides';
const OVR_STORAGE_KEY = 'plandese_access_overrides_v1';
const emptyOvr = () => ({ roles:{}, users:{} });
let _ovr = loadOverridesLocal();

function loadOverridesLocal(){
  try {
    const raw = localStorage.getItem(OVR_STORAGE_KEY);
    if(raw){ const o = JSON.parse(raw); return { roles:o.roles||{}, users:o.users||{} }; }
  } catch(e){}
  return emptyOvr();
}

// Lê a matriz partilhada do Supabase e sincroniza para o localStorage local.
// O servidor é a fonte de verdade — chamado no login para todos os dispositivos verem o mesmo.
export async function loadPermissionsFromServer(){
  let result = null;
  try {
    const { data, error } = await sb.from('app_config')
      .select('key,value').in('key', [PERM_CONFIG_KEY, OVR_CONFIG_KEY]);
    if(error) throw error;
    (data||[]).forEach(row=>{
      if(!row.value || typeof row.value !== 'object') return;
      if(row.key === PERM_CONFIG_KEY){
        try { localStorage.setItem(PERM_STORAGE_KEY, JSON.stringify(row.value)); } catch(e){}
        result = row.value;
      } else if(row.key === OVR_CONFIG_KEY){
        _ovr = { roles:row.value.roles||{}, users:row.value.users||{} };
        try { localStorage.setItem(OVR_STORAGE_KEY, JSON.stringify(_ovr)); } catch(e){}
      }
    });
  } catch(e){ /* sem ligação — cai no localStorage/default */ }
  return result;
}

// Rascunho em edição no ecrã (só é aplicado ao guardar)
let _draft = null;
const _openRoles = new Set();   // perfis expandidos (lista de pessoas)
const _openChaps = new Set();   // capítulos expandidos (sub-páginas)

function cloneJ(o){ return JSON.parse(JSON.stringify(o)); }
function draft(){
  if(!_draft) _draft = { perms: loadPermissions(), ovr: cloneJ(_ovr) };
  return _draft;
}
const sameSet = (a,b)=>{ a=a||[]; b=b||[]; return a.length===b.length && a.every(x=>b.includes(x)); };

function cfgUsersOfRole(role){
  return Object.entries(S.USERS||{})
    .filter(([,u])=>u.role===role)
    .map(([username,u])=>({username, nome:u.nome||username}))
    .sort((a,b)=>a.nome.localeCompare(b.nome,'pt'));
}

async function upsertConfig(key, value){
  const { error } = await sb.from('app_config').upsert(
    { key, value, updated_at: new Date().toISOString() }, { onConflict:'key' });
  if(error) throw error;
}

function normalizeOvr(o){
  Object.keys(o.roles).forEach(r=>{ if(!(o.roles[r].off||[]).length) delete o.roles[r]; });
  Object.keys(o.users).forEach(u=>{ if(!Object.keys(o.users[u]).length) delete o.users[u]; });
  return o;
}

export async function savePermissions(){
  const d = draft();
  const perms = d.perms;
  const ovr = normalizeOvr(cloneJ(d.ovr));
  try { localStorage.setItem(PERM_STORAGE_KEY, JSON.stringify(perms)); } catch(e){}
  try { localStorage.setItem(OVR_STORAGE_KEY, JSON.stringify(ovr)); } catch(e){}
  _ovr = ovr;
  CONFIGURABLE_ROLES.forEach(r=>{
    if(ROLE_ACCESS[r.key]){
      ROLE_ACCESS[r.key].chapters = perms[r.key] || [];
      ROLE_ACCESS[r.key].default  = 'painel';
    }
  });
  let serverOk = true;
  try {
    await upsertConfig(PERM_CONFIG_KEY, perms);
    await upsertConfig(OVR_CONFIG_KEY, ovr);
  } catch(e){ serverOk = false; }
  const msg = document.getElementById('perm-saved-msg');
  if(msg){ msg.classList.add('show'); setTimeout(()=>msg.classList.remove('show'),2500); }
  showToast(serverOk ? 'Permissões guardadas ✓' : '⚠️ Guardado localmente — falhou no servidor');
  if(S.currentUser) applyRolePermissions(S.currentUser.role);
}

export async function resetPermissions(){
  if(!confirm('Repor todas as permissões para os valores predefinidos? Isto remove também as exceções por pessoa e por sub-página.')) return;
  try { localStorage.removeItem(PERM_STORAGE_KEY); localStorage.removeItem(OVR_STORAGE_KEY); } catch(e){}
  _ovr = emptyOvr();
  _draft = { perms: cloneJ(DEFAULT_PERMISSIONS), ovr: emptyOvr() };
  CONFIGURABLE_ROLES.forEach(r=>{
    if(ROLE_ACCESS[r.key]){
      ROLE_ACCESS[r.key].chapters = [...(DEFAULT_PERMISSIONS[r.key]||[])];
      ROLE_ACCESS[r.key].default  = 'painel';
    }
  });
  try {
    await upsertConfig(PERM_CONFIG_KEY, DEFAULT_PERMISSIONS);
    await upsertConfig(OVR_CONFIG_KEY, emptyOvr());
  } catch(e){ /* servidor indisponível — reposição só local */ }
  renderPermMatrix();
  showToast('Permissões repostas ✓');
}

export function readPermMatrixState(){ return cloneJ(draft().perms); }

const SECTION_LABELS = {
  'historico':'Folha de Ponto','fecho-mes':'Fecho do Mês','mapa-ferias':'Mapa de Férias','colaboradores':'Colaboradores',
  'compras':'Compras','faturas':'Faturas','faturas-aprovar':'Faturas por Aprovar','tesouraria':'Tesouraria',
  'equipamentos':'Equipamentos','combustivel':'Combustível','producao':'Produção','precos-unitarios':'Preços Unitários',
  'pendentes-tavira':'Pendentes Tavira','obras':'Obras','utilizadores':'Utilizadores','atividade':'Atividade',
  'empresas-moa':'Empresas MOA','fornecedores':'Fornecedores',
};

// Estado efetivo (no rascunho) de um capítulo/sub-página para um perfil (user=null) ou para uma pessoa
function chapEff(role, user, ch){
  const o = user ? draft().ovr.users[user] : null;
  const list = (o && o.chapters) || draft().perms[role] || [];
  return list.includes(ch);
}
function offList(role, user){
  const d = draft();
  const o = user ? d.ovr.users[user] : null;
  if(o && o.off) return o.off;
  return (d.ovr.roles[role]||{}).off || [];
}
function secBlockedByRole(role, sec){ return !!(SECTION_ROLES[sec] && !SECTION_ROLES[sec].includes(role)); }
function secEff(role, user, ch, sec){
  if(secBlockedByRole(role, sec)) return false;
  if(offList(role,user).includes(sec)) return false;
  if(sec==='faturas-aprovar' && role==='diretor_obra') return true;
  return chapEff(role, user, ch);
}
function secLocked(role, user, ch, sec){
  if(secBlockedByRole(role, sec)) return true;
  if(sec==='faturas-aprovar' && role==='diretor_obra') return false;
  return !chapEff(role, user, ch);
}

function visibleCols(){
  const cols = [];
  NAV_CHAPTERS.forEach(ch=>{
    cols.push({type:'chap', ch});
    if(_openChaps.has(ch.id)) ch.sections.forEach(sec=>cols.push({type:'sec', ch, sec}));
  });
  return cols;
}

function toggleCell(checked, attrs, opts={}){
  const {disabled=false, diff=false, title=''} = opts;
  return `<label class="perm-toggle${diff?' perm-diff':''}" title="${title}">
    <input type="checkbox" class="perm-chk" ${attrs} ${checked?'checked':''} ${disabled?'disabled':''} onchange="onPermChange(this)"/>
    <span class="perm-slider"></span></label>`;
}

export function renderPermMatrix(){
  const d = draft();
  const thead = document.getElementById('perm-matrix-head');
  if(!thead) return;
  const cols = visibleCols();
  thead.innerHTML = '<tr><th>Perfil</th>' + cols.map(c=>{
    if(c.type==='chap'){
      const open = _openChaps.has(c.ch.id);
      return `<th class="perm-th-chap${open?' open':''}" onclick="togglePermChapter('${c.ch.id}')" title="Ver sub-páginas"><span class="perm-caret">${open?'▾':'▸'}</span> ${c.ch.label}</th>`;
    }
    return `<th class="perm-th-sec">${SECTION_LABELS[c.sec]||c.sec}</th>`;
  }).join('') + '</tr>';

  const rows = [];
  CONFIGURABLE_ROLES.forEach(role=>{
    const users = cfgUsersOfRole(role.key);
    const open = _openRoles.has(role.key);
    const nOv = users.filter(u=>d.ovr.users[u.username] && Object.keys(d.ovr.users[u.username]).length).length;
    const cells = cols.map(c=>{
      if(c.type==='chap'){
        const on = chapEff(role.key, null, c.ch.id);
        return `<td>${toggleCell(on, `data-kind="chap" data-role="${role.key}" data-ch="${c.ch.id}"`, {title:on?'Acesso permitido':'Acesso bloqueado'})}</td>`;
      }
      const on = secEff(role.key, null, c.ch.id, c.sec);
      return `<td class="perm-sec-cell">${toggleCell(on, `data-kind="sec" data-role="${role.key}" data-ch="${c.ch.id}" data-sec="${c.sec}"`, {disabled:secLocked(role.key,null,c.ch.id,c.sec), title:on?'Sub-página permitida':'Sub-página bloqueada'})}</td>`;
    }).join('');
    rows.push(`<tr class="perm-role-row${open?' open':''}"><td onclick="togglePermRole('${role.key}')" class="perm-role-name"><span class="perm-caret">${open?'▾':'▸'}</span> ${role.label}
      <span class="perm-count">${users.length} ${users.length===1?'pessoa':'pessoas'}${nOv?` · <b>${nOv} com exceções</b>`:''}</span></td>${cells}</tr>`);
    if(open){
      if(!users.length) rows.push(`<tr class="perm-user-row"><td colspan="${cols.length+1}" class="perm-empty">Sem utilizadores neste perfil.</td></tr>`);
      users.forEach(u=>{
        const ov = d.ovr.users[u.username];
        const has = ov && Object.keys(ov).length;
        const ucells = cols.map(c=>{
          if(c.type==='chap'){
            const on = chapEff(role.key, u.username, c.ch.id);
            const diff = on !== chapEff(role.key, null, c.ch.id);
            return `<td>${toggleCell(on, `data-kind="chap" data-role="${role.key}" data-user="${u.username}" data-ch="${c.ch.id}"`, {diff, title:diff?'Difere do perfil':(on?'Acesso permitido':'Acesso bloqueado')})}</td>`;
          }
          const on = secEff(role.key, u.username, c.ch.id, c.sec);
          const diff = on !== secEff(role.key, null, c.ch.id, c.sec);
          return `<td class="perm-sec-cell">${toggleCell(on, `data-kind="sec" data-role="${role.key}" data-user="${u.username}" data-ch="${c.ch.id}" data-sec="${c.sec}"`, {disabled:secLocked(role.key,u.username,c.ch.id,c.sec), diff, title:diff?'Difere do perfil':''})}</td>`;
        }).join('');
        rows.push(`<tr class="perm-user-row${has?' perm-user-diff':''}"><td><span class="perm-user-name">${u.nome}</span>
          ${has?`<span class="perm-badge">difere do perfil</span><button type="button" class="perm-reset" onclick="resetPermUser('${u.username}')" title="Repor ao perfil">↺ Repor</button>`:''}</td>${ucells}</tr>`);
      });
    }
  });
  rows.push(`<tr style="opacity:.6"><td>Administrador <span style="font-size:10px;color:var(--gray-400);font-weight:400">(total)</span></td>${cols.map(()=>`<td><label class="perm-toggle"><input type="checkbox" checked disabled/><span class="perm-slider"></span></label></td>`).join('')}</tr>`);
  document.getElementById('perm-matrix-body').innerHTML = rows.join('');
}

export function togglePermRole(role){
  _openRoles.has(role) ? _openRoles.delete(role) : _openRoles.add(role);
  renderPermMatrix();
}
export function togglePermChapter(ch){
  _openChaps.has(ch) ? _openChaps.delete(ch) : _openChaps.add(ch);
  renderPermMatrix();
}
export function resetPermUser(username){
  delete draft().ovr.users[username];
  renderPermMatrix();
}

export function onPermChange(chk){
  const d = draft();
  const {kind, role, user, ch, sec} = chk.dataset;
  const on = chk.checked;
  if(kind==='chap'){
    const roleList = d.perms[role] || [];
    if(!user){
      d.perms[role] = on ? [...new Set([...roleList, ch])] : roleList.filter(x=>x!==ch);
    } else {
      const o = d.ovr.users[user] || (d.ovr.users[user] = {});
      const cur = o.chapters || roleList;
      const next = on ? [...new Set([...cur, ch])] : cur.filter(x=>x!==ch);
      if(sameSet(next, roleList)) delete o.chapters; else o.chapters = next;
    }
  } else if(kind==='sec'){
    const roleOff = (d.ovr.roles[role]||{}).off || [];
    if(!user){
      const next = on ? roleOff.filter(x=>x!==sec) : [...new Set([...roleOff, sec])];
      d.ovr.roles[role] = { off: next };
    } else {
      const o = d.ovr.users[user] || (d.ovr.users[user] = {});
      const cur = o.off || roleOff;
      const next = on ? cur.filter(x=>x!==sec) : [...new Set([...cur, sec])];
      if(sameSet(next, roleOff)) delete o.off; else o.off = next;
    }
  }
  renderPermMatrix();
}

export function switchUtilTab(tab, btn){
  document.querySelectorAll('.sec-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.sec-tab-pane').forEach(p=>p.classList.remove('active'));
  if(btn) btn.classList.add('active');
  document.getElementById('util-pane-'+tab)?.classList.add('active');
  const btnNovo = document.getElementById('btn-novo-utilizador');
  if(btnNovo) btnNovo.style.display = tab==='users' ? '' : 'none';
  if(tab==='perms'){ _draft = null; renderPermMatrix(); }
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

// Secções abertas a todos os perfis autenticados (não pertencem a nenhum capítulo)
const OPEN_SECTIONS = ['painel','analise','notificacoes','calendario','m-modulos','m-favoritos','m-conta','m-defs'];

// ── Verificação central de acesso ──────────────────────────────────
// Fonte única de verdade: sidebar, goTo, painel, análise e notificações usam estas funções.
// Falha "fechada": secção desconhecida ou perfil sem configuração → sem acesso (excepto admin).
// Dentro do capítulo Financeiro, cada página é só para certos perfis (fluxo das faturas)
const SECTION_ROLES = {
  'faturas':         ['admin','financeiro'],
  'tesouraria':      ['admin','financeiro'],
  'faturas-aprovar': ['admin','financeiro','diretor_obra'],
};

export function roleCanAccessSection(role, sec, username){
  if(role === 'admin') return true;
  if(SECTION_ROLES[sec] && !SECTION_ROLES[sec].includes(role)) return false;
  const uo = username ? _ovr.users[username] : null;
  const off = (uo && uo.off) || (_ovr.roles[role] && _ovr.roles[role].off) || [];
  if(off.includes(sec)) return false;
  // Faturas por aprovar: o diretor de obra acede mesmo sem o capítulo Financeiro (o RLS limita-o às faturas das suas obras)
  if(sec === 'faturas-aprovar' && role === 'diretor_obra') return true;
  if(OPEN_SECTIONS.includes(sec)) return !!role;
  const chId = chapterOfSection(sec);
  if(!chId) return false;
  if(uo && uo.chapters) return uo.chapters.includes(chId);
  const access = ROLE_ACCESS[role];
  if(!access) return false;
  return (access.chapters || []).includes(chId);
}

export function canAccessSection(sec){
  return roleCanAccessSection(S.currentUser?.role, sec, S.currentUser?.key);
}

export function applyRolePermissions(role){
  const user = S.currentUser?.key;
  const allSecs = NAV_CHAPTERS.flatMap(ch=>ch.sections);
  // repor tudo visível antes de reaplicar (necessário ao trocar de utilizador sem recarregar a página)
  document.querySelectorAll('.nav-lbl[data-grp],.nav-group[data-grp],.bnav-btn[onclick],.settings-item[onclick*="goTo("]').forEach(el=>{ el.style.display=''; });
  allSecs.forEach(sec=>{ document.querySelectorAll(`.nav-btn[onclick*="goTo('${sec}'"]`).forEach(el=>{ el.style.display=''; }); });
  if(role === 'admin') return; // admin vê tudo
  if(!ROLE_ACCESS[role]) return;
  // Esconder capítulos inteiros (grupo + toggle) sem nenhuma página permitida
  NAV_CHAPTERS.forEach(ch=>{
    if(ch.sections.some(sec=>roleCanAccessSection(role, sec, user))) return;
    document.querySelectorAll('.nav-lbl[data-grp="'+ch.id+'"],.nav-group[data-grp="'+ch.id+'"]').forEach(el=>{ el.style.display='none'; });
  });
  // Esconder páginas individuais não permitidas (perfil, pessoa ou sub-página)
  allSecs.forEach(sec=>{
    if(roleCanAccessSection(role, sec, user)) return;
    document.querySelectorAll(`.nav-btn[onclick*="goTo('${sec}'"]`).forEach(el=>{ el.style.display='none'; });
  });
  // Esconder atalhos da barra de navegação inferior (mobile) e das definições cuja página não é permitida
  document.querySelectorAll('.bnav-btn[onclick],.settings-item[onclick*="goTo("]').forEach(btn=>{
    const m = btn.getAttribute('onclick').match(/goTo\('([^']+)'/);
    const sec = m && m[1];
    if(sec && allSecs.includes(sec) && !roleCanAccessSection(role, sec, user)) btn.style.display='none';
  });
}
