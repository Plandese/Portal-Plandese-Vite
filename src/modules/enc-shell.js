// ═══════════════════════════════════════
//  ENC-SHELL — estrutura da app dos encarregados (mesma linguagem da app mobile do admin)
//    · cabeçalho colorido com título do ecrã e folha branca por baixo
//    · menu lateral (perfil, compras, histórico, meteorologia, sair)
//    · "voltar" inteligente: passo anterior do ecrã atual, senão início
//  Só mexe em apresentação: os ecrãs e as funções de navegação continuam a ser as do enc-ponto.js.
// ═══════════════════════════════════════
import { S } from '../state.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const IC = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h.01M18 14h.01M21 14h.01M14 18h.01M18 18h.01M21 18h.01M14 21h.01M18 21h.01M21 21h.01"/></svg>',
  fuel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16"/><path d="M3 21h14"/><path d="M15 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3"/><rect x="7" y="7" width="4" height="4" rx=".5"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  drop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.7s6 6.3 6 10.8a6 6 0 0 1-12 0C6 9 12 2.7 12 2.7z"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
};

// Ecrãs da app: título/subtítulo/ícone do cabeçalho e para onde volta o "voltar"
const ECRAS = {
  'enc-screen0':             { home: true },
  'enc-screen1':             { t: 'Folha de ponto', s: 'MO Plandese · passo 1 de 2', i: IC.user, back: 'encVoltarHome' },
  'enc-screen2':             { t: 'Folha de ponto', s: 'MO Plandese · passo 2 de 2', i: IC.user, back: 'encVoltarScreen1' },
  'enc-screen-aluguer':      { t: 'MO Aluguer', s: 'Mão de obra cedida', i: IC.users, back: 'encVoltarHome' },
  'enc-screen-equip':        { t: 'Equipamentos', s: 'Localização e manutenção', i: IC.qr, back: 'encVoltarHome', estados: {
    'enc-eq-state-scanner': 'encEqVoltarMetodo', 'enc-eq-state-lista': 'encEqVoltarMetodo', 'enc-eq-state-acao': 'encEqVoltarMetodo',
    'enc-eq-state-form-reg': 'encEqVoltarAcao', 'enc-eq-state-form-man': 'encEqVoltarAcao' } },
  'enc-screen-combustivel':  { t: 'Combustível', s: 'Escolha o tipo de registo', i: IC.fuel, back: 'encVoltarHome' },
  'enc-screen-comb-deposito':{ t: 'Depósito de obra', s: 'Entrada e saída de gasóleo', i: IC.drop, back: 'encGoCombustivel' },
  'enc-screen-comb-viatura': { t: 'Abastecimento bombas', s: 'Viaturas e máquinas', i: IC.fuel, back: 'encGoCombustivel', estados: {
    'comb-viatura-state-form': 'combViaturaVoltarScanner' } },
  'enc-screen-historico-enc':{ t: 'Histórico', s: 'Registos anteriores', i: IC.clock, back: 'encVoltarHome' },
  'enc-screen-compras-chat': { t: 'Compras', s: 'Assistente de compras', i: IC.cart, back: 'encVoltarHome' },
};
const IDS = Object.keys(ECRAS);
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function ecraAtual() {
  return IDS.find(id => { const e = $(id); return e && e.style.display !== 'none' && e.style.display !== ''; }) || null;
}

const iniciais = () => String(S.currentUser?.nome || 'E').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'E';
const primeiroNome = () => String(S.currentUser?.nome || '').trim().split(/\s+/)[0] || 'Encarregado';

let _atual = null, _raf = 0;
export function eSync() {
  const h = $('e-hdr'); if (!h) return;
  const id = ecraAtual();
  if (!id) return;
  const cfg = ECRAS[id];
  const home = !!cfg.home;
  if (id !== _atual) eDrawer(false);
  _atual = id;
  h.dataset.v = home ? 'home' : 'child';
  document.body.dataset.eScreen = id.replace('enc-screen-', '').replace('enc-screen', 'home');
  $('e-hl').innerHTML = home ? IC.menu : IC.back;
  $('e-hl').setAttribute('aria-label', home ? 'Menu' : 'Voltar');
  $('e-hr').innerHTML = home ? IC.sun : IC.home;
  $('e-hr').setAttribute('aria-label', home ? 'Previsão do tempo' : 'Início');
  const av = $('e-av'); if (av) av.textContent = iniciais();
  if (home) {
    const d = new Date(), hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    $('e-hdr-title').innerHTML = `<span>Olá, ${esc(primeiroNome())}</span>`;
    $('e-hdr-sub').textContent = `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} · ${hm}`;
  } else {
    $('e-hdr-title').innerHTML = `${cfg.i}<span>${esc(cfg.t)}</span>`;
    $('e-hdr-sub').textContent = cfg.s || '';
  }
  const tc = document.querySelector('meta[name="theme-color"]');
  if (tc) tc.setAttribute('content', '#173f9f');
}
const agendar = () => { cancelAnimationFrame(_raf); _raf = requestAnimationFrame(eSync); };

export function eLeft() {
  const id = ecraAtual();
  if (!id || ECRAS[id].home) { eDrawer(true); return; }
  eBack(id);
}
export function eRight() {
  const id = ecraAtual();
  if (!id || ECRAS[id].home) window.encOpenWeatherModal?.();
  else window.encVoltarHome?.();
}
function eBack(id) {
  const cfg = ECRAS[id];
  // passo interno do ecrã (ex.: formulário de equipamento → ação → método)
  let fn = cfg.back;
  if (cfg.estados) {
    const vis = Object.keys(cfg.estados).find(k => { const e = $(k); return e && e.style.display !== 'none' && e.offsetParent !== null; });
    if (vis) fn = cfg.estados[vis];
  }
  // MO Aluguer: do passo B volta ao A
  if (id === 'enc-screen-aluguer') {
    const b = $('enc-alug-screen-b');
    if (b && b.style.display !== 'none' && window.encAlugVoltarA) fn = 'encAlugVoltarA';
  }
  (window[fn] || window.encVoltarHome)?.();
}

export function eDrawer(abrir) {
  const d = $('e-drawer'); if (!d) return;
  if (abrir) { const av = $('e-av'); if (av) av.textContent = iniciais(); }
  d.classList.toggle('open', !!abrir);
  d.setAttribute('aria-hidden', abrir ? 'false' : 'true');
}

function iniciar() {
  const o = new MutationObserver(agendar);
  IDS.forEach(id => { const e = $(id); if (e) o.observe(e, { attributes: true, attributeFilter: ['style'] }); });
  const app = $('enc-app'); if (app) o.observe(app, { attributes: true, attributeFilter: ['style'] });
  // MO Aluguer: o passo A/B muda sem mudar de ecrã (só o botão "voltar" precisa de o saber)
  agendar();
  setInterval(() => { if (_atual === 'enc-screen0') eSync(); }, 30000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();

Object.assign(window, { eLeft, eRight, eDrawer, eSync });
