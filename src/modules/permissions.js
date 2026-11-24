// ═══════════════════════════════════════
//  PERMISSÕES DE ACESSO
// ═══════════════════════════════════════
import { ROLE_ACCESS, NAV_CHAPTERS, ROLE_LABELS } from '../config.js';
import { showToast } from './navigation.js';
import { sb } from '../supabase.js';
import { S } from '../state.js';

// Chave (linha) na tabela app_config onde a matriz de permissões é partilhada entre dispositivos
const PERM_CONFIG_KEY = 'role_permissions';

// O perfil Administrador também se configura; só a conta «admin» (SUPER_USER) vê sempre tudo, aqui e no servidor
export const SUPER_USER = 'admin';
const CONFIGURABLE_ROLES = [
  {key:'admin',        label:'Administrador'},
  {key:'diretor_obra', label:'Diretor de Obra'},
  {key:'compras',      label:'Compras'},
  {key:'financeiro',   label:'Financeiro'},
];

const DEFAULT_PERMISSIONS = {
  admin:        ['rh','cmp','fin','log','prod','def'],
  diretor_obra: ['rh','cmp','fin','log','prod'],
  compras:      ['cmp'],
  financeiro:   ['fin','cmp'],
};

// v2: granularidade por capítulo (rh/cmp/fin/log/prod/def) em vez de por secção individual
const PERM_STORAGE_KEY = 'plandese_role_permissions_v2';

export function loadPermissions(){
  try {
    const raw = localStorage.getItem(PERM_STORAGE_KEY);
    if(raw) return { ...JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS)), ...JSON.parse(raw) };
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
// Sub-páginas fechadas por omissão a um perfil, enquanto o administrador não as abrir na matriz
// (o diretor de obra só vê "Faturas por aprovar"; as restantes do Financeiro são dadas caso a caso)
// (Estrutura Central e as páginas do circuito das faturas ficam fechadas por omissão a quem não é da área financeira)
const DEFAULT_ROLE_OFF = { diretor_obra:['faturas','tesouraria','estrutura-central'], compras:['faturas','tesouraria','faturas-aprovar','estrutura-central'] };
const roleOffOf = (ovr, role) => (ovr.roles[role] && ovr.roles[role].off) || DEFAULT_ROLE_OFF[role] || [];
// Todas as páginas se gerem na matriz. Além das páginas dos capítulos (capítulo ligado e página não fechada) há:
//  • PAG_ABERTAS — ligadas a todos por omissão; desligam-se pondo a página em «off»
//  • PAG_LIVRES  — não dependem de capítulo; ligam-se pondo a página em «on» (roles.<role>.on / users.<u>.on,
//                  a da pessoa substitui a do perfil, como «off»). No servidor: fn_pag_on(página).
export const PAG_ABERTAS = ['painel','calendario','notificacoes','ponto-escritorio'];
export const PAG_LIVRES  = ['balanco-fat','carteira','telas-finais','fornecedores','planos-trabalho','guias-teste','compras-teste'];
// o perfil Administrador tem todas as páginas livres ligadas por omissão
const DEFAULT_ROLE_ON = { admin: PAG_LIVRES };
const roleOnOf = (ovr, role) => (ovr.roles[role] && ovr.roles[role].on) || DEFAULT_ROLE_ON[role] || [];
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
    .filter(([username,u])=>u.role===role && username!==SUPER_USER)
    .map(([username,u])=>({username, nome:u.nome||username}))
    .sort((a,b)=>a.nome.localeCompare(b.nome,'pt'))
    // duas contas com o mesmo nome: mostra também o utilizador
    .map((u,_,a)=>a.filter(x=>x.nome===u.nome).length>1 ? { ...u, nome:`${u.nome} (${u.username})` } : u);
}

async function upsertConfig(key, value){
  const { error } = await sb.from('app_config').upsert(
    { key, value, updated_at: new Date().toISOString() }, { onConflict:'key' });
  if(error) throw error;
}

function normalizeOvr(o){
  // perfis com lista predefinida guardam sempre a lista (mesmo vazia), senão voltavam a fechar
  Object.keys(o.roles).forEach(r=>{
    if(o.roles[r].on && !o.roles[r].on.length && !DEFAULT_ROLE_ON[r]) delete o.roles[r].on;
    if(!o.roles[r].on && !(o.roles[r].off||[]).length && !DEFAULT_ROLE_OFF[r] && !DEFAULT_ROLE_ON[r]) delete o.roles[r];
  });
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
  showToast(serverOk ? 'Permissões guardadas ✓' : '⚠️ Guardado localmente — falhou no servidor');
  if(S.currentUser) applyRolePermissions(S.currentUser.role);
  // o rascunho passa a ser o estado guardado
  d.ovr = cloneJ(ovr);
  _paSnap = '';
  renderPermMatrix();
}

export async function resetPermissions(){
  if(!confirm('Repor todas as permissões para os valores predefinidos? Isto remove também as exceções por pessoa e por sub-página, e as páginas fora dos capítulos (Clientes, Telas Finais, Planos de Trabalho, testes…) ficam só para o administrador.')) return;
  try { localStorage.removeItem(PERM_STORAGE_KEY); localStorage.removeItem(OVR_STORAGE_KEY); } catch(e){}
  _ovr = emptyOvr();
  _draft = { perms: cloneJ(DEFAULT_PERMISSIONS), ovr: emptyOvr() };
  _paSnap = '';
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

// Estado efetivo (no rascunho) de um capítulo/página para um perfil (user=null) ou para uma pessoa
function chapEff(role, user, ch){
  const o = user ? draft().ovr.users[user] : null;
  const list = (o && o.chapters) || draft().perms[role] || [];
  return list.includes(ch);
}
function offList(role, user){
  const d = draft();
  const o = user ? d.ovr.users[user] : null;
  if(o && o.off) return o.off;
  return roleOffOf(d.ovr, role);
}
function onList(role, user){
  const d = draft();
  const o = user ? d.ovr.users[user] : null;
  if(o && o.on) return o.on;
  return roleOnOf(d.ovr, role);
}
function secEff(role, user, ch, sec){
  if(offList(role,user).includes(sec)) return false;
  if(PAG_ABERTAS.includes(sec)) return true;
  if(PAG_LIVRES.includes(sec)) return onList(role,user).includes(sec);
  if(sec==='faturas-aprovar' && role==='diretor_obra') return true;
  return chapEff(role, user, ch);
}

// ═══════════════════════════════════════════════════════════════════
//  SEPARADOR «PERMISSÕES DE ACESSO»
//  As páginas aparecem como no menu (mesmos nomes e grupos) e cada perfil tem um interruptor por página.
//  O que se guarda é o mesmo de sempre: capítulos por perfil (role_permissions), páginas fechadas por perfil
//  e exceções por pessoa (access_overrides) e as listas de pessoas (telas_finais_acesso, clientes_acesso).
//  Ligar uma página de um capítulo fechado abre o capítulo só com essa página; desligar a última página
//  aberta fecha o capítulo (o servidor, fn_cap, deixa de dar os dados desse capítulo).
// ═══════════════════════════════════════════════════════════════════
// Todas as páginas têm interruptor por perfil e exceções por pessoa (ver PAG_ABERTAS / PAG_LIVRES).
const MENU_ACESSOS = [
  { label:'Geral', paginas:[
    { sec:'painel', label:'Painel Principal' },
    { sec:'calendario', label:'Calendário' },
    { sec:'notificacoes', label:'Notificações' },
  ]},
  { ch:'rh', label:'Recursos Humanos', paginas:[
    { sec:'historico', label:'Folha de Ponto' },
    { sec:'fecho-mes', label:'Folha de Fecho' },
    { sec:'mapa-ferias', label:'Mapa de Férias' },
    { sec:'ponto-escritorio', label:'Folha de Ponto (escritório)' },
    { sec:'colaboradores', label:'Colaboradores' },
    { sec:'empresas-moa', label:'Mão de Obra Aluguer' },
  ]},
  { ch:'cmp', label:'Compras', paginas:[
    { sec:'compras', label:'Pedidos de compra' },
    { sec:'necessidades', label:'Necessidades de obra' },
    { sec:'fornecedores', label:'Lista de Fornecedores' },
  ]},
  { ch:'fin', label:'Financeiro', paginas:[
    { sub:'Fornecedores' },
    { sec:'faturas', label:'Inserção de Faturas' },
    { sec:'faturas-aprovar', label:'Faturas Por Aprovar' },
    { sec:'tesouraria', label:'Tesouraria' },
    { sub:'Clientes' },
    { sec:'balanco-fat', label:'Balanço de Faturação' },
    { sec:'carteira', label:'Carteira de Encomendas' },
    { sub:'Estrutura Central' },
    { sec:'estrutura-central', label:'Faturas da Estrutura Central' },
  ]},
  { ch:'log', label:'Equipamentos', paginas:[
    { sec:'equipamentos', label:'Equipamentos' },
    { sec:'combustivel', label:'Registos de Combustível' },
  ]},
  { ch:'prod', label:'Produção', paginas:[
    { sec:'producao', label:'Controlo de Obras' },
    { sec:'existencias', label:'Existências' },
    { sec:'precos-unitarios', label:'Lista de Preços' },
    { sec:'pendentes-tavira', label:'Pós Venda' },
    { sec:'telas-finais', label:'Telas Finais' },
  ]},
  { ch:'def', label:'Definições', paginas:[
    { sec:'obras', label:'Adicionar obra' },
    { sec:'utilizadores', label:'Gerir utilizadores' },
    { sec:'atividade', label:'Histórico de atividade' },
    { sec:'planos-trabalho', label:'Planos de Trabalho' },
    { sec:'guias-teste', label:'Guias de Remessa (teste)' },
    { sec:'compras-teste', label:'Compras (teste)' },
  ]},
];
const _paFechados = new Set();   // grupos recolhidos no ecrã
let _paSnap = '';                // estado guardado (para avisar de alterações por guardar)
let _paQ = '';

const roleLabel = r => (CONFIGURABLE_ROLES.find(x=>x.key===r)||{}).label || r;
const nomeDe = u => (S.USERS?.[u]?.nome) || u;
const escP = t => String(t==null?'':t).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// páginas que dependem do capítulo (as abertas a todos e as que não dependem de capítulo não contam)
const paginasCap = ch => (NAV_CHAPTERS.find(c=>c.id===ch)?.sections || []).filter(s => !PAG_ABERTAS.includes(s) && !PAG_LIVRES.includes(s) && s !== 'guias');
const solta = sec => PAG_ABERTAS.includes(sec) || PAG_LIVRES.includes(sec);

// Forma canónica do rascunho (para saber se há alterações): a ordem das listas não conta e a lista de páginas
// fechadas de um perfil igual à predefinida vale o mesmo que não a ter
function estadoGuardavel(){
  const d = draft();
  const srt = a => [...(a||[])].sort();
  const perms = {}; Object.keys(d.perms).sort().forEach(r => { perms[r] = srt(d.perms[r]); });
  const roles = {}; Object.keys(d.ovr.roles).sort().forEach(r => {
    const c = {}, off = srt(d.ovr.roles[r].off), on = srt(d.ovr.roles[r].on);
    if(d.ovr.roles[r].off && !sameSet(off, DEFAULT_ROLE_OFF[r] || [])) c.off = off;
    if(d.ovr.roles[r].on && !sameSet(on, DEFAULT_ROLE_ON[r] || [])) c.on = on;
    if(Object.keys(c).length) roles[r] = c;
  });
  const users = {}; Object.keys(d.ovr.users).sort().forEach(u => {
    const o = d.ovr.users[u], c = {};
    if(o.chapters) c.chapters = srt(o.chapters);
    if(o.off) c.off = srt(o.off);
    if(o.on) c.on = srt(o.on);
    if(Object.keys(c).length) users[u] = c;
  });
  return JSON.stringify({ perms, roles, users });
}
// grava capítulos / off / on de um perfil (user=null) ou de uma pessoa (só o que difere do perfil)
function gravarAcesso(role, user, { chs, off, on }){
  const d = draft();
  if(!user){
    const r = d.ovr.roles[role] = { ...(d.ovr.roles[role] || {}) };
    if(chs) d.perms[role] = chs;
    if(off) r.off = off;
    if(on) r.on = on;
    return;
  }
  const ou = d.ovr.users[user] || (d.ovr.users[user] = {});
  if(chs){ if(sameSet(chs, d.perms[role] || [])) delete ou.chapters; else ou.chapters = chs; }
  if(off){ if(sameSet(off, roleOffOf(d.ovr, role))) delete ou.off; else ou.off = off; }
  if(on){ if(sameSet(on, roleOnOf(d.ovr, role))) delete ou.on; else ou.on = on; }
  if(!Object.keys(ou).length) delete d.ovr.users[user];
}
// Páginas que não dependem de capítulo: as abertas (só «off») e as livres («on»)
function setPaginaSolta(role, user, sec, ligar){
  let off = offList(role, user).filter(s => s !== sec), on = [...onList(role, user)];
  if(PAG_ABERTAS.includes(sec)){ if(!ligar) off.push(sec); gravarAcesso(role, user, { off }); return; }
  on = ligar ? [...new Set([...on, sec])] : on.filter(s => s !== sec);
  gravarAcesso(role, user, { off, on });
}

// Liga/desliga uma página para um perfil (user=null) ou para uma pessoa (exceção)
function setPagina(role, user, ch, sec, on){
  if(solta(sec)) return setPaginaSolta(role, user, sec, on);
  const d = draft();
  const roleChs = d.perms[role] || [], roleOff = roleOffOf(d.ovr, role);
  const o = user ? (d.ovr.users[user] || {}) : null;
  let chs = [...((o && o.chapters) || roleChs)];
  let off = [...((o && o.off) || roleOff)];
  const pags = paginasCap(ch);
  if(on){
    if(!chs.includes(ch)){
      chs.push(ch);
      off = [...new Set([...off, ...pags.filter(s => s !== sec)])];   // abre o capítulo só com esta página
    }
    off = off.filter(s => s !== sec);
  } else {
    off = [...new Set([...off, sec])];
    // sem nenhuma página aberta, o capítulo fecha (e a lista fica limpa)
    // (Faturas por aprovar conta: o diretor tem o capítulo Financeiro por omissão só com ela e não se lho tira sem querer)
    const aberta = s => !off.includes(s);
    if(chs.includes(ch) && !pags.some(aberta)){ chs = chs.filter(c => c !== ch); off = off.filter(s => !pags.includes(s) || (s==='faturas-aprovar' && role==='diretor_obra')); }
  }
  gravarAcesso(role, user, { chs, off });
}
// Liga/desliga todas as páginas de um grupo do menu para um perfil (ou pessoa): o capítulo e as páginas soltas
function setGrupo(role, user, gi, on){
  const g = MENU_ACESSOS[gi];
  if(g.ch) setCapitulo(role, user, g.ch, on);
  g.paginas.forEach(p => { if(p.sec && solta(p.sec)) setPaginaSolta(role, user, p.sec, on); });
}
// Liga/desliga todas as páginas de um capítulo para um perfil (ou pessoa)
function setCapitulo(role, user, ch, on){
  const d = draft();
  const roleChs = d.perms[role] || [], roleOff = roleOffOf(d.ovr, role);
  const o = user ? (d.ovr.users[user] || {}) : null;
  let chs = [...((o && o.chapters) || roleChs)];
  let off = [...((o && o.off) || roleOff)];
  const pags = paginasCap(ch);
  if(on){ if(!chs.includes(ch)) chs.push(ch); off = off.filter(s => !pags.includes(s)); }
  else { chs = chs.filter(c => c !== ch); off = off.filter(s => !pags.includes(s)); if(role==='diretor_obra' && pags.includes('faturas-aprovar')) off.push('faturas-aprovar'); }
  gravarAcesso(role, user, { chs, off });
}
// estado de um grupo para um perfil/pessoa: 'on' | 'mix' | 'off' | null (sem páginas editáveis)
function estadoGrupo(g, role, user){
  const ps = g.paginas.filter(p => p.sec);
  if(!ps.length) return null;
  const n = ps.filter(p => secEff(role, user, g.ch, p.sec)).length;
  return n === ps.length ? 'on' : n ? 'mix' : 'off';
}
// pessoas do perfil cuja página difere do perfil
function excecoes(role, ch, sec){
  return cfgUsersOfRole(role).filter(u => secEff(role, u.username, ch, sec) !== secEff(role, null, ch, sec));
}
// páginas (rótulos) em que a pessoa difere do perfil
function diferencasPessoa(role, user){
  const out = [];
  MENU_ACESSOS.forEach(g => g.paginas.forEach(p => {
    if(!p.sec) return;
    const a = secEff(role, user, g.ch, p.sec), b = secEff(role, null, g.ch, p.sec);
    if(a !== b) out.push({ label:p.label, on:a });
  }));
  return out;
}

// interruptor: on = true/'on' (ligado), 'mix' (parcial), false/'off' (desligado)
const sw = (on, attrs, title='') => {
  const lig = on === true || on === 'on', mix = on === 'mix';
  return `<button type="button" class="pa-sw ${mix?'mix':lig?'on':''}" ${attrs} aria-pressed="${lig}" title="${escP(title)}"><i></i></button>`;
};

export function renderPermMatrix(){
  const box = document.getElementById('perm-acessos');
  if(!box) return;
  const d = draft();
  if(!_paSnap) _paSnap = estadoGuardavel();
  const roles = CONFIGURABLE_ROLES;
  const q = _paQ.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  const bate = p => !q || (p.label||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').includes(q);
  const nExc = Object.keys(d.ovr.users).filter(u => S.USERS?.[u] && CONFIGURABLE_ROLES.some(r => r.key === S.USERS[u].role) && diferencasPessoa(S.USERS[u].role, u).length).length;
  const linhas = [];
  MENU_ACESSOS.forEach((g, gi) => {
    const pags = g.paginas.filter(p => p.sub || bate(p));
    if(q && !pags.some(p => p.sec)) return;
    const fechado = !q && _paFechados.has(gi);
    linhas.push(`<tr class="pa-g"><td><button type="button" class="pa-g-b" data-pa="grp" data-gi="${gi}"><span class="pa-car">${fechado?'▸':'▾'}</span>${escP(g.label)}</button></td>${roles.map(r => {
      const st = estadoGrupo(g, r.key, null);
      return `<td>${st ? sw(st, `data-pa="cap" data-role="${r.key}" data-gi="${gi}"`, st==='on'?'Todas as páginas ligadas — clique para desligar o capítulo':st==='mix'?'Algumas páginas ligadas — clique para ligar todas':'Capítulo desligado — clique para ligar todas as páginas') : ''}</td>`;
    }).join('')}</tr>`);
    if(fechado) return;
    pags.forEach((p, k) => {
      if(p.sub){ if(pags.slice(k+1).some(x => x.sec && !x.sub) && !(pags[k+1]||{}).sub) linhas.push(`<tr class="pa-sg"><td colspan="${roles.length+1}">${escP(p.sub)}</td></tr>`); return; }
      linhas.push(`<tr class="pa-p"><td>${escP(p.label)}</td>${roles.map(r => {
        const on = secEff(r.key, null, g.ch, p.sec);
        const ex = excecoes(r.key, g.ch, p.sec);
        return `<td><span class="pa-c">${sw(on, `data-pa="pag" data-role="${r.key}" data-ch="${g.ch}" data-sec="${p.sec}"`, on?'Ligada para o perfil':'Desligada para o perfil')}${ex.length ? `<button type="button" class="pa-exc" data-pa="exc" data-role="${r.key}" data-ch="${g.ch}" data-sec="${p.sec}" title="${escP(ex.map(u=>u.nome).join(', '))}">${ex.length} ${ex.length===1?'exceção':'exceções'}</button>` : `<button type="button" class="pa-exc vazio" data-pa="exc" data-role="${r.key}" data-ch="${g.ch}" data-sec="${p.sec}" title="Dar ou tirar só a algumas pessoas">pessoas</button>`}</span></td>`;
      }).join('')}</tr>`);
    });
  });
  const mudou = estadoGuardavel() !== _paSnap;
  box.innerHTML = `
    <div class="pa-top">
      <div class="pa-top-tx">
        <b>Quem vê cada página</b>
        <span>As páginas estão organizadas como no menu. Ligue ou desligue por perfil; em «pessoas» dá ou tira a uma pessoa só. A conta «admin» vê sempre tudo. As alterações aplicam-se no próximo início de sessão de cada pessoa.</span>
      </div>
      <div class="pa-top-ac">
        <input type="search" class="pa-q" id="pa-q" placeholder="Procurar página…" value="${escP(_paQ)}" autocomplete="off"/>
        <button type="button" class="pa-chip ${nExc?'warn':''}" data-pa="todas-exc">${nExc ? `${nExc} ${nExc===1?'pessoa':'pessoas'} com exceções` : 'Sem exceções por pessoa'}</button>
        <button type="button" class="pa-chip" data-pa="repor" title="Repor permissões predefinidas">Repor predefinições</button>
      </div>
    </div>
    <div class="pa-wrap"><table class="pa-t">
      <thead><tr><th>Página</th>${roles.map(r => { const n = cfgUsersOfRole(r.key).length; return `<th><button type="button" class="pa-th" data-pa="perfil" data-role="${r.key}" title="Ver as pessoas deste perfil">${escP(r.label)}<small>${n} ${n===1?'pessoa':'pessoas'}</small></button></th>`; }).join('')}</tr></thead>
      <tbody>${linhas.join('') || `<tr><td colspan="${roles.length+1}" class="pa-vazio">Nenhuma página com «${escP(_paQ)}».</td></tr>`}</tbody>
    </table></div>
    <p class="pa-nota">Encarregados: usam a app do encarregado; os módulos de cada um escolhem-se em <b>Utilizadores → Editar</b>.</p>
    <div class="pa-bar ${mudou?'mudou':''}">
      <span class="pa-bar-tx">${mudou ? 'Há alterações por guardar' : 'Sem alterações por guardar'}</span>
      <button type="button" class="pa-btn sec" data-pa="descartar" ${mudou?'':'hidden'}>Descartar</button>
      <button type="button" class="pa-btn pri" data-pa="guardar">Guardar permissões</button>
    </div>`;
  ligarPA(box);
  if(document.getElementById('perm-drawer')?.classList.contains('open')) _paRedesenharGaveta?.();
}

function ligarPA(box){
  if(box._paOk) return; box._paOk = true;
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-pa]'); if(!b) return;
    const { pa, role, ch, sec, gi } = b.dataset;
    if(pa==='grp'){ const i = +gi; _paFechados.has(i) ? _paFechados.delete(i) : _paFechados.add(i); return renderPermMatrix(); }
    if(pa==='pag'){ setPagina(role, null, ch, sec, !b.classList.contains('on')); return renderPermMatrix(); }
    if(pa==='cap'){ setGrupo(role, null, +gi, !b.classList.contains('on')); return renderPermMatrix(); }
    if(pa==='exc') return gavetaPagina(role, ch, sec);
    if(pa==='perfil') return gavetaPerfil(role);
    if(pa==='todas-exc') return gavetaExcecoes();
    if(pa==='repor') return resetPermissions();
    if(pa==='guardar') return savePermissions();
    if(pa==='descartar'){ _draft = null; _paSnap = ''; return renderPermMatrix(); }
  });
  box.addEventListener('input', e => {
    if(e.target.id !== 'pa-q') return;
    _paQ = e.target.value;
    const pos = e.target.selectionStart;
    renderPermMatrix();
    const i = document.getElementById('pa-q'); if(i){ i.focus(); try{ i.setSelectionRange(pos, pos); }catch(_){} }
  });
}

// ── Painel lateral ──
let _paRedesenharGaveta = null;
function gavetaPA(sup, titulo, sub, corpo, aoClicar){
  let dr = document.getElementById('perm-drawer');
  if(!dr){
    document.body.insertAdjacentHTML('beforeend', '<div class="d-scrim" id="perm-scrim"></div><aside class="d-drawer pa-drawer" id="perm-drawer" aria-hidden="true"></aside>');
    dr = document.getElementById('perm-drawer');
    document.getElementById('perm-scrim').addEventListener('click', fecharGavetaPA);
    document.addEventListener('keydown', e => { if(e.key==='Escape' && dr.classList.contains('open')) fecharGavetaPA(); });
    dr.addEventListener('click', e => { if(e.target.closest('[data-g="fechar"]')) return fecharGavetaPA(); dr._aoClicar?.(e); });
  }
  const desenhar = () => {
    const c = typeof corpo === 'function' ? corpo() : corpo;
    const y = dr.querySelector('.dd-b')?.scrollTop || 0;
    dr.innerHTML = `<div class="dd-h"><button class="dd-x" data-g="fechar" aria-label="Fechar">✕</button><small>${escP(sup)}</small><h2>${escP(typeof titulo==='function'?titulo():titulo)}</h2>${sub?`<p>${escP(typeof sub==='function'?sub():sub)}</p>`:''}</div>
      <div class="dd-b">${c}</div>
      <div class="dd-f"><button type="button" class="btn btn-primary" data-g="fechar">Feito</button></div>`;
    const b = dr.querySelector('.dd-b'); if(b) b.scrollTop = y;
  };
  dr._aoClicar = aoClicar;
  _paRedesenharGaveta = desenhar;
  desenhar();
  requestAnimationFrame(() => { dr.classList.add('open'); document.getElementById('perm-scrim').classList.add('open'); });
}
function fecharGavetaPA(){
  document.getElementById('perm-drawer')?.classList.remove('open');
  document.getElementById('perm-scrim')?.classList.remove('open');
  _paRedesenharGaveta = null;
}
const iniciais = n => String(n||'').split(/\s+/).filter(Boolean).map(w=>w[0]).slice(0,2).join('').toUpperCase();

// Uma página × um perfil: cada pessoa do perfil, com exceção
function gavetaPagina(role, ch, sec){
  const p = MENU_ACESSOS.flatMap(g=>g.paginas).find(x=>x.sec===sec) || { label:sec };
  gavetaPA(roleLabel(role), p.label, () => `Ligada para o perfil: ${secEff(role,null,ch,sec)?'sim':'não'}`, () => {
    const us = cfgUsersOfRole(role);
    if(!us.length) return '<div class="dd-vazio">Não há pessoas com este perfil.</div>';
    return `<p class="pa-dnota">Por omissão cada pessoa segue o perfil. Ligue ou desligue para dar ou tirar esta página só a essa pessoa.</p>` + us.map(u => {
      const on = secEff(role, u.username, ch, sec), dif = on !== secEff(role, null, ch, sec);
      return `<div class="pa-dl ${dif?'dif':''}"><span class="d-rav">${escP(iniciais(u.nome))}</span><div class="pa-dl-tx"><b>${escP(u.nome)}</b><small>${dif ? (on?'Exceção: tem acesso':'Exceção: sem acesso') : 'Segue o perfil'}</small></div>${dif?`<button type="button" class="pa-lnk" data-r="repor-pag" data-u="${u.username}">Repor</button>`:''}${sw(on, `data-r="pag" data-u="${u.username}"`)}</div>`;
    }).join('');
  }, e => {
    const b = e.target.closest('[data-r]'); if(!b) return;
    const u = b.dataset.u;
    if(b.dataset.r==='pag') setPagina(role, u, ch, sec, !b.classList.contains('on'));
    if(b.dataset.r==='repor-pag') setPagina(role, u, ch, sec, secEff(role, null, ch, sec));
    renderPermMatrix();
  });
}

// Um perfil: as pessoas e as suas exceções
function gavetaPerfil(role){
  gavetaPA('Perfil', roleLabel(role), () => `${cfgUsersOfRole(role).length} pessoas`, () => {
    const us = cfgUsersOfRole(role);
    if(!us.length) return '<div class="dd-vazio">Não há pessoas com este perfil.</div>';
    return `<p class="pa-dnota">Clique numa pessoa para ver tudo o que ela vê e dar-lhe exceções.</p>` + us.map(u => {
      const dif = diferencasPessoa(role, u.username);
      return `<button type="button" class="pa-dl pa-dl-b ${dif.length?'dif':''}" data-r="pessoa" data-u="${u.username}"><span class="d-rav">${escP(iniciais(u.nome))}</span><div class="pa-dl-tx"><b>${escP(u.nome)}</b><small>${dif.length ? dif.map(x=>(x.on?'+ ':'− ')+x.label).join(' · ') : 'Igual ao perfil'}</small></div><span class="pa-car">›</span></button>`;
    }).join('');
  }, e => { const b = e.target.closest('[data-r="pessoa"]'); if(b) gavetaPessoa(b.dataset.u); });
}

// Uma pessoa: todas as páginas, como no menu
function gavetaPessoa(user){
  const role = S.USERS?.[user]?.role;
  if(user === SUPER_USER || !CONFIGURABLE_ROLES.some(r => r.key === role)) return showToast('Este perfil não se configura aqui');
  gavetaPA(roleLabel(role), nomeDe(user), () => { const n = diferencasPessoa(role, user).length; return n ? `${n} ${n===1?'exceção':'exceções'} ao perfil` : 'Igual ao perfil'; }, () => {
    const d = draft(), tem = d.ovr.users[user] && Object.keys(d.ovr.users[user]).length;
    let h = tem ? `<button type="button" class="pa-btn sec pa-repor" data-r="repor">Repor ao perfil (tirar todas as exceções)</button>` : '';
    MENU_ACESSOS.forEach(g => {
      const ps = g.paginas.filter(p => p.sec);
      h += `<h4>${escP(g.label)}</h4>`;
      ps.forEach(p => {
        const on = secEff(role, user, g.ch, p.sec), dif = on !== secEff(role, null, g.ch, p.sec);
        const dir = `${dif?`<span class="pa-pill warn">exceção</span>`:''}${sw(on, `data-r="pag" data-ch="${g.ch||''}" data-sec="${p.sec}"`)}`;
        h += `<div class="pa-dp"><span>${escP(p.label)}</span><span class="pa-dp-d">${dir}</span></div>`;
      });
    });
    return h;
  }, e => {
    const b = e.target.closest('[data-r]'); if(!b) return;
    const d = draft();
    if(b.dataset.r==='pag') setPagina(role, user, b.dataset.ch, b.dataset.sec, !b.classList.contains('on'));
    if(b.dataset.r==='repor') delete d.ovr.users[user];
    renderPermMatrix();
  });
}

// Todas as pessoas com exceções
function gavetaExcecoes(){
  gavetaPA('Permissões de acesso', 'Pessoas com exceções', 'Diferenças em relação ao perfil de cada uma', () => {
    const d = draft();
    const us = Object.keys(S.USERS||{}).filter(u => CONFIGURABLE_ROLES.some(r => r.key === S.USERS[u].role) && d.ovr.users[u] && diferencasPessoa(S.USERS[u].role, u).length)
      .sort((a,b) => nomeDe(a).localeCompare(nomeDe(b), 'pt'));
    if(!us.length) return '<div class="dd-vazio">Ninguém tem exceções: todas as pessoas seguem o seu perfil.</div>';
    return us.map(u => {
      const role = S.USERS[u].role, dif = diferencasPessoa(role, u);
      return `<div class="pa-dl dif"><span class="d-rav">${escP(iniciais(nomeDe(u)))}</span><button type="button" class="pa-dl-tx pa-dl-bt" data-r="pessoa" data-u="${u}"><b>${escP(nomeDe(u))} <span class="pa-mute">· ${escP(roleLabel(role))}</span></b><small>${dif.map(x=>(x.on?'+ ':'− ')+x.label).join(' · ')}</small></button><button type="button" class="pa-lnk" data-r="repor" data-u="${u}">Repor</button></div>`;
    }).join('');
  }, e => {
    const b = e.target.closest('[data-r]'); if(!b) return;
    if(b.dataset.r==='pessoa') return gavetaPessoa(b.dataset.u);
    if(b.dataset.r==='repor'){ delete draft().ovr.users[b.dataset.u]; renderPermMatrix(); }
  });
}

// Compatibilidade com os handlers antigos (já não usados pelo separador)
export function togglePermRole(){ renderPermMatrix(); }
export function togglePermChapter(){ renderPermMatrix(); }
export function resetPermUser(username){ delete draft().ovr.users[username]; renderPermMatrix(); }
export function onPermChange(){ renderPermMatrix(); }

export function switchUtilTab(tab, btn){
  document.querySelectorAll('.sec-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.sec-tab-pane').forEach(p=>p.classList.remove('active'));
  if(btn) btn.classList.add('active');
  document.getElementById('util-pane-'+tab)?.classList.add('active');
  const btnNovo = document.getElementById('btn-novo-utilizador');
  if(btnNovo) btnNovo.style.display = tab==='users' ? '' : 'none';
  if(tab==='perms'){ _draft = null; _paSnap = ''; renderPermMatrix(); }
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
// Dentro do capítulo Financeiro, cada página é só para certos perfis (fluxo das faturas);
// o diretor de obra pode recebê-las do administrador na matriz (DEFAULT_ROLE_OFF fecha-as por omissão)
// (as antigas regras fixas por perfil passaram a predefinições da matriz: DEFAULT_ROLE_OFF)
const SECTION_ROLES = {
  'guias':           ['admin'],   // secção antiga das guias (sem botão no menu): só o administrador
};

export function roleCanAccessSection(role, sec, username){
  if(username === SUPER_USER) return true;
  if(!role) return false;
  if(SECTION_ROLES[sec] && !SECTION_ROLES[sec].includes(role)) return false;
  const uo = username ? _ovr.users[username] : null;
  const off = (uo && uo.off) || roleOffOf(_ovr, role);
  if(off.includes(sec)) return false;
  // Páginas abertas a todos por omissão (ponto do escritório: cada pessoa a sua folha; o RLS limita o que cada um vê)
  if(PAG_ABERTAS.includes(sec)) return role !== 'encarregado' || sec !== 'ponto-escritorio';
  if(OPEN_SECTIONS.includes(sec)) return true;
  // Páginas fora dos capítulos: só quem as tem ligadas (o servidor decide o mesmo com fn_pag_on)
  if(PAG_LIVRES.includes(sec)) return ((uo && uo.on) || roleOnOf(_ovr, role)).includes(sec);
  // Faturas por aprovar: o diretor de obra acede mesmo sem o capítulo Financeiro (o RLS limita-o às faturas das suas obras)
  if(sec === 'faturas-aprovar' && role === 'diretor_obra') return true;
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

// secção de um botão do menu: data-sec ou o goTo('…') do onclick
const secDoBotao = el => el.dataset.sec || ((el.getAttribute('onclick') || '').match(/goTo\('([^']+)'/) || [])[1] || null;

export function applyRolePermissions(role){
  const user = S.currentUser?.key;
  const pode = sec => roleCanAccessSection(role, sec, user);
  // páginas do menu (incluindo as que não dependem de capítulo, marcadas com data-sec)
  document.querySelectorAll('.sidebar .nav-btn').forEach(el => {
    const sec = secDoBotao(el); if(!sec) return;
    el.style.display = pode(sec) ? '' : 'none';
  });
  // sub-capítulos: Clientes e Estrutura Central somem por inteiro (título incluído) sem nenhuma página
  document.querySelectorAll('.nav-sub[data-sub="cli"],.nav-subgrp[data-sub="cli"]').forEach(el => { el.style.display = (pode('balanco-fat') || pode('carteira')) ? '' : 'none'; });
  document.querySelectorAll('.nav-sub[data-sub="estc"],.nav-subgrp[data-sub="estc"]').forEach(el => { el.style.display = pode('estrutura-central') ? '' : 'none'; });
  // capítulos (grupo + título) sem nenhuma página visível
  document.querySelectorAll('.sidebar .nav-group[data-grp]').forEach(gr => {
    const algum = [...gr.querySelectorAll('.nav-btn')].some(el => { const sec = secDoBotao(el); return sec ? pode(sec) : el.style.display !== 'none'; });
    gr.style.display = algum ? '' : 'none';
    document.querySelectorAll('.nav-lbl[data-grp="'+gr.dataset.grp+'"]').forEach(el => { el.style.display = algum ? '' : 'none'; });
  });
  // atalhos da barra de navegação inferior (mobile) e das definições cuja página não é permitida
  document.querySelectorAll('.bnav-btn[onclick],.settings-item[onclick*="goTo("]').forEach(btn=>{
    const m = btn.getAttribute('onclick').match(/goTo\('([^']+)'/);
    const sec = m && m[1];
    btn.style.display = sec && !sec.startsWith('m-') && sec !== 'analise' && !pode(sec) ? 'none' : '';
  });
}
