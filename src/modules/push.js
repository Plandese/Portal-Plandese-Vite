// ═══════════════════════════════════════
//  WEB PUSH — notificações reais no dispositivo (iOS/Android/desktop)
// ═══════════════════════════════════════
import { S } from '../state.js';
import { VAPID_PUBLIC_KEY } from '../config.js';
import { sbSavePushSubscription } from '../db.js';
import { showToast } from './navigation.js';
import { goToSection } from './notifications.js';

function isIos(){
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone(){
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

function supported(){
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function subscribeAndSave(){
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if(!sub){
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
  }
  const me = S.currentUser?.key;
  if(me) await sbSavePushSubscription(me, sub.toJSON());
  return sub;
}

// Estado atual, para a UI decidir o que mostrar (sem pedir nada ao utilizador).
export function pushStatus(){
  if(!supported()) return 'unsupported';
  if(isIos() && !isStandalone()) return 'precisa-instalar';
  return Notification.permission; // 'granted' | 'denied' | 'default'
}

// Chamado silenciosamente no login: só reativa quem já tinha aceitado antes
// (ex. depois de reinstalar a app). Nunca dispara o popup de permissão sozinho.
export async function ensurePushSubscription(){
  try {
    if(!supported()) return;
    if(isIos() && !isStandalone()) return;
    if(Notification.permission !== 'granted') return;
    await subscribeAndSave();
  } catch(e){ console.warn('Erro ao renovar subscrição push:', e); }
}

// Chamado por ação explícita do utilizador (botão nas Definições).
export async function requestPushPermission(){
  const status = pushStatus();
  if(status === 'unsupported'){
    showToast('Este dispositivo/browser não suporta notificações');
    return;
  }
  if(status === 'precisa-instalar'){
    showToast('Adiciona o Portal ao ecrã principal primeiro (Partilhar → Adicionar ao Ecrã Principal)');
    return;
  }
  if(status === 'denied'){
    showToast('Notificações bloqueadas — ativa-as nas Definições do telemóvel');
    return;
  }
  try {
    const perm = await Notification.requestPermission();
    if(perm !== 'granted'){ showToast('Permissão não concedida'); return; }
    await subscribeAndSave();
    showToast('Notificações ativadas ✓');
  } catch(e){
    console.warn('Erro ao pedir permissão de notificações:', e);
    showToast('Não foi possível ativar as notificações');
  }
}

// ── Deep link: abrir a secção certa ao clicar numa notificação ──────────
// Caso 1: a app já estava aberta numa aba — o service worker manda um postMessage.
// Caso 2: a app estava fechada — abre com ?open=<seccao> no URL, lido aqui no arranque.
let _pendingSection = null;

export function capturePendingSectionFromURL(){
  const seccao = new URLSearchParams(location.search).get('open');
  if(seccao) _pendingSection = seccao;
}

export function applyPendingSection(){
  if(!_pendingSection) return;
  const seccao = _pendingSection;
  _pendingSection = null;
  history.replaceState(null, '', location.pathname);
  goToSection(seccao);
}

if('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('message', e => {
    if(e.data?.type !== 'notif-open') return;
    if(S.currentUser) goToSection(e.data.seccao);
    else _pendingSection = e.data.seccao;
  });
}
