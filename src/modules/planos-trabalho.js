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
    calendario: p.calendario, tarefas: p.tarefas, updated_at: p.updated_at,
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
  const dur = T.map((t, i) => resumo[i] ? 0 : Math.max(0, t.dur | 0));
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
        for (const p of preds[k]) e = Math.max(e, req(p, dur[i]));
      }
      const f = ms[i] ? e : e + dur[i] - 1;
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
  const lsDe = i => ms[i] ? lf[i] : lf[i] - dur[i] + 1;
  for (let i = 0; i < n; i++) ls[i] = lsDe(i);
  if (!ciclo) {
    let m2 = true, it2 = 0;
    while (m2 && it2 < lim) {
      m2 = false; it2++;
      for (const e of E) {
        const da = Math.max(0, dur[e.a] - 1);
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
  _R = { n, pai, resumo, filhos, folhas, idx, edt, preds, dur, ms, es, ef, folga, valor, pct, vis, ciclo, S0, PF };
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
        <button type="button" class="plt-btn sec sm" data-acao="xls">${ICO.xls}Excel</button>
        <button type="button" class="plt-btn sec sm" data-acao="xml" title="Ficheiro XML que o MS Project abre (Ficheiro → Abrir)">${ICO.mpp}MS Project</button>
        <button type="button" class="plt-btn sec sm" data-acao="definicoes">${ICO.cfg}Definições</button>
      </div>
    </div>
    <div class="plt-kpis" id="plt-kpis"></div>
    <div class="plt-tabs">
      <button type="button" class="plt-tab" data-vista="gantt">Gráfico de Gantt</button>
      <button type="button" class="plt-tab" data-vista="fin">Cronograma financeiro</button>
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
  if (_ui.vista === 'fin') pintarFinanceiro(); else pintarGantt();
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
  { k: 'pct', t: '%', w: 54 },
  { k: 'valor', t: 'Valor', w: 112 },
];
const GRID_W = COLS.reduce((s, c) => s + c.w, 0);

function escala() {
  const r = _R, px = ZOOM[_ui.zoom];
  let d0 = diaDe(r.S0), d1 = diaDe(r.S0) + 30;
  for (let i = 0; i < r.n; i++) { d0 = Math.min(d0, diaDe(r.es[i])); d1 = Math.max(d1, diaDe(r.ef[i])); }
  if (_ui.zoom === 'mes') { const a = new Date(d0 * DIA); d0 = Math.round(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1) / DIA); d1 += 62; }
  else { d0 -= 3; while (dow(d0) !== 1) d0--; d1 += _ui.zoom === 'dia' ? 14 : 35; }
  return { d0, d1, px, w: Math.ceil((d1 - d0 + 1) * px) };
}

function pintarGantt() {
  const v = $('plt-vista');
  const splitW = Math.max(220, Math.min(GRID_W, +(localStorage.getItem(LS_SPLIT) || 620)));
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
      <span class="plt-tb-fill"></span>
      <button type="button" class="plt-tb-b ${_ui.critico ? 'on' : ''}" data-acao="critico" title="Realçar o caminho crítico">${ICO.crit}<span>Caminho crítico</span></button>
      ${tbi('hoje', ICO.hoje, 'Ir para hoje')}
      <div class="plt-seg">${zb('dia')}${zb('semana')}${zb('mes')}</div>
    </div>
    <div class="plt-gantt" id="plt-gantt">
      <div class="plt-grid" id="plt-grid" style="width:${splitW}px">
        <div class="plt-gh" style="width:${GRID_W}px">${COLS.map(c => `<div class="c-${c.k}" style="width:${c.w}px">${c.t}</div>`).join('')}</div>
        <div class="plt-gb" id="plt-gb" style="width:${GRID_W}px"></div>
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
      <div class="c-dur"><input data-f="dur" value="${txtDur(durDe(i))}" ${ro}/></div>
      <div class="c-ini"><input data-f="ini" value="${fmtD(diaDe(r.es[i]))}" ${ro}/></div>
      <div class="c-fim"><input data-f="fim" value="${fmtD(diaDe(r.ef[i]))}" ${ro || (r.ms[i] ? 'readonly tabindex="-1"' : '')}/></div>
      <div class="c-pred"><input data-f="pred" value="${esc(txtPred(i))}"/></div>
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
    if (r.resumo[i]) {
      barras += `<div class="plt-bar rs${sel}" data-i="${i}" style="top:${y + 10}px;left:${X(a)}px;width:${(b - a + 1) * px}px" title="${tit}"></div>`;
      barras += `<div class="plt-lbl rs" style="top:${y}px;left:${X(b + 1) + 8}px">${esc(t.nome)}</div>`;
    } else if (r.ms[i]) {
      barras += `<div class="plt-bar ms${crit ? ' crit' : ''}${sel}" data-i="${i}" style="top:${y + 9}px;left:${X(a) + px / 2 - 7}px" title="${tit}"></div>`;
      barras += `<div class="plt-lbl" style="top:${y}px;left:${X(a) + px / 2 + 12}px">${fmtD(a)}</div>`;
    } else {
      barras += `<div class="plt-bar${crit ? ' crit' : ''}${sel}" data-i="${i}" style="top:${y + 8}px;left:${X(a)}px;width:${Math.max(4, (b - a + 1) * px)}px" title="${tit}"><div class="plt-prog" style="width:${r.pct[i]}%"></div><div class="plt-rh"></div></div>`;
      barras += `<div class="plt-lbl" style="top:${y}px;left:${X(b + 1) + 6}px">${esc(t.nome)}</div>`;
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
    mudar(() => { t.dur = d; }); return;
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
    mudar(() => { t.dur = d; }); return;
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
    const mv = ev => { g.style.width = Math.max(220, Math.min(GRID_W, w0 + ev.clientX - x0)) + 'px'; };
    const up = () => { e.target.removeEventListener('pointermove', mv); e.target.removeEventListener('pointerup', up); try { localStorage.setItem(LS_SPLIT, g.offsetWidth); } catch (er) {} };
    e.target.addEventListener('pointermove', mv); e.target.addEventListener('pointerup', up);
  });
  // barras: mover / alterar duração
  ch.addEventListener('pointerdown', e => {
    const bar = e.target.closest('.plt-bar'); if (!bar) return;
    const i = +bar.dataset.i;
    selecionar(i, e);
    if (bar.classList.contains('rs')) return;
    e.preventDefault();
    const modo = e.target.classList.contains('plt-rh') ? 'dur' : 'mover';
    const px = +ch.dataset.px, x0 = e.clientX, l0 = bar.offsetLeft, w0 = bar.offsetWidth;
    const tip = $('plt-tip'); let dd = 0;
    bar.setPointerCapture(e.pointerId);
    const mv = ev => {
      dd = Math.round((ev.clientX - x0) / px);
      if (!dd) { bar.style.left = l0 + 'px'; bar.style.width = w0 + 'px'; tip.style.display = 'none'; return; }
      bar.classList.add('drag');
      if (modo === 'mover') {
        bar.style.left = (l0 + dd * px) + 'px';
        const n = diaDe(ordC(diaDe(_R.es[i]) + dd));
        tip.textContent = 'Início: ' + fmtDL(n);
      } else {
        bar.style.width = Math.max(px, w0 + dd * px) + 'px';
        const fim = diaDe(_R.ef[i]) + dd, d = Math.max(1, ordF(fim) - _R.es[i] + 1);
        tip.textContent = 'Fim: ' + fmtDL(diaDe(_R.es[i] + d - 1)) + ' · ' + txtDur(d);
      }
      tip.style.display = 'block'; tip.style.left = (ev.clientX + 14) + 'px'; tip.style.top = (ev.clientY + 14) + 'px';
    };
    const up = () => {
      bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up);
      tip.style.display = 'none';
      if (!dd) return;
      const t = _plano.tarefas[i];
      mudar(() => {
        if (modo === 'mover') t.inicioMin = diso(diaDe(ordC(diaDe(_R.es[i]) + dd)));
        else t.dur = Math.max(1, ordF(diaDe(_R.ef[i]) + dd) - _R.es[i] + 1);
      });
    };
    bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up);
  });
  ch.addEventListener('dblclick', e => { const bar = e.target.closest('.plt-bar'); if (bar) abrirTarefa(+bar.dataset.i); });
}

function ligarTeclado() {
  if (_keysOk) return; _keysOk = true;
  const body = $('plt-body');
  body.addEventListener('click', e => {
    const b = e.target.closest('[data-acao],[data-abrir],[data-vista],[data-zoom]'); if (!b) return;
    if (b.dataset.abrir) return abrirPlano(b.dataset.abrir);
    if (b.dataset.vista) { _ui.vista = b.dataset.vista; return pintarPlano(); }
    if (b.dataset.zoom) { _ui.zoom = b.dataset.zoom; const ch = $('plt-chart'); if (ch) delete ch.dataset.pronto; return pintarGantt(); }
    const a = b.dataset.acao;
    if (a === 'novo') return abrirNovo();
    if (a === 'voltar') { gravar(); _plano = null; _R = null; return renderPlanosTrabalho(); }
    if (a === 'definicoes') return abrirDefinicoes();
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
    const nd = r.ms[i] ? 1 : r.dur[i];
    const porDia = r.valor[i] / nd;
    for (let o = r.es[i]; o < r.es[i] + nd; o++) { const m = meses.get(chave(diaDe(o))); if (m != null) g.m[m] += porDia; }
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
      <div class="plt-f"><label>Detalhe</label><select id="pn-det"><option value="artigos">Capítulos e artigos (uma tarefa por artigo)</option><option value="capitulos">Só capítulos (os artigos somam no capítulo)</option></select></div>
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
      prazo: Math.max(1, parseInt($('pn-prazo').value, 10) || 60),
      ligacoes: $('pn-lig').value,
    });
  }
  const p = { id: uid(), obra_id: _novo.obra || null, nome, data_inicio: ini, calendario: $('pn-cal').value, tarefas, updated_at: new Date().toISOString() };
  const btn = document.querySelector('#plt-drawer [data-g="criar"]'); btn.disabled = true; btn.textContent = 'A criar…';
  if (!_modoLocal) {
    const { error } = await sb.from('planos_trabalho').insert({ id: p.id, obra_id: p.obra_id, nome: p.nome, data_inicio: p.data_inicio, calendario: p.calendario, tarefas: p.tarefas });
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
export function tarefasDoArticulado(artigos, { soCapitulos = false, prazo = 60, ligacoes = 'seq' } = {}) {
  const out = [], pilha = [];   // pilha: tarefas-capítulo abertas { cod, t }
  const ePrefixo = (cap, cod) => cap.cod && cod && cod.startsWith(cap.cod + '.');
  const fundo = cod => { for (let k = pilha.length - 1; k >= 0; k--) if (ePrefixo(pilha[k], cod)) return k + 1; return -1; };
  for (const a of artigos) {
    const cod = String(a.codigo || '').trim(), nome = String(a.descricao || '').trim() || cod;
    if (!nome) continue;
    if (a.isCapitulo) {
      let d = fundo(cod);
      if (d < 0) d = (a.nivel === 1 && pilha.length) ? 1 : 0;
      pilha.length = Math.min(d, pilha.length);
      const t = novaTarefa(nome, pilha.length, 1); t.cod = cod;
      out.push(t); pilha.push({ cod, t });
    } else {
      const d = fundo(cod);
      if (d >= 0) pilha.length = d;
      const v = Number(a.total) || (Number(a.quantidade) || 0) * (Number(a.precoUnit) || 0);
      if (soCapitulos && pilha.length) { pilha[pilha.length - 1].t.valor += v; continue; }
      const t = novaTarefa(nome, pilha.length, 1);
      Object.assign(t, { cod, un: a.unidade || '', qtd: Number(a.quantidade) || 0, valor: v });
      out.push(t);
    }
  }
  // só capítulos: o valor de um subcapítulo também fica no pai se este ficar sem folhas — normalizar níveis
  for (let i = 1; i < out.length; i++) if (out[i].nivel > out[i - 1].nivel + 1) out[i].nivel = out[i - 1].nivel + 1;
  if (out.length) out[0].nivel = 0;
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
      if (!rs) { t.dur = Math.max(0, parseInt($('pt-dur').value, 10) || 0); t.pct = Math.max(0, Math.min(100, parseInt($('pt-pct').value, 10) || 0)); t.valor = parseFloat($('pt-valor').value) || 0; }
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
