// ═══════════════════════════════════════
//  AUTH — Login/Logout e Device Detection
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S, R } from '../state.js';
import { USERS_BASE, ROLE_LABELS } from '../config.js';

export function mostrarDiag(msg, cor='#1d4ed8') {
  let d = document.getElementById('diag-box');
  if (!d) {
    d = document.createElement('div');
    d.id = 'diag-box';
    d.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;padding:12px 16px;border-radius:10px;font-size:13px;font-family:DM Sans,sans-serif;z-index:9999;color:white;max-height:120px;overflow-y:auto';
    document.body.appendChild(d);
  }
  d.style.background = cor;
  d.textContent = msg;
  clearTimeout(d._t);
  d._t = setTimeout(() => d.remove(), 6000);
}

// ── DEVICE DETECTION ──────────────────────────────────
export function getDeviceType(){
  const w=window.innerWidth;
  const isTouch=/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  if(w<=640||(isTouch&&w<=900))return'mobile';
  if(w<=1024)return'tablet';
  return'desktop';
}

// ── MODO DE VISUALIZAÇÃO ESCOLHIDO PELO UTILIZADOR ──────────────
// 'mobile' | 'desktop' | null (null = deteta automaticamente pelo tamanho do ecrã)
const DEVICE_MODE_KEY = 'plandese_device_mode';

export function getDeviceMode(){
  try {
    const v = localStorage.getItem(DEVICE_MODE_KEY);
    return (v==='mobile'||v==='desktop') ? v : null;
  } catch(e){ return null; }
}

// Estado inicial a partir da preferência guardada
S.deviceMode = getDeviceMode();

export function setDeviceMode(mode){
  const m = (mode==='mobile'||mode==='desktop') ? mode : null;
  S.deviceMode = m;
  try {
    if(m) localStorage.setItem(DEVICE_MODE_KEY, m);
    else localStorage.removeItem(DEVICE_MODE_KEY);
  } catch(e){}
  return applyDeviceClass();
}

export function applyDeviceClass(){
  const forced = S.deviceMode;
  const dt = forced==='mobile' ? 'mobile'
           : forced==='desktop' ? 'desktop'
           : getDeviceType();
  document.body.classList.remove('device-mobile','device-tablet','device-desktop');
  document.body.classList.add('device-'+dt);
  // forced-mobile: modo telemóvel escolhido à mão (pode estar num ecrã grande)
  document.body.classList.toggle('forced-mobile', forced==='mobile');
  document.body.classList.toggle('forced-desktop', forced==='desktop');
  if(dt==='desktop') document.documentElement.style.setProperty('--sidebar-w','220px');
  else if(dt==='tablet') document.documentElement.style.setProperty('--sidebar-w','60px');
  return dt;
}

// Ecrã "Como quer usar o portal?" — resolve com o modo escolhido
export function showDeviceChooser(){
  return new Promise(resolve => {
    const ov = document.getElementById('device-choice');
    if(!ov){ resolve(S.deviceMode || getDeviceType()); return; }
    const cards = Array.from(ov.querySelectorAll('.devc-card'));
    const sugerido = S.deviceMode || (getDeviceType()==='mobile' ? 'mobile' : 'desktop');
    cards.forEach(c=>{
      c.classList.toggle('suggested', c.dataset.mode===sugerido);
      c.classList.toggle('current',   c.dataset.mode===S.deviceMode);
    });
    const escolher = mode => {
      cards.forEach(c=>{ c.onclick=null; });
      ov.classList.remove('open');
      setDeviceMode(mode);
      resolve(mode);
    };
    cards.forEach(c=>{ c.onclick = () => escolher(c.dataset.mode); });
    ov.classList.add('open');
  });
}



// ── Passwords: regras e troca pelo próprio utilizador ──────────────────
export const PASS_MIN = 8;

export function validarPassword(p1, p2){
  if(!p1 || p1.length<PASS_MIN) return `A password tem de ter pelo menos ${PASS_MIN} caracteres.`;
  if(!/[A-Za-z]/.test(p1) || !/\d/.test(p1)) return 'A password tem de ter letras e números.';
  if(p1!==p2) return 'As passwords não coincidem.';
  return null;
}

// Muda a password de quem tem sessão via Supabase Auth (o servidor aplica as regras de segurança).
// Devolve null se correu bem, ou a mensagem de erro para mostrar.
export async function trocarPropriaPassword(nova){
  const {error}=await sb.auth.updateUser({password:nova});
  if(error){
    if(error.code==='same_password') return 'A nova password tem de ser diferente da atual.';
    if(error.code==='weak_password'){
      if((error.reasons||[]).includes('pwned')) return 'Esta password aparece em fugas de dados conhecidas. Escolha outra.';
      return `Password demasiado fraca: use pelo menos ${PASS_MIN} caracteres, com letras e números.`;
    }
    return 'Não foi possível guardar a password: '+error.message;
  }
  await sb.rpc('fn_password_trocada');
  return null;
}

// Ecrã bloqueante: obriga a escolher uma password nova antes de entrar. Resolve true/false (saiu).
function pedirNovaPassword(nome){
  return new Promise(resolve=>{
    const ov=document.createElement('div');
    ov.className='modal-bg open';
    ov.style.zIndex='10000';
    ov.innerHTML=`<div class="modal" style="max-width:400px">
      <div class="modal-title">Defina uma nova password</div>
      <div class="modal-sub" id="tp-sub"></div>
      <div class="field"><label>Nova password</label><input type="password" id="tp-p1" autocomplete="new-password"/></div>
      <div class="field"><label>Confirmar password</label><input type="password" id="tp-p2" autocomplete="new-password"/></div>
      <div style="font-size:12px;color:var(--gray-500);margin:-4px 0 12px">Mínimo ${PASS_MIN} caracteres, com letras e números.</div>
      <div id="tp-erro" style="display:none;font-size:13px;color:#B91C1C;margin-bottom:12px"></div>
      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" id="tp-sair">Sair</button>
        <button class="btn btn-primary" type="button" id="tp-ok">Guardar e entrar</button>
      </div>
    </div>`;
    ov.querySelector('#tp-sub').textContent=`Olá ${nome||''}. Por segurança, tem de escolher uma password nova antes de continuar.`;
    document.body.appendChild(ov);
    const erro=msg=>{ const e=ov.querySelector('#tp-erro'); e.textContent=msg||''; e.style.display=msg?'block':'none'; };
    const ok=ov.querySelector('#tp-ok');
    ok.onclick=async()=>{
      const p1=ov.querySelector('#tp-p1').value, p2=ov.querySelector('#tp-p2').value;
      const v=validarPassword(p1,p2); if(v){ erro(v); return; }
      ok.disabled=true; ok.textContent='A guardar...'; erro('');
      const e=await trocarPropriaPassword(p1);
      ok.disabled=false; ok.textContent='Guardar e entrar';
      if(e){ erro(e); return; }
      ov.remove(); resolve(true);
    };
    ov.querySelector('#tp-p2').addEventListener('keypress',ev=>{ if(ev.key==='Enter') ok.click(); });
    ov.querySelector('#tp-sair').onclick=()=>{ ov.remove(); resolve(false); };
    setTimeout(()=>ov.querySelector('#tp-p1').focus(),50);
  });
}

// ── Entra na app já autenticado (usado pelo login manual e pela sessão guardada) ──
export async function entrarComoUtilizador(authedUser) {
  // Password provisória (posta pelo admin) ou exposta: tem de a trocar antes de entrar
  if(authedUser.trocar_password){
    const trocou=await pedirNovaPassword(authedUser.nome);
    if(!trocou){ doLogout(); return; }
  }
  S.currentUser={nome:authedUser.nome,role:authedUser.role,initials:authedUser.initials,key:authedUser.username};
  localStorage.setItem('plandese_session',JSON.stringify({key:authedUser.username,nome:authedUser.nome,role:authedUser.role,initials:authedUser.initials||''}));
  document.getElementById('login-screen').style.display='none';
  // Escolha do modo de visualização (telemóvel / computador) — só se ainda não houver preferência guardada
  if(authedUser.role!=='encarregado' && !getDeviceMode()) await showDeviceChooser();
  document.body.insertAdjacentHTML('beforeend','<div id="loading-screen" style="position:fixed;inset:0;background:#103060;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9998"><div style="width:48px;height:48px;border:4px solid rgba(255,255,255,.2);border-top-color:white;border-radius:50%;animation:spin 1s linear infinite"></div><div style="color:white;margin-top:16px;font-family:DM Sans,sans-serif;font-size:14px" id="loading-msg">A carregar dados...</div></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>');
  try {
    document.getElementById('loading-msg').textContent='A carregar obras e colaboradores...';
    await R.carregarDados();
    mostrarDiag(`✓ Dados carregados: ${S.OBRAS.length} obras, ${S.COLABORADORES.length} colaboradores`,'#15803D');
  } catch(e){
    mostrarDiag('❌ Erro ao carregar dados: '+e.message,'#B91C1C');
  }
  const ls=document.getElementById('loading-screen');if(ls)ls.remove();
  const device=applyDeviceClass();
  if(authedUser.role==='encarregado'){
    document.body.classList.add('enc-mode');
    document.getElementById('enc-app').style.display='flex';
    document.getElementById('enc-name').textContent=authedUser.nome;
    await R.initEnc();
    R.ensurePushSubscription?.();
  } else {
    document.getElementById('admin-app').style.display='flex';
    document.body.classList.add('app-ativa');
    document.getElementById('u-av').textContent=authedUser.initials;
    document.getElementById('u-nm').textContent=authedUser.nome;
    document.getElementById('u-role').textContent=ROLE_LABELS[authedUser.role]||authedUser.role;
    await R.loadPermissionsFromServer();
    R.applyStoredPermissions();
    R.initAdmin();
    R.applyRolePermissions(authedUser.role);
    R.initNotifications();
    R.ensurePushSubscription?.();
    R.applyPendingSection?.();
  }
}

// Contas do Supabase Auth usam um email sintético derivado do username (ver fn_sync_auth_user)
const authEmail = username => `${username}@portal.plandese.local`;

export async function doLogin() {
  const u=document.getElementById('lu').value.trim().toLowerCase();
  const p=document.getElementById('lp').value;
  const btn=document.querySelector('.btn-login');
  btn.textContent='A ligar ao Supabase...'; btn.disabled=true;
  let authedUser=null;
  try {
    mostrarDiag('A ligar ao Supabase...','#1d4ed8');
    // Login no Supabase Auth: sem sessão válida o servidor não entrega dados nenhuns
    const {data:authData,error:signErr}=await sb.auth.signInWithPassword({email:authEmail(u),password:p});
    if(signErr&&signErr.status!==400)throw signErr;
    if(!signErr&&authData?.session){
      const {data:users,error}=await sb.from('utilizadores').select('username,nome,role,initials,telefone,painel_config,trocar_password');
      if(error)throw error;
      S.USERS={};
      (users||[]).forEach(x=>{S.USERS[x.username]={nome:x.nome,initials:x.initials||x.nome.split(' ').map(c=>c[0]).join('').slice(0,2).toUpperCase(),role:x.role};});
      if(!S.USERS['admin'])S.USERS['admin']={nome:USERS_BASE['admin'].nome,initials:USERS_BASE['admin'].initials,role:USERS_BASE['admin'].role};
      authedUser=(users||[]).find(x=>x.username===u)||null;
      if(authedUser) mostrarDiag('✓ Supabase ligado — '+users.length+' utilizadores','#15803D');
      else await sb.auth.signOut().catch(()=>{});
    }
  } catch(e){
    mostrarDiag('⚠️ Sem ligação ao servidor — tente novamente','#B45309');
  }
  btn.textContent='Entrar'; btn.disabled=false;
  if(authedUser){
    await entrarComoUtilizador(authedUser);
  } else {
    const e=document.getElementById('login-error');e.style.display='block';setTimeout(()=>e.style.display='none',3000);
  }
}

// ── Restaura a sessão ao (re)abrir a página, sem pedir login outra vez ──
// Exige sessão válida no Supabase Auth; a sessão antiga só em localStorage já não chega.
export async function tentarSessaoGuardada() {
  const {data:{session}}=await sb.auth.getSession();
  const username=session?.user?.app_metadata?.username;
  if(!username){ localStorage.removeItem('plandese_session'); return false; }
  let saved=null;
  try { saved=JSON.parse(localStorage.getItem('plandese_session')||'null'); } catch(e){}
  const {data:perfil,error}=await sb.from('utilizadores').select('username,nome,role,initials,trocar_password').eq('username',username).maybeSingle();
  // Sem rede: confia no perfil guardado se for do mesmo utilizador da sessão
  const user=perfil||(error&&saved?.key===username?{username:saved.key,nome:saved.nome,role:saved.role,initials:saved.initials||''}:null);
  if(!user){
    await sb.auth.signOut().catch(()=>{});
    localStorage.removeItem('plandese_session');
    return false;
  }
  await entrarComoUtilizador(user);
  return true;
}

export function doLogout() {
  S.currentUser = null;
  localStorage.removeItem('plandese_session');
  sb.auth.signOut().catch(()=>{});
  S.NOTIFICACOES = [];
  S.notifPanelOpen = false;
  document.getElementById('notif-panel')?.classList.remove('open');
  const badge = document.getElementById('notif-badge');
  if(badge) badge.hidden = true;
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('enc-app').style.display = 'none';
  document.getElementById('admin-app').style.display = 'none';
  document.body.classList.remove('app-ativa');
  document.body.classList.remove('enc-mode');
  S.encObraId = ''; S.encDataSel = '';
  ['enc-screen0','enc-screen1','enc-screen2',
   'enc-screen-equip','enc-screen-aluguer','enc-screen-historico-enc','enc-screen-combustivel','enc-screen-comb-deposito','enc-screen-comb-viatura',
   'enc-screen-compras-chat'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.style.display='none';
  });
  document.getElementById('lu').value = '';
  document.getElementById('lp').value = '';
}
