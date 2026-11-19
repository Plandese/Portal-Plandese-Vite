// ═══════════════════════════════════════════════════════════════════
//  PLANOS DE TRABALHO (versão de teste) — Gantt tipo MS Project a partir do articulado
//  Página pessoal: só os utilizadores de SOLO_USER_SECTIONS (permissions.js) a veem;
//  o servidor aplica o mesmo limite por RLS na tabela planos_trabalho.
//  Enquanto a tabela não existir na Supabase, os planos ficam guardados neste computador.
//
//  Cálculo: as datas trabalham em «dias úteis» (ordinais do calendário do plano: seg–sex
//  ou seg–sáb, sem feriados_pt). Ligações TI/II/TT/IT (= FS/SS/FF/SF) com desfasamento em
//  dias úteis; «Não iniciar antes de» quando se escreve a data de início ou se arrasta a barra.
// ═══════════════════════════════════════════════════════════════════
import { sb } from '../supabase.js';
import { S } from '../state.js';
import { showToast } from './navigation.js';
import { puLerArticulado, puArticuladoDaObra } from './precos-unitarios.js';

const $ = id => document.getElementById(id);
const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur0 = v => (Number(v) || 0).toLocaleString('pt-PT', { maximumFractionDigits: 0 }) + ' €';
const eur2 = v => (Number(v) || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2));
const LS_KEY = 'plt_planos_local';
const LS_SPLIT = 'plt_split_w';
const ROW = 32;
const ZOOM = { dia: 26, semana: 7, mes: 1.7 };
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MES_ABR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DSEM = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
// Tipos de ligação: código interno (MS Project em inglês) → sigla em português
const TIPO_PT = { FS: 'TI', SS: 'II', FF: 'TT', SF: 'IT' };
const TIPO_IN = { FS: 'FS', SS: 'SS', FF: 'FF', SF: 'SF', TI: 'FS', II: 'SS', TT: 'FF', IT: 'SF', FI: 'FS', IF: 'SF' };
const TIPO_TXT = { FS: 'Fim → Início', SS: 'Início → Início', FF: 'Fim → Fim', SF: 'Início → Fim' };

const ICO = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  marco: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l9 9-9 9-9-9z"/></svg>',
  out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 6H11M21 12H11M21 18H11M7 8l-4 4 4 4"/></svg>',
  ind: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 6H11M21 12H11M21 18H11M3 8l4 4-4 4"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  unlink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.8 13.3l1.7-1.8a5 5 0 0 0-7-7l-1.8 1.7M5.2 10.7l-1.7 1.8a5 5 0 0 0 7 7l1.8-1.7M8 2v3M2 8h3M16 22v-3M22 16h-3"/></svg>',
  del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>',
  hoje: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><circle cx="12" cy="16" r="1.6" fill="currentColor"/></svg>',
  crit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  cfg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  xls: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13l4 5M12 13l-4 5"/></svg>',
  mpp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h9M7 10h11M5 15h7M10 20h10"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M16 3v4M8 3v4M4 11h16"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  ia: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>',
  enviar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  parar: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  equipas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.2a3.5 3.5 0 0 1 0 6.6M18.5 14.2A6.5 6.5 0 0 1 21.5 20"/></svg>',
  maquina: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="15" width="13" height="5" rx="2.5"/><path d="M4 15v-4h7v4M11 11l5-7 4 3M20 7l1 6h-3"/></svg>',
  pincel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8 9.2 12z"/><path d="M9.2 12c-2.5 0-4.2 1.7-4.2 4.2 0 1.3-.8 2.6-2.5 3.3 1.3 1.2 3.2 1.5 4.8 1.5 3 0 5.1-2.2 4.7-5.6"/></svg>',
  tesoura: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/></svg>',
  juntar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h7M14 12h7M7 8l4 4-4 4M17 8l-4 4 4 4"/></svg>',
  visto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  desfazer100: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  colunas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/></svg>',
  olho: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  olhoX: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.2A10.4 10.4 0 0 1 12 4c6.4 0 10 8 10 8a17.6 17.6 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.6 8 10 8a9.7 9.7 0 0 0 5.4-1.6M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  minimizar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 17h12"/></svg>',
  plano: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h8M6 10h10M9 15h9M5 20h7"/></svg>',
};

// ───────────────────────── estado ─────────────────────────
let _planos = [];
let _plano = null;
let _modoLocal = false;
let _feriados = null;               // Set de 'YYYY-MM-DD'
let _C = null;                      // calendário do plano aberto
let _R = null;                      // resultado do cálculo
let _ui = { vista: 'gantt', zoom: 'semana', critico: true, sel: new Set(), ancora: -1 };
let _undo = [], _redo = [];
let _saveT = null, _estado = 'ok';
let _novo = null;                   // dados do painel «Novo plano»
let _keysOk = false;

// ───────────────────────── persistência ─────────────────────────
const lsLer = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; } };
const lsGravarTodos = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(_planos)); } catch (e) {} };
const tabelaEmFalta = err => /planos_trabalho|does not exist|PGRST205|42P01|schema cache/i.test(((err && err.message) || '') + ' ' + ((err && err.code) || ''));

async function carregarPlanos() {
  const r = await sb.from('planos_trabalho').select('*').order('updated_at', { ascending: false });
  if (r.error) {
    if (tabelaEmFalta(r.error)) { _modoLocal = true; _planos = lsLer(); return; }
    throw r.error;
  }
  _modoLocal = false;
  _planos = r.data || [];
}

async function carregarFeriados() {
  if (_feriados) return;
  _feriados = new Set();
  try {
    const { data } = await sb.from('feriados_pt').select('data');
    (data || []).forEach(f => _feriados.add(String(f.data).slice(0, 10)));
  } catch (e) {}
}

function agendarGravar() {
  _estado = 'pend'; pintarEstado();
  clearTimeout(_saveT);
  _saveT = setTimeout(gravar, 700);
}
async function gravar() {
  const p = _plano; if (!p) return;
  clearTimeout(_saveT);
  p.updated_at = new Date().toISOString();
  if (_modoLocal) { lsGravarTodos(); _estado = 'ok'; pintarEstado(); return; }
  _estado = 'a'; pintarEstado();
  const { error } = await sb.from('planos_trabalho').upsert({
    id: p.id, obra_id: p.obra_id, nome: p.nome, data_inicio: p.data_inicio,
    calendario: p.calendario, tarefas: p.tarefas, equipas: Array.isArray(p.equipas) ? p.equipas : [], updated_at: p.updated_at,
  });
  _estado = error ? 'erro' : 'ok';
  if (error) console.error('planos_trabalho:', error);
  pintarEstado();
}
function pintarEstado() {
  const el = $('plt-estado'); if (!el) return;
  const m = { ok: ['ok', 'Guardado'], pend: ['mute', 'Por guardar…'], a: ['mute', 'A guardar…'], erro: ['bad', 'Erro ao guardar'] }[_estado];
  el.className = 'plt-pill ' + m[0]; el.textContent = m[1];
}

// ───────────────────────── calendário (dias úteis) ─────────────────────────
const DIA = 86400000;
const dnum = iso => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DIA);
const diso = n => new Date(n * DIA).toISOString().slice(0, 10);
const dow = n => new Date(n * DIA).getUTCDay();
const hojeN = () => { const d = new Date(); return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DIA); };
const fmtD = n => { const d = new Date(n * DIA); return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + String(d.getUTCFullYear()).slice(2); };
const fmtDL = n => { const d = new Date(n * DIA); return d.getUTCDate() + ' ' + MES_ABR[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };

function montarCalendario() {
  const sab = _plano.calendario === '6';
  const base = dnum(_plano.data_inicio) - 400;
  const len = 365 * 16;
  const wd = [], ceil = new Int32Array(len + 1);
  for (let k = 0; k <= len; k++) {
    const n = base + k, w = dow(n);
    if (w !== 0 && (w !== 6 || sab) && !_feriados.has(diso(n))) wd.push(n);
  }
  let j = 0;
  for (let k = 0; k <= len; k++) { while (j < wd.length - 1 && wd[j] < base + k) j++; ceil[k] = j; }
  _C = { base, wd, ceil, len, sab };
}
// dia de calendário → ordinal do 1.º dia útil ≥ n
const ordC = n => { const k = n - _C.base; return _C.ceil[Math.max(0, Math.min(_C.len, k))]; };
// dia de calendário → ordinal do último dia útil ≤ n
const ordF = n => { const o = ordC(n); return _C.wd[o] > n ? o - 1 : o; };
const diaDe = o => _C.wd[Math.max(0, Math.min(_C.wd.length - 1, o))];
const eUtil = n => _C.wd[ordC(n)] === n;

// ───────────────────────── cálculo (CPM) ─────────────────────────
// ── Fases: barra partida (como «Dividir tarefa» do MS Project) ──
// t.fases = [{ dur, pausa, nome? }] — pausa = dias úteis parados antes da fase (a 1.ª tem 0; 0 nas outras = fases seguidas).
// t.dur é sempre o trabalho total (soma das fases); a barra ocupa trabalho + pausas.
const temFases = t => Array.isArray(t.fases) && t.fases.length > 1;
function normFases(t, eResumo) {
  if (!Array.isArray(t.fases)) return;
  if (eResumo || !(t.dur > 0)) { delete t.fases; return; }
  const out = [];
  for (const f of t.fases) {
    const d = Math.max(0, parseInt(f.dur, 10) || 0), p = Math.max(0, parseInt(f.pausa, 10) || 0);
    if (!d) continue;
    out.push({ dur: d, pausa: out.length ? p : 0, ...(f.nome ? { nome: String(f.nome).slice(0, 80) } : {}) });
  }
  if (out.length < 2) { if (out.length) t.dur = out[0].dur; delete t.fases; return; }
  t.fases = out;
  t.dur = out.reduce((s, f) => s + f.dur, 0);
}
const spanDe = t => temFases(t) ? t.fases.reduce((s, f, k) => s + f.dur + (k ? f.pausa : 0), 0) : Math.max(0, t.dur | 0);
// ordinal (dia útil) em que começa cada fase, dado o início da tarefa
const iniciosFases = (t, es) => { let o = es; return t.fases.map((f, k) => { if (k) o += f.pausa; const a = o; o += f.dur; return a; }); };
// muda a duração (trabalho) mantendo as fases: acerta a partir da última
function definirDur(t, d) {
  d = Math.max(0, parseInt(d, 10) || 0);
  if (!temFases(t) || d < t.fases.length) { delete t.fases; t.dur = d; return; }
  let dif = d - t.dur;
  for (let k = t.fases.length - 1; k >= 0 && dif !== 0; k--) {
    const nv = Math.max(1, t.fases[k].dur + dif);
    dif -= nv - t.fases[k].dur; t.fases[k].dur = nv;
  }
  t.dur = t.fases.reduce((s, f) => s + f.dur, 0);
}
// dias úteis (ordinais) em que a tarefa tem trabalho — sem as pausas
function diasTrabalho(i) {
  const r = _R, t = _plano.tarefas[i];
  if (r.ms[i]) return [r.es[i]];
  const out = [];
  if (!temFases(t)) { for (let o = r.es[i]; o <= r.ef[i]; o++) out.push(o); return out; }
  iniciosFases(t, r.es[i]).forEach((a, k) => { for (let o = a; o < a + t.fases[k].dur; o++) out.push(o); });
  return out;
}

function calcular() {
  const T = _plano.tarefas, n = T.length;
  const pai = new Array(n).fill(-1), resumo = new Array(n).fill(false), filhos = Array.from({ length: n }, () => []);
  const pilha = [];
  for (let i = 0; i < n; i++) {
    while (pilha.length && T[pilha[pilha.length - 1]].nivel >= T[i].nivel) pilha.pop();
    if (pilha.length) { pai[i] = pilha[pilha.length - 1]; filhos[pai[i]].push(i); resumo[pai[i]] = true; }
    pilha.push(i);
  }
  const idx = new Map(T.map((t, i) => [t.id, i]));
  // EDT 1, 1.1, 1.2 …
  const edt = new Array(n), cont = [];
  for (let i = 0; i < n; i++) {
    const lv = T[i].nivel; cont.length = lv + 1; cont[lv] = (cont[lv] || 0) + 1;
    edt[i] = cont.slice(0, lv + 1).map(x => x || 1).join('.');
  }
  // folhas de cada tarefa (ela própria se não for resumo)
  const folhas = new Array(n);
  for (let i = n - 1; i >= 0; i--) folhas[i] = resumo[i] ? filhos[i].flatMap(c => folhas[c]) : [i];
  const preds = T.map(t => (t.pred || []).map(p => ({ j: idx.get(p.id), tipo: p.tipo || 'FS', lag: p.lag | 0 })).filter(p => p.j != null));
  T.forEach((t, i) => normFases(t, resumo[i]));
  const dur = T.map((t, i) => resumo[i] ? 0 : Math.max(0, t.dur | 0));        // trabalho (dias úteis)
  const span = T.map((t, i) => resumo[i] ? 0 : spanDe(t));                      // ocupação na barra (trabalho + pausas)
  const ms = T.map((t, i) => !resumo[i] && dur[i] === 0);
  const S0 = ordC(dnum(_plano.data_inicio));
  const es = new Array(n).fill(S0), ef = new Array(n).fill(S0);
  const minOrd = T.map(t => t.inicioMin ? ordC(dnum(t.inicioMin)) : null);

  const req = (p, d) => {
    const pes = es[p.j], pef = ef[p.j];
    switch (p.tipo) {
      case 'SS': return pes + p.lag;
      case 'FF': return pef + p.lag - Math.max(0, d - 1);
      case 'SF': return pes + p.lag - Math.max(0, d - 1);
      default: return (ms[p.j] || d === 0 ? pef : pef + 1) + p.lag;   // marco a seguir a uma tarefa fica no dia em que ela acaba
    }
  };
  let mudou = true, it = 0;
  const lim = n + 5;
  while (mudou && it < lim) {
    mudou = false; it++;
    for (let i = 0; i < n; i++) {
      if (resumo[i]) continue;
      let e = S0;
      for (let k = i; k !== -1; k = pai[k]) {
        if (minOrd[k] != null) e = Math.max(e, minOrd[k]);
        for (const p of preds[k]) e = Math.max(e, req(p, span[i]));
      }
      const f = ms[i] ? e : e + span[i] - 1;
      if (e !== es[i] || f !== ef[i]) { es[i] = e; ef[i] = f; mudou = true; }
    }
    for (let i = n - 1; i >= 0; i--) {
      if (!resumo[i]) continue;
      let a = Infinity, b = -Infinity;
      for (const c of filhos[i]) { a = Math.min(a, es[c]); b = Math.max(b, ef[c]); }
      if (a !== es[i] || b !== ef[i]) { es[i] = a; ef[i] = b; mudou = true; }
    }
  }
  const ciclo = it >= lim && mudou;

  // Passagem para trás (folgas / caminho crítico) sobre ligações expandidas às folhas
  const E = [];
  for (let k = 0; k < n; k++) for (const p of preds[k]) for (const b of folhas[k]) for (const a of folhas[p.j]) if (a !== b) E.push({ a, b, tipo: p.tipo, lag: p.lag });
  let PF = S0;
  for (let i = 0; i < n; i++) if (!resumo[i]) PF = Math.max(PF, ef[i]);
  const lf = new Array(n).fill(PF), ls = new Array(n);
  const lsDe = i => ms[i] ? lf[i] : lf[i] - span[i] + 1;
  for (let i = 0; i < n; i++) ls[i] = lsDe(i);
  if (!ciclo) {
    let m2 = true, it2 = 0;
    while (m2 && it2 < lim) {
      m2 = false; it2++;
      for (const e of E) {
        const da = Math.max(0, span[e.a] - 1);
        let L;
        switch (e.tipo) {
          case 'SS': L = ls[e.b] - e.lag + da; break;
          case 'FF': L = lf[e.b] - e.lag; break;
          case 'SF': L = lf[e.b] - e.lag + da; break;
          default: L = ls[e.b] - e.lag - (ms[e.a] || ms[e.b] ? 0 : 1);
        }
        if (L < lf[e.a]) { lf[e.a] = L; ls[e.a] = lsDe(e.a); m2 = true; }
      }
    }
  }
  const folga = new Array(n).fill(0);
  for (let i = 0; i < n; i++) if (!resumo[i]) folga[i] = lf[i] - ef[i];
  for (let i = n - 1; i >= 0; i--) if (resumo[i]) folga[i] = Math.min(...folhas[i].map(c => folga[c]));
  // valores e % dos resumos
  const valor = T.map((t, i) => resumo[i] ? 0 : (Number(t.valor) || 0));
  const pct = T.map(t => Math.max(0, Math.min(100, Number(t.pct) || 0)));
  for (let i = n - 1; i >= 0; i--) {
    if (!resumo[i]) continue;
    valor[i] = folhas[i].reduce((s, c) => s + valor[c], 0);
    const w = folhas[i].reduce((s, c) => s + Math.max(1, dur[c]), 0);
    pct[i] = w ? Math.round(folhas[i].reduce((s, c) => s + pct[c] * Math.max(1, dur[c]), 0) / w) : 0;
  }
  // tarefas visíveis (resumos fechados escondem os descendentes)
  const vis = [];
  let corte = Infinity;
  for (let i = 0; i < n; i++) {
    if (T[i].nivel > corte) continue;
    corte = Infinity;
    vis.push(i);
    if (resumo[i] && T[i].fechado) corte = T[i].nivel;
  }
  _R = { n, pai, resumo, filhos, folhas, idx, edt, preds, dur, span, ms, es, ef, folga, valor, pct, vis, ciclo, S0, PF };
}

// duração do ecrã (dias úteis) de uma tarefa calculada
const durDe = i => _R.resumo[i] ? (_R.ef[i] - _R.es[i] + 1) : _R.dur[i];

// ───────────────────────── texto ⇄ valores ─────────────────────────
function lerDur(txt) {
  const m = String(txt).trim().toLowerCase().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(d|dias?|s|sem|semanas?|m|mes|meses|mês)?$/);
  if (!m) return null;
  let v = parseFloat(m[1]);
  const u = (m[2] || 'd')[0];
  if (u === 's') v *= _C.sab ? 6 : 5;
  if (u === 'm') v *= _C.sab ? 26 : 22;
  return Math.round(v);
}
const txtDur = d => d + (d === 1 ? ' dia' : ' dias');
function lerData(txt, ref) {
  const s = String(txt).trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/);
  if (!m) return null;
  const refY = new Date(ref * DIA).getUTCFullYear();
  let y = m[3] ? +m[3] : refY; if (y < 100) y += 2000;
  const mo = +m[2], d = +m[1];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function txtPred(i) {
  return (_plano.tarefas[i].pred || []).map(p => {
    const j = _R.idx.get(p.id); if (j == null) return '';
    const lag = p.lag | 0;
    return (j + 1) + (p.tipo !== 'FS' || lag ? TIPO_PT[p.tipo] : '') + (lag ? (lag > 0 ? '+' : '') + lag : '');
  }).filter(Boolean).join(';');
}
function lerPred(txt, i) {
  const T = _plano.tarefas, out = [];
  for (const tok of String(txt).split(/[;,]/).map(x => x.trim()).filter(Boolean)) {
    const m = tok.toUpperCase().replace(/\s+/g, '').match(/^(\d+)([A-Z]{2})?([+-]\d+)?(D|DIAS?)?$/);
    if (!m) return { erro: `Ligação inválida: «${tok}»` };
    const j = +m[1] - 1;
    if (j < 0 || j >= T.length) return { erro: `Não existe a tarefa ${m[1]}` };
    if (j === i) return { erro: 'Uma tarefa não pode depender de si própria' };
    const tipo = m[2] ? TIPO_IN[m[2]] : 'FS';
    if (!tipo) return { erro: `Tipo de ligação desconhecido: «${m[2]}» (usar TI, II, TT ou IT)` };
    if (eAscendente(j, i) || eAscendente(i, j)) return { erro: 'Não se pode ligar uma tarefa ao seu próprio resumo' };
    out.push({ id: T[j].id, tipo, lag: m[3] ? parseInt(m[3], 10) : 0 });
  }
  return { pred: out };
}
function eAscendente(a, b) { for (let k = _R.pai[b]; k !== -1; k = _R.pai[k]) if (k === a) return true; return false; }

// ───────────────────────── anular / refazer ─────────────────────────
function mudar(fn) {
  const antes = JSON.stringify(_plano.tarefas);
  const r = fn();
  if (r === false) return;
  _undo.push(antes); if (_undo.length > 60) _undo.shift();
  _redo = [];
  depoisDeMudar();
}
function depoisDeMudar() { calcular(); pintarPlano(); agendarGravar(); }
function anular() { if (!_undo.length) return; _redo.push(JSON.stringify(_plano.tarefas)); _plano.tarefas = JSON.parse(_undo.pop()); _ui.sel.clear(); depoisDeMudar(); }
function refazer() { if (!_redo.length) return; _undo.push(JSON.stringify(_plano.tarefas)); _plano.tarefas = JSON.parse(_redo.pop()); _ui.sel.clear(); depoisDeMudar(); }

// ───────────────────────── página: lista de planos ─────────────────────────
export async function renderPlanosTrabalho() {
  const el = $('plt-body'); if (!el) return;
  ligarTeclado();
  if (_plano) { abrirPlano(_plano.id); return; }
  el.innerHTML = '<div class="plt-vazio">A carregar…</div>';
  try { await Promise.all([carregarPlanos(), carregarFeriados()]); }
  catch (err) { el.innerHTML = `<div class="plt-vazio">Não foi possível carregar os planos (${esc(err.message || err)}).</div>`; return; }
  pintarLista();
}

function nomeObra(id) { const o = (S.OBRAS || []).find(x => String(x.id) === String(id)); return o ? o.nome : ''; }

function resumoPlano(p) {
  const T = p.tarefas || [];
  if (!T.length) return { fim: null, dias: 0, valor: 0, n: 0 };
  const guard = _plano; _plano = p;
  montarCalendario(); calcular();
  const r = { fim: diaDe(_R.PF), dias: _R.PF - _R.S0 + 1, valor: _R.valor.reduce((s, v, i) => s + (_R.pai[i] === -1 ? v : 0), 0), n: T.length };
  _plano = guard; _R = null; _C = null;
  return r;
}

function pintarLista() {
  const el = $('plt-body'); if (!el) return;
  const aviso = _modoLocal ? `<div class="plt-aviso"><b>Modo local</b> — a tabela <code>planos_trabalho</code> ainda não existe na Supabase, por isso os planos ficam guardados só neste computador. Aplicar a migração <code>20261119_planos_trabalho.sql</code> para os guardar no servidor.</div>` : '';
  const cards = _planos.map(p => {
    const r = resumoPlano(p);
    return `<button type="button" class="plt-card" data-abrir="${esc(p.id)}">
      <span class="plt-card-ic">${ICO.plano}</span>
      <span class="plt-card-tx">
        <small>${esc(nomeObra(p.obra_id) || 'Sem obra')}</small>
        <b>${esc(p.nome)}</b>
        <span class="plt-card-meta">
          <span class="plt-pill info">${fmtDL(dnum(p.data_inicio))}${r.fim ? ' → ' + fmtDL(r.fim) : ''}</span>
          ${r.n ? `<span class="plt-pill mute">${r.dias} dias úteis</span><span class="plt-pill mute">${r.n} tarefas</span>` : '<span class="plt-pill warn">Sem tarefas</span>'}
          ${r.valor ? `<span class="plt-pill ok">${eur0(r.valor)}</span>` : ''}
        </span>
      </span>
      <span class="plt-card-dt">Alterado ${p.updated_at ? new Date(p.updated_at).toLocaleDateString('pt-PT') : ''}</span>
    </button>`;
  }).join('');
  el.innerHTML = `${aviso}
    <div class="plt-lista-top">
      <div class="plt-lista-tx">${_planos.length ? `${_planos.length} plano${_planos.length > 1 ? 's' : ''}` : ''}</div>
      <button type="button" class="plt-btn pri" data-acao="novo">${ICO.plus}Novo plano de trabalhos</button>
    </div>
    ${_planos.length ? `<div class="plt-cards">${cards}</div>` : `<div class="plt-vazio-g">
      <div class="plt-vazio-ic">${ICO.plano}</div>
      <b>Ainda não há planos de trabalho</b>
      <p>Cria um plano a partir do articulado de uma obra (Lista de Preços ou ficheiro Excel/PDF) e ajusta-o num gráfico de Gantt.</p>
      <button type="button" class="plt-btn pri" data-acao="novo">${ICO.plus}Novo plano de trabalhos</button></div>`}`;
}

// ───────────────────────── página: plano aberto ─────────────────────────
async function abrirPlano(id) {
  await carregarFeriados();
  const p = _planos.find(x => x.id === id); if (!p) return;
  if (!Array.isArray(p.tarefas)) p.tarefas = [];
  if (!Array.isArray(p.equipas)) p.equipas = [];
  if (_plano !== p) { _undo = []; _redo = []; _ui.sel.clear(); _ui.vista = 'gantt'; }
  _plano = p;
  montarCalendario(); calcular();
  const el = $('plt-body');
  el.innerHTML = `
    <div class="plt-top">
      <button type="button" class="plt-ico-btn" data-acao="voltar" title="Voltar aos planos">${ICO.back}</button>
      <div class="plt-top-tx">
        <small>${esc(nomeObra(p.obra_id) || 'Sem obra')}</small>
        <b id="plt-titulo">${esc(p.nome)}</b>
      </div>
      <span id="plt-estado" class="plt-pill ok">Guardado</span>
      <div class="plt-top-acoes">
        <button type="button" class="plt-btn pri sm" data-acao="ia" title="Pedir alterações ou fazer perguntas ao assistente de IA">${ICO.ia}Assistente</button>
        <button type="button" class="plt-btn sec sm" data-acao="xls">${ICO.xls}Excel</button>
        <button type="button" class="plt-btn sec sm" data-acao="xml" title="Ficheiro XML que o MS Project abre (Ficheiro → Abrir)">${ICO.mpp}MS Project</button>
        <button type="button" class="plt-btn sec sm" data-acao="equipas" title="Equipas de trabalho: mão de obra e equipamentos">${ICO.equipas}Equipas</button>
        <button type="button" class="plt-btn sec sm" data-acao="definicoes">${ICO.cfg}Definições</button>
      </div>
    </div>
    <div class="plt-kpis" id="plt-kpis"></div>
    <div class="plt-tabs">
      <button type="button" class="plt-tab" data-vista="gantt">Gráfico de Gantt</button>
      <button type="button" class="plt-tab" data-vista="fin">Cronograma financeiro</button>
      <button type="button" class="plt-tab" data-vista="mo">Mão de obra</button>
      <button type="button" class="plt-tab" data-vista="eq">Equipamentos</button>
    </div>
    <div id="plt-vista"></div>`;
  pintarEstado();
  pintarPlano();
}

function pintarPlano() {
  if (!_plano || !$('plt-vista')) return;
  $('plt-titulo').textContent = _plano.nome;
  document.querySelectorAll('.plt-tab').forEach(b => b.classList.toggle('on', b.dataset.vista === _ui.vista));
  pintarKpis();
  if (_ui.vista === 'fin') pintarFinanceiro();
  else if (_ui.vista === 'mo' || _ui.vista === 'eq') pintarMapaRecursos(_ui.vista);
  else pintarGantt();
}

function pintarKpis() {
  const r = _R, T = _plano.tarefas;
  const tot = r.valor.reduce((s, v, i) => s + (r.pai[i] === -1 ? v : 0), 0);
  const folhas = T.map((t, i) => i).filter(i => !r.resumo[i]);
  const w = folhas.reduce((s, i) => s + Math.max(1, r.dur[i]), 0);
  const pct = w ? Math.round(folhas.reduce((s, i) => s + r.pct[i] * Math.max(1, r.dur[i]), 0) / w) : 0;
  const crit = folhas.filter(i => r.folga[i] <= 0 && !r.ms[i]).length;
  $('plt-kpis').innerHTML = `
    <div class="plt-kpi"><small>Início</small><b>${fmtDL(diaDe(r.S0))}</b></div>
    <div class="plt-kpi"><small>Conclusão</small><b>${T.length ? fmtDL(diaDe(r.PF)) : '—'}</b></div>
    <div class="plt-kpi"><small>Prazo</small><b>${T.length ? (r.PF - r.S0 + 1) + ' d.ú.' : '—'}</b><span>${T.length ? (diaDe(r.PF) - diaDe(r.S0) + 1) + ' dias de calendário' : ''}</span></div>
    <div class="plt-kpi"><small>Valor</small><b>${eur0(tot)}</b></div>
    <div class="plt-kpi"><small>Concluído</small><b>${pct}%</b></div>
    <div class="plt-kpi"><small>Tarefas críticas</small><b>${crit}</b></div>
    ${r.ciclo ? '<div class="plt-kpi bad"><small>Atenção</small><b>Ligações em ciclo</b><span>Rever as predecessoras</span></div>' : ''}`;
}

// ───────────────────────── Gantt ─────────────────────────
const COLS = [
  { k: 'id', t: '', w: 44 },
  { k: 'edt', t: 'EDT', w: 54 },
  { k: 'nome', t: 'Nome da tarefa', w: 300 },
  { k: 'dur', t: 'Duração', w: 78 },
  { k: 'ini', t: 'Início', w: 84 },
  { k: 'fim', t: 'Fim', w: 84 },
  { k: 'pred', t: 'Predecessoras', w: 104 },
  { k: 'eq', t: 'Equipas', w: 150 },
  { k: 'pct', t: '%', w: 54 },
  { k: 'valor', t: 'Valor', w: 112 },
];
// Colunas ocultas (preferência deste computador). O nº e o nome da tarefa estão sempre visíveis.
const LS_COLS = 'plt_cols_ocultas';
const COLS_FIXAS = ['id', 'nome'];
let _colsOcultas = new Set((() => { try { return JSON.parse(localStorage.getItem(LS_COLS) || '[]'); } catch (e) { return []; } })().filter(k => !COLS_FIXAS.includes(k)));
const colsVisiveis = () => COLS.filter(c => !_colsOcultas.has(c.k));
const gridW = () => colsVisiveis().reduce((s, c) => s + c.w, 0);
const cabecalhoGrelha = () => colsVisiveis().map(c => `<div class="c-${c.k}" data-col="${c.k}" style="width:${c.w}px" title="Botão direito: ocultar colunas">${c.t}</div>`).join('');
function estiloColunas() {
  let st = $('plt-cols-css');
  if (!st) { st = document.createElement('style'); st.id = 'plt-cols-css'; document.head.appendChild(st); }
  st.textContent = [..._colsOcultas].map(k => `#plt-gb .plt-r > .c-${k}{display:none}`).join(' ');
}
// aplica as colunas visíveis sem redesenhar o gráfico (mantém o scroll)
function aplicarColunas(antes) {
  try { localStorage.setItem(LS_COLS, JSON.stringify([..._colsOcultas])); } catch (e) { /* sem armazenamento */ }
  estiloColunas();
  const gh = document.querySelector('#plt-grid .plt-gh'), gb = $('plt-gb'), g = $('plt-grid');
  if (!gh || !gb || !g) return;
  gh.innerHTML = cabecalhoGrelha();
  gh.style.width = gb.style.width = gridW() + 'px';
  const w = g.offsetWidth;
  g.style.width = Math.max(220, Math.min(w >= antes - 2 ? gridW() : w, gridW())) + 'px';
  try { localStorage.setItem(LS_SPLIT, g.offsetWidth); } catch (e) { /* sem armazenamento */ }
}
function abrirMenuColunas(anchor, x, y, kHdr) {
  fecharMenu();
  const op = COLS.filter(c => !COLS_FIXAS.includes(c.k));
  const tit = k => (COLS.find(c => c.k === k) || {}).t || k;
  let h = '';
  if (kHdr && !COLS_FIXAS.includes(kHdr)) h += `<button type="button" class="plt-menu-i" data-ocultar="${kHdr}">${ICO.olhoX}<span>Ocultar «${tit(kHdr)}»</span></button><div class="plt-menu-sep"></div>`;
  h += '<div class="plt-menu-h">Colunas visíveis</div>';
  h += op.map(c => `<button type="button" class="plt-menu-i plt-menu-chk ${_colsOcultas.has(c.k) ? '' : 'on'}" data-col="${c.k}"><span class="plt-chk">${ICO.visto}</span><span>${c.t}</span></button>`).join('');
  h += `<div class="plt-menu-sep"></div><button type="button" class="plt-menu-i" data-todas="1">${ICO.olho}<span>Mostrar todas</span></button>`;
  document.body.insertAdjacentHTML('beforeend', `<div class="plt-menu" id="plt-menu" role="menu">${h}</div>`);
  const m = $('plt-menu');
  if (anchor) { const r = anchor.getBoundingClientRect(); x = r.left; y = r.bottom + 6; }
  m.style.left = Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8)) + 'px';
  m.style.top = Math.min(y, innerHeight - m.offsetHeight - 8) + 'px';
  m.addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    const antes = gridW();
    if (b.dataset.col) {
      const k = b.dataset.col;
      if (_colsOcultas.has(k)) _colsOcultas.delete(k); else _colsOcultas.add(k);
      b.classList.toggle('on', !_colsOcultas.has(k));
      return aplicarColunas(antes);                     // o menu fica aberto para escolher várias
    }
    if (b.dataset.ocultar) _colsOcultas.add(b.dataset.ocultar);
    if (b.dataset.todas) _colsOcultas.clear();
    fecharMenu(); aplicarColunas(antes);
  });
}

function escala() {
  const r = _R, px = ZOOM[_ui.zoom];
  let d0 = diaDe(r.S0), d1 = diaDe(r.S0) + 30;
  for (let i = 0; i < r.n; i++) { d0 = Math.min(d0, diaDe(r.es[i])); d1 = Math.max(d1, diaDe(r.ef[i])); }
  if (_ui.zoom === 'mes') { const a = new Date(d0 * DIA); d0 = Math.round(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1) / DIA); d1 += 62; }
  else { d0 -= 3; while (dow(d0) !== 1) d0--; d1 += _ui.zoom === 'dia' ? 14 : 35; }
  return { d0, d1, px, w: Math.ceil((d1 - d0 + 1) * px) };
}

function pintarGantt() {
  estiloColunas();
  const v = $('plt-vista');
  const splitW = Math.max(220, Math.min(gridW(), +(localStorage.getItem(LS_SPLIT) || 620)));
  const zb = z => `<button type="button" class="plt-seg-b ${_ui.zoom === z ? 'on' : ''}" data-zoom="${z}">${{ dia: 'Dias', semana: 'Semanas', mes: 'Meses' }[z]}</button>`;
  const tb = (acao, ic, txt, tit) => `<button type="button" class="plt-tb-b" data-acao="${acao}" title="${esc(tit || txt)}">${ic}<span>${txt}</span></button>`;
  const tbi = (acao, ic, tit) => `<button type="button" class="plt-tb-b ic" data-acao="${acao}" title="${esc(tit)}">${ic}</button>`;
  v.innerHTML = `
    <div class="plt-tb">
      ${tb('add', ICO.plus, 'Tarefa', 'Nova tarefa abaixo da selecionada (Insert)')}
      ${tb('marco', ICO.marco, 'Marco', 'Novo marco (duração 0)')}
      <span class="plt-tb-sep"></span>
      ${tbi('recuar', ICO.out, 'Recuar nível (Alt+Shift+←)')}
      ${tbi('avancar', ICO.ind, 'Avançar nível — passa a subtarefa da anterior (Alt+Shift+→)')}
      ${tbi('subir', ICO.up, 'Mover para cima')}
      ${tbi('descer', ICO.down, 'Mover para baixo')}
      <span class="plt-tb-sep"></span>
      ${tb('ligar', ICO.link, 'Ligar', 'Ligar as tarefas selecionadas (fim → início)')}
      ${tbi('desligar', ICO.unlink, 'Remover ligações das tarefas selecionadas')}
      ${tbi('info', ICO.info, 'Informações da tarefa (duplo clique)')}
      ${tbi('eliminar', ICO.del, 'Eliminar tarefas selecionadas (Delete)')}
      <span class="plt-tb-sep"></span>
      ${tbi('anular', ICO.undo, 'Anular (Ctrl+Z)')}
      ${tbi('refazer', ICO.redo, 'Refazer (Ctrl+Y)')}
      <span class="plt-tb-sep"></span>
      ${tb('colunas', ICO.colunas, 'Colunas', 'Mostrar ou ocultar colunas da tabela')}
      <span class="plt-tb-fill"></span>
      <button type="button" class="plt-tb-b ${_ui.critico ? 'on' : ''}" data-acao="critico" title="Realçar o caminho crítico">${ICO.crit}<span>Caminho crítico</span></button>
      ${tbi('hoje', ICO.hoje, 'Ir para hoje')}
      <div class="plt-seg">${zb('dia')}${zb('semana')}${zb('mes')}</div>
    </div>
    <div class="plt-gantt" id="plt-gantt">
      <div class="plt-grid" id="plt-grid" style="width:${splitW}px">
        <div class="plt-gh" style="width:${gridW()}px">${cabecalhoGrelha()}</div>
        <div class="plt-gb" id="plt-gb" style="width:${gridW()}px"></div>
      </div>
      <div class="plt-split" id="plt-split" title="Arrastar para redimensionar"></div>
      <div class="plt-chart" id="plt-chart"></div>
    </div>
    <div class="plt-ajuda">Duplo clique numa tarefa abre os detalhes · Predecessoras: <b>3</b> (fim→início), <b>3II</b>, <b>3TT</b>, <b>3IT</b>, com desfasamento <b>3+2</b> ou <b>3II-1</b> (dias úteis) · Duração: <b>5</b>, <b>2s</b> (semanas), <b>0</b> = marco · Arrastar a barra muda o início; arrastar a ponta direita muda a duração.</div>
    <div class="plt-tip" id="plt-tip"></div>`;
  pintarGrelha();
  pintarGrafico();
  ligarGantt();
}

function pintarGrelha() {
  const r = _R, T = _plano.tarefas;
  const linhas = r.vis.map(i => {
    const t = T[i], rs = r.resumo[i], sel = _ui.sel.has(i), crit = _ui.critico && r.folga[i] <= 0 && !rs;
    const ro = rs ? 'readonly tabindex="-1"' : '';
    const tg = rs ? `<button type="button" class="plt-tg" data-tg="${i}" title="${t.fechado ? 'Expandir' : 'Recolher'}">${t.fechado ? '▸' : '▾'}</button>` : '<span class="plt-tg0"></span>';
    const restr = t.inicioMin ? `<span class="plt-restr" title="Não iniciar antes de ${fmtD(dnum(t.inicioMin))}">${ICO.pin}</span>` : '';
    return `<div class="plt-r ${sel ? 'sel' : ''} ${rs ? 'rs' : ''} ${crit ? 'crit' : ''} ${r.ms[i] ? 'ms' : ''}" data-i="${i}">
      <div class="c-id">${i + 1}${restr}</div>
      <div class="c-edt">${r.edt[i]}</div>
      <div class="c-nome" style="padding-left:${6 + t.nivel * 18}px">${tg}${t.cod ? `<span class="plt-cod" title="Artigo ${esc(t.cod)}">${esc(t.cod)}</span>` : ''}<input data-f="nome" value="${esc(t.nome)}" spellcheck="false"/></div>
      <div class="c-dur">${temFases(t) ? `<span class="plt-fases-ic" title="Barra partida em ${t.fases.length} fases">${t.fases.length}×</span>` : ''}<input data-f="dur" value="${txtDur(durDe(i))}" ${ro} ${temFases(t) ? `title="${t.fases.map((f, k) => (k ? `pausa ${f.pausa} + ` : '') + f.dur).join(' + ')} d.ú."` : ''}/></div>
      <div class="c-ini"><input data-f="ini" value="${fmtD(diaDe(r.es[i]))}" ${ro}/></div>
      <div class="c-fim"><input data-f="fim" value="${fmtD(diaDe(r.ef[i]))}" ${ro || (r.ms[i] ? 'readonly tabindex="-1"' : '')}/></div>
      <div class="c-pred"><input data-f="pred" value="${esc(txtPred(i))}"/></div>
      <div class="c-eq ${rs || r.ms[i] ? 'ro' : ''}" ${rs || r.ms[i] ? '' : `data-eq="${i}" title="Clique para atribuir equipas"`}>${celulaEquipas(t, i)}</div>
      <div class="c-pct"><input data-f="pct" value="${r.pct[i]}%" ${ro}/></div>
      <div class="c-valor"><input data-f="valor" value="${r.valor[i] ? eur0(r.valor[i]) : ''}" ${ro}/></div>
    </div>`;
  }).join('');
  $('plt-gb').innerHTML = linhas + `<div class="plt-r novo"><div class="c-id"></div><div class="c-edt"></div><div class="c-nome" style="padding-left:24px"><input data-f="novo" placeholder="Escrever nova tarefa…"/></div></div>`;
}

function pintarGrafico() {
  const r = _R, T = _plano.tarefas, E = escala(), px = E.px;
  const X = n => (n - E.d0) * px;
  const H = (r.vis.length + 1) * ROW;
  // cabeçalho (2 níveis)
  let top = '', bot = '';
  const seg = (a, b, txt, cls) => `<div class="${cls}" style="left:${X(a)}px;width:${(b - a + 1) * px}px">${txt}</div>`;
  if (_ui.zoom === 'mes') {
    let a = E.d0;
    while (a <= E.d1) {
      const d = new Date(a * DIA), y = d.getUTCFullYear();
      const b = Math.min(E.d1, Math.round(Date.UTC(y + 1, 0, 1) / DIA) - 1);
      top += seg(a, b, y, 'plt-h1'); a = b + 1;
    }
    a = E.d0;
    while (a <= E.d1) {
      const d = new Date(a * DIA);
      const b = Math.min(E.d1, Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DIA) - 1);
      bot += seg(a, b, MES_ABR[d.getUTCMonth()], 'plt-h2'); a = b + 1;
    }
  } else {
    let a = E.d0;
    while (a <= E.d1) {
      const d = new Date(a * DIA);
      const b = Math.min(E.d1, Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DIA) - 1);
      top += seg(a, b, (b - a + 1) * px > 70 ? MESES[d.getUTCMonth()] + ' ' + d.getUTCFullYear() : MES_ABR[d.getUTCMonth()], 'plt-h1'); a = b + 1;
    }
    if (_ui.zoom === 'dia') {
      for (let a2 = E.d0; a2 <= E.d1; a2++) { const d = new Date(a2 * DIA); bot += seg(a2, a2, `<i>${DSEM[d.getUTCDay()]}</i>${d.getUTCDate()}`, 'plt-h2 d' + (eUtil(a2) ? '' : ' nu')); }
    } else {
      for (let a2 = E.d0; a2 <= E.d1; a2 += 7) { const d = new Date(a2 * DIA); bot += seg(a2, Math.min(E.d1, a2 + 6), d.getUTCDate() + ' ' + MES_ABR[d.getUTCMonth()], 'plt-h2'); }
    }
  }
  // fundo: dias não úteis
  let fundo = '';
  if (_ui.zoom !== 'mes') {
    let a = null;
    for (let d = E.d0; d <= E.d1 + 1; d++) {
      const nu = d <= E.d1 && !eUtil(d);
      if (nu && a == null) a = d;
      if (!nu && a != null) { fundo += `<div class="plt-nu" style="left:${X(a)}px;width:${(d - a) * px}px"></div>`; a = null; }
    }
  } else {
    // linhas de mês
    let a = E.d0;
    while (a <= E.d1) { fundo += `<div class="plt-vl" style="left:${X(a)}px"></div>`; const d = new Date(a * DIA); a = Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DIA); }
  }
  const hj = hojeN();
  if (hj >= E.d0 && hj <= E.d1) fundo += `<div class="plt-hoje" style="left:${X(hj) + px / 2}px" title="Hoje"></div>`;
  // barras
  const linha = new Map(r.vis.map((i, k) => [i, k]));
  let barras = '';
  r.vis.forEach((i, k) => {
    const t = T[i], y = k * ROW;
    const a = diaDe(r.es[i]), b = diaDe(r.ef[i]);
    const crit = _ui.critico && r.folga[i] <= 0;
    const tit = esc(`${t.nome}\n${fmtD(a)} → ${fmtD(b)} · ${txtDur(durDe(i))}${r.resumo[i] ? '' : ' · folga ' + Math.max(0, r.folga[i]) + ' d.ú.'}${r.valor[i] ? ' · ' + eur0(r.valor[i]) : ''}`);
    const sel = _ui.sel.has(i) ? ' sel' : '';
    const st = estiloCor(t);
    const cls = (t.estilo === 'tracejada' ? ' trac' : '') + sel;
    const critCls = crit ? (t.cor ? ' crit-o' : ' crit') : '';
    if (r.resumo[i]) {
      barras += `<div class="plt-bar rs${cls}" data-i="${i}" style="${st}top:${y + 10}px;left:${X(a)}px;width:${(b - a + 1) * px}px" title="${tit}"></div>`;
      const lb = textoBarra(t, i, a, b, esc(t.nome));
      if (lb) barras += `<div class="plt-lbl rs" style="top:${y}px;left:${X(b + 1) + 8}px">${lb}</div>`;
    } else if (r.ms[i]) {
      barras += `<div class="plt-bar ms${critCls}${cls}" data-i="${i}" style="${st}top:${y + 9}px;left:${X(a) + px / 2 - 7}px" title="${tit}"></div>`;
      const lb = textoBarra(t, i, a, b, fmtD(a));
      if (lb) barras += `<div class="plt-lbl" style="top:${y}px;left:${X(a) + px / 2 + 12}px">${lb}</div>`;
    } else if (temFases(t)) {
      // barra partida: um segmento por fase, linha pontilhada nas pausas; o progresso enche as fases por ordem
      const ini = iniciosFases(t, r.es[i]);
      let feito = r.pct[i] / 100 * t.dur;
      ini.forEach((o, k) => {
        const f = t.fases[k], a2 = diaDe(o), b2 = diaDe(o + f.dur - 1);
        const p = Math.max(0, Math.min(f.dur, feito)); feito -= p;
        if (k) {
          const fimAnt = diaDe(ini[k - 1] + t.fases[k - 1].dur - 1);
          barras += `<div class="plt-gap" style="top:${y + 15}px;left:${X(fimAnt + 1)}px;width:${Math.max(0, (a2 - fimAnt - 1) * px)}px"></div>`;
        }
        const tf = esc(`${t.nome} — ${f.nome || 'Fase ' + (k + 1)}\n${fmtD(a2)} → ${fmtD(b2)} · ${txtDur(f.dur)}${k ? ` · pausa de ${f.pausa} d.ú. antes` : ''}\nArrastar para mudar a pausa · botão direito para mais opções`);
        barras += `<div class="plt-bar seg${critCls}${cls}" data-i="${i}" data-k="${k}" style="${st}top:${y + 8}px;left:${X(a2)}px;width:${Math.max(4, (b2 - a2 + 1) * px)}px" title="${tf}"><div class="plt-prog" style="width:${p / f.dur * 100}%"></div>${f.nome && (b2 - a2 + 1) * px > 60 ? `<span class="plt-seg-nome">${esc(f.nome)}</span>` : ''}<div class="plt-rh"></div></div>`;
      });
      const lb = textoBarra(t, i, a, b, esc(t.nome));
      if (lb) barras += `<div class="plt-lbl" style="top:${y}px;left:${X(b + 1) + 6}px">${lb}</div>`;
    } else {
      barras += `<div class="plt-bar${critCls}${cls}" data-i="${i}" style="${st}top:${y + 8}px;left:${X(a)}px;width:${Math.max(4, (b - a + 1) * px)}px" title="${tit}"><div class="plt-prog" style="width:${r.pct[i]}%"></div><div class="plt-rh"></div></div>`;
      const lb = textoBarra(t, i, a, b, esc(t.nome));
      if (lb) barras += `<div class="plt-lbl" style="top:${y}px;left:${X(b + 1) + 6}px">${lb}</div>`;
    }
  });
  // ligações
  let setas = '';
  r.vis.forEach(i => {
    for (const p of r.preds[i]) {
      if (!linha.has(p.j)) continue;
      const ka = linha.get(p.j), kb = linha.get(i);
      const ya = ka * ROW + ROW / 2, yb = kb * ROW + ROW / 2;
      const a0 = X(diaDe(r.es[p.j])), a1 = X(diaDe(r.ef[p.j]) + 1), b0 = X(diaDe(r.es[i])), b1 = X(diaDe(r.ef[i]) + 1);
      const msA = r.ms[p.j], msB = r.ms[i];
      const pa0 = msA ? a0 + px / 2 : a0, pa1 = msA ? a0 + px / 2 + 7 : a1, pb0 = msB ? b0 + px / 2 - 8 : b0, pb1 = msB ? b0 + px / 2 + 8 : b1;
      const crit = _ui.critico && r.folga[i] <= 0 && r.folga[p.j] <= 0 && !r.resumo[i] && !r.resumo[p.j];
      const down = yb > ya ? 1 : -1;
      let d;
      if (p.tipo === 'SS') d = `M${pa0} ${ya}H${Math.min(pa0, pb0) - 10}V${yb}H${pb0 - 1}`;
      else if (p.tipo === 'FF') d = `M${pa1} ${ya}H${Math.max(pa1, pb1) + 10}V${yb}H${pb1 + 1}`;
      else if (p.tipo === 'SF') d = `M${pa0} ${ya}H${pa0 - 10}V${yb - down * ROW / 2}H${pb1 + 10}V${yb}H${pb1 + 1}`;
      else if (pb0 >= pa1 + 6) d = `M${pa1} ${ya}H${pb0 + 6}V${yb - down * 9}`;
      else d = `M${pa1} ${ya}H${pa1 + 8}V${yb - down * ROW / 2}H${pb0 - 10}V${yb}H${pb0 - 1}`;
      setas += `<path d="${d}" class="${crit ? 'crit' : ''}" marker-end="url(#plt-arr${crit ? 'c' : ''})"/>`;
    }
  });
  const ch = $('plt-chart');
  const sl = ch.scrollLeft, st = ch.scrollTop, primeira = !ch.dataset.pronto;
  ch.innerHTML = `
    <div class="plt-ch" style="width:${E.w}px"><div class="plt-ch1">${top}</div><div class="plt-ch2">${bot}</div></div>
    <div class="plt-cb" id="plt-cb" style="width:${E.w}px;height:${H}px">
      ${fundo}
      <svg class="plt-links" width="${E.w}" height="${H}"><defs>
        <marker id="plt-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" fill="#6b7489"/></marker>
        <marker id="plt-arrc" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" fill="#c62828"/></marker>
      </defs>${setas}</svg>
      ${barras}
    </div>`;
  ch.dataset.d0 = E.d0; ch.dataset.px = px;
  if (primeira) { ch.dataset.pronto = '1'; ch.scrollLeft = Math.max(0, X(diaDe(r.S0)) - 40); }
  else { ch.scrollLeft = sl; ch.scrollTop = st; }
  const g = $('plt-grid'); if (g) g.scrollTop = ch.scrollTop;
}

// ── Aparência das barras (por tarefa): t.cor, t.estilo ('solida'|'tracejada'), t.rotulo ──
const CORES_BARRA = [
  { k: '', nome: 'Automática' }, { k: '#5b86e5', nome: 'Azul' }, { k: '#43a047', nome: 'Verde' },
  { k: '#8e5bd8', nome: 'Roxo' }, { k: '#f08c2e', nome: 'Laranja' }, { k: '#e6b422', nome: 'Amarelo' },
  { k: '#1fa3a3', nome: 'Turquesa' }, { k: '#e05252', nome: 'Vermelho' }, { k: '#8a93a5', nome: 'Cinzento' }, { k: '#1b2130', nome: 'Preto' },
];
const ROTULOS_BARRA = [
  ['', 'Automático (nome; data nos marcos)'], ['nome', 'Nome da tarefa'], ['nome_datas', 'Nome e datas'],
  ['datas', 'Datas de início e fim'], ['dur', 'Duração'], ['pct', '% concluída'], ['equipas', 'Equipas'], ['nome_equipas', 'Nome e equipas'], ['nenhum', 'Nenhum'],
];
const corValida = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
function escurecer(hex, f = 0.75) {
  const n = parseInt(hex.slice(1), 16);
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(v * f).toString(16).padStart(2, '0')).join('');
}
const estiloCor = t => corValida(t.cor) ? `--c:${t.cor};--cb:${escurecer(t.cor)};` : '';
function textoBarra(t, i, a, b, auto) {
  switch (t.rotulo) {
    case 'nenhum': return '';
    case 'nome': return esc(t.nome);
    case 'datas': return `${fmtD(a)} – ${fmtD(b)}`;
    case 'nome_datas': return `${esc(t.nome)} <span class="plt-lbl-dt">${fmtD(a)} – ${fmtD(b)}</span>`;
    case 'dur': return txtDur(durDe(i));
    case 'pct': return _R.pct[i] + '%';
    case 'equipas': return esc(nomesEquipas(t)) || auto;
    case 'nome_equipas': return `${esc(t.nome)}${nomesEquipas(t) ? ` <span class="plt-lbl-dt">${esc(nomesEquipas(t))}</span>` : ''}`;
    default: return auto;
  }
}

function irPara(dia) {
  const ch = $('plt-chart'); if (!ch) return;
  ch.scrollLeft = Math.max(0, (dia - +ch.dataset.d0) * +ch.dataset.px - ch.clientWidth / 3);
}

// ───────────────────────── seleção e edição ─────────────────────────
function selecionar(i, e) {
  if (e && (e.ctrlKey || e.metaKey)) { _ui.sel.has(i) ? _ui.sel.delete(i) : _ui.sel.add(i); _ui.ancora = i; }
  else if (e && e.shiftKey && _ui.ancora >= 0) {
    const a = _R.vis.indexOf(_ui.ancora), b = _R.vis.indexOf(i);
    _ui.sel.clear();
    for (let k = Math.min(a, b); k <= Math.max(a, b); k++) _ui.sel.add(_R.vis[k]);
  } else { _ui.sel = new Set([i]); _ui.ancora = i; }
  document.querySelectorAll('#plt-gb .plt-r[data-i]').forEach(el => el.classList.toggle('sel', _ui.sel.has(+el.dataset.i)));
  document.querySelectorAll('#plt-cb .plt-bar').forEach(el => el.classList.toggle('sel', _ui.sel.has(+el.dataset.i)));
}
const selOrd = () => [..._ui.sel].filter(i => i < _plano.tarefas.length).sort((a, b) => a - b);
const fimBloco = i => { const T = _plano.tarefas; let k = i; while (k + 1 < T.length && T[k + 1].nivel > T[i].nivel) k++; return k; };

function editarCampo(i, f, val, input) {
  const T = _plano.tarefas, t = T[i], r = _R;
  const repor = () => { if (input) pintarGrelha(); };
  if (f === 'nome') { const v = val.trim(); if (!v || v === t.nome) return repor(); mudar(() => { t.nome = v; }); return; }
  if (f === 'dur') {
    const d = lerDur(val); if (d == null) { showToast('Duração inválida (ex.: 5, 5d, 2s)'); return repor(); }
    if (d === t.dur) return repor();
    mudar(() => { definirDur(t, d); }); return;
  }
  if (f === 'ini') {
    const iso = lerData(val, diaDe(r.es[i]));
    if (iso === null) { showToast('Data inválida (ex.: 25/11/26)'); return repor(); }
    mudar(() => { t.inicioMin = iso || null; if (iso && !eUtil(dnum(iso))) showToast('O início passa para o dia útil seguinte'); });
    return;
  }
  if (f === 'fim') {
    const iso = lerData(val, diaDe(r.ef[i]));
    if (!iso) { showToast('Data inválida (ex.: 25/11/26)'); return repor(); }
    const d = ordF(dnum(iso)) - r.es[i] + 1;
    if (d < 1) { showToast('O fim não pode ser anterior ao início'); return repor(); }
    mudar(() => { definirDur(t, temFases(t) ? t.dur + (d - spanDe(t)) : d); }); return;
  }
  if (f === 'pred') {
    calcular();
    const x = lerPred(val, i);
    if (x.erro) { showToast(x.erro); return repor(); }
    mudar(() => { t.pred = x.pred; }); return;
  }
  if (f === 'pct') {
    const v = parseFloat(String(val).replace('%', '').replace(',', '.'));
    if (isNaN(v)) return repor();
    mudar(() => { t.pct = Math.max(0, Math.min(100, Math.round(v))); }); return;
  }
  if (f === 'valor') {
    const v = parseFloat(String(val).replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
    mudar(() => { t.valor = v; }); return;
  }
  if (f === 'novo') {
    const v = val.trim(); if (!v) return;
    mudar(() => { T.push(novaTarefa(v, T.length ? T[T.length - 1].nivel : 0, 1)); _ui.sel = new Set([T.length - 1]); });
    setTimeout(() => $('plt-gb')?.querySelector('input[data-f="novo"]')?.focus(), 0);
  }
}

function novaTarefa(nome, nivel, dur) {
  return { id: uid(), nome, nivel, dur, pred: [], inicioMin: null, pct: 0, valor: 0, cod: '', un: '', qtd: 0, notas: '', fechado: false };
}

function acao(a) {
  const T = _plano?.tarefas; if (!T) return;
  const sel = selOrd();
  switch (a) {
    case 'add': case 'marco': {
      const i = sel.length ? sel[sel.length - 1] : -1;
      const pos = i >= 0 ? fimBloco(i) + 1 : T.length;
      const nv = i >= 0 ? T[i].nivel : (T.length ? T[T.length - 1].nivel : 0);
      mudar(() => { T.splice(pos, 0, novaTarefa(a === 'marco' ? 'Marco' : 'Nova tarefa', nv, a === 'marco' ? 0 : 1)); _ui.sel = new Set([pos]); _ui.ancora = pos; });
      setTimeout(() => { const inp = document.querySelector(`#plt-gb .plt-r[data-i="${pos}"] input[data-f="nome"]`); if (inp) { inp.focus(); inp.select(); } }, 0);
      break;
    }
    case 'avancar': {
      if (!sel.length) return showToast('Seleciona uma tarefa');
      mudar(() => {
        let ok = false; const feito = new Set();
        for (const i of sel) {
          if (feito.has(i) || i === 0 || T[i - 1].nivel < T[i].nivel) continue;
          const e = fimBloco(i);
          for (let k = i; k <= e; k++) { T[k].nivel++; feito.add(k); }
          ok = true;
        }
        if (!ok) { showToast('A primeira tarefa de um grupo não pode avançar de nível'); return false; }
        limparLigacoesResumo();
      });
      break;
    }
    case 'recuar': {
      if (!sel.length) return showToast('Seleciona uma tarefa');
      mudar(() => {
        let ok = false; const feito = new Set();
        for (const i of sel) {
          if (feito.has(i) || T[i].nivel === 0) continue;
          const e = fimBloco(i);
          for (let k = i; k <= e; k++) { T[k].nivel--; feito.add(k); }
          ok = true;
        }
        if (!ok) return false;
      });
      break;
    }
    case 'subir': case 'descer': {
      if (sel.length !== 1) return showToast('Seleciona uma tarefa');
      const i = sel[0], e = fimBloco(i), nv = T[i].nivel;
      if (a === 'subir') {
        let p = i - 1; while (p >= 0 && T[p].nivel > nv) p--;
        if (p < 0 || T[p].nivel !== nv) return;
        mudar(() => { const bl = T.splice(i, e - i + 1); T.splice(p, 0, ...bl); _ui.sel = new Set([p]); _ui.ancora = p; });
      } else {
        const q = e + 1; if (q >= T.length || T[q].nivel !== nv) return;
        const e2 = fimBloco(q);
        mudar(() => { const bl = T.splice(i, e - i + 1); const pos = i + (e2 - q + 1); T.splice(pos, 0, ...bl); _ui.sel = new Set([pos]); _ui.ancora = pos; });
      }
      break;
    }
    case 'ligar': {
      if (sel.length < 2) return showToast('Seleciona duas ou mais tarefas (Ctrl ou Shift + clique)');
      mudar(() => {
        for (let k = 1; k < sel.length; k++) {
          const a0 = sel[k - 1], b0 = sel[k];
          if (eAscendente(a0, b0) || eAscendente(b0, a0)) continue;
          const t = T[b0]; t.pred = t.pred || [];
          if (!t.pred.some(p => p.id === T[a0].id)) t.pred.push({ id: T[a0].id, tipo: 'FS', lag: 0 });
        }
      });
      break;
    }
    case 'desligar': {
      if (!sel.length) return showToast('Seleciona uma tarefa');
      const ids = new Set(sel.map(i => T[i].id));
      mudar(() => {
        if (sel.length === 1) { T[sel[0]].pred = []; T.forEach(t => { t.pred = (t.pred || []).filter(p => p.id !== T[sel[0]].id); }); }
        else sel.forEach(i => { T[i].pred = (T[i].pred || []).filter(p => !ids.has(p.id)); });
      });
      break;
    }
    case 'eliminar': {
      if (!sel.length) return showToast('Seleciona uma tarefa');
      const apagar = new Set();
      sel.forEach(i => { for (let k = i; k <= fimBloco(i); k++) apagar.add(k); });
      if (apagar.size > 1 && !confirm(`Eliminar ${apagar.size} tarefas?`)) return;
      mudar(() => {
        const ids = new Set([...apagar].map(i => T[i].id));
        _plano.tarefas = T.filter((t, i) => !apagar.has(i));
        _plano.tarefas.forEach(t => { t.pred = (t.pred || []).filter(p => !ids.has(p.id)); });
        _ui.sel.clear();
      });
      break;
    }
    case 'anular': anular(); break;
    case 'refazer': refazer(); break;
    case 'critico': _ui.critico = !_ui.critico; pintarGantt(); break;
    case 'hoje': irPara(hojeN()); break;
    case 'info': if (sel.length) abrirTarefa(sel[0]); else showToast('Seleciona uma tarefa'); break;
  }
}
// uma ligação entre uma tarefa e o seu resumo deixa de fazer sentido após mudar níveis
function limparLigacoesResumo() {
  calcular();
  const T = _plano.tarefas;
  T.forEach((t, i) => { t.pred = (t.pred || []).filter(p => { const j = _R.idx.get(p.id); return j != null && !eAscendente(j, i) && !eAscendente(i, j); }); });
}

// ───────────────────────── eventos do Gantt ─────────────────────────
function ligarGantt() {
  const gb = $('plt-gb'), ch = $('plt-chart'), g = $('plt-grid');
  // scroll vertical sincronizado
  let lock = false;
  ch.addEventListener('scroll', () => { if (lock) return; lock = true; g.scrollTop = ch.scrollTop; lock = false; });
  g.addEventListener('scroll', () => { if (lock) return; lock = true; ch.scrollTop = g.scrollTop; lock = false; });
  // grelha
  gb.addEventListener('mousedown', e => {
    const row = e.target.closest('.plt-r[data-i]'); if (!row) return;
    if (e.target.closest('.plt-tg')) return;
    const i = +row.dataset.i, mod = e.shiftKey || e.ctrlKey || e.metaKey;
    if (mod) { if (e.target.tagName === 'INPUT') e.preventDefault(); selecionar(i, e); }
    else if (!_ui.sel.has(i) || _ui.sel.size > 1) selecionar(i);
  });
  gb.addEventListener('click', e => {
    const ce = e.target.closest('[data-eq]');
    if (ce && !(e.shiftKey || e.ctrlKey || e.metaKey)) return abrirAtribuir([+ce.dataset.eq]);
    const tg = e.target.closest('.plt-tg'); if (!tg) return;
    const t = _plano.tarefas[+tg.dataset.tg]; t.fechado = !t.fechado;
    calcular(); pintarGrelha(); pintarGrafico(); agendarGravar();
  });
  gb.addEventListener('dblclick', e => { const row = e.target.closest('.plt-r[data-i]'); if (row && !e.target.closest('input[data-f="nome"]:not([readonly])')) abrirTarefa(+row.dataset.i); });
  gb.addEventListener('focusin', e => { const inp = e.target.closest('input'); if (inp && !inp.readOnly) { inp.dataset.orig = inp.value; if (inp.dataset.f !== 'nome' && inp.dataset.f !== 'novo') inp.select(); } });
  gb.addEventListener('change', e => {
    const inp = e.target.closest('input[data-f]'); if (!inp || inp.readOnly) return;
    const row = inp.closest('.plt-r');
    editarCampo(row.dataset.i != null ? +row.dataset.i : -1, inp.dataset.f, inp.value, inp);
  });
  gb.addEventListener('keydown', e => {
    const inp = e.target.closest('input[data-f]'); if (!inp) return;
    if (e.key === 'Escape') { inp.value = inp.dataset.orig ?? inp.value; inp.blur(); return; }
    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (inp.dataset.f === 'novo') { if (e.key === 'Enter') inp.blur(); return; }
      e.preventDefault();
      const row = inp.closest('.plt-r'), f = inp.dataset.f, i = +row.dataset.i;
      const k = _R.vis.indexOf(i) + (e.key === 'ArrowUp' ? -1 : 1);
      inp.blur();
      setTimeout(() => {
        const alvo = k >= _R.vis.length ? $('plt-gb').querySelector('input[data-f="novo"]') : (k >= 0 ? $('plt-gb').querySelector(`.plt-r[data-i="${_R.vis[k]}"] input[data-f="${f}"]`) : null);
        if (alvo) { if (k < _R.vis.length) selecionar(_R.vis[k]); alvo.focus(); }
      }, 0);
    }
  });
  // divisória
  $('plt-split').addEventListener('pointerdown', e => {
    const x0 = e.clientX, w0 = g.offsetWidth;
    e.target.setPointerCapture(e.pointerId);
    const mv = ev => { g.style.width = Math.max(220, Math.min(gridW(), w0 + ev.clientX - x0)) + 'px'; };
    const up = () => { e.target.removeEventListener('pointermove', mv); e.target.removeEventListener('pointerup', up); try { localStorage.setItem(LS_SPLIT, g.offsetWidth); } catch (er) {} };
    e.target.addEventListener('pointermove', mv); e.target.addEventListener('pointerup', up);
  });
  // barras: mover / alterar duração
  // barras: mover a tarefa, mudar a duração, ou (barra partida) mudar a pausa / a duração de uma fase
  ch.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;            // o botão direito abre o menu
    const bar = e.target.closest('.plt-bar'); if (!bar) return;
    const i = +bar.dataset.i, k = bar.dataset.k != null ? +bar.dataset.k : -1;
    selecionar(i, e);
    if (bar.classList.contains('rs')) return;
    e.preventDefault();
    const t = _plano.tarefas[i];
    const modo = e.target.classList.contains('plt-rh') ? 'dur' : (k > 0 ? 'fase' : 'mover');
    const ini = k >= 0 ? iniciosFases(t, _R.es[i])[k] : _R.es[i];
    const fim = k >= 0 ? ini + t.fases[k].dur - 1 : _R.ef[i];
    const px = +ch.dataset.px, x0 = e.clientX, l0 = bar.offsetLeft, w0 = bar.offsetWidth;
    const tip = $('plt-tip'); let dd = 0, valor = null;
    bar.setPointerCapture(e.pointerId);
    const mv = ev => {
      dd = Math.round((ev.clientX - x0) / px);
      if (!dd) { bar.style.left = l0 + 'px'; bar.style.width = w0 + 'px'; tip.style.display = 'none'; valor = null; return; }
      bar.classList.add('drag');
      if (modo === 'mover') {
        bar.style.left = (l0 + dd * px) + 'px';
        valor = diaDe(ordC(diaDe(ini) + dd));
        tip.textContent = 'Início: ' + fmtDL(valor);
      } else if (modo === 'fase') {
        bar.style.left = (l0 + dd * px) + 'px';
        valor = Math.max(0, t.fases[k].pausa + ordC(diaDe(ini) + dd) - ini);
        tip.textContent = `Pausa antes da fase ${k + 1}: ${valor} d.ú. · recomeça a ${fmtDL(diaDe(ini + valor - t.fases[k].pausa))}`;
      } else {
        bar.style.width = Math.max(px, w0 + dd * px) + 'px';
        valor = Math.max(1, ordF(diaDe(fim) + dd) - ini + 1);
        tip.textContent = (k >= 0 ? `Fase ${k + 1}: ` : 'Fim: ' + fmtDL(diaDe(ini + valor - 1)) + ' · ') + txtDur(valor);
      }
      tip.style.display = 'block'; tip.style.left = (ev.clientX + 14) + 'px'; tip.style.top = (ev.clientY + 14) + 'px';
    };
    const up = () => {
      bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up);
      tip.style.display = 'none';
      if (!dd || valor == null) return;
      mudar(() => {
        if (modo === 'mover') t.inicioMin = diso(valor);
        else if (modo === 'fase') t.fases[k].pausa = valor;               // pausa 0 = fase seguida à anterior
        else if (k >= 0) { t.fases[k].dur = valor; t.dur = t.fases.reduce((s, f) => s + f.dur, 0); }
        else definirDur(t, valor);
      });
    };
    bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up);
  });
  ch.addEventListener('dblclick', e => { const bar = e.target.closest('.plt-bar'); if (bar) abrirTarefa(+bar.dataset.i); });
  // botão direito: menu da barra (no gráfico) ou da tarefa (na grelha)
  ch.addEventListener('contextmenu', e => {
    const bar = e.target.closest('.plt-bar'); if (!bar) return;
    e.preventDefault();
    const i = +bar.dataset.i;
    if (!_ui.sel.has(i)) selecionar(i);
    const cb = $('plt-cb').getBoundingClientRect();
    const dia = +ch.dataset.d0 + Math.floor((e.clientX - cb.left) / +ch.dataset.px);
    abrirMenuBarra(i, dia, e.clientX, e.clientY);
  });
  gb.addEventListener('contextmenu', e => {
    const row = e.target.closest('.plt-r[data-i]'); if (!row) return;
    if (e.target.tagName === 'INPUT' && document.activeElement === e.target) return;   // a editar: menu normal (copiar/colar)
    e.preventDefault();
    const i = +row.dataset.i;
    if (!_ui.sel.has(i)) selecionar(i);
    abrirMenuBarra(i, null, e.clientX, e.clientY);
  });
  ch.addEventListener('scroll', fecharMenu);
  // botão direito no cabeçalho da tabela: ocultar esta coluna / escolher colunas
  g.querySelector('.plt-gh').addEventListener('contextmenu', e => {
    e.preventDefault();
    abrirMenuColunas(null, e.clientX, e.clientY, e.target.closest('[data-col]')?.dataset.col);
  });
  g.addEventListener('scroll', fecharMenu);
}

// ───────────────────────── menu do botão direito ─────────────────────────
const PAUSA_PADRAO = 5;
function fecharMenu() { $('plt-menu')?.remove(); }
function abrirMenuBarra(i, dia, x, y) {
  fecharMenu();
  const t = _plano.tarefas[i], r = _R;
  const folha = !r.resumo[i] && !r.ms[i];
  // ponto onde se pode partir: dia útil clicado, dentro de uma fase e depois do 1.º dia dela
  let partir = null;
  if (folha && dia != null) {
    const o = ordF(dia);
    const segs = temFases(t) ? iniciosFases(t, r.es[i]).map((a, k) => ({ a, d: t.fases[k].dur, k })) : [{ a: r.es[i], d: t.dur, k: 0 }];
    const s = segs.find(z => o >= z.a && o < z.a + z.d);
    if (s && o > s.a) partir = { k: s.k, off: o - s.a, dia: diaDe(o) };
  }
  const it = (a, ic, txt, extra = '') => `<button type="button" class="plt-menu-i ${extra}" data-m="${a}">${ic}<span>${txt}</span></button>`;
  let h = `<div class="plt-menu-h">${esc(t.nome)}</div>`;
  h += it('info', ICO.info, 'Definições da tarefa…');
  h += it('barra', ICO.pincel, folha ? 'Aparência e fases da barra…' : 'Aparência da barra…');
  if (folha) { const n = _ui.sel.has(i) ? selOrd().filter(eFolhaAtribuivel).length : 1; h += it('equipas', ICO.equipas, n > 1 ? `Atribuir equipas a ${n} tarefas…` : 'Atribuir equipas…'); }
  if (folha && t.dur >= 2) {
    h += '<div class="plt-menu-sep"></div>';
    h += partir ? it('partir', ICO.tesoura, `Partir a barra a ${fmtD(partir.dia)}`)
                : it('', ICO.tesoura, 'Partir a barra: clique dentro dela, no ponto de corte', 'off');
    if (temFases(t)) h += it('juntar', ICO.juntar, `Juntar as ${t.fases.length} fases`);
  }
  if (!r.resumo[i]) {
    h += '<div class="plt-menu-sep"></div>';
    h += r.pct[i] >= 100 ? it('pct0', ICO.desfazer100, 'Marcar como por concluir') : it('pct100', ICO.visto, 'Marcar como concluída');
  }
  h += it('eliminar', ICO.del, 'Eliminar tarefa', 'perigo');
  document.body.insertAdjacentHTML('beforeend', `<div class="plt-menu" id="plt-menu" role="menu">${h}</div>`);
  const m = $('plt-menu');
  const w = m.offsetWidth, hh = m.offsetHeight;
  m.style.left = Math.min(x, innerWidth - w - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - hh - 8) + 'px';
  m.addEventListener('click', ev => {
    const b = ev.target.closest('[data-m]'); if (!b || !b.dataset.m) return;
    fecharMenu();
    switch (b.dataset.m) {
      case 'info': abrirTarefa(i); break;
      case 'barra': abrirBarra(i); break;
      case 'equipas': abrirAtribuir(_ui.sel.has(i) && _ui.sel.size > 1 ? selOrd().filter(eFolhaAtribuivel) : [i]); break;
      case 'partir':
        mudar(() => {
          if (!temFases(t)) t.fases = [{ dur: t.dur, pausa: 0 }];
          const f = t.fases[partir.k];
          t.fases.splice(partir.k + 1, 0, { dur: f.dur - partir.off, pausa: PAUSA_PADRAO });
          f.dur = partir.off;
        });
        showToast(`Barra partida (pausa de ${PAUSA_PADRAO} d.ú.) — arraste a fase seguinte para ajustar a pausa`);
        break;
      case 'juntar': mudar(() => { delete t.fases; }); break;
      case 'pct100': mudar(() => { t.pct = 100; }); break;
      case 'pct0': mudar(() => { t.pct = 0; }); break;
      case 'eliminar': _ui.sel = new Set([i]); acao('eliminar'); break;
    }
  });
}
// fecha o menu ao clicar fora (mousedown, antes de qualquer re-render), com Esc ou ao sair da janela
document.addEventListener('mousedown', e => { if (!e.target.closest('#plt-menu, [data-acao="colunas"]')) fecharMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharMenu(); });
window.addEventListener('blur', fecharMenu);
window.addEventListener('resize', fecharMenu);

// ───────────────────────── painel «Aparência e fases da barra» ─────────────────────────
function abrirBarra(i) {
  const t = _plano.tarefas[i], r = _R;
  const folha = !r.resumo[i] && !r.ms[i];
  const rasc = {
    cor: corValida(t.cor) ? t.cor : '', estilo: t.estilo === 'tracejada' ? 'tracejada' : 'solida', rotulo: t.rotulo || '',
    fases: temFases(t) ? t.fases.map(f => ({ ...f })) : null,
  };
  const corpo = () => {
    const corAtual = rasc.cor || (r.ms[i] || r.resumo[i] ? '#1b2130' : '#5b86e5');
    let h = `<h4>Cor da barra</h4>
      <div class="plt-cores">${CORES_BARRA.map(c => `<button type="button" class="plt-cor ${rasc.cor === c.k ? 'on' : ''} ${c.k ? '' : 'auto'}" data-cor="${c.k}" title="${c.nome}" style="--c:${c.k || '#5b86e5'}">${c.k ? '' : 'A'}</button>`).join('')}
        <label class="plt-cor-out ${rasc.cor && !CORES_BARRA.some(c => c.k === rasc.cor) ? 'on' : ''}" title="Escolher outra cor"><input type="color" id="pb-cor" value="${corAtual}"/><span>Outra</span></label>
      </div>
      <p class="plt-nota">«Automática» usa o azul do plano e o vermelho do caminho crítico. Com uma cor escolhida, o caminho crítico aparece com um contorno vermelho.</p>
      <h4>Estilo</h4>
      <div class="plt-seg plt-seg-lg"><button type="button" class="plt-seg-b ${rasc.estilo === 'solida' ? 'on' : ''}" data-estilo="solida">Sólida</button><button type="button" class="plt-seg-b ${rasc.estilo === 'tracejada' ? 'on' : ''}" data-estilo="tracejada">Tracejada (provisória)</button></div>
      <div class="plt-f" style="margin-top:16px"><label>Texto ao lado da barra</label><select id="pb-rot">${ROTULOS_BARRA.map(([k, v]) => `<option value="${k}" ${rasc.rotulo === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`;
    if (folha) {
      h += '<h4>Fases da barra</h4>';
      if (!rasc.fases) {
        h += `<p class="plt-nota">A barra é contínua (${txtDur(t.dur)}). Parta-a quando o trabalho é feito em várias fases com paragens pelo meio — à espera de licenças, de material, de uma ligação dos SMAS ou de outra frente. Também pode clicar com o botão direito na barra, no ponto onde a quer partir.</p>
          ${t.dur >= 2 ? `<button type="button" class="plt-btn sec sm" data-b="partir2">${ICO.tesoura}Partir em 2 fases</button>` : '<p class="plt-nota">Uma tarefa de 1 dia não se pode partir.</p>'}`;
      } else {
        const trab = rasc.fases.reduce((s, f) => s + (f.dur | 0), 0), pausas = rasc.fases.reduce((s, f, k) => s + (k ? f.pausa | 0 : 0), 0);
        h += `<div class="plt-fases-prev">${rasc.fases.map((f, k) => `${k ? `<i style="flex:${Math.max(0, f.pausa | 0)}"></i>` : ''}<b style="flex:${Math.max(1, f.dur | 0)};--c:${corAtual}"></b>`).join('')}</div>
          <div class="plt-fases">
            <div class="plt-fase hd"><span>Fase</span><span>Pausa antes</span><span>Duração</span><span></span></div>
            ${rasc.fases.map((f, k) => `<div class="plt-fase">
              <input data-fk="${k}" data-ff="nome" value="${esc(f.nome || '')}" placeholder="Fase ${k + 1}"/>
              ${k ? `<input type="number" min="0" data-fk="${k}" data-ff="pausa" value="${f.pausa}"/>` : '<span class="plt-fase-0">—</span>'}
              <input type="number" min="1" data-fk="${k}" data-ff="dur" value="${f.dur}"/>
              ${k ? `<button type="button" class="plt-fase-x" data-b="juntar" data-k="${k}" title="Juntar à fase anterior">${ICO.x}</button>` : '<span></span>'}
            </div>`).join('')}
          </div>
          <p class="plt-nota">Trabalho: <b>${txtDur(trab)}</b> · pausas: <b>${txtDur(pausas)}</b> · a barra ocupa ${txtDur(trab + pausas)} úteis. Pausa e duração em dias úteis.</p>
          <div class="plt-fases-ac">
            <button type="button" class="plt-btn sec sm" data-b="mais" title="Parte a última fase ao meio">${ICO.plus}Mais uma fase</button>
            <button type="button" class="plt-btn sec sm" data-b="contínua">${ICO.juntar}Barra contínua</button>
          </div>`;
      }
    }
    return h;
  };
  const dr = mostrarGaveta(`Tarefa ${i + 1} · EDT ${r.edt[i]}`, t.nome, folha ? 'Aparência e fases da barra' : 'Aparência da barra', corpo(),
    `<button type="button" class="plt-btn sec" data-g="cancelar">Cancelar</button><button type="button" class="plt-btn pri" data-g="ok">Guardar</button>`);
  const body = dr.querySelector('.dd-b');
  const repintar = () => { const y = body.scrollTop; body.innerHTML = corpo(); body.scrollTop = y; };
  body.addEventListener('click', e => {
    const c = e.target.closest('[data-cor]'); if (c) { rasc.cor = c.dataset.cor; return repintar(); }
    const s = e.target.closest('[data-estilo]'); if (s) { rasc.estilo = s.dataset.estilo; return repintar(); }
    const b = e.target.closest('[data-b]'); if (!b) return;
    if (b.dataset.b === 'partir2') rasc.fases = [{ dur: Math.ceil(t.dur / 2), pausa: 0 }, { dur: Math.floor(t.dur / 2), pausa: PAUSA_PADRAO }];
    if (b.dataset.b === 'contínua') rasc.fases = null;
    if (b.dataset.b === 'juntar') { const k = +b.dataset.k; rasc.fases[k - 1].dur += rasc.fases[k].dur; rasc.fases.splice(k, 1); if (rasc.fases.length < 2) rasc.fases = null; }
    if (b.dataset.b === 'mais') {
      const u = rasc.fases[rasc.fases.length - 1];
      if (u.dur < 2) return showToast('A última fase tem só 1 dia: aumente-a antes de a partir');
      rasc.fases.push({ dur: Math.floor(u.dur / 2), pausa: PAUSA_PADRAO }); u.dur = Math.ceil(u.dur / 2);
    }
    repintar();
  });
  body.addEventListener('change', e => {
    if (e.target.id === 'pb-rot') { rasc.rotulo = e.target.value; return; }
    if (e.target.id === 'pb-cor') { rasc.cor = e.target.value; return repintar(); }
    const k = e.target.dataset.fk; if (k == null) return;
    const f = rasc.fases[+k], ff = e.target.dataset.ff;
    if (ff === 'nome') f.nome = e.target.value.trim();
    else f[ff] = Math.max(ff === 'dur' ? 1 : 0, parseInt(e.target.value, 10) || 0);
    repintar();
  });
  dr.querySelector('[data-g="cancelar"]').onclick = fecharGaveta;
  dr.querySelector('[data-g="ok"]').onclick = () => {
    mudar(() => {
      if (rasc.cor) t.cor = rasc.cor; else delete t.cor;
      if (rasc.estilo === 'tracejada') t.estilo = 'tracejada'; else delete t.estilo;
      if (rasc.rotulo) t.rotulo = rasc.rotulo; else delete t.rotulo;
      if (folha) {
        if (rasc.fases && rasc.fases.length > 1) { t.fases = rasc.fases.map(f => ({ dur: f.dur, pausa: f.pausa, ...(f.nome ? { nome: f.nome } : {}) })); t.dur = t.fases.reduce((s, f) => s + f.dur, 0); }
        else delete t.fases;
      }
    });
    fecharGaveta();
  };
}

function ligarTeclado() {
  if (_keysOk) return; _keysOk = true;
  const body = $('plt-body');
  body.addEventListener('click', e => {
    const b = e.target.closest('[data-acao],[data-abrir],[data-vista],[data-zoom],[data-mapa-per],[data-mapa-val]'); if (!b) return;
    if (b.dataset.mapaPer) { _ui.mapaPer = b.dataset.mapaPer; return pintarPlano(); }
    if (b.dataset.mapaVal) { _ui.mapaVal = b.dataset.mapaVal; return pintarPlano(); }
    if (b.dataset.abrir) return abrirPlano(b.dataset.abrir);
    if (b.dataset.vista) { _ui.vista = b.dataset.vista; return pintarPlano(); }
    if (b.dataset.zoom) { _ui.zoom = b.dataset.zoom; const ch = $('plt-chart'); if (ch) delete ch.dataset.pronto; return pintarGantt(); }
    const a = b.dataset.acao;
    if (a === 'novo') return abrirNovo();
    if (a === 'voltar') { fecharIA(); gravar(); _plano = null; _R = null; return renderPlanosTrabalho(); }
    if (a === 'definicoes') return abrirDefinicoes();
    if (a === 'equipas') return abrirEquipas();
    if (a === 'colunas') return $('plt-menu') ? fecharMenu() : abrirMenuColunas(b);
    if (a === 'atribuir') return abrirAtribuir(selOrd().filter(eFolhaAtribuivel));
    if (a === 'ia') return abrirIA();
    if (a === 'xls') return exportarExcel();
    if (a === 'xml') return exportarMSProject();
    acao(a);
  });
  document.addEventListener('keydown', e => {
    if (!_plano || _ui.vista !== 'gantt' || !$('plt-gantt') || !$('plt-gantt').offsetParent) return;
    if (document.querySelector('#plt-drawer.open')) return;
    const emInput = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && k.toLowerCase() === 'z' && !emInput) { e.preventDefault(); return anular(); }
    if ((e.ctrlKey || e.metaKey) && (k.toLowerCase() === 'y' || (e.shiftKey && k.toLowerCase() === 'z')) && !emInput) { e.preventDefault(); return refazer(); }
    if (e.altKey && e.shiftKey && k === 'ArrowRight') { e.preventDefault(); return acao('avancar'); }
    if (e.altKey && e.shiftKey && k === 'ArrowLeft') { e.preventDefault(); return acao('recuar'); }
    if (k === 'Insert') { e.preventDefault(); return acao('add'); }
    if (k === 'Delete' && !emInput) { e.preventDefault(); return acao('eliminar'); }
  });
}

// ───────────────────────── cronograma financeiro ─────────────────────────
function distribuicaoMensal() {
  const r = _R, T = _plano.tarefas;
  const meses = new Map();   // 'YYYY-MM' → índice
  const chave = n => diso(n).slice(0, 7);
  let a = diaDe(r.S0), b = diaDe(r.PF);
  const lista = [];
  for (let d = new Date(a * DIA); ; d.setUTCMonth(d.getUTCMonth() + 1, 1)) {
    const k = d.toISOString().slice(0, 7);
    if (k > chave(b)) break;
    meses.set(k, lista.length); lista.push(k);
  }
  const grupos = [];      // tarefas de topo
  const gi = new Map();
  T.forEach((t, i) => { if (r.pai[i] === -1) { gi.set(i, grupos.length); grupos.push({ i, nome: t.nome, edt: r.edt[i], valor: r.valor[i], m: new Array(lista.length).fill(0) }); } });
  T.forEach((t, i) => {
    if (r.resumo[i] || !r.valor[i]) return;
    let top = i; while (r.pai[top] !== -1) top = r.pai[top];
    const g = grupos[gi.get(top)];
    const dias = diasTrabalho(i);              // só os dias com trabalho (as pausas das fases não faturam)
    const porDia = r.valor[i] / dias.length;
    for (const o of dias) { const m = meses.get(chave(diaDe(o))); if (m != null) g.m[m] += porDia; }
  });
  return { lista, grupos: grupos.filter(g => g.valor) };
}

function pintarFinanceiro() {
  const v = $('plt-vista');
  if (!_plano.tarefas.length) { v.innerHTML = '<div class="plt-vazio">O plano ainda não tem tarefas.</div>'; return; }
  const { lista, grupos } = distribuicaoMensal();
  const total = grupos.reduce((s, g) => s + g.valor, 0);
  const mens = lista.map((_, k) => grupos.reduce((s, g) => s + g.m[k], 0));
  let ac = 0; const acum = mens.map(x => (ac += x));
  const nomeMes = k => { const [y, m] = k.split('-'); return MES_ABR[+m - 1] + ' ' + y.slice(2); };
  // gráfico: barras mensais + curva S
  const W = Math.max(640, lista.length * 64), Hh = 230, pl = 64, pr = 52, pt = 16, pb = 30;
  const maxM = Math.max(1, ...mens), cw = (W - pl - pr) / lista.length;
  const yM = x => pt + (Hh - pt - pb) * (1 - x / maxM), yA = x => pt + (Hh - pt - pb) * (1 - x / Math.max(1, total));
  let svg = '';
  for (let g = 0; g <= 4; g++) { const y = pt + (Hh - pt - pb) * g / 4; svg += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" class="gl"/><text x="${pl - 8}" y="${y + 4}" class="ax" text-anchor="end">${eur0(maxM * (1 - g / 4)).replace(' €', '')}</text><text x="${W - pr + 8}" y="${y + 4}" class="ax">${100 - g * 25}%</text>`; }
  lista.forEach((k, i) => {
    const x = pl + i * cw, h = Hh - pb - yM(mens[i]);
    svg += `<rect x="${x + cw * .18}" y="${yM(mens[i])}" width="${cw * .64}" height="${Math.max(0, h)}" rx="4" class="bm"><title>${nomeMes(k)}: ${eur2(mens[i])}</title></rect>`;
    svg += `<text x="${x + cw / 2}" y="${Hh - 10}" class="ax" text-anchor="middle">${nomeMes(k)}</text>`;
  });
  const pts = [`${pl},${yA(0)}`].concat(acum.map((a2, i) => `${pl + (i + 1) * cw},${yA(a2)}`)).join(' ');
  svg += `<polyline points="${pts}" class="cs"/>` + acum.map((a2, i) => `<circle cx="${pl + (i + 1) * cw}" cy="${yA(a2)}" r="3.5" class="csp"><title>Acumulado ${nomeMes(lista[i])}: ${eur2(a2)} (${total ? Math.round(a2 / total * 100) : 0}%)</title></circle>`).join('');
  const linhas = grupos.map(g => `<tr><td class="n"><span class="plt-edt">${g.edt}</span>${esc(g.nome)}</td><td class="v">${eur0(g.valor)}</td>${g.m.map(x => `<td class="${x ? '' : 'z'}">${x ? eur0(x) : '—'}</td>`).join('')}</tr>`).join('');
  v.innerHTML = `
    <div class="plt-fin-card">
      <div class="plt-fin-h"><b>Faturação prevista por mês</b><span><i class="lg bm"></i>Mensal <i class="lg cs"></i>Acumulado (curva S)</span></div>
      <div class="plt-fin-g"><svg width="${W}" height="${Hh}" class="plt-fin-svg">${svg}</svg></div>
    </div>
    <div class="plt-fin-card">
      <div class="plt-fin-t"><table class="plt-fin-tab">
        <thead><tr><th class="n">Capítulo</th><th class="v">Valor</th>${lista.map(k => `<th>${nomeMes(k)}</th>`).join('')}</tr></thead>
        <tbody>${linhas}</tbody>
        <tfoot>
          <tr><td class="n">Total mensal</td><td class="v">${eur0(total)}</td>${mens.map(x => `<td>${eur0(x)}</td>`).join('')}</tr>
          <tr><td class="n">Acumulado</td><td class="v"></td>${acum.map(x => `<td>${eur0(x)}</td>`).join('')}</tr>
          <tr><td class="n">% acumulada</td><td class="v"></td>${acum.map(x => `<td>${total ? (x / total * 100).toLocaleString('pt-PT', { maximumFractionDigits: 1 }) : 0}%</td>`).join('')}</tr>
        </tfoot>
      </table></div>
    </div>
    <div class="plt-ajuda">O valor de cada tarefa é distribuído por igual pelos seus dias úteis. Os valores vêm do articulado (ou da coluna «Valor» do Gantt).</div>`;
}

// ───────────────────────── painel lateral ─────────────────────────
function gaveta() {
  let dr = $('plt-drawer');
  if (!dr) {
    document.body.insertAdjacentHTML('beforeend', '<div class="d-scrim" id="plt-scrim"></div><aside class="d-drawer plt-drawer" id="plt-drawer" aria-hidden="true"></aside>');
    dr = $('plt-drawer');
    $('plt-scrim').addEventListener('click', fecharGaveta);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && dr.classList.contains('open')) fecharGaveta(); });
  }
  return dr;
}
function fecharGaveta() { $('plt-drawer')?.classList.remove('open'); $('plt-scrim')?.classList.remove('open'); }
function mostrarGaveta(sup, titulo, sub, corpo, rodape) {
  const dr = gaveta();
  dr.innerHTML = `
    <div class="dd-h">
      <button class="dd-x" data-g="fechar" aria-label="Fechar">${ICO.x}</button>
      <small>${esc(sup)}</small><h2>${esc(titulo)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}
    </div>
    <div class="dd-b">${corpo}</div>
    <div class="dd-f">${rodape}</div>`;
  dr.querySelector('[data-g="fechar"]').onclick = fecharGaveta;
  requestAnimationFrame(() => { dr.classList.add('open'); $('plt-scrim').classList.add('open'); });
  return dr;
}

// ── Novo plano ──
function proximaSegunda() { let n = hojeN() + 1; while (dow(n) !== 1) n++; return diso(n); }
function abrirNovo() {
  const obras = (S.OBRAS || []).filter(o => o.ativa !== false).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt'));
  _novo = { obra: obras[0]?.id ?? '', origem: 'lista', detalhe: 'artigos', ligacoes: 'seq', ficheiro: null, artigos: null };
  const corpo = `
    <div class="plt-f"><label>Obra</label><select id="pn-obra">${obras.map(o => `<option value="${esc(o.id)}">${esc(o.nome)}</option>`).join('')}<option value="">— Sem obra —</option></select></div>
    <div class="plt-f"><label>Nome do plano</label><input id="pn-nome"/></div>
    <div class="plt-f2">
      <div class="plt-f"><label>Data de início (consignação)</label><input id="pn-ini" type="date" value="${proximaSegunda()}"/></div>
      <div class="plt-f"><label>Calendário</label><select id="pn-cal"><option value="5">Segunda a sexta</option><option value="6">Segunda a sábado</option></select></div>
    </div>
    <h4>Tarefas a partir de</h4>
    <div class="plt-ops" id="pn-origem">
      <button type="button" class="plt-op" data-v="lista"><b>Lista de Preços da obra</b><small id="pn-lista-info"></small></button>
      <button type="button" class="plt-op" data-v="ficheiro"><b>Ficheiro do articulado</b><small>Excel ou PDF (mapa de quantidades)</small></button>
      <button type="button" class="plt-op" data-v="vazio"><b>Plano em branco</b><small>Escrever as tarefas à mão</small></button>
    </div>
    <div id="pn-fich" class="plt-fich" hidden>
      <label class="plt-drop"><input type="file" id="pn-file" accept=".xlsx,.xls,.csv,.pdf" hidden/><span id="pn-file-tx">Escolher ficheiro…</span></label>
    </div>
    <div id="pn-opts">
      <h4>Como criar o plano</h4>
      <div class="plt-f"><label>Detalhe</label><select id="pn-det"><option value="artigos">Capítulos e artigos (uma tarefa por artigo)</option><option value="3">Até ao 3.º nível (ex.: 2.3.1) — o resto soma no nível acima</option><option value="2">Até ao 2.º nível (ex.: 2.3)</option><option value="capitulos">Só capítulos (os artigos somam no capítulo)</option></select></div>
      <div class="plt-f2">
        <div class="plt-f"><label>Prazo da obra (dias úteis)</label><input id="pn-prazo" type="number" min="1" value="60"/></div>
        <div class="plt-f"><label>Ligações iniciais</label><select id="pn-lig"><option value="seq">Sequenciais (fim → início)</option><option value="cap">Sequenciais dentro de cada capítulo</option><option value="nao">Sem ligações</option></select></div>
      </div>
      <p class="plt-nota">As durações são distribuídas pelo prazo na proporção do valor de cada tarefa. É uma primeira proposta — depois ajusta-se no Gantt.</p>
      <div id="pn-prev" class="plt-prev"></div>
    </div>`;
  const dr = mostrarGaveta('Planos de trabalho', 'Novo plano de trabalhos', 'Gráfico de Gantt a partir do articulado', corpo,
    `<button type="button" class="plt-btn sec" data-g="cancelar">Cancelar</button><button type="button" class="plt-btn pri" data-g="criar">Criar plano</button>`);
  const atualizar = () => {
    _novo.obra = $('pn-obra').value;
    const o = obras.find(x => String(x.id) === String(_novo.obra));
    if (!$('pn-nome').dataset.mexido) $('pn-nome').value = 'Plano de trabalhos' + (o ? ' — ' + String(o.nome).replace(/^O\d{3}\s*-\s*/, '') : '');
    const art = _novo.obra ? puArticuladoDaObra(_novo.obra) : [];
    const nArt = art.filter(a => !a.isCapitulo).length;
    $('pn-lista-info').textContent = nArt ? `${nArt} artigos já importados` : 'Esta obra ainda não tem Lista de Preços';
    const bLista = dr.querySelector('.plt-op[data-v="lista"]');
    bLista.classList.toggle('off', !nArt);
    if (!nArt && _novo.origem === 'lista') _novo.origem = 'ficheiro';
    dr.querySelectorAll('.plt-op').forEach(b => b.classList.toggle('on', b.dataset.v === _novo.origem));
    $('pn-fich').hidden = _novo.origem !== 'ficheiro';
    $('pn-opts').hidden = _novo.origem === 'vazio';
    _novo.artigos = _novo.origem === 'lista' ? art : _novo.origem === 'ficheiro' ? _novo.ficheiro : null;
    const a = _novo.artigos || [];
    const caps = a.filter(x => x.isCapitulo).length, arts = a.filter(x => !x.isCapitulo), tot = arts.reduce((s, x) => s + (Number(x.total) || 0), 0);
    $('pn-prev').innerHTML = a.length ? `<span class="plt-pill info">${caps} capítulos</span><span class="plt-pill info">${arts.length} artigos</span>${tot ? `<span class="plt-pill ok">${eur0(tot)}</span>` : ''}` : (_novo.origem === 'ficheiro' ? '<span class="plt-pill mute">Nenhum ficheiro escolhido</span>' : '');
  };
  $('pn-obra').onchange = atualizar;
  $('pn-nome').oninput = () => { $('pn-nome').dataset.mexido = '1'; };
  dr.querySelector('#pn-origem').onclick = e => { const b = e.target.closest('.plt-op'); if (!b || b.classList.contains('off')) return; _novo.origem = b.dataset.v; atualizar(); };
  $('pn-file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    $('pn-file-tx').textContent = 'A ler ' + f.name + '…';
    try {
      const art = await puLerArticulado(f);
      _novo.ficheiro = art; $('pn-file-tx').textContent = f.name;
      if (!art.length) showToast('Nenhum artigo reconhecido no ficheiro');
    } catch (err) { console.error(err); _novo.ficheiro = null; $('pn-file-tx').textContent = 'Erro ao ler o ficheiro — escolher outro'; }
    atualizar();
  };
  dr.querySelector('[data-g="cancelar"]').onclick = fecharGaveta;
  dr.querySelector('[data-g="criar"]').onclick = criarPlano;
  atualizar();
}

async function criarPlano() {
  const nome = $('pn-nome').value.trim(), ini = $('pn-ini').value;
  if (!nome) return showToast('Indica o nome do plano');
  if (!ini) return showToast('Indica a data de início');
  let tarefas = [];
  if (_novo.origem !== 'vazio') {
    if (!_novo.artigos?.length) return showToast(_novo.origem === 'ficheiro' ? 'Escolhe o ficheiro do articulado' : 'Esta obra não tem Lista de Preços');
    tarefas = tarefasDoArticulado(_novo.artigos, {
      soCapitulos: $('pn-det').value === 'capitulos',
      maxNivel: parseInt($('pn-det').value, 10) || 0,
      prazo: Math.max(1, parseInt($('pn-prazo').value, 10) || 60),
      ligacoes: $('pn-lig').value,
    });
  }
  const p = { id: uid(), obra_id: _novo.obra || null, nome, data_inicio: ini, calendario: $('pn-cal').value, tarefas, equipas: [], updated_at: new Date().toISOString() };
  const btn = document.querySelector('#plt-drawer [data-g="criar"]'); btn.disabled = true; btn.textContent = 'A criar…';
  if (!_modoLocal) {
    const { error } = await sb.from('planos_trabalho').insert({ id: p.id, obra_id: p.obra_id, nome: p.nome, data_inicio: p.data_inicio, calendario: p.calendario, tarefas: p.tarefas, equipas: [] });
    if (error) {
      if (tabelaEmFalta(error)) { _modoLocal = true; _planos = lsLer(); }
      else { btn.disabled = false; btn.textContent = 'Criar plano'; return showToast('Erro ao criar: ' + error.message); }
    }
  }
  _planos.unshift(p);
  if (_modoLocal) lsGravarTodos();
  fecharGaveta();
  showToast(tarefas.length ? `Plano criado com ${tarefas.length} tarefas` : 'Plano criado');
  abrirPlano(p.id);
}

// Articulado (lista de capítulos/artigos) → tarefas com níveis, durações proporcionais ao valor e ligações
export function tarefasDoArticulado(artigos, { soCapitulos = false, maxNivel = 0, prazo = 60, ligacoes = 'seq' } = {}) {
  let out = [];
  const pilha = [];   // pilha: tarefas-capítulo abertas { cod, t }
  const segs = c => (c ? c.split('.').filter(Boolean).length : 0);
  const ePrefixo = (cap, cod) => cap.cod && cod && cod.startsWith(cap.cod + '.');
  // capítulo aberto mais fundo cujo código é prefixo deste (índice na pilha; -1 se nenhum)
  const prefixo = cod => { for (let k = pilha.length - 1; k >= 0; k--) if (ePrefixo(pilha[k], cod)) return k; return -1; };
  // nome da tarefa = 1.ª linha da descrição (o texto completo vai para as notas)
  const titulo = s => { const l = String(s || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean)[0] || ''; return l.length > 110 ? l.slice(0, 107).trimEnd() + '…' : l; };
  for (const a of artigos) {
    const cod = String(a.codigo || '').trim().replace(/\.$/, '');
    const desc = String(a.descricao || '').trim();
    const v = Number(a.total) || (Number(a.quantidade) || 0) * (Number(a.precoUnit) || 0);
    if (!/^\d/.test(cod) && !v) continue;          // notas e cabeçalhos soltos (sem código nem valor) não são tarefas
    const nome = titulo(desc) || cod;
    if (!nome) continue;
    const notas = (desc.includes('\n') || desc.length > 110) ? desc : '';
    if (a.isCapitulo) {
      const ult = pilha[pilha.length - 1];
      // o mesmo código repetido logo a seguir (título + descrição longa) é o mesmo capítulo
      if (ult && ult.cod === cod && out[out.length - 1] === ult.t) { if (!ult.t.notas) ult.t.notas = notas || desc; continue; }
      const k = prefixo(cod);
      if (k >= 0) pilha.length = k + 1;
      else pilha.length = (a.nivel === 1 && pilha.length) ? 1 : 0;
      const t = novaTarefa(nome, pilha.length, 1); t.cod = cod; t.notas = notas;
      out.push(t); pilha.push({ cod, t });
    } else {
      // só muda de capítulo quando o código encaixa (2.3.8 → 2.3); códigos trocados no articulado ficam no capítulo atual
      const k = prefixo(cod);
      if (k >= 0 && segs(cod) === segs(pilha[k].cod) + 1) pilha.length = k + 1;
      if (soCapitulos && pilha.length) { pilha[pilha.length - 1].t.valor += v; continue; }
      const t = novaTarefa(nome, pilha.length, 1);
      Object.assign(t, { cod, un: a.unidade || '', qtd: Number(a.quantidade) || 0, valor: v, notas });
      out.push(t);
    }
  }
  // normalizar níveis (nunca saltar mais do que um nível)
  for (let i = 1; i < out.length; i++) if (out[i].nivel > out[i - 1].nivel + 1) out[i].nivel = out[i - 1].nivel + 1;
  if (out.length) out[0].nivel = 0;
  // detalhe limitado: o que fica abaixo do nível máximo soma-se ao antepassado desse nível
  if (maxNivel > 0) {
    const fica = [];
    for (const t of out) {
      if (t.nivel < maxNivel) { fica.push(t); continue; }
      for (let k = fica.length - 1; k >= 0; k--) if (fica[k].nivel === maxNivel - 1) { fica[k].valor += t.valor; break; }
    }
    out = fica;
  }
  const eFolha = i => !(i + 1 < out.length && out[i + 1].nivel > out[i].nivel);
  // num plano só de capítulos, um capítulo-pai com subcapítulos passa o seu valor direto para o 1.º filho
  out.forEach((t, i) => { if (!eFolha(i) && t.valor) { out[i + 1].valor += t.valor; t.valor = 0; } });
  const folhas = out.map((t, i) => i).filter(eFolha);
  const tot = folhas.reduce((s, i) => s + out[i].valor, 0);
  folhas.forEach(i => { out[i].dur = Math.max(1, Math.round(tot > 0 ? prazo * out[i].valor / tot : prazo / folhas.length)); });
  // marcos de início e fim
  const consig = novaTarefa('Consignação da obra', 0, 0);
  const fim = novaTarefa('Conclusão da obra', 0, 0);
  if (ligacoes === 'seq') {
    let ant = consig;
    folhas.forEach(i => { out[i].pred = [{ id: ant.id, tipo: 'FS', lag: 0 }]; ant = out[i]; });
  } else if (ligacoes === 'cap') {
    // dentro de cada capítulo de topo em sequência; os capítulos começam todos na consignação
    let ant = null, top = -1;
    folhas.forEach(i => {
      let k = i; while (k > 0 && out[k].nivel > 0) k--;
      if (k !== top) { top = k; ant = consig; }
      out[i].pred = [{ id: ant.id, tipo: 'FS', lag: 0 }]; ant = out[i];
    });
  }
  const topo = out.filter(t => t.nivel === 0);
  fim.pred = (topo.length ? topo : []).map(t => ({ id: t.id, tipo: 'FS', lag: 0 }));
  return [consig, ...out, fim];
}

// ── Informações da tarefa ──
function abrirTarefa(i) {
  const T = _plano.tarefas, t = T[i], r = _R; if (!t) return;
  const rs = r.resumo[i];
  const predsHtml = (t.pred || []).map(p => {
    const j = r.idx.get(p.id); if (j == null) return '';
    return `<div class="dd-row"><div class="dd-tx"><b>${j + 1} · ${esc(T[j].nome)}</b><small>${TIPO_TXT[p.tipo]} (${TIPO_PT[p.tipo]})${p.lag ? ` · desfasamento ${p.lag > 0 ? '+' : ''}${p.lag} d.ú.` : ''}</small></div></div>`;
  }).join('') || '<div class="dd-vazio">Sem predecessoras.</div>';
  const succ = T.map((x, k) => (x.pred || []).some(p => p.id === t.id) ? k : -1).filter(k => k >= 0);
  const succHtml = succ.map(k => `<div class="dd-row"><div class="dd-tx"><b>${k + 1} · ${esc(T[k].nome)}</b></div></div>`).join('') || '<div class="dd-vazio">Nenhuma tarefa depende desta.</div>';
  const corpo = `
    <div class="dd-tiles">
      <div class="dd-tile"><small>Início</small><b>${fmtD(diaDe(r.es[i]))}</b></div>
      <div class="dd-tile"><small>Fim</small><b>${fmtD(diaDe(r.ef[i]))}</b></div>
      <div class="dd-tile"><small>Duração</small><b>${durDe(i)} d.ú.</b></div>
      <div class="dd-tile"><small>Folga total</small><b class="${r.folga[i] <= 0 ? 'plt-crit-t' : ''}">${Math.max(0, r.folga[i])} d.ú.</b></div>
    </div>
    <h4>Tarefa</h4>
    <div class="plt-f"><label>Nome</label><input id="pt-nome" value="${esc(t.nome)}"/></div>
    ${rs ? '' : `<div class="plt-f2">
      <div class="plt-f"><label>Duração (dias úteis)</label><input id="pt-dur" type="number" min="0" value="${t.dur}"/></div>
      <div class="plt-f"><label>% concluída</label><input id="pt-pct" type="number" min="0" max="100" value="${t.pct || 0}"/></div>
    </div>`}
    <div class="plt-f"><label>Não iniciar antes de</label><input id="pt-min" type="date" value="${t.inicioMin || ''}"/></div>
    <div class="plt-f"><label>Predecessoras</label><input id="pt-pred" value="${esc(txtPred(i))}" placeholder="ex.: 3; 5II+2"/></div>
    ${predsHtml}
    <h4>Sucessoras</h4>${succHtml}
    ${(t.cod || t.qtd) ? `<h4>Artigo do articulado</h4>
      <div class="dd-row"><div class="dd-tx"><b>${esc(t.cod || '—')}</b><small>${t.qtd ? `${t.qtd.toLocaleString('pt-PT')} ${esc(t.un || '')}` : ''}${t.valor ? ' · ' + eur2(t.valor) : ''}</small></div></div>` : ''}
    ${rs ? '' : `<div class="plt-f"><label>Valor (€)</label><input id="pt-valor" type="number" step="0.01" value="${t.valor || 0}"/></div>`}
    <div class="plt-f"><label>Notas</label><textarea id="pt-notas" rows="3">${esc(t.notas || '')}</textarea></div>`;
  const dr = mostrarGaveta(`Tarefa ${i + 1} · EDT ${r.edt[i]}`, t.nome, rs ? 'Tarefa de resumo — datas calculadas a partir das subtarefas' : (r.ms[i] ? 'Marco' : ''), corpo,
    `<button type="button" class="plt-btn sec" data-g="cancelar">Cancelar</button><button type="button" class="plt-btn pri" data-g="ok">Guardar</button>`);
  dr.querySelector('[data-g="cancelar"]').onclick = fecharGaveta;
  dr.querySelector('[data-g="ok"]').onclick = () => {
    const x = lerPred($('pt-pred').value, i);
    if (x.erro) return showToast(x.erro);
    const nome = $('pt-nome').value.trim(); if (!nome) return showToast('A tarefa precisa de nome');
    mudar(() => {
      t.nome = nome; t.pred = x.pred; t.inicioMin = $('pt-min').value || null; t.notas = $('pt-notas').value;
      if (!rs) { definirDur(t, $('pt-dur').value); t.pct = Math.max(0, Math.min(100, parseInt($('pt-pct').value, 10) || 0)); t.valor = parseFloat($('pt-valor').value) || 0; }
    });
    fecharGaveta();
  };
}

// ── Definições do plano ──
function abrirDefinicoes() {
  const p = _plano;
  const obras = (S.OBRAS || []).slice().sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt'));
  const corpo = `
    <div class="plt-f"><label>Nome do plano</label><input id="pd-nome" value="${esc(p.nome)}"/></div>
    <div class="plt-f"><label>Obra</label><select id="pd-obra"><option value="">— Sem obra —</option>${obras.map(o => `<option value="${esc(o.id)}" ${String(o.id) === String(p.obra_id) ? 'selected' : ''}>${esc(o.nome)}</option>`).join('')}</select></div>
    <div class="plt-f2">
      <div class="plt-f"><label>Data de início</label><input id="pd-ini" type="date" value="${p.data_inicio}"/></div>
      <div class="plt-f"><label>Calendário</label><select id="pd-cal"><option value="5" ${p.calendario !== '6' ? 'selected' : ''}>Segunda a sexta</option><option value="6" ${p.calendario === '6' ? 'selected' : ''}>Segunda a sábado</option></select></div>
    </div>
    <p class="plt-nota">Os feriados nacionais (tabela de feriados do portal) não contam como dias úteis.</p>
    <h4>Zona de perigo</h4>
    <button type="button" class="plt-btn del" data-g="apagar">${ICO.del}Eliminar este plano</button>`;
  const dr = mostrarGaveta('Plano de trabalhos', 'Definições', p.nome, corpo,
    `<button type="button" class="plt-btn sec" data-g="cancelar">Cancelar</button><button type="button" class="plt-btn pri" data-g="ok">Guardar</button>`);
  dr.querySelector('[data-g="cancelar"]').onclick = fecharGaveta;
  dr.querySelector('[data-g="ok"]').onclick = () => {
    const nome = $('pd-nome').value.trim(), ini = $('pd-ini').value;
    if (!nome || !ini) return showToast('Nome e data de início são obrigatórios');
    p.nome = nome; p.obra_id = $('pd-obra').value || null; p.data_inicio = ini; p.calendario = $('pd-cal').value;
    montarCalendario(); calcular(); fecharGaveta(); abrirPlano(p.id); agendarGravar();
  };
  dr.querySelector('[data-g="apagar"]').onclick = async () => {
    if (!confirm(`Eliminar o plano «${p.nome}»? Não é possível recuperar.`)) return;
    if (!_modoLocal) { const { error } = await sb.from('planos_trabalho').delete().eq('id', p.id); if (error) return showToast('Erro ao eliminar: ' + error.message); }
    _planos = _planos.filter(x => x.id !== p.id); if (_modoLocal) lsGravarTodos();
    _plano = null; _R = null; fecharGaveta(); renderPlanosTrabalho(); showToast('Plano eliminado');
  };
}

// ───────────────────────── exportar ─────────────────────────
const nomeFicheiro = () => { const f = _plano.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, ''); return /^plano/i.test(f) ? f : 'Plano_' + f; };

function exportarExcel() {
  if (!window.XLSX) return showToast('Excel indisponível');
  const r = _R, T = _plano.tarefas;
  const ds = n => diso(diaDe(n)).split('-').reverse().join('/');
  const rows = [['ID', 'EDT', 'Artigo', 'Nome da tarefa', 'Duração (d.ú.)', 'Início', 'Fim', 'Predecessoras', '% concluída', 'Folga (d.ú.)', 'Un.', 'Quantidade', 'Valor (€)']];
  T.forEach((t, i) => rows.push([i + 1, r.edt[i], t.cod || '', '    '.repeat(t.nivel) + t.nome, durDe(i), ds(r.es[i]), ds(r.ef[i]), txtPred(i), r.pct[i], r.resumo[i] ? '' : Math.max(0, r.folga[i]), t.un || '', t.qtd || '', Math.round(r.valor[i] * 100) / 100]));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [6, 8, 10, 60, 12, 11, 11, 16, 10, 10, 6, 11, 14].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, 'Plano de trabalhos');
  if (T.length) {
    const { lista, grupos } = distribuicaoMensal();
    const f = [['EDT', 'Capítulo', 'Valor (€)', ...lista]];
    grupos.forEach(g => f.push([g.edt, g.nome, Math.round(g.valor * 100) / 100, ...g.m.map(x => Math.round(x * 100) / 100)]));
    const mens = lista.map((_, k) => grupos.reduce((s, g) => s + g.m[k], 0));
    let ac = 0;
    f.push(['', 'Total mensal', Math.round(grupos.reduce((s, g) => s + g.valor, 0) * 100) / 100, ...mens.map(x => Math.round(x * 100) / 100)]);
    f.push(['', 'Acumulado', '', ...mens.map(x => Math.round((ac += x) * 100) / 100)]);
    const ws2 = XLSX.utils.aoa_to_sheet(f);
    ws2['!cols'] = [{ wch: 8 }, { wch: 50 }, { wch: 14 }, ...lista.map(() => ({ wch: 12 }))];
    XLSX.utils.book_append_sheet(wb, ws2, 'Cronograma financeiro');
  }
  ['mo', 'eq'].forEach(tp => { const m = mapaRecursos(tp, 'mes'); if (!m.cats.length) return;
    const f = [[tp === 'mo' ? 'Categoria' : 'Equipamento', ...m.periodos.map(x => x.rotulo + ' (máx.)'), 'Máximo', 'Total (dias)']];
    m.cats.forEach(c => f.push([c, ...m.periodos.map(x => x.max.get(c) || 0), m.maxCat.get(c) || 0, m.totCat.get(c) || 0]));
    f.push(['Total (simultâneo)', ...m.periodos.map(x => x.maxTot), m.maxGeral, m.totGeral]);
    const w3 = XLSX.utils.aoa_to_sheet(f); w3['!cols'] = [{ wch: 30 }, ...m.periodos.map(() => ({ wch: 13 })), { wch: 10 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, w3, tp === 'mo' ? 'Mapa de mão de obra' : 'Mapa de equipamento'); });
  XLSX.writeFile(wb, `${nomeFicheiro()}.xlsx`);
}

// XML do Microsoft Project (MSPDI) — abre no MS Project com Ficheiro → Abrir
function exportarMSProject() {
  const r = _R, T = _plano.tarefas;
  const x = s => esc(s);
  const dt = (n, h) => diso(diaDe(n)) + 'T' + h;
  const tipoMS = { FF: 0, FS: 1, SF: 2, SS: 3 };
  const fer = [..._feriados].filter(d => d >= diso(diaDe(r.S0) - 30) && d <= diso(diaDe(r.PF) + 400)).sort();
  const wt = '<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime><WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes>';
  const dias = [1, 2, 3, 4, 5, 6, 7].map(d => {
    const util = d >= 2 && d <= 6 || (d === 7 && _C.sab);
    return `<WeekDay><DayType>${d}</DayType><DayWorking>${util ? 1 : 0}</DayWorking>${util ? wt : ''}</WeekDay>`;
  }).join('') + fer.map(d => `<WeekDay><DayType>0</DayType><DayWorking>0</DayWorking><TimePeriod><FromDate>${d}T00:00:00</FromDate><ToDate>${d}T23:59:00</ToDate></TimePeriod></WeekDay>`).join('');
  const tarefas = T.map((t, i) => {
    const d = r.resumo[i] ? durDe(i) : r.dur[i];
    const links = r.preds[i].map(p => `<PredecessorLink><PredecessorUID>${p.j + 1}</PredecessorUID><Type>${tipoMS[p.tipo]}</Type><CrossProject>0</CrossProject><LinkLag>${p.lag * 4800}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`).join('');
    const notas = [t.cod ? 'Artigo ' + t.cod : '', t.qtd ? `${t.qtd} ${t.un || ''}` : '', r.valor[i] ? 'Valor: ' + eur2(r.valor[i]) : '', t.notas || ''].filter(Boolean).join(' · ');
    return `<Task><UID>${i + 1}</UID><ID>${i + 1}</ID><Name>${x(t.nome)}</Name><Active>1</Active><Manual>0</Manual><Type>1</Type>
<OutlineNumber>${r.edt[i]}</OutlineNumber><OutlineLevel>${t.nivel + 1}</OutlineLevel><WBS>${r.edt[i]}</WBS>
<Start>${dt(r.es[i], '08:00:00')}</Start><Finish>${dt(r.ef[i], r.ms[i] ? '08:00:00' : '17:00:00')}</Finish>
<Duration>PT${d * 8}H0M0S</Duration><DurationFormat>7</DurationFormat>
<Milestone>${r.ms[i] ? 1 : 0}</Milestone><Summary>${r.resumo[i] ? 1 : 0}</Summary><PercentComplete>${r.pct[i]}</PercentComplete>
${t.inicioMin ? `<ConstraintType>4</ConstraintType><ConstraintDate>${t.inicioMin}T08:00:00</ConstraintDate>` : '<ConstraintType>0</ConstraintType>'}
${notas ? `<Notes>${x(notas)}</Notes>` : ''}${links}</Task>`;
  }).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
<Name>${x(_plano.nome)}.xml</Name><Title>${x(_plano.nome)}</Title><Company>Plandese</Company>
<ScheduleFromStart>1</ScheduleFromStart><StartDate>${dt(r.S0, '08:00:00')}</StartDate>
<DefaultStartTime>08:00:00</DefaultStartTime><DefaultFinishTime>17:00:00</DefaultFinishTime>
<MinutesPerDay>480</MinutesPerDay><MinutesPerWeek>${_C.sab ? 2880 : 2400}</MinutesPerWeek><DaysPerMonth>${_C.sab ? 26 : 22}</DaysPerMonth>
<DurationFormat>7</DurationFormat><WeekStartDay>1</WeekStartDay><CalendarUID>1</CalendarUID>
<Calendars><Calendar><UID>1</UID><Name>Plandese</Name><IsBaseCalendar>1</IsBaseCalendar><BaseCalendarUID>-1</BaseCalendarUID><WeekDays>${dias}</WeekDays></Calendar></Calendars>
<Tasks>
${tarefas}
</Tasks>
</Project>`;
  const blob = new Blob([xml], { type: 'application/xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${nomeFicheiro()}.xml`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  showToast('Ficheiro para o MS Project descarregado (abrir com Ficheiro → Abrir)');
}

// ═══════════════════════════════════════════════════════════════════
//  ASSISTENTE DE IA DO PLANO (Edge Function agente-planos)
//  O agente recebe o plano calculado e devolve propostas (operações); nada muda sem «Aplicar».
//  Todas as operações de uma proposta são aplicadas como UM passo de anular (Ctrl+Z).
// ═══════════════════════════════════════════════════════════════════
const URL_IA = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agente-planos`;
const ANON_IA = import.meta.env.VITE_SUPABASE_KEY;
let _ia = { planoId: null, msgs: [], ctrl: null, min: false, novo: false };
const SUGESTOES_IA = [
  'Que tarefas estão no caminho crítico e onde há mais folga?',
  'Como posso encurtar o prazo em duas semanas?',
  'Não se trabalha entre 24/12 e 1/1: ajusta as tarefas afetadas',
  'Acrescenta um marco de receção provisória 5 dias úteis depois da conclusão',
];

// Resumo do plano (texto) enviado ao agente: tabela com o que se vê no Gantt
function resumoParaIA() {
  const r = _R, T = _plano.tarefas;
  const ds = o => diso(diaDe(o));
  const tot = r.valor.reduce((s, v, i) => s + (r.pai[i] === -1 ? v : 0), 0);
  const cab = [
    `Plano: ${_plano.nome}`,
    `Obra: ${nomeObra(_plano.obra_id) || '—'}`,
    `Data de início (consignação): ${_plano.data_inicio} · calendário: ${_plano.calendario === '6' ? 'segunda a sábado' : 'segunda a sexta'} (sem feriados nacionais)`,
    T.length ? `Conclusão calculada: ${ds(r.PF)} · prazo ${r.PF - r.S0 + 1} dias úteis (${diaDe(r.PF) - diaDe(r.S0) + 1} dias de calendário) · valor total ${tot.toFixed(2)} €` : 'O plano ainda não tem tarefas.',
    r.ciclo ? 'ATENÇÃO: há ligações em ciclo, as datas não são fiáveis.' : '',
    _ui.sel.size ? `Tarefas selecionadas pelo utilizador: ${selOrd().map(i => i + 1).join(', ')}` : '',
  ].filter(Boolean).join('\n');
  const linhas = T.map((t, i) => [
    i + 1, r.edt[i], t.nivel,
    (r.resumo[i] ? '[RESUMO] ' : '') + (r.ms[i] ? '[MARCO] ' : '') + t.nome,
    durDe(i), ds(r.es[i]), ds(r.ef[i]), txtPred(i) || '—', r.pct[i],
    r.valor[i] ? r.valor[i].toFixed(2) : '', r.resumo[i] ? '' : Math.max(0, r.folga[i]),
    !r.resumo[i] && r.folga[i] <= 0 ? 'sim' : '',
    t.cod || '', t.inicioMin || '', nomesEquipas(t) || '—',
    (temFases(t) ? `[barra partida: ${t.fases.map((f, k) => (k ? `pausa ${f.pausa} d.ú. → ` : '') + `${f.nome ? f.nome + ' ' : ''}${f.dur} d.ú.`).join(' → ')}] ` : '') + (t.notas || '').replace(/\s+/g, ' ').slice(0, 140),
  ].join(' | '));
  const eqs = equipasDoPlano();
  const secEq = eqs.length ? `EQUIPAS DO PLANO (nome: composição)\n${eqs.map(e => `- ${e.nome}: ${resumoComp(e) || 'sem composição'}`).join('\n')}` : 'EQUIPAS DO PLANO: nenhuma definida.';
  return `${cab}\n\n${secEq}\n\nTAREFAS\nID | EDT | nível | nome | duração (d.ú.) | início | fim | predecessoras | % | valor € | folga (d.ú.) | crítica | artigo | não iniciar antes de | equipas | notas\n${linhas.join('\n')}`;
}

function abrirIA() {
  if (!_plano) return;
  if (_ia.planoId !== _plano.id) { _ia.ctrl?.abort(); _ia = { planoId: _plano.id, msgs: [], ctrl: null, min: false, novo: false }; }
  let el = $('plt-ia');
  if (!el) {
    document.body.insertAdjacentHTML('beforeend', `
      <aside class="plt-ia" id="plt-ia" aria-label="Assistente do plano">
        <div class="plt-ia-h">
          <span class="plt-ia-ic">${ICO.ia}</span>
          <div class="plt-ia-ht"><small>Planos de Trabalho</small><b>Assistente do plano</b></div>
          <button type="button" class="plt-ia-x" data-ia="minimizar" aria-label="Minimizar" title="Minimizar (continua a trabalhar)">${ICO.minimizar}</button>
          <button type="button" class="plt-ia-x" data-ia="fechar" aria-label="Fechar" title="Fechar">${ICO.x}</button>
        </div>
        <div class="plt-ia-b" id="plt-ia-b"></div>
        <form class="plt-ia-f" id="plt-ia-form">
          <textarea id="plt-ia-in" rows="2" placeholder="Pede uma alteração ou faz uma pergunta sobre o plano…"></textarea>
          <button type="submit" class="plt-ia-env" id="plt-ia-env" aria-label="Enviar">${ICO.enviar}</button>
        </form>
      </aside>`);
    el = $('plt-ia');
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-ia]'); if (!b) return;
      const a = b.dataset.ia;
      if (a === 'fechar') return fecharIA();
      if (a === 'minimizar') return minimizarIA();
      if (a === 'sug') return enviarIA(b.textContent);
      if (a === 'aplicar') return aplicarProposta(+b.dataset.k);
      if (a === 'cancelar') { const m = _ia.msgs[+b.dataset.k]; if (m?.proposta) { m.proposta.estado = 'cancelada'; pintarIA(); } return; }
      if (a === 'anular') { anular(); const m = _ia.msgs[+b.dataset.k]; if (m?.proposta) { m.proposta.estado = 'anulada'; pintarIA(); } return; }
    });
    $('plt-ia-form').addEventListener('submit', e => { e.preventDefault(); if (_ia.ctrl) return _ia.ctrl.abort(); enviarIA($('plt-ia-in').value); });
    $('plt-ia-in').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('plt-ia-form').requestSubmit(); } });
  }
  vigiarSeccaoIA();
  _ia.min = false; _ia.novo = false;
  el.classList.add('open');
  pintarMiniIA();
  pintarIA();
  setTimeout(() => $('plt-ia-in')?.focus(), 50);
}
function fecharIA() {
  _ia.min = false;
  $('plt-ia')?.classList.remove('open');
  pintarMiniIA();
}
// Minimizar: o painel sai do ecrã mas o pedido continua; fica um indicador junto ao canto
function minimizarIA() {
  _ia.min = true; _ia.novo = false;
  $('plt-ia')?.classList.remove('open');
  pintarMiniIA();
}
function pintarMiniIA() {
  let m = $('plt-ia-mini');
  if (!_ia.min) { m?.classList.remove('open'); return; }
  if (!m) {
    document.body.insertAdjacentHTML('beforeend', '<button type="button" class="plt-ia-mini" id="plt-ia-mini" title="Abrir o assistente do plano"></button>');
    m = $('plt-ia-mini');
    m.addEventListener('click', () => abrirIA());
  }
  const ult = [..._ia.msgs].reverse().find(x => x.role === 'assistant');
  let txt, cls = '';
  if (_ia.ctrl) { txt = 'O assistente está a trabalhar…'; cls = 'a'; }
  else if (_ia.novo && ult?.proposta?.estado === 'pendente') { txt = 'Proposta pronta para aplicar'; cls = 'novo'; }
  else if (_ia.novo && ult?.erro) { txt = 'O assistente não conseguiu responder'; cls = 'erro'; }
  else if (_ia.novo) { txt = 'Resposta pronta'; cls = 'novo'; }
  else txt = 'Assistente do plano';
  m.className = 'plt-ia-mini open ' + cls;
  m.innerHTML = `${cls === 'a' ? '<span class="plt-ia-spin"></span>' : `<span class="plt-ia-mini-ic">${ICO.ia}</span>`}<span>${txt}</span>${cls === 'novo' || cls === 'erro' ? '<i class="plt-ia-mini-dot"></i>' : ''}`;
}
// O painel e o indicador vivem no <body>: escondem-se quando se sai da página dos planos
let _vigiaIA = false;
function vigiarSeccaoIA() {
  if (_vigiaIA) return;
  const sec = $('sec-planos-trabalho'); if (!sec) return;
  _vigiaIA = true;
  const ver = () => document.body.classList.toggle('plt-ia-fora', !sec.classList.contains('active'));
  new MutationObserver(ver).observe(sec, { attributes: true, attributeFilter: ['class'] });
  ver();
}

// Markdown mínimo: **negrito**, títulos (#), listas, tabelas simples, parágrafos
function mdIA(t) {
  const linhas = esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n');
  let out = '', lista = false, tab = null;
  const fechaLista = () => { if (lista) { out += '</ul>'; lista = false; } };
  const fechaTab = () => { if (tab) { out += `<div class="plt-ia-tab"><table>${tab.map((c, k) => `<tr>${c.map(x => k ? `<td>${x}</td>` : `<th>${x}</th>`).join('')}</tr>`).join('')}</table></div>`; tab = null; } };
  for (const l of linhas) {
    if (/^\s*\|.*\|\s*$/.test(l)) {
      fechaLista();
      if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) continue;   // linha separadora |---|
      (tab = tab || []).push(l.trim().slice(1, -1).split('|').map(x => x.trim()));
      continue;
    }
    fechaTab();
    const h = l.match(/^\s*#{1,6}\s+(.*)$/);
    if (h) { fechaLista(); out += `<p class="plt-ia-tit">${h[1]}</p>`; continue; }
    const m = l.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (m) { if (!lista) { out += '<ul>'; lista = true; } out += `<li>${m[1]}</li>`; continue; }
    fechaLista();
    out += l.trim() ? `<p>${l}</p>` : '';
  }
  fechaTab(); fechaLista();
  return out;
}

function pintarIA() {
  if (_ia.min) pintarMiniIA();
  const b = $('plt-ia-b'); if (!b) return;
  const env = $('plt-ia-env');
  if (env) { env.innerHTML = _ia.ctrl ? ICO.parar : ICO.enviar; env.classList.toggle('stop', !!_ia.ctrl); env.setAttribute('aria-label', _ia.ctrl ? 'Parar' : 'Enviar'); }
  if (!_ia.msgs.length) {
    b.innerHTML = `<div class="plt-ia-vazio">
      <p>Pede-me alterações ao plano em linguagem natural — eu preparo as operações e tu confirmas com <b>Aplicar</b> (anulável com Ctrl+Z). Também respondo a perguntas sobre prazos, folgas e o caminho crítico.</p>
      <div class="plt-ia-sugs">${SUGESTOES_IA.map(s => `<button type="button" class="plt-ia-sug" data-ia="sug">${esc(s)}</button>`).join('')}</div>
    </div>`;
    return;
  }
  b.innerHTML = _ia.msgs.map((m, k) => {
    if (m.role === 'user') return `<div class="plt-ia-m eu">${esc(m.content).replace(/\n/g, '<br>')}</div>`;
    let h = '';
    if (m.content) h += `<div class="plt-ia-m ia">${mdIA(m.content)}</div>`;
    if (m.ferr) h += `<div class="plt-ia-ferr"><span class="plt-ia-spin"></span>${esc(m.ferr)}…</div>`;
    if (m.proposta) h += cartaoProposta(m.proposta, k);
    if (m.erro) h += `<div class="plt-ia-erro">${esc(m.erro)}</div>`;
    if (!m.content && !m.ferr && !m.proposta && !m.erro && _ia.ctrl) h += `<div class="plt-ia-ferr"><span class="plt-ia-spin"></span>A pensar…</div>`;
    return h;
  }).join('');
  b.scrollTop = b.scrollHeight;
}

// ── Descrição das operações (para o cartão) ──
function descreverOps(p) {
  const novos = {};
  p.operacoes.forEach(o => { if (o.op === 'adicionar' && o.ref) novos[String(o.ref).toUpperCase()] = o.nome; });
  const nm = ref => {
    if (ref == null || ref === '') return '?';
    const s = String(ref).trim(), m = s.match(/^N(\d+)$/i);
    if (m) return `«${esc(novos['N' + m[1]] || s)}» (nova)`;
    const n = parseInt(s, 10);
    return p.nomes[n - 1] != null ? `${n} · «${esc(p.nomes[n - 1])}»` : `${esc(s)} (?)`;
  };
  const lig = (tipo, lag) => `${tipo || 'TI'}${lag ? (lag > 0 ? ' +' : ' ') + lag + ' d.ú.' : ''}`;
  const dt = iso => (iso ? iso.split('-').reverse().join('/') : '');
  return p.operacoes.map(o => {
    switch (o.op) {
      case 'adicionar': {
        const onde = o.dentro_de ? ` dentro de ${nm(o.dentro_de)}` : o.depois_de ? ` a seguir a ${nm(o.depois_de)}` : ' no fim';
        const pr = (o.pred || []).length ? ` · depois de ${o.pred.map(x => `${nm(x.id)} (${lig(x.tipo, x.desfasamento)})`).join(', ')}` : '';
        return `<b>Nova</b> «${esc(o.nome)}» — ${o.dur === 0 ? 'marco' : (o.dur ?? 1) + ' d.ú.'}${onde}${pr}${o.valor ? ` · ${eur0(o.valor)}` : ''}${o.inicio_min ? ` · não antes de ${dt(o.inicio_min)}` : ''}`;
      }
      case 'editar': {
        const c = [];
        if (o.nome) c.push(`nome → «${esc(o.nome)}»`);
        if (o.dur != null) c.push(o.dur === 0 ? 'passa a marco' : `duração → ${o.dur} d.ú.`);
        if (o.inicio_min === '') c.push('sem restrição de início');
        else if (o.inicio_min) c.push(`não iniciar antes de ${dt(o.inicio_min)}`);
        if (o.pct != null) c.push(`${o.pct}% concluída`);
        if (o.valor != null) c.push(`valor → ${eur0(o.valor)}`);
        if (o.notas != null) c.push('notas');
        return `${nm(o.id)}: ${c.join(', ') || 'sem alterações'}`;
      }
      case 'predecessoras': return `${nm(o.id)}: predecessoras → ${(o.pred || []).length ? o.pred.map(x => `${nm(x.id)} (${lig(x.tipo, x.desfasamento)})`).join(', ') : 'nenhuma'}`;
      case 'ligar': return `<b>Ligar</b> ${nm(o.de)} → ${nm(o.para)} (${lig(o.tipo, o.desfasamento)})`;
      case 'desligar': return `<b>Retirar ligação</b> ${nm(o.de)} → ${nm(o.para)}`;
      case 'eliminar': return `<b>Eliminar</b> ${nm(o.id)} (e subtarefas)`;
      case 'mover': return `<b>Mover</b> ${nm(o.id)} ${o.dentro_de ? 'para dentro de ' + nm(o.dentro_de) : 'para a seguir a ' + nm(o.depois_de)}`;
      case 'nivel': return `${Number(o.delta) > 0 ? '<b>Avançar</b>' : '<b>Recuar</b>'} nível de ${nm(o.id)}`;
      case 'definir_equipa': return `<b>Equipa</b> «${esc(o.nome)}»: ${[...(o.mao_de_obra || []).map(x => `${x.qtd} ${esc(x.categoria)}`), ...(o.equipamentos || []).map(x => `${x.qtd} ${esc(x.tipo)}`)].join(', ') || 'sem alterações à composição'}`;
      case 'equipas': return `${nm(o.id)}: equipas → ${(o.equipas || []).length ? o.equipas.map(x => `${esc(x.nome)}${x.n > 1 ? ' ×' + x.n : ''}`).join(', ') : 'nenhuma'}`;
      case 'fases': {
        const l = Array.isArray(o.fases) ? o.fases : [];
        if (l.length < 2) return `${nm(o.id)}: <b>barra contínua</b> (juntar as fases)`;
        const tot = l.reduce((a, f) => a + (parseInt(f.dur, 10) || 0), 0);
        return `<b>Partir</b> ${nm(o.id)} em ${l.length} fases (${tot} d.ú. de trabalho): ${l.map((f, k) => `${k && f.pausa ? `pausa ${f.pausa} d.ú. → ` : ''}${f.nome ? esc(f.nome) + ' ' : ''}${f.dur} d.ú.`).join(' · ')}`;
      }
      case 'plano': {
        const c = [];
        if (o.data_inicio) c.push(`início → ${dt(o.data_inicio)}`);
        if (o.calendario) c.push(o.calendario === '6' ? 'calendário segunda a sábado' : 'calendário segunda a sexta');
        if (o.nome_plano) c.push(`nome → «${esc(o.nome_plano)}»`);
        return `<b>Plano</b>: ${c.join(', ')}`;
      }
      default: return esc(o.op);
    }
  });
}

function cartaoProposta(p, k) {
  const itens = descreverOps(p);
  const pend = p.estado === 'pendente';
  const n = p.resultado?.feitas;
  const est = {
    aplicada: `<span class="plt-pill ok">Aplicada${n ? ` · ${n} ${n === 1 ? 'alteração' : 'alterações'}` : ''}</span>`,
    cancelada: '<span class="plt-pill mute">Cancelada</span>',
    anulada: '<span class="plt-pill mute">Anulada</span>',
    obsoleta: '<span class="plt-pill warn">O plano mudou — pede de novo</span>',
  }[p.estado] || '';
  const erros = p.resultado?.erros?.length ? `<div class="plt-ia-perr">Não foi possível aplicar:<ul>${p.resultado.erros.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  return `<div class="plt-ia-card ${pend ? '' : 'feito'}">
    <div class="plt-ia-card-h"><b>${esc(p.resumo)}</b><small>${itens.length} ${itens.length === 1 ? 'alteração' : 'alterações'}</small></div>
    <ol class="plt-ia-ops">${itens.map(t => `<li>${t}</li>`).join('')}</ol>
    ${erros}
    <div class="plt-ia-card-f">${pend
      ? `<button type="button" class="plt-btn sec sm" data-ia="cancelar" data-k="${k}">Cancelar</button><button type="button" class="plt-btn pri sm" data-ia="aplicar" data-k="${k}">Aplicar</button>`
      : est + (p.estado === 'aplicada' ? `<button type="button" class="plt-btn sec sm" data-ia="anular" data-k="${k}">Anular</button>` : '')}</div>
  </div>`;
}

// ── Conversa ──
async function enviarIA(texto) {
  texto = String(texto || '').trim();
  if (!texto || _ia.ctrl || !_plano) return;
  $('plt-ia-in').value = '';
  calcular();
  // propostas por decidir deixam de valer quando se faz um novo pedido
  _ia.msgs.forEach(m => { if (m.proposta?.estado === 'pendente') m.proposta.estado = 'cancelada'; });
  _ia.msgs.push({ role: 'user', content: texto });
  const atual = { role: 'assistant', content: '', ferr: '', proposta: null, erro: '' };
  _ia.msgs.push(atual);
  // o que o agente viu: linha (ID) → tarefa, para aplicar certo mesmo que se mexa no plano entretanto
  const ids = _plano.tarefas.map(t => t.id), nomes = _plano.tarefas.map(t => t.nome);
  const historico = _ia.msgs.slice(0, -1).map(m => {
    if (m.role === 'user') return { role: 'user', content: m.content };
    let c = m.content || '';
    if (m.proposta) c += `\n\n[Proposta «${m.proposta.resumo}» com ${m.proposta.operacoes.length} operações — ${m.proposta.estado}${m.proposta.resultado?.erros?.length ? `; erros: ${m.proposta.resultado.erros.join('; ')}` : ''}]`;
    return { role: 'assistant', content: c.trim() };
  }).filter(m => m.content);
  _ia.ctrl = new AbortController();
  pintarIA();
  try {
    const { data } = await sb.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error('Sessão expirada. Volte a iniciar sessão.');
    const r = await fetch(URL_IA, {
      method: 'POST', signal: _ia.ctrl.signal,
      headers: { Authorization: 'Bearer ' + token, apikey: ANON_IA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mensagens: historico, plano: resumoParaIA() }),
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || ('Erro ' + r.status)); }
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const linha = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!linha) continue;
        let ev; try { ev = JSON.parse(linha); } catch (_) { continue; }
        if (ev.type === 'texto') { atual.content += ev.texto; atual.ferr = ''; }
        else if (ev.type === 'ferramenta') { atual.ferr = ev.rotulo || ev.nome; if (atual.content && !/\n\n$/.test(atual.content)) atual.content += '\n\n'; }
        else if (ev.type === 'propostas') { atual.ferr = ''; atual.proposta = { resumo: ev.resumo, operacoes: ev.operacoes || [], ids, nomes, estado: 'pendente', resultado: null }; }
        else if (ev.type === 'erro') { atual.erro = ev.mensagem; atual.ferr = ''; }
        pintarIA();
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') atual.content += atual.content ? '\n\n(interrompido)' : '(interrompido)';
    else atual.erro = String(e.message || e);
  } finally {
    atual.ferr = '';
    if (!atual.content && !atual.proposta && !atual.erro) atual.erro = 'Sem resposta do assistente.';
    _ia.ctrl = null;
    if (_ia.min) _ia.novo = true;
    pintarIA();
  }
}

function aplicarProposta(k) {
  const m = _ia.msgs[k], p = m?.proposta;
  if (!p || p.estado !== 'pendente' || !_plano) return;
  if (_ia.planoId !== _plano.id) { p.estado = 'obsoleta'; pintarIA(); return; }
  p.resultado = aplicarOperacoes(p.operacoes, p.ids);
  p.estado = p.resultado.feitas ? 'aplicada' : 'cancelada';
  const n = p.resultado.feitas;
  if (n) showToast(`${n} ${n === 1 ? 'alteração aplicada' : 'alterações aplicadas'} — Ctrl+Z para anular`);
  pintarIA();
}

// Aplica as operações do agente como um único passo de anular
function aplicarOperacoes(ops, ids) {
  const erros = [];
  let feitas = 0, mudouPlano = false;
  const antes = JSON.stringify(_plano.tarefas);
  const antesPlano = { data_inicio: _plano.data_inicio, calendario: _plano.calendario, nome: _plano.nome };
  const T = _plano.tarefas;
  const novos = {};
  const uidDe = ref => {
    if (ref == null || ref === '') return null;
    const s = String(ref).trim(), m = s.match(/^N(\d+)$/i);
    if (m) return novos['N' + m[1]] || null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? (ids[n - 1] || null) : null;
  };
  const pos = u => (u ? T.findIndex(t => t.id === u) : -1);
  const precisa = ref => { const i = pos(uidDe(ref)); if (i < 0) throw new Error(`tarefa ${ref} não encontrada`); return i; };
  const fim = i => { let k = i; while (k + 1 < T.length && T[k + 1].nivel > T[i].nivel) k++; return k; };
  const eResumo = i => i + 1 < T.length && T[i + 1].nivel > T[i].nivel;
  const tipoDe = t => TIPO_IN[String(t || 'TI').toUpperCase()] || 'FS';
  const limpaNome = n => String(n).replace(/\[(MARCO|RESUMO)\]\s*/gi, '').trim().slice(0, 200);
  const predsDe = (lista, self) => {
    const out = [];
    for (const x of lista || []) {
      const u = uidDe(x.id);
      if (!u || pos(u) < 0) throw new Error(`predecessora ${x.id} não encontrada`);
      if (u === self || out.some(y => y.id === u)) continue;
      out.push({ id: u, tipo: tipoDe(x.tipo), lag: parseInt(x.desfasamento, 10) || 0 });
    }
    return out;
  };
  ops.forEach((o, k) => {
    try {
      switch (o.op) {
        case 'adicionar': {
          let p = T.length, nv = 0;
          if (o.dentro_de) { const a = precisa(o.dentro_de); p = fim(a) + 1; nv = T[a].nivel + 1; }
          else if (o.depois_de) { const a = precisa(o.depois_de); p = fim(a) + 1; nv = T[a].nivel; }
          const t = novaTarefa(limpaNome(o.nome), nv, o.dur != null ? Math.max(0, parseInt(o.dur, 10) || 0) : 1);
          if (o.inicio_min) t.inicioMin = o.inicio_min;
          if (o.valor != null) t.valor = Number(o.valor) || 0;
          if (o.notas) t.notas = String(o.notas);
          if (o.pred) t.pred = predsDe(o.pred, t.id);
          T.splice(p, 0, t);
          if (o.ref) novos[String(o.ref).trim().toUpperCase()] = t.id;
          break;
        }
        case 'editar': {
          const i = precisa(o.id), t = T[i];
          if (o.dur != null && eResumo(i)) throw new Error('não se muda a duração de uma tarefa de resumo');
          if (o.nome) t.nome = limpaNome(o.nome);
          if (o.dur != null) definirDur(t, o.dur);
          if (o.inicio_min != null) t.inicioMin = o.inicio_min || null;
          if (o.pct != null) t.pct = Math.max(0, Math.min(100, parseInt(o.pct, 10) || 0));
          if (o.valor != null) t.valor = Number(o.valor) || 0;
          if (o.notas != null) t.notas = String(o.notas);
          break;
        }
        case 'predecessoras': { const i = precisa(o.id); T[i].pred = predsDe(o.pred, T[i].id); break; }
        case 'ligar': {
          const a = uidDe(o.de); if (pos(a) < 0) throw new Error(`tarefa ${o.de} não encontrada`);
          const t = T[precisa(o.para)]; if (t.id === a) throw new Error('uma tarefa não se liga a si própria');
          t.pred = (t.pred || []).filter(x => x.id !== a);
          t.pred.push({ id: a, tipo: tipoDe(o.tipo), lag: parseInt(o.desfasamento, 10) || 0 });
          break;
        }
        case 'desligar': {
          const a = uidDe(o.de), t = T[precisa(o.para)];
          const n0 = (t.pred || []).length;
          t.pred = (t.pred || []).filter(x => x.id !== a);
          if (t.pred.length === n0) throw new Error('essa ligação não existe');
          break;
        }
        case 'eliminar': {
          const i = precisa(o.id), e = fim(i);
          const fora = new Set(T.slice(i, e + 1).map(t => t.id));
          T.splice(i, e - i + 1);
          T.forEach(t => { t.pred = (t.pred || []).filter(x => !fora.has(x.id)); });
          break;
        }
        case 'mover': {
          const i = precisa(o.id), e = fim(i);
          const alvoU = uidDe(o.dentro_de || o.depois_de);
          if (pos(alvoU) < 0) throw new Error(`tarefa ${o.dentro_de || o.depois_de} não encontrada`);
          if (T.slice(i, e + 1).some(t => t.id === alvoU)) throw new Error('não se move uma tarefa para dentro de si própria');
          const bloco = T.splice(i, e - i + 1);
          const a = pos(alvoU), p = fim(a) + 1, nv = T[a].nivel + (o.dentro_de ? 1 : 0), d = nv - bloco[0].nivel;
          bloco.forEach(t => { t.nivel += d; });
          T.splice(p, 0, ...bloco);
          break;
        }
        case 'nivel': {
          const i = precisa(o.id), e = fim(i), d = Number(o.delta) > 0 ? 1 : -1;
          if (d > 0 && (i === 0 || T[i - 1].nivel < T[i].nivel)) throw new Error('a primeira tarefa de um grupo não pode avançar de nível');
          if (d < 0 && T[i].nivel === 0) throw new Error('a tarefa já está no primeiro nível');
          for (let q = i; q <= e; q++) T[q].nivel += d;
          break;
        }
        case 'fases': {
          const i = precisa(o.id), t = T[i];
          if (eResumo(i)) throw new Error('uma tarefa de resumo não se parte');
          const lista = (Array.isArray(o.fases) ? o.fases : []).map((f, k) => ({
            dur: Math.max(1, parseInt(f.dur, 10) || 1), pausa: k ? Math.max(0, parseInt(f.pausa, 10) || 0) : 0,
            ...(f.nome ? { nome: String(f.nome).trim().slice(0, 80) } : {}),
          }));
          if (lista.length < 2) { delete t.fases; if (lista.length) t.dur = lista[0].dur; }
          else { t.fases = lista; t.dur = lista.reduce((a, f) => a + f.dur, 0); }
          break;
        }
        case 'definir_equipa': {
          const nome = String(o.nome || '').trim().slice(0, 80);
          if (!nome) throw new Error('falta o nome da equipa');
          const eqs = equipasDoPlano();
          let e = eqs.find(x => x.nome.toLowerCase() === nome.toLowerCase());
          if (!e) { e = { id: uid(), nome, cor: CORES_EQUIPA[eqs.length % CORES_EQUIPA.length], mo: [], eq: [] }; eqs.push(e); }
          if (Array.isArray(o.mao_de_obra)) e.mo = o.mao_de_obra.filter(x => x && x.categoria && +x.qtd > 0).map(x => ({ cat: String(x.categoria).trim().slice(0, 60), qtd: Math.round(+x.qtd) }));
          if (Array.isArray(o.equipamentos)) e.eq = o.equipamentos.filter(x => x && x.tipo && +x.qtd > 0).map(x => ({ tipo: String(x.tipo).trim().slice(0, 60), qtd: Math.round(+x.qtd) }));
          break;
        }
        case 'equipas': {
          const i = precisa(o.id), t = T[i];
          if (eResumo(i)) throw new Error('as equipas atribuem-se às tarefas, não aos resumos');
          const lista = (Array.isArray(o.equipas) ? o.equipas : []).map(x => {
            const e = equipasDoPlano().find(y => y.nome.toLowerCase() === String(x.nome || '').trim().toLowerCase());
            if (!e) throw new Error(`não existe a equipa «${x.nome}»`);
            return { id: e.id, n: Math.max(1, Math.min(20, parseInt(x.n, 10) || 1)) };
          });
          if (lista.length) t.equipas = lista; else delete t.equipas;
          break;
        }
        case 'plano': {
          if (o.data_inicio) { _plano.data_inicio = o.data_inicio; mudouPlano = true; }
          if (o.calendario === '5' || o.calendario === '6') { _plano.calendario = o.calendario; mudouPlano = true; }
          if (o.nome_plano) _plano.nome = String(o.nome_plano).trim().slice(0, 200);
          break;
        }
        default: throw new Error('operação desconhecida');
      }
      feitas++;
    } catch (e) {
      erros.push(`${k + 1}.ª (${o.op}): ${e.message || e}`);
    }
  });
  // níveis coerentes (nunca saltar mais do que um nível)
  for (let i = 0; i < T.length; i++) {
    const max = i === 0 ? 0 : T[i - 1].nivel + 1;
    if (T[i].nivel > max) T[i].nivel = max;
    if (T[i].nivel < 0) T[i].nivel = 0;
  }
  if (mudouPlano) montarCalendario();
  limparLigacoesResumo();
  if (feitas) {
    _undo.push(antes); if (_undo.length > 60) _undo.shift();
    _redo = [];
    _ui.sel.clear();
    depoisDeMudar();
    if (mudouPlano) showToast(`Datas do plano alteradas (antes: início ${antesPlano.data_inicio}) — o Ctrl+Z não repõe o início nem o calendário`);
  }
  return { feitas, erros };
}

// ═══════════════════════════════════════════════════════════════════
//  EQUIPAS DE TRABALHO, MAPA DE MÃO DE OBRA E MAPA DE EQUIPAMENTO
//  _plano.equipas = [{ id, nome, cor, mo: [{ cat, qtd }], eq: [{ tipo, qtd }] }]
//  Cada tarefa: t.equipas = [{ id, n }] (n = nº de equipas iguais na tarefa).
//  Os mapas somam, em cada dia de trabalho da tarefa (sem as pausas das fases), a composição das equipas.
// ═══════════════════════════════════════════════════════════════════
const MO_SUGESTOES = ['Encarregado', 'Chefe de equipa', 'Pedreiro', 'Servente', 'Canalizador', 'Calceteiro', 'Carpinteiro de cofragem', 'Armador de ferro', 'Eletricista', 'Serralheiro', 'Pintor', 'Manobrador', 'Motorista', 'Topógrafo', 'Técnico de segurança'];
const EQ_SUGESTOES = ['Retroescavadora', 'Giratória', 'Mini-giratória', 'Mini-pá carregadora', 'Pá carregadora', 'Camião basculante', 'Camião grua', 'Dumper', 'Cilindro', 'Placa vibratória', 'Saltitão', 'Martelo pneumático', 'Compressor', 'Gerador', 'Bomba de água', 'Serra de corte de pavimento', 'Betoneira', 'Grua', 'Plataforma elevatória', 'Carrinha de apoio'];
const CORES_EQUIPA = ['#5b86e5', '#43a047', '#f08c2e', '#8e5bd8', '#1fa3a3', '#e05252', '#e6b422', '#8a93a5'];
const MODELOS_EQUIPA = [
  { nome: 'Valas e tubagem', mo: [['Encarregado', 1], ['Manobrador', 1], ['Canalizador', 1], ['Servente', 2]], eq: [['Retroescavadora', 1], ['Camião basculante', 1], ['Placa vibratória', 1]] },
  { nome: 'Ligações e acessórios', mo: [['Canalizador', 2], ['Servente', 1]], eq: [['Mini-giratória', 1], ['Carrinha de apoio', 1]] },
  { nome: 'Construção civil', mo: [['Pedreiro', 2], ['Servente', 2]], eq: [['Betoneira', 1], ['Carrinha de apoio', 1]] },
  { nome: 'Pavimentação', mo: [['Calceteiro', 1], ['Manobrador', 2], ['Servente', 2]], eq: [['Pá carregadora', 1], ['Cilindro', 1], ['Camião basculante', 1]] },
  { nome: 'Estaleiro e apoio', mo: [['Encarregado', 1], ['Servente', 1]], eq: [['Carrinha de apoio', 1]] },
];
const equipasDoPlano = () => (Array.isArray(_plano.equipas) ? _plano.equipas : (_plano.equipas = []));
const equipaPorId = id => equipasDoPlano().find(e => e.id === id);
const atribDe = t => (Array.isArray(t.equipas) ? t.equipas : []).filter(a => equipaPorId(a.id));
const eFolhaAtribuivel = i => _R && !_R.resumo[i] && !_R.ms[i];
const nomesEquipas = t => atribDe(t).map(a => equipaPorId(a.id).nome + (a.n > 1 ? ' ×' + a.n : '')).join(', ');
const resumoComp = e => [
  ...(e.mo || []).filter(x => x.cat && x.qtd > 0).map(x => `${x.qtd} ${x.cat}`),
  ...(e.eq || []).filter(x => x.tipo && x.qtd > 0).map(x => `${x.qtd} ${x.tipo}`),
].join(', ');

function celulaEquipas(t, i) {
  if (_R.resumo[i]) {
    // resumo: equipas usadas nas subtarefas (só leitura)
    const ids = new Set(_R.folhas[i].flatMap(c => atribDe(_plano.tarefas[c]).map(a => a.id)));
    return ids.size ? `<span class="plt-eq-mais">${ids.size} equipa${ids.size > 1 ? 's' : ''}</span>` : '';
  }
  if (_R.ms[i]) return '';
  const at = atribDe(t);
  if (!at.length) return '<span class="plt-eq-vazio">+ equipa</span>';
  return at.map(a => { const e = equipaPorId(a.id); return `<span class="plt-eq-pill" style="--c:${e.cor || '#5b86e5'}" title="${esc(e.nome)}: ${esc(resumoComp(e))}">${esc(e.nome)}${a.n > 1 ? ' ×' + a.n : ''}</span>`; }).join('');
}

// listas de sugestões (datalist) para categorias e equipamentos
function garantirListas() {
  if ($('plt-dl-mo')) return;
  const funcs = [...new Set((S.COLABORADORES || []).filter(c => c.ativo !== false && c.func).map(c => String(c.func).trim()))];
  const mo = [...new Set([...MO_SUGESTOES, ...funcs])].sort((a, b) => a.localeCompare(b, 'pt'));
  document.body.insertAdjacentHTML('beforeend', `<datalist id="plt-dl-mo">${mo.map(x => `<option value="${esc(x)}">`).join('')}</datalist><datalist id="plt-dl-eq">${EQ_SUGESTOES.map(x => `<option value="${esc(x)}">`).join('')}</datalist>`);
}

// ── Painel «Equipas de trabalho» ──
function abrirEquipas() {
  garantirListas();
  const rasc = JSON.parse(JSON.stringify(equipasDoPlano()));
  const usos = id => _plano.tarefas.filter(t => atribDe(t).some(a => a.id === id)).length;
  const linha = (k, tipo, x, j) => `<div class="plt-eqc-l">
      <input class="plt-eqc-cat" list="plt-dl-${tipo}" data-k="${k}" data-tp="${tipo}" data-j="${j}" data-f="nome" value="${esc(tipo === 'mo' ? x.cat : x.tipo)}" placeholder="${tipo === 'mo' ? 'Categoria (ex.: Servente)' : 'Equipamento (ex.: Retroescavadora)'}"/>
      <input class="plt-eqc-q" type="number" min="0" step="1" data-k="${k}" data-tp="${tipo}" data-j="${j}" data-f="qtd" value="${x.qtd}"/>
      <button type="button" class="plt-fase-x" data-b="tira" data-k="${k}" data-tp="${tipo}" data-j="${j}" title="Retirar">${ICO.x}</button>
    </div>`;
  const corpo = () => `
    <p class="plt-nota">Cada equipa junta a mão de obra e os equipamentos que trabalham juntos numa frente. Depois atribua as equipas às tarefas (coluna «Equipas» ou botão direito na barra) e veja os mapas nos separadores «Mão de obra» e «Equipamentos».</p>
    ${rasc.length ? '' : '<div class="dd-vazio">Ainda não há equipas neste plano.</div>'}
    ${rasc.map((e, k) => `<div class="plt-eqc" style="--c:${e.cor}">
      <div class="plt-eqc-h">
        <input class="plt-eqc-nome" data-k="${k}" data-f="enome" value="${esc(e.nome)}" placeholder="Nome da equipa"/>
        <div class="plt-eqc-cores">${CORES_EQUIPA.map(c => `<button type="button" class="plt-cor sm ${e.cor === c ? 'on' : ''}" style="--c:${c}" data-b="cor" data-k="${k}" data-cor="${c}" title="Cor"></button>`).join('')}</div>
      </div>
      <div class="plt-eqc-sec">${ICO.equipas}<b>Mão de obra</b><small>${(e.mo || []).reduce((a, x) => a + (+x.qtd || 0), 0)} pessoas</small></div>
      ${(e.mo || []).map((x, j) => linha(k, 'mo', x, j)).join('')}
      <button type="button" class="plt-eqc-add" data-b="mais" data-k="${k}" data-tp="mo">${ICO.plus}Mão de obra</button>
      <div class="plt-eqc-sec">${ICO.maquina}<b>Equipamentos</b><small>${(e.eq || []).reduce((a, x) => a + (+x.qtd || 0), 0)} unidades</small></div>
      ${(e.eq || []).map((x, j) => linha(k, 'eq', x, j)).join('')}
      <button type="button" class="plt-eqc-add" data-b="mais" data-k="${k}" data-tp="eq">${ICO.plus}Equipamento</button>
      <div class="plt-eqc-f"><small>${usos(e.id) ? `Usada em ${usos(e.id)} tarefa${usos(e.id) > 1 ? 's' : ''}` : 'Ainda não está atribuída'}</small>
        <button type="button" class="plt-btn del sm" data-b="apaga" data-k="${k}">${ICO.del}Eliminar equipa</button></div>
    </div>`).join('')}
    <div class="plt-eqc-novo">
      <button type="button" class="plt-btn pri sm" data-b="nova">${ICO.plus}Nova equipa</button>
      <select class="plt-eqc-modelo" data-b-sel="modelo"><option value="">Criar a partir de um modelo…</option>${MODELOS_EQUIPA.map((m, j) => `<option value="${j}">${esc(m.nome)}</option>`).join('')}</select>
    </div>`;
  const dr = mostrarGaveta('Plano de trabalhos', 'Equipas de trabalho', 'Mão de obra e equipamentos de cada equipa', corpo(),
    '<button type="button" class="plt-btn sec" data-g="cancelar">Cancelar</button><button type="button" class="plt-btn pri" data-g="ok">Guardar</button>');
  dr.classList.add('plt-drawer-lg');
  const body = dr.querySelector('.dd-b');
  const repintar = () => { const y = body.scrollTop; body.innerHTML = corpo(); body.scrollTop = y; };
  const focar = (k, sel) => { const c = body.querySelectorAll('.plt-eqc')[k]; const el = c && c.querySelector(sel); if (el) { el.focus(); el.select?.(); } };
  const nova = (m) => {
    rasc.push({ id: uid(), nome: m ? m.nome : `Equipa ${rasc.length + 1}`, cor: CORES_EQUIPA[rasc.length % CORES_EQUIPA.length],
      mo: m ? m.mo.map(([cat, qtd]) => ({ cat, qtd })) : [{ cat: '', qtd: 1 }], eq: m ? m.eq.map(([tipo, qtd]) => ({ tipo, qtd })) : [] });
    repintar();
    body.scrollTop = body.scrollHeight;
    focar(rasc.length - 1, '.plt-eqc-nome');
  };
  body.addEventListener('click', ev => {
    const b = ev.target.closest('[data-b]'); if (!b) return;
    const k = +b.dataset.k, e = rasc[k];
    switch (b.dataset.b) {
      case 'nova': return nova(null);
      case 'cor': e.cor = b.dataset.cor; return repintar();
      case 'mais': (e[b.dataset.tp] = e[b.dataset.tp] || []).push(b.dataset.tp === 'mo' ? { cat: '', qtd: 1 } : { tipo: '', qtd: 1 }); repintar(); return focar(k, `input[data-tp="${b.dataset.tp}"][data-j="${e[b.dataset.tp].length - 1}"][data-f="nome"]`);
      case 'tira': e[b.dataset.tp].splice(+b.dataset.j, 1); return repintar();
      case 'apaga': {
        const n = usos(e.id);
        if (n && !confirm(`A equipa «${e.nome}» está atribuída a ${n} tarefa(s). Eliminar e retirá-la dessas tarefas?`)) return;
        rasc.splice(k, 1); return repintar();
      }
    }
  });
  body.addEventListener('change', ev => {
    const x = ev.target;
    if (x.dataset.bSel === 'modelo') { const m = MODELOS_EQUIPA[+x.value]; if (m) nova(m); return; }
    const k = x.dataset.k; if (k == null) return;
    const e = rasc[+k];
    if (x.dataset.f === 'enome') { e.nome = x.value.trim(); return; }
    const it = e[x.dataset.tp][+x.dataset.j];
    if (x.dataset.f === 'nome') { if (x.dataset.tp === 'mo') it.cat = x.value.trim(); else it.tipo = x.value.trim(); }
    else it.qtd = Math.max(0, parseInt(x.value, 10) || 0);
    if (x.dataset.f === 'qtd') repintar();
  });
  dr.querySelector('[data-g="cancelar"]').onclick = fecharGaveta;
  dr.querySelector('[data-g="ok"]').onclick = () => {
    // limpar: sem linhas vazias, nomes únicos
    const vistos = new Set();
    const limpas = rasc.map((e, k) => {
      let nome = (e.nome || '').trim() || `Equipa ${k + 1}`;
      while (vistos.has(nome.toLowerCase())) nome += ' (2)';
      vistos.add(nome.toLowerCase());
      return { id: e.id, nome, cor: e.cor || CORES_EQUIPA[k % CORES_EQUIPA.length],
        mo: (e.mo || []).filter(x => x.cat && x.qtd > 0).map(x => ({ cat: x.cat, qtd: +x.qtd })),
        eq: (e.eq || []).filter(x => x.tipo && x.qtd > 0).map(x => ({ tipo: x.tipo, qtd: +x.qtd })) };
    });
    const ids = new Set(limpas.map(e => e.id));
    _plano.equipas = limpas;
    const orfas = _plano.tarefas.some(t => (t.equipas || []).some(a => !ids.has(a.id)));
    if (orfas) mudar(() => { _plano.tarefas.forEach(t => { if (t.equipas) { t.equipas = t.equipas.filter(a => ids.has(a.id)); if (!t.equipas.length) delete t.equipas; } }); });
    else depoisDeMudar();
    fecharGaveta();
    showToast(`${limpas.length} equipa${limpas.length === 1 ? '' : 's'} guardada${limpas.length === 1 ? '' : 's'}`);
  };
}

// ── Painel «Atribuir equipas» (uma ou várias tarefas) ──
function abrirAtribuir(idxs) {
  idxs = (idxs || []).filter(eFolhaAtribuivel);
  if (!idxs.length) return showToast('Selecione tarefas (não resumos nem marcos) para atribuir equipas');
  const T = _plano.tarefas, eqs = equipasDoPlano();
  // ponto de partida: as equipas da 1.ª tarefa
  const rasc = new Map(atribDe(T[idxs[0]]).map(a => [a.id, a.n || 1]));
  const corpo = () => eqs.length ? `
    <p class="plt-nota">${idxs.length > 1 ? `As equipas escolhidas substituem as das <b>${idxs.length} tarefas</b> selecionadas.` : 'Escolha as equipas que executam esta tarefa e quantas de cada.'} A mão de obra e os equipamentos contam em todos os dias de trabalho da tarefa.</p>
    ${eqs.map(e => { const n = rasc.get(e.id) || 0; return `<div class="plt-at ${n ? 'on' : ''}" style="--c:${e.cor}">
      <button type="button" class="plt-at-chk" data-b="tg" data-id="${e.id}" aria-pressed="${!!n}">${n ? ICO.visto : ''}</button>
      <div class="plt-at-tx"><b>${esc(e.nome)}</b><small>${esc(resumoComp(e)) || 'Sem composição'}</small></div>
      <div class="plt-at-n ${n ? '' : 'off'}"><button type="button" data-b="menos" data-id="${e.id}">−</button><span>${n || 1}</span><button type="button" data-b="mais" data-id="${e.id}">+</button></div>
    </div>`; }).join('')}
    <button type="button" class="plt-eqc-add" data-b="gerir">${ICO.cfg}Criar ou editar equipas…</button>`
    : `<div class="dd-vazio">Ainda não há equipas neste plano. Crie-as primeiro (com a mão de obra e os equipamentos de cada uma).</div>
       <button type="button" class="plt-btn pri sm" data-b="gerir">${ICO.plus}Criar equipas</button>`;
  const titulo = idxs.length > 1 ? `${idxs.length} tarefas` : T[idxs[0]].nome;
  const dr = mostrarGaveta('Atribuir equipas', titulo, idxs.length > 1 ? idxs.map(i => i + 1).join(', ') : `Tarefa ${idxs[0] + 1} · EDT ${_R.edt[idxs[0]]}`, corpo(),
    `<button type="button" class="plt-btn sec" data-g="cancelar">Cancelar</button><button type="button" class="plt-btn pri" data-g="ok">Aplicar</button>`);
  const body = dr.querySelector('.dd-b');
  body.addEventListener('click', ev => {
    const b = ev.target.closest('[data-b]'); if (!b) return;
    const id = b.dataset.id, n = rasc.get(id) || 0;
    if (b.dataset.b === 'gerir') { fecharGaveta(); return setTimeout(abrirEquipas, 320); }
    if (b.dataset.b === 'tg') { if (n) rasc.delete(id); else rasc.set(id, 1); }
    if (b.dataset.b === 'mais') rasc.set(id, Math.min(20, (n || 0) + 1));
    if (b.dataset.b === 'menos') { if (n > 1) rasc.set(id, n - 1); else rasc.delete(id); }
    const y = body.scrollTop; body.innerHTML = corpo(); body.scrollTop = y;
  });
  dr.querySelector('[data-g="cancelar"]').onclick = fecharGaveta;
  dr.querySelector('[data-g="ok"]').onclick = () => {
    const lista = eqs.filter(e => rasc.has(e.id)).map(e => ({ id: e.id, n: rasc.get(e.id) }));
    mudar(() => { idxs.forEach(i => { if (lista.length) T[i].equipas = lista.map(a => ({ ...a })); else delete T[i].equipas; }); });
    fecharGaveta();
  };
}

// ── Cálculo dos mapas ──
// tipo 'mo' | 'eq'; per 'semana' | 'mes'. Por período: máximo diário, média diária (dias úteis) e total (dias × unidades).
function mapaRecursos(tipo, per) {
  const r = _R, T = _plano.tarefas;
  const dia = new Map();     // ordinal → Map(categoria → quantidade)
  let comAtrib = 0;
  T.forEach((t, i) => {
    if (r.resumo[i] || r.ms[i]) return;
    const at = atribDe(t); if (!at.length) return;
    comAtrib++;
    const comp = new Map();
    at.forEach(a => { const e = equipaPorId(a.id); ((tipo === 'mo' ? e.mo : e.eq) || []).forEach(x => { const c = tipo === 'mo' ? x.cat : x.tipo; if (c && x.qtd > 0) comp.set(c, (comp.get(c) || 0) + x.qtd * (a.n || 1)); }); });
    if (!comp.size) return;
    for (const o of diasTrabalho(i)) { let m = dia.get(o); if (!m) dia.set(o, (m = new Map())); comp.forEach((q, c) => m.set(c, (m.get(c) || 0) + q)); }
  });
  const periodos = [], chave = o => { const n = diaDe(o), d = new Date(n * DIA); if (per === 'mes') return d.toISOString().slice(0, 7); let s = n; while (dow(s) !== 1) s--; return 's' + s; };
  const rot = (k, o) => { const d = new Date(diaDe(o) * DIA); if (per === 'mes') return MES_ABR[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2); let s = diaDe(o); while (dow(s) !== 1) s--; return fmtD(s).slice(0, 5); };
  const idx = new Map();
  if (T.length) for (let o = r.S0; o <= r.PF; o++) {
    const k = chave(o);
    if (!idx.has(k)) { idx.set(k, periodos.length); periodos.push({ k, rotulo: rot(k, o), dias: 0, max: new Map(), soma: new Map(), maxTot: 0, somaTot: 0 }); }
    const p = periodos[idx.get(k)], m = dia.get(o);
    p.dias++;
    let tot = 0;
    if (m) m.forEach((q, c) => { p.max.set(c, Math.max(p.max.get(c) || 0, q)); p.soma.set(c, (p.soma.get(c) || 0) + q); tot += q; });
    p.maxTot = Math.max(p.maxTot, tot); p.somaTot += tot;
  }
  const totCat = new Map(), maxCat = new Map();
  periodos.forEach(p => p.soma.forEach((q, c) => { totCat.set(c, (totCat.get(c) || 0) + q); maxCat.set(c, Math.max(maxCat.get(c) || 0, p.max.get(c))); }));
  const cats = [...totCat.keys()].sort((a, b) => totCat.get(b) - totCat.get(a) || a.localeCompare(b, 'pt'));
  return { periodos, cats, totCat, maxCat, maxGeral: Math.max(0, ...periodos.map(p => p.maxTot)), totGeral: periodos.reduce((a, p) => a + p.somaTot, 0), comAtrib, nFolhas: T.filter((t, i) => !r.resumo[i] && !r.ms[i]).length };
}

const CORES_MAPA = ['#5b86e5', '#43a047', '#f08c2e', '#8e5bd8', '#1fa3a3', '#e05252', '#e6b422', '#6d4c41', '#00897b', '#c2185b', '#7cb342', '#3949ab', '#8a93a5', '#ff7043'];
function pintarMapaRecursos(tipo) {
  const v = $('plt-vista');
  _ui.mapaPer = _ui.mapaPer || 'mes'; _ui.mapaVal = _ui.mapaVal || 'max';
  const nomeT = tipo === 'mo' ? 'mão de obra' : 'equipamento';
  const eqs = equipasDoPlano();
  const m = mapaRecursos(tipo, _ui.mapaPer);
  const cab = `<div class="plt-mapa-top">
      <div class="plt-mapa-info">${tipo === 'mo' ? ICO.equipas : ICO.maquina}<span><b>${eqs.length} equipa${eqs.length === 1 ? '' : 's'}</b> · ${m.comAtrib} de ${m.nFolhas} tarefas com equipa atribuída</span></div>
      <div class="plt-seg"><button type="button" class="plt-seg-b ${_ui.mapaPer === 'semana' ? 'on' : ''}" data-mapa-per="semana">Semanas</button><button type="button" class="plt-seg-b ${_ui.mapaPer === 'mes' ? 'on' : ''}" data-mapa-per="mes">Meses</button></div>
      <div class="plt-seg"><button type="button" class="plt-seg-b ${_ui.mapaVal === 'max' ? 'on' : ''}" data-mapa-val="max" title="O máximo em simultâneo num dia do período">Máximo diário</button><button type="button" class="plt-seg-b ${_ui.mapaVal === 'med' ? 'on' : ''}" data-mapa-val="med" title="Média por dia útil do período">Média diária</button><button type="button" class="plt-seg-b ${_ui.mapaVal === 'tot' ? 'on' : ''}" data-mapa-val="tot" title="${tipo === 'mo' ? 'Homens × dias' : 'Unidades × dias'}">${tipo === 'mo' ? 'Homens-dia' : 'Dias de máquina'}</button></div>
      <button type="button" class="plt-btn sec sm" data-acao="equipas">${ICO.equipas}Equipas</button>
    </div>`;
  if (!m.cats.length) {
    v.innerHTML = cab + `<div class="plt-vazio-g">
      <div class="plt-vazio-ic">${tipo === 'mo' ? ICO.equipas : ICO.maquina}</div>
      <b>O mapa de ${nomeT} ainda está vazio</b>
      <p>${eqs.length ? `Atribua as equipas às tarefas: na coluna «Equipas» do Gantt, ou com o botão direito numa barra (pode selecionar várias tarefas com Ctrl ou Shift).` : 'Crie as equipas do plano com a mão de obra e os equipamentos de cada uma e depois atribua-as às tarefas.'}</p>
      <button type="button" class="plt-btn pri" data-acao="equipas">${ICO.equipas}${eqs.length ? 'Ver equipas' : 'Criar equipas'}</button></div>`;
    return;
  }
  const val = (p, c) => _ui.mapaVal === 'max' ? (p.max.get(c) || 0) : _ui.mapaVal === 'tot' ? (p.soma.get(c) || 0) : (p.dias ? (p.soma.get(c) || 0) / p.dias : 0);
  const valTot = p => _ui.mapaVal === 'max' ? p.maxTot : _ui.mapaVal === 'tot' ? p.somaTot : (p.dias ? p.somaTot / p.dias : 0);
  const fmt = x => (Math.round(x * 10) / 10).toLocaleString('pt-PT');
  const cor = c => CORES_MAPA[m.cats.indexOf(c) % CORES_MAPA.length];
  // gráfico de barras empilhadas
  const W = Math.max(640, m.periodos.length * (_ui.mapaPer === 'mes' ? 70 : 38)), Hh = 250, pl = 46, pr = 16, pt = 14, pb = 30;
  const maxY = Math.max(1, ...m.periodos.map(p => m.cats.reduce((a, c) => a + val(p, c), 0)));
  const passo = maxY <= 5 ? 1 : maxY <= 12 ? 2 : maxY <= 30 ? 5 : maxY <= 60 ? 10 : Math.ceil(maxY / 50) * 10;
  const topo = Math.ceil(maxY / passo) * passo, cw = (W - pl - pr) / m.periodos.length;
  const Y = x => pt + (Hh - pt - pb) * (1 - x / topo);
  let svg = '';
  for (let g = 0; g <= topo; g += passo) svg += `<line x1="${pl}" x2="${W - pr}" y1="${Y(g)}" y2="${Y(g)}" class="gl"/><text x="${pl - 8}" y="${Y(g) + 4}" class="ax" text-anchor="end">${g}</text>`;
  m.periodos.forEach((p, k) => {
    const x = pl + k * cw + cw * 0.16, w = cw * 0.68;
    let acc = 0;
    m.cats.forEach(c => {
      const q = val(p, c); if (!q) return;
      svg += `<rect x="${x}" y="${Y(acc + q)}" width="${w}" height="${Math.max(0, Y(acc) - Y(acc + q))}" fill="${cor(c)}"><title>${esc(p.rotulo)} · ${esc(c)}: ${fmt(q)}</title></rect>`;
      acc += q;
    });
    if (_ui.mapaPer === 'mes' || k % 2 === 0) svg += `<text x="${pl + k * cw + cw / 2}" y="${Hh - 10}" class="ax" text-anchor="middle">${esc(p.rotulo)}</text>`;
  });
  const rotVal = { max: 'máximo diário em simultâneo', med: 'média por dia útil', tot: tipo === 'mo' ? 'homens × dias' : 'unidades × dias' }[_ui.mapaVal];
  v.innerHTML = cab + `
    <div class="plt-fin-card">
      <div class="plt-fin-h"><b>Mapa de ${nomeT} — ${rotVal}</b><span>Pico: <b>${m.maxGeral}</b> ${tipo === 'mo' ? 'pessoas' : 'unidades'} em simultâneo · total ${m.totGeral.toLocaleString('pt-PT')} ${tipo === 'mo' ? 'homens-dia' : 'dias de máquina'}</span></div>
      <div class="plt-mapa-leg">${m.cats.map(c => `<span><i style="background:${cor(c)}"></i>${esc(c)}</span>`).join('')}</div>
      <div class="plt-fin-g"><svg width="${W}" height="${Hh}" class="plt-fin-svg">${svg}</svg></div>
    </div>
    <div class="plt-fin-card">
      <div class="plt-fin-t"><table class="plt-fin-tab plt-mapa-tab">
        <thead><tr><th class="n">${tipo === 'mo' ? 'Categoria' : 'Equipamento'}</th>${m.periodos.map(p => `<th>${esc(p.rotulo)}</th>`).join('')}<th class="v">Máximo</th><th class="v">${tipo === 'mo' ? 'Homens-dia' : 'Dias'}</th></tr></thead>
        <tbody>${m.cats.map(c => `<tr><td class="n"><i class="plt-mapa-dot" style="background:${cor(c)}"></i>${esc(c)}</td>${m.periodos.map(p => { const q = val(p, c); return `<td class="${q ? '' : 'z'}">${q ? fmt(q) : '—'}</td>`; }).join('')}<td class="v">${m.maxCat.get(c)}</td><td class="v">${m.totCat.get(c).toLocaleString('pt-PT')}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td class="n">Total${_ui.mapaVal === 'max' ? ' (em simultâneo)' : ''}</td>${m.periodos.map(p => `<td>${fmt(valTot(p))}</td>`).join('')}<td class="v">${m.maxGeral}</td><td class="v">${m.totGeral.toLocaleString('pt-PT')}</td></tr></tfoot>
      </table></div>
    </div>
    <div class="plt-ajuda">Os valores vêm das equipas atribuídas a cada tarefa, nos dias de trabalho de cada uma (as pausas das barras partidas não contam). «Máximo diário» é o que se usa habitualmente nos mapas do plano de trabalhos. O Excel inclui estes mapas por mês.</div>`;
}
