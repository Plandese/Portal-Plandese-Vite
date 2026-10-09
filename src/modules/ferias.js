// ═══════════════════════════════════════
//  FÉRIAS — Mapa anual por colaborador
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S } from '../state.js';
import { fmt } from '../utils/helpers.js';

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MESES_FULL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

let _ano = new Date().getFullYear();
let _locked = true;
let _filtroFuncs = new Set(); // vazio = todas as funções
let _funcDropdownOpen = false;
let _feriasUtilizadas = new Set(); // 'colab_numero|YYYY-MM-DD' — vêm das folhas de ponto
let _feriasPrevistas  = new Set(); // 'colab_numero|YYYY-MM-DD' — planeadas, editáveis
let _vista = 'mes';                // portal em computador: 'mes' (mapa do mês) | 'ano' (mapa anual editável)
let _mes = new Date().getMonth();
let _faltas = new Set();           // 'colab_numero|YYYY-MM-DD' — faltas registadas no ponto
let _mobSelColab = null;  // colaborador escolhido no resumo mobile (nº)
let _mobSugAberta = false; // dropdown de sugestões do campo de pesquisa (mobile) aberta?

// Fecha o dropdown de função ao clicar fora dele.
// Usa 'mousedown' (não 'click'): corre antes do re-render disparado pelo
// próprio clique no botão/checkboxes, evitando fechar-se a si mesmo assim que abre.
document.addEventListener('mousedown', (e) => {
  if (!_funcDropdownOpen) return;
  const dd = document.getElementById('ferias-func-dd');
  const btn = document.getElementById('ferias-func-btn');
  if (dd && btn && !dd.contains(e.target) && !btn.contains(e.target)) {
    _funcDropdownOpen = false;
    _renderTabela();
  }
});

// Fecha ao fazer scroll da página/tabela (a dropdown é position:fixed,
// calculada a partir do botão — sem isto ficaria "descolada" do botão).
// Usa capture para apanhar o scroll de qualquer contentor (ex.: a tabela
// com scroll horizontal), mas ignora o scroll dentro da própria dropdown
// (a lista de funções tem overflow-y:auto e pode precisar de scroll).
document.addEventListener('scroll', (e) => {
  if (!_funcDropdownOpen) return;
  const dd = document.getElementById('ferias-func-dd');
  if (dd && (e.target === dd || dd.contains(e.target))) return;
  _funcDropdownOpen = false;
  _renderTabela();
}, true);

// Fecha a lista de sugestões da pesquisa de colaborador (resumo mobile) ao
// clicar fora — 'mousedown' para não fechar-se a si mesma no clique que a abre.
document.addEventListener('mousedown', (e) => {
  if (!_mobSugAberta) return;
  const sug = document.getElementById('ferias-mob-sug');
  const inp = document.getElementById('ferias-mob-busca');
  if (sug && e.target !== inp && !sug.contains(e.target)) {
    _mobSugAberta = false;
    sug.style.display = 'none';
  }
});

// ── Dropdown do filtro de função ───────────────────────────────
// Anexada diretamente ao <body> (position:fixed, posição calculada a partir
// do botão) para nunca ficar tapada por overflow/stacking context de
// ancestrais da tabela (ex.: colunas fixas com position:sticky).
function _renderFuncDropdown(funcs) {
  const btn = document.getElementById('ferias-func-btn');
  if (!btn) return;

  let dd = document.getElementById('ferias-func-dd');
  if (!dd) {
    dd = document.createElement('div');
    dd.id = 'ferias-func-dd';
    document.body.appendChild(dd);
  }

  dd.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px 8px;border-bottom:1px solid var(--gray-100);margin-bottom:4px">
      <span style="font-size:11px;font-weight:600;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px">Funções</span>
      ${_filtroFuncs.size ? `<button type="button" onclick="feriasLimparFuncs()" style="border:none;background:none;color:var(--blue-500);font-size:12px;cursor:pointer;padding:0">Limpar</button>` : ''}
    </div>
    ${funcs.map(f => `
      <label style="display:flex;align-items:center;gap:8px;padding:6px 8px;margin:0;font-size:13px;font-weight:400;text-transform:none;letter-spacing:normal;color:var(--gray-700);cursor:pointer;border-radius:6px" onmouseover="this.style.background='var(--gray-50)'" onmouseout="this.style.background=''">
        <input type="checkbox" ${_filtroFuncs.has(f) ? 'checked' : ''} onchange="feriasToggleFunc('${f}')" style="-webkit-appearance:checkbox;appearance:checkbox;width:14px;height:14px;min-width:14px;padding:0;margin:0;border:none;border-radius:0;background:none;accent-color:var(--blue-500);cursor:pointer;flex-shrink:0"/> ${f}
      </label>
    `).join('')}
  `;

  const rect = btn.getBoundingClientRect();
  dd.style.cssText = `display:${_funcDropdownOpen ? 'block' : 'none'};position:fixed;top:${rect.bottom + 4}px;left:${rect.left}px;min-width:${rect.width}px;background:var(--white);border:1px solid var(--gray-200);border-radius:var(--radius);box-shadow:0 8px 24px rgba(0,0,0,.18);z-index:1500;max-height:260px;overflow-y:auto;padding:6px`;
}

const NAME_W = 160;
const TOT_W  = 52;
// Fundo dos fins de semana — listras diagonais subtis para realçar
const WKND_BG = "var(--fe-wknd,repeating-linear-gradient(135deg,#E9EDF2 0px,#E9EDF2 3px,#D4DAE3 3px,#D4DAE3 6px))";

// ── Navegação de ano — precisa de novo fetch ──────────────────
export function feriasNavAno(delta) {
  _ano += delta;
  renderMapaFerias();
}

// ── Lock / Unlock — apenas re-render, sem novo fetch ─────────
export function feriasToggleLock() {
  _locked = !_locked;
  _applyLockBtn();
  _renderTabela();
}

// ── Filtro por função (multi-seleção) — apenas re-render, sem novo fetch ─────
export function feriasToggleFuncDropdown() {
  _funcDropdownOpen = !_funcDropdownOpen;
  _renderTabela();
}

export function feriasToggleFunc(func) {
  if (_filtroFuncs.has(func)) _filtroFuncs.delete(func);
  else _filtroFuncs.add(func);
  _renderTabela();
}

export function feriasLimparFuncs() {
  _filtroFuncs.clear();
  _renderTabela();
}

// ── Toggle férias previstas (click na célula) ─────────────────
export async function feriasTogglePrevista(colabN, dateStr) {
  if (_locked) return;
  const key = `${colabN}|${dateStr}`;
  if (_feriasUtilizadas.has(key)) return;

  try {
    if (_feriasPrevistas.has(key)) {
      await sb.from('ferias_previstas')
        .delete()
        .eq('colab_numero', colabN)
        .eq('data', dateStr);
      _feriasPrevistas.delete(key);
    } else {
      await sb.from('ferias_previstas')
        .upsert({ colab_numero: colabN, data: dateStr }, { onConflict: 'colab_numero,data' });
      _feriasPrevistas.add(key);
    }
    _updateColabRow(colabN);
  } catch (e) {
    console.warn('feriasTogglePrevista:', e);
  }
}

// ── Atualiza só a linha de um colaborador sem re-render total ──
function _updateColabRow(colabN) {
  const colab = S.COLABORADORES.find(c => c.n === colabN);
  if (!colab) return;

  let totalUtil = 0, totalPrev = 0;

  for (let m = 0; m < 12; m++) {
    const diasNoMes = new Date(_ano, m + 1, 0).getDate();
    for (let d = 1; d <= diasNoMes; d++) {
      const dateObj = new Date(_ano, m, d);
      const isWknd = dateObj.getDay() === 0 || dateObj.getDay() === 6;
      const dateStr = fmt(new Date(_ano, m, d, 12));
      const key = `${colabN}|${dateStr}`;
      const isUtil = _feriasUtilizadas.has(key);
      const isPrev = _feriasPrevistas.has(key);

      if (!isWknd) {
        if (isUtil) totalUtil++;
        else if (isPrev) totalPrev++;
      }

      const cell = document.getElementById(`fc-${colabN}-${dateStr}`);
      if (!cell) continue;

      _styleCell(cell, { isUtil, isPrev, isWknd, d, m, colabN, dateStr });
    }
  }

  const totalMarcadas = totalUtil + totalPrev;
  const elMarc = document.getElementById(`ft-marc-${colabN}`);
  if (elMarc) elMarc.innerHTML = _totalBadge(totalMarcadas, 'var(--gray-600)', 'var(--gray-100)');
  const elUtil = document.getElementById(`ft-util-${colabN}`);
  if (elUtil) elUtil.innerHTML = _totalBadge(totalUtil, 'var(--fe-util-t,#065F46)', 'var(--fe-util-bg,#D1FAE5)');
  const elPrev = document.getElementById(`ft-prev-${colabN}`);
  if (elPrev) elPrev.innerHTML = _totalBadge(totalPrev, 'var(--fe-prev-t,#92400E)', 'var(--fe-prev-bg,#FEF3C7)');
}

// ── Aplica estilo + handlers a uma célula de dia ──────────────
function _styleCell(cell, { isUtil, isPrev, isWknd, d, m, colabN, dateStr }) {
  cell.onclick = null;
  if (isUtil) {
    cell.style.background = 'var(--fe-util,#10B981)';
    cell.style.cursor = 'default';
    cell.title = `Férias utilizadas — ${d} ${MESES_FULL[m]}`;
  } else if (isPrev) {
    cell.style.background = 'var(--fe-prev,#F59E0B)';
    if (_locked) {
      cell.style.cursor = 'default';
      cell.title = `Férias previstas — ${d} ${MESES_FULL[m]}`;
    } else {
      cell.style.cursor = 'pointer';
      cell.title = `Férias previstas — ${d} ${MESES_FULL[m]} (clique para remover)`;
      cell.onclick = () => feriasTogglePrevista(colabN, dateStr);
    }
  } else if (isWknd) {
    cell.style.background = WKND_BG;
    cell.style.cursor = 'default';
    cell.title = '';
  } else {
    cell.style.background = '';
    if (_locked) {
      cell.style.cursor = 'default';
      cell.title = '';
    } else {
      cell.style.cursor = 'pointer';
      cell.title = `Clique para marcar férias — ${d} ${MESES_FULL[m]}`;
      cell.onclick = () => feriasTogglePrevista(colabN, dateStr);
    }
  }
}

function _totalBadge(n, color, bg) {
  return `<span style="display:inline-block;padding:2px 6px;border-radius:9999px;font-size:11px;font-weight:600;background:${bg};color:${color}">${n}d</span>`;
}

function _svgLock() {
  return `<svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px"><path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM8.9 6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H8.9V6zM18 20H6V10h12v10z"/></svg>`;
}

function _svgLockOpen() {
  return `<svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h2c0-1.65 1.35-3 3-3s3 1.35 3 3v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/></svg>`;
}

function _applyLockBtn() {
  const btn = document.getElementById('ferias-lock-btn');
  if (!btn) return;
  if (_locked) {
    btn.title = 'Mapa trancado — clique para editar';
    btn.style.color = '';
    btn.style.background = '';
    btn.innerHTML = _svgLock();
  } else {
    btn.title = 'Mapa destrancado — clique para trancar';
    btn.style.color = 'var(--primary)';
    btn.style.background = 'var(--primary-50, #EFF6FF)';
    btn.innerHTML = _svgLockOpen();
  }
}

// ── Render principal: fetch Supabase + tabela ─────────────────
export async function renderMapaFerias() {
  const cont = document.getElementById('ferias-cont');
  if (!cont) return;

  const lbl = document.getElementById('ferias-ano-label');
  if (lbl) lbl.textContent = _ano;

  _applyLockBtn();

  cont.innerHTML = '<div class="pl-load"><span class="pl-logo"></span>A carregar…</div>';

  const dIni = `${_ano}-01-01`;
  const dFim = `${_ano}-12-31`;

  try {
    const { data: dataUtil, error: errUtil } = await sb
      .from('registos_ponto')
      .select('colab_numero, data')
      .eq('tipo', 'Férias')
      .gte('data', dIni)
      .lte('data', dFim);
    if (errUtil) throw errUtil;
    _feriasUtilizadas = new Set((dataUtil || []).map(r => `${r.colab_numero}|${r.data}`));

    const { data: dataPrev, error: errPrev } = await sb
      .from('ferias_previstas')
      .select('colab_numero, data')
      .gte('data', dIni)
      .lte('data', dFim);
    if (errPrev) throw errPrev;
    _feriasPrevistas = new Set((dataPrev || []).map(r => `${r.colab_numero}|${r.data}`));

    const { data: dataFalt } = await sb
      .from('registos_ponto')
      .select('colab_numero, data')
      .in('tipo', ['Falta Just.', 'Falta Injust.'])
      .gte('data', dIni)
      .lte('data', dFim);
    _faltas = new Set((dataFalt || []).map(r => `${r.colab_numero}|${r.data}`));

  } catch (e) {
    cont.innerHTML = `<div class="card" style="text-align:center;color:var(--red);padding:32px;font-size:13px">⚠️ Erro ao carregar dados: ${e.message}</div>`;
    return;
  }

  _renderTabela();
}

// ── Iniciais para o avatar do resumo mobile ───────────────────
function _iniciais(nome) {
  const partes = (nome || '').trim().split(/\s+/);
  return ((partes[0]?.[0] || '') + (partes[partes.length - 1]?.[0] || '')).toUpperCase();
}

// ── Agrupa datas (YYYY-MM-DD) consecutivas em intervalos [ini, fim] ──
function _agruparIntervalos(dateStrs) {
  const sorted = [...new Set(dateStrs)].sort();
  if (!sorted.length) return [];
  const ranges = [];
  let ini = sorted[0], fim = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const seguinte = fmt(new Date(new Date(fim + 'T12:00:00').setDate(new Date(fim + 'T12:00:00').getDate() + 1)));
    if (sorted[i] === seguinte) { fim = sorted[i]; continue; }
    ranges.push([ini, fim]);
    ini = fim = sorted[i];
  }
  ranges.push([ini, fim]);
  return ranges;
}

function _fmtIntervalo([ini, fim]) {
  const di = new Date(ini + 'T12:00:00'), df = new Date(fim + 'T12:00:00');
  if (ini === fim) return `${di.getDate()} de ${MESES_FULL[di.getMonth()]}`;
  if (di.getMonth() === df.getMonth()) return `${di.getDate()} a ${df.getDate()} de ${MESES_FULL[di.getMonth()]}`;
  return `${di.getDate()} ${MESES[di.getMonth()]} a ${df.getDate()} ${MESES[df.getMonth()]}`;
}

// ── Datas de férias (utilizadas/previstas) de um colaborador no ano atual ──
function _mobColabDatas(colabN) {
  const util = [], prev = [];
  for (let m = 0; m < 12; m++) {
    const diasNoMes = new Date(_ano, m + 1, 0).getDate();
    for (let d = 1; d <= diasNoMes; d++) {
      const dateObj = new Date(_ano, m, d);
      const isWknd = dateObj.getDay() === 0 || dateObj.getDay() === 6;
      const dateStr = fmt(new Date(_ano, m, d, 12));
      const key = `${colabN}|${dateStr}`;
      if (_feriasUtilizadas.has(key)) util.push({ dateStr, isWknd });
      else if (_feriasPrevistas.has(key)) prev.push({ dateStr, isWknd });
    }
  }
  return { util, prev };
}

// ── Resumo do colaborador escolhido (dias já tirados / ainda por tirar) ──
function _mobRenderResumo() {
  const box = document.getElementById('ferias-mob-resumo');
  if (!box) return;

  if (!_mobSelColab) {
    box.innerHTML = `<div class="card" style="text-align:center;color:var(--gray-400);padding:32px 16px;font-size:13px">Escolha um colaborador para ver o resumo de férias de ${_ano}.</div>`;
    return;
  }
  const colab = S.COLABORADORES.find(c => c.n === _mobSelColab);
  if (!colab) { box.innerHTML = ''; return; }

  const { util, prev } = _mobColabDatas(_mobSelColab);
  const totalUtil = util.filter(x => !x.isWknd).length;
  const totalPrev = prev.filter(x => !x.isWknd).length;
  const rangesUtil = _agruparIntervalos(util.map(x => x.dateStr));
  const rangesPrev = _agruparIntervalos(prev.map(x => x.dateStr));

  const lista = (ranges, msgVazio) => ranges.length
    ? `<div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">${ranges.map(r => `<div style="font-size:13px;color:var(--gray-700);padding:8px 12px;background:var(--gray-50);border-radius:8px">${_fmtIntervalo(r)}</div>`).join('')}</div>`
    : `<div style="font-size:12.5px;color:var(--gray-400);margin-top:8px">${msgVazio}</div>`;

  box.innerHTML = `
    <div class="card" style="padding:16px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:36px;height:36px;border-radius:50%;background:var(--blue-500);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">${_iniciais(colab.nome)}</div>
        <div style="min-width:0">
          <div style="font-size:14.5px;font-weight:700;color:var(--gray-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${colab.nome}</div>
          <div style="font-size:11.5px;color:var(--gray-500)">${colab.func}</div>
        </div>
      </div>
    </div>
    <div class="card" style="padding:14px 16px;margin-bottom:12px;border-left:3px solid var(--fe-util,#10B981)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <span style="font-size:13px;font-weight:600;color:var(--gray-800)">Já tirou em ${_ano}</span>
        ${_totalBadge(totalUtil, 'var(--fe-util-t,#065F46)', 'var(--fe-util-bg,#D1FAE5)')}
      </div>
      ${lista(rangesUtil, `Sem férias utilizadas em ${_ano}.`)}
    </div>
    <div class="card" style="padding:14px 16px;border-left:3px solid var(--fe-prev,#F59E0B)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <span style="font-size:13px;font-weight:600;color:var(--gray-800)">Ainda por tirar em ${_ano}</span>
        ${_totalBadge(totalPrev, 'var(--fe-prev-t,#92400E)', 'var(--fe-prev-bg,#FEF3C7)')}
      </div>
      ${lista(rangesPrev, `Sem férias previstas marcadas em ${_ano}.`)}
    </div>
  `;
}

// ── Vista mobile: caixa de pesquisa de colaborador + resumo ───
function _renderMobileResumo(cont, allColabsPorNome) {
  cont.innerHTML = `
    <div style="position:relative;margin-bottom:14px">
      <input type="text" id="ferias-mob-busca" autocomplete="off" placeholder="Escreva o nome do colaborador…"
        style="width:100%;padding:11px 14px;font-size:14px;border:1.5px solid var(--gray-200);border-radius:var(--radius);font-family:var(--font);background:var(--white);color:var(--gray-900)"/>
      <div id="ferias-mob-sug" style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;background:var(--white);border:1px solid var(--gray-200);border-radius:var(--radius);box-shadow:0 8px 24px rgba(0,0,0,.15);max-height:260px;overflow-y:auto;z-index:50"></div>
    </div>
    <div id="ferias-mob-resumo"></div>
  `;

  const inp = document.getElementById('ferias-mob-busca');
  const sug = document.getElementById('ferias-mob-sug');

  const colabAtual = allColabsPorNome.find(c => c.n === _mobSelColab);
  if (colabAtual) inp.value = colabAtual.nome;

  function fechar() { _mobSugAberta = false; sug.style.display = 'none'; }

  function mostrar() {
    const q = inp.value.trim().toLowerCase();
    const matches = (q ? allColabsPorNome.filter(c => c.nome.toLowerCase().includes(q)) : allColabsPorNome).slice(0, 8);
    sug.innerHTML = matches.length ? matches.map(c => `
      <button type="button" data-n="${c.n}" style="display:block;width:100%;text-align:left;padding:9px 14px;border:none;background:none;cursor:pointer;font-family:var(--font);border-bottom:1px solid var(--gray-100)">
        <div style="font-size:13px;font-weight:600;color:var(--gray-900)">${c.nome}</div>
        <div style="font-size:11px;color:var(--gray-500)">${c.func}</div>
      </button>
    `).join('') : `<div style="padding:12px 14px;font-size:12.5px;color:var(--gray-400)">Sem colaboradores encontrados.</div>`;
    sug.querySelectorAll('button[data-n]').forEach(btn => {
      // mousedown (não click): corre antes do blur do input, que já fecharia a lista
      btn.onmousedown = (e) => {
        e.preventDefault();
        const n = parseInt(btn.getAttribute('data-n'));
        const c = allColabsPorNome.find(x => x.n === n);
        _mobSelColab = n;
        inp.value = c ? c.nome : '';
        fechar();
        _mobRenderResumo();
      };
    });
    _mobSugAberta = true;
    sug.style.display = 'block';
  }

  inp.addEventListener('input', () => {
    if (_mobSelColab) {
      const c = allColabsPorNome.find(x => x.n === _mobSelColab);
      if (!c || c.nome !== inp.value) { _mobSelColab = null; _mobRenderResumo(); }
    }
    mostrar();
  });
  inp.addEventListener('focus', () => { inp.select(); mostrar(); });

  _mobRenderResumo();
}


// ── Portal em computador: mapa do mês (barras por pessoa) ─────────────────
const _MES_L = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const _esc2 = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _dmy = d => `${String(d).padStart(2, '0')}/${String(_mes + 1).padStart(2, '0')}`;

// Intervalos [início, fim, tipo, diasÚteis] de ausência de um colaborador no mês (fins de semana não quebram a barra)
function _feSegmentos(n, nd) {
  const segs = []; let cur = null;
  for (let d = 1; d <= nd; d++) {
    const dt = new Date(_ano, _mes, d), we = dt.getDay() === 0 || dt.getDay() === 6;
    const key = `${n}|${fmt(new Date(_ano, _mes, d, 12))}`;
    const t = _feriasUtilizadas.has(key) ? 'fe' : _faltas.has(key) ? 'fa' : _feriasPrevistas.has(key) ? 'pd' : null;
    if (t) {
      if (cur && cur.t === t) { cur.e = d; if (!we) cur.u++; }
      else { cur = { s: d, e: d, t, u: we ? 0 : 1 }; segs.push(cur); }
    } else if (!we) cur = null;
  }
  return segs;
}

function _renderMes(cont, colabs) {
  const nd = new Date(_ano, _mes + 1, 0).getDate();
  const hoje = new Date(), hojeD = hoje.getFullYear() === _ano && hoje.getMonth() === _mes ? hoje.getDate() : 0;
  const d0 = (_ano * 12 + _mes) - (hoje.getFullYear() * 12 + hoje.getMonth());
  const sub = d0 === 0 ? 'Mês atual' : d0 < 0 ? 'Histórico' : 'Próximo';
  const rows = colabs.map(c => ({ c, segs: _feSegmentos(c.n, nd) })).filter(r => r.segs.length).sort((a, b) => a.segs[0].s - b.segs[0].s || a.c.nome.localeCompare(b.c.nome, 'pt'));
  const cor = { fe: ['#2b5dd1', '#fff'], fa: ['#a35a08', '#fff'], pd: ['#dbe5fb', '#2b5dd1'] };
  const lbl = { fe: 'Férias', fa: 'Falta', pd: 'Férias previstas' };
  let grid = '<div class="fe-gt" style="--nd:' + nd + '"><div class="fe-h0"></div>';
  for (let d = 1; d <= nd; d++) { const w = new Date(_ano, _mes, d).getDay(); grid += `<div class="fe-d${w === 0 || w === 6 ? ' we' : ''}${d === hojeD ? ' td' : ''}">${d}</div>`; }
  rows.forEach((r, i) => {
    const row = i + 2, ini = r.c.nome.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    grid += `<div class="fe-gl" style="grid-row:${row}"></div><div class="fe-n" style="grid-row:${row}"><div class="d-pp"><span class="d-rav">${_esc2(ini)}</span><div><b>${_esc2(r.c.nome)}</b><small>${_esc2(r.c.func || '—')}</small></div></div></div>`;
    r.segs.forEach(g => {
      const txt = g.t === 'fa' ? (g.u === 1 ? 'Falta' : g.u + ' dias') : g.u + (g.u === 1 ? ' dia' : ' dias');
      grid += `<div class="fe-b" title="${lbl[g.t]} · ${_dmy(g.s)}${g.e > g.s ? ' a ' + _dmy(g.e) : ''}" style="grid-row:${row};grid-column:${g.s + 1} / ${g.e + 2};background:${cor[g.t][0]};color:${cor[g.t][1]}">${txt}</div>`;
    });
  });
  grid += '</div>';

  // próximas ausências (14 dias) e férias previstas do mês
  const ini14 = hoje.getFullYear() * 10000 + (hoje.getMonth() + 1) * 100 + hoje.getDate();
  const lim = new Date(hoje); lim.setDate(lim.getDate() + 14);
  const fim14 = lim.getFullYear() * 10000 + (lim.getMonth() + 1) * 100 + lim.getDate();
  const prox = [], prev = [];
  colabs.forEach(c => {
    // percorre o ano atual do mapa em intervalos por tipo
    for (let m = 0; m < 12; m++) {
      const dm = new Date(_ano, m + 1, 0).getDate(); let cur = null;
      for (let d = 1; d <= dm; d++) {
        const dt = new Date(_ano, m, d), we = dt.getDay() === 0 || dt.getDay() === 6;
        const key = `${c.n}|${fmt(new Date(_ano, m, d, 12))}`;
        const t = _feriasUtilizadas.has(key) ? 'fe' : _faltas.has(key) ? 'fa' : _feriasPrevistas.has(key) ? 'pd' : null;
        if (t) { if (cur && cur.t === t) { cur.e = d; if (!we) cur.u++; } else { cur = { c, m, s: d, e: d, t, u: we ? 0 : 1 }; (t === 'pd' && m === _mes ? prev : []).push(cur); const num = _ano * 10000 + (m + 1) * 100; cur.ns = num + d; if (num + d >= ini14 && num + d <= fim14) prox.push(cur); } }
        else if (!we) cur = null;
      }
    }
  });
  const dd = x => `${String(x.s).padStart(2, '0')}/${String(x.m + 1).padStart(2, '0')}${x.e > x.s ? ' a ' + String(x.e).padStart(2, '0') + '/' + String(x.m + 1).padStart(2, '0') : ''}`;
  const pill = t => t === 'fa' ? '<span class="dd-pill warn">Falta</span>' : t === 'pd' ? '<span class="dd-pill mute">Prevista</span>' : '<span class="dd-pill info">Férias</span>';
  const li = x => `<div class="dd-row"><span class="d-rav">${_esc2(x.c.nome.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase())}</span><div class="dd-tx"><b>${_esc2(x.c.nome)}</b><small>${_esc2(x.c.func || '—')} · ${dd(x)}${x.u ? ' · ' + x.u + (x.u === 1 ? ' dia' : ' dias') : ''}</small></div>${pill(x.t)}</div>`;
  prox.sort((a, b) => a.ns - b.ns); prev.sort((a, b) => a.s - b.s);

  cont.innerHTML = `<div class="fe-bar"><div class="fe-mes"><button type="button" data-fmes="-1" aria-label="Mês anterior">&#8249;</button><div><b>${_MES_L[_mes]} de ${_ano}</b><small>${sub}</small></div><button type="button" data-fmes="1" aria-label="Mês seguinte">&#8250;</button></div>
      <div class="fe-leg"><span><i style="background:#2b5dd1"></i>Férias aprovadas</span><span><i style="background:#a35a08"></i>Falta</span><span><i style="background:#dbe5fb"></i>Previstas</span></div></div>
    <div class="card fe-card">${rows.length ? `<div class="tbl-wrap fe-wrap">${grid}</div>` : '<div class="d-empty" style="border:0">Sem ausências registadas neste mês.</div>'}</div>
    <div class="fe-2">
      <div class="card fe-card"><div class="fe-ch"><b>Próximas ausências</b><small>Nos próximos 14 dias</small></div>${prox.length ? prox.slice(0, 6).map(li).join('') : '<div class="dd-vazio">Sem ausências nos próximos 14 dias.</div>'}</div>
      <div class="card fe-card"><div class="fe-ch"><b>Férias previstas</b><small>${prev.length} ${prev.length === 1 ? 'marcação' : 'marcações'} em ${_MES_L[_mes]}</small></div>${prev.length ? prev.slice(0, 6).map(li).join('') : '<div class="dd-vazio">Sem férias previstas neste mês.</div>'}</div>
    </div>`;
}

document.addEventListener('click', e => {
  const v = e.target.closest('[data-fv]');
  if (v) { _vista = v.dataset.fv; _renderTabela(); return; }
  const m = e.target.closest('[data-fmes]');
  if (m) {
    _mes += +m.dataset.fmes;
    if (_mes < 0) { _mes = 11; _ano--; renderMapaFerias(); return; }
    if (_mes > 11) { _mes = 0; _ano++; renderMapaFerias(); return; }
    _renderTabela(); return;
  }
  if (e.target.closest('[data-fmarcar]')) { _vista = 'ano'; if (_locked) feriasToggleLock(); else _renderTabela(); }
});

// ── Render da tabela a partir dos dados em memória ────────────
// Chamado por lock/filtro — nunca faz fetch ao Supabase.
function _renderTabela() {
  const cont = document.getElementById('ferias-cont');
  if (!cont) return;

  const allColabs = S.COLABORADORES.filter(c => c.ativo).sort((a, b) => a.n - b.n);
  if (!allColabs.length) {
    cont.innerHTML = '<div class="card" style="text-align:center;color:var(--gray-400);padding:32px;font-size:13px">Sem colaboradores ativos.</div>';
    return;
  }

  if (document.body.classList.contains('device-mobile')) {
    const porNome = [...allColabs].sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    _renderMobileResumo(cont, porNome);
    return;
  }

  const desk = document.body.classList.contains('device-desktop') && !document.body.classList.contains('enc-mode');
  const sec = document.getElementById('sec-mapa-ferias');
  if (sec) sec.dataset.vista = desk ? _vista : 'ano';
  const sb2 = document.querySelector('#sec-mapa-ferias .pg-sub'); if (sb2 && desk) sb2.textContent = _vista === 'mes' ? 'Quem está ausente e quando' : 'Visão anual das férias por colaborador';
  document.querySelectorAll('#fe-seg button').forEach(b => b.classList.toggle('on', b.dataset.fv === _vista));
  if (desk && _vista === 'mes') { _renderMes(cont, allColabs); return; }

  const funcs = [...new Set(allColabs.map(c => c.func))].sort((a, b) => a.localeCompare(b, 'pt'));
  const colabs = _filtroFuncs.size ? allColabs.filter(c => _filtroFuncs.has(c.func)) : allColabs;

  cont.innerHTML = '';

  // ── Barra de filtro por função (multi-seleção) ────────────────
  const btnLabel = _filtroFuncs.size === 0
    ? 'Todas'
    : _filtroFuncs.size === 1
      ? [...(_filtroFuncs)][0]
      : `${_filtroFuncs.size} selecionadas`;

  const filtroBar = document.createElement('div');
  filtroBar.className = 'filter-bar';
  filtroBar.style.marginBottom = '12px';
  filtroBar.innerHTML = `
    <div class="field" style="margin:0">
      <label>Função</label>
      <button type="button" id="ferias-func-btn" onclick="feriasToggleFuncDropdown()" style="min-width:180px;text-align:left;padding:7px 10px;font-size:13px;border:1.5px solid var(--gray-200);border-radius:var(--radius);background:var(--white);color:var(--gray-900);cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px">
        <span>${btnLabel}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0;opacity:.6"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    </div>
  `;
  cont.appendChild(filtroBar);

  // A dropdown vive fora da hierarquia da tabela (anexada ao <body>, position:fixed)
  // para nunca ficar tapada por contextos de empilhamento/overflow de ancestrais da tabela.
  _renderFuncDropdown(funcs);

  // ── Tabela ────────────────────────────────────────────────────
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'overflow-x:auto;border-radius:12px;border:1px solid var(--gray-200)';

  const table = document.createElement('table');
  table.style.cssText = 'border-collapse:collapse;width:100%;min-width:900px;font-size:12px';

  const stickyTh = (left) =>
    `position:sticky;left:${left}px;background:var(--gray-50);z-index:2;`;
  const stickyTd = (left) =>
    `position:sticky;left:${left}px;background:white;z-index:1;`;

  // Cabeçalho de meses
  let thead = '<thead>';
  thead += '<tr style="background:var(--gray-50)">';
  thead += `<th style="padding:10px 14px;text-align:left;font-size:12px;font-weight:600;color:var(--gray-500);white-space:nowrap;border-bottom:2px solid var(--gray-200);width:${NAME_W}px;min-width:${NAME_W}px;${stickyTh(0)}">Colaborador</th>`;
  thead += `<th style="padding:6px 2px;text-align:center;font-size:10px;font-weight:600;color:var(--gray-500);border-bottom:2px solid var(--gray-200);border-left:1px solid var(--gray-200);width:${TOT_W}px;min-width:${TOT_W}px;${stickyTh(NAME_W)}">Marc.</th>`;
  thead += `<th style="padding:6px 2px;text-align:center;font-size:10px;font-weight:600;color:var(--fe-util-t,#065F46);border-bottom:2px solid var(--gray-200);border-left:1px solid var(--gray-200);width:${TOT_W}px;min-width:${TOT_W}px;${stickyTh(NAME_W + TOT_W)}">Usadas</th>`;
  thead += `<th style="padding:6px 2px;text-align:center;font-size:10px;font-weight:600;color:var(--fe-prev-t,#92400E);border-bottom:2px solid var(--gray-200);border-left:1px solid var(--gray-200);border-right:2px solid var(--gray-300);width:${TOT_W}px;min-width:${TOT_W}px;${stickyTh(NAME_W + TOT_W * 2)}">P/ Usar</th>`;

  for (let m = 0; m < 12; m++) {
    const diasNoMes = new Date(_ano, m + 1, 0).getDate();
    thead += `<th colspan="${diasNoMes}" style="padding:8px 4px;text-align:center;font-size:11px;font-weight:600;color:var(--gray-500);border-bottom:1px solid var(--gray-200);border-left:2px solid var(--gray-200)">${MESES[m]}</th>`;
  }
  thead += '</tr>';

  // Sub-cabeçalho de dias
  thead += '<tr style="background:var(--gray-50)">';
  thead += `<th style="border-bottom:1px solid var(--gray-200);${stickyTh(0)}"></th>`;
  thead += `<th style="border-bottom:1px solid var(--gray-200);border-left:1px solid var(--gray-200);${stickyTh(NAME_W)}"></th>`;
  thead += `<th style="border-bottom:1px solid var(--gray-200);border-left:1px solid var(--gray-200);${stickyTh(NAME_W + TOT_W)}"></th>`;
  thead += `<th style="border-bottom:1px solid var(--gray-200);border-left:1px solid var(--gray-200);border-right:2px solid var(--gray-300);${stickyTh(NAME_W + TOT_W * 2)}"></th>`;

  for (let m = 0; m < 12; m++) {
    const diasNoMes = new Date(_ano, m + 1, 0).getDate();
    for (let d = 1; d <= diasNoMes; d++) {
      const dateObj = new Date(_ano, m, d);
      const isWknd = dateObj.getDay() === 0 || dateObj.getDay() === 6;
      const wkndBg = isWknd ? `background:${WKND_BG};` : '';
      const borderL = d === 1 ? 'border-left:2px solid var(--gray-200)' : 'border-left:1px solid var(--gray-100)';
      thead += `<th style="padding:3px 0;text-align:center;font-size:9px;font-weight:500;color:var(--gray-400);border-bottom:1px solid var(--gray-200);width:18px;min-width:18px;${wkndBg}${borderL}">${d}</th>`;
    }
  }
  thead += '</tr>';
  thead += '</thead>';

  // Corpo — uma linha por colaborador
  let tbody = '<tbody>';
  for (const colab of colabs) {
    let totalUtil = 0, totalPrev = 0;
    let cells = '';

    for (let m = 0; m < 12; m++) {
      const diasNoMes = new Date(_ano, m + 1, 0).getDate();
      for (let d = 1; d <= diasNoMes; d++) {
        const dateObj = new Date(_ano, m, d);
        const isWknd = dateObj.getDay() === 0 || dateObj.getDay() === 6;
        const dateStr = fmt(new Date(_ano, m, d, 12));
        const key = `${colab.n}|${dateStr}`;
        const isUtil = _feriasUtilizadas.has(key);
        const isPrev = _feriasPrevistas.has(key);

        if (!isWknd) {
          if (isUtil) totalUtil++;
          else if (isPrev) totalPrev++;
        }

        const borderL = d === 1 ? 'border-left:2px solid var(--gray-200)' : 'border-left:1px solid var(--gray-100)';

        let bg = '', titleAttr = '', cursorStyle = '', onclickAttr = '';
        if (isUtil) {
          bg = 'background:var(--fe-util,#10B981);';
          titleAttr = ` title="Férias utilizadas — ${d} ${MESES_FULL[m]}"`;
          cursorStyle = 'cursor:default;';
        } else if (isPrev) {
          bg = 'background:var(--fe-prev,#F59E0B);';
          if (_locked) {
            titleAttr = ` title="Férias previstas — ${d} ${MESES_FULL[m]}"`;
            cursorStyle = 'cursor:default;';
          } else {
            titleAttr = ` title="Férias previstas — ${d} ${MESES_FULL[m]} (clique para remover)"`;
            cursorStyle = 'cursor:pointer;';
            onclickAttr = ` onclick="feriasTogglePrevista(${colab.n},'${dateStr}')"`;
          }
        } else if (isWknd) {
          bg = `background:${WKND_BG};`;
          cursorStyle = 'cursor:default;';
        } else {
          if (_locked) {
            cursorStyle = 'cursor:default;';
          } else {
            titleAttr = ` title="Clique para marcar férias — ${d} ${MESES_FULL[m]}"`;
            cursorStyle = 'cursor:pointer;';
            onclickAttr = ` onclick="feriasTogglePrevista(${colab.n},'${dateStr}')"`;
          }
        }

        cells += `<td id="fc-${colab.n}-${dateStr}" style="padding:0;height:28px;${bg}${cursorStyle}${borderL}"${titleAttr}${onclickAttr}></td>`;
      }
    }

    const totalMarcadas = totalUtil + totalPrev;

    tbody += `<tr style="border-bottom:1px solid var(--gray-100)">`;
    const iniC = (colab.nome || '').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    tbody += document.body.classList.contains('device-desktop')
      ? `<td class="fe-an" style="padding:6px 14px;white-space:nowrap;border-right:1px solid var(--gray-200);${stickyTd(0)}"><div class="d-pp"><span class="d-rav">${_esc2(iniC)}</span><div><b>${_esc2(colab.nome)}</b><small>${_esc2(colab.func || '—')} · Nº ${colab.n}</small></div></div></td>`
      : `<td style="padding:6px 14px;white-space:nowrap;font-weight:500;font-size:12px;color:var(--gray-700);border-right:1px solid var(--gray-200);${stickyTd(0)}">
      <span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gray-400);margin-right:6px">${colab.n}</span>${colab.nome}
      <div style="font-size:10px;color:var(--gray-400);margin-top:1px;font-weight:400">${colab.func}</div>
    </td>`;
    tbody += `<td id="ft-marc-${colab.n}" style="padding:4px;text-align:center;border-left:1px solid var(--gray-200);${stickyTd(NAME_W)}">${_totalBadge(totalMarcadas, 'var(--gray-600)', 'var(--gray-100)')}</td>`;
    tbody += `<td id="ft-util-${colab.n}" style="padding:4px;text-align:center;border-left:1px solid var(--gray-200);${stickyTd(NAME_W + TOT_W)}">${_totalBadge(totalUtil, 'var(--fe-util-t,#065F46)', 'var(--fe-util-bg,#D1FAE5)')}</td>`;
    tbody += `<td id="ft-prev-${colab.n}" style="padding:4px;text-align:center;border-left:1px solid var(--gray-200);border-right:2px solid var(--gray-300);${stickyTd(NAME_W + TOT_W * 2)}">${_totalBadge(totalPrev, 'var(--fe-prev-t,#92400E)', 'var(--fe-prev-bg,#FEF3C7)')}</td>`;
    tbody += cells;
    tbody += `</tr>`;
  }
  tbody += '</tbody>';

  table.innerHTML = thead + tbody;
  wrapper.appendChild(table);
  cont.appendChild(wrapper);

  // Legenda
  const leg = document.createElement('div');
  leg.style.cssText = 'display:flex;gap:16px;align-items:center;margin-top:12px;flex-wrap:wrap';

  const lockInfo = _locked
    ? `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--gray-500);padding:3px 10px;border-radius:8px;background:var(--gray-50);border:1px solid var(--gray-200)">${_svgLock()} Mapa trancado</span>`
    : `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--primary);padding:3px 10px;border-radius:8px;background:#EFF6FF;border:1px solid #BFDBFE">${_svgLockOpen()} Modo edição ativo</span>`;

  leg.innerHTML = `
    ${lockInfo}
    <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--gray-500)">
      <span style="display:inline-block;width:16px;height:16px;border-radius:3px;background:var(--fe-util,#10B981)"></span> Férias utilizadas
    </div>
    <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--gray-500)">
      <span style="display:inline-block;width:16px;height:16px;border-radius:3px;background:var(--fe-prev,#F59E0B)"></span> Férias previstas
    </div>
    <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--gray-500)">
      <span style="display:inline-block;width:16px;height:16px;border-radius:3px;background:${WKND_BG};border:1px solid var(--gray-200)"></span> Fim de semana
    </div>
  `;
  cont.appendChild(leg);
}
