// ═══════════════════════════════════════
//  ADMIN — Painel principal e Fecho de Mês
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { carregarRegistosFecho } from '../db.js';
import { S, R } from '../state.js';
import { fmt, fmtPT, getMonday, calcH, fmtH } from '../utils/helpers.js';
import { MESES_PT } from '../config.js';
import { showToast, openModal } from './navigation.js';
import { canAccessSection } from './permissions.js';

let _painelSeq = 0; // evita que uma resposta antiga sobrescreva uma mais recente

// ── Painel Principal — presenças e ausências da semana ────────────
const _DIAS_CURTO = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];

const _esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const _ymd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

// Filtro geral do Painel Principal: semana (0 = atual, -1 = anterior, +1 = seguinte...) e obra ('' = todas)
let _pOffset = 0;
let _pObra = '';

// Segunda a domingo da semana corrente (ou deslocada de `offset` semanas)
function _painelSemana(offset = _pOffset) {
  const mon = getMonday(new Date());
  mon.setHours(12,0,0,0);
  mon.setDate(mon.getDate() + 7 * offset);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d; });
}

// Registos da semana: vai buscar ao servidor (para apanhar o que outros
// encarregados lançaram entretanto) e recorre ao estado local se falhar.
async function _painelCarregarSemana(dias) {
  const ini = _ymd(dias[0]), fim = _ymd(dias[6]);
  const obra = _pObra;
  const local = () => dias.flatMap(d => (S.REGISTOS[_ymd(d)] || []).map(r => ({ data: _ymd(d), colab: r.colabN, obra: r.obra || null, tipo: r.tipo || 'Presença' })));
  let registos, previstas = [], equipa = null;
  try {
    // Com uma obra escolhida vai-se buscar também a semana anterior, para saber quem é da equipa
    const { data, error } = await sb.from('registos_ponto').select('data,colab_numero,obra_id,tipo').gte('data', obra ? _ymd(_inicioLookback(dias)) : ini).lte('data', fim);
    if (error) throw error;
    registos = (data || []).map(r => ({ data: r.data, colab: r.colab_numero, obra: r.obra_id || null, tipo: r.tipo || 'Presença' }));
    if (obra) {
      equipa = new Set([..._obraPorColab(data || []).entries()].filter(([, o]) => o === obra).map(([n]) => n));
      registos = registos.filter(r => r.data >= ini && equipa.has(r.colab));
    }
  } catch (e) { console.warn('painel (registos):', e); registos = local(); if (obra) registos = registos.filter(r => r.obra === obra); }
  try {
    const { data, error } = await sb.from('ferias_previstas').select('colab_numero,data').gte('data', ini).lte('data', fim);
    if (error) throw error;
    previstas = (data || []).map(r => ({ data: r.data, colab: r.colab_numero }));
    if (obra) previstas = previstas.filter(p => equipa?.has(p.colab));
  } catch (e) { console.warn('painel (férias previstas):', e); }
  return { registos, previstas };
}

// Equipa de cada obra = obra do registo mais recente de cada colaborador (semana anterior à escolhida
// em diante; nas semanas futuras parte-se da semana atual, que é a última com registos)
function _inicioLookback(dias) {
  const d = new Date(Math.min(dias[0], _painelSemana(0)[0]));
  d.setDate(d.getDate() - 7);
  return d;
}
function _obraPorColab(regs) {
  const ult = new Map();
  regs.filter(r => r.obra_id).forEach(r => { const a = ult.get(r.colab_numero); if (!a || r.data > a.data) ult.set(r.colab_numero, r); });
  return new Map([...ult].map(([n, r]) => [n, r.obra_id]));
}

function _painelPessoa(n) {
  const c = S.COLABORADORES.find(x => x.n === n);
  return { nome: c?.nome || `Colaborador ${n}`, func: c?.func || '' };
}

function _painelCardHtml(titulo, subtitulo, corIcon, bgIcon, iconPath, corpo) {
  return `<div class="card pc-card" style="padding:20px">
    <div class="pc-head" style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <div class="pc-ic" style="width:36px;height:36px;border-radius:9px;background:${bgIcon};color:${corIcon};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px">${iconPath}</svg>
      </div>
      <div>
        <div class="pc-t" style="font-size:14px;font-weight:600;color:var(--gray-800)">${titulo}</div>
        <div class="pc-s" style="font-size:11px;color:var(--gray-400)">${subtitulo}</div>
      </div>
    </div>
    ${corpo}
  </div>`;
}

function _painelVazio(txt) {
  return `<div style="font-size:13px;color:var(--gray-400);padding:8px 0">${txt}</div>`;
}

function _painelHtmlAusentes(registos, previstas, dias) {
  // colab → { ferias, fInj, fJust, prev } (conjuntos de datas)
  const porColab = new Map();
  const get = (n) => { if (!porColab.has(n)) porColab.set(n, { ferias: new Set(), fInj: new Set(), fJust: new Set(), prev: new Set() }); return porColab.get(n); };
  registos.forEach(r => {
    if (r.tipo === 'Férias') get(r.colab).ferias.add(r.data);
    else if (r.tipo === 'Falta Just.') get(r.colab).fJust.add(r.data);
    else if (r.tipo.includes('Falta')) get(r.colab).fInj.add(r.data); // 'Falta Injust.' e registos antigos
  });
  // férias planeadas que ainda não têm registo no ponto
  previstas.forEach(p => {
    if (porColab.get(p.colab)?.ferias.has(p.data)) return;
    get(p.colab).prev.add(p.data);
  });
  if (!porColab.size) return _painelVazio('Ninguém de férias ou a faltar nesta semana.');

  const diasTxt = (set) => dias.map((d, i) => set.has(_ymd(d)) ? _DIAS_CURTO[i] : '').filter(Boolean).join(', ');
  const tag = (set, txt, cls) => set.size ? `<span class="badge ${cls}" style="font-size:10px;white-space:nowrap">${txt} · ${diasTxt(set)}</span>` : '';

  return [...porColab.entries()]
    .map(([n, t]) => ({ n, t, ...(_painelPessoa(n)) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'))
    .map(p => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--gray-100)">
      <div style="min-width:0">
        <div style="font-size:13px;color:var(--gray-800);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(p.nome)}</div>
        ${p.func ? `<div style="font-size:11px;color:var(--gray-400)">${_esc(p.func)}</div>` : ''}
      </div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">
        ${tag(p.t.ferias, 'Férias', 'b-blue')}${tag(p.t.prev, 'Férias previstas', 'b-blue')}${tag(p.t.fJust, 'Falta just.', 'b-orange')}${tag(p.t.fInj, 'Falta injust.', 'b-red')}
      </div>
    </div>`).join('');
}

async function renderPainel() {
  const grid = document.getElementById('painel-grid');
  if (!grid) return;

  // Saudação personalizada
  const titulo = document.getElementById('painel-titulo');
  if (titulo) {
    const h = new Date().getHours();
    const saudacao = h < 12 ? 'Bom dia' : h < 19 ? 'Boa tarde' : 'Boa noite';
    const nomePropio = S.currentUser?.nome?.split(' ')[0] || '';
    titulo.textContent = nomePropio ? `${saudacao}, ${nomePropio}` : 'Painel Principal';
  }

  R.renderCalWidget?.();

  const dias = _painelSemana();
  const semanaTxt = `${fmtPT(_ymd(dias[0]))} a ${fmtPT(_ymd(dias[6]))}`;
  const sub = document.getElementById('painel-sub');
  if (sub) sub.textContent = `Folhas de ponto · semana de ${semanaTxt}`;
  const filtros = document.getElementById('painel-filtros');
  if (filtros) filtros.innerHTML = htmlFiltrosPainel();

  // Os dados vêm das folhas de ponto e dos equipamentos — só para quem tem acesso a essas secções
  const podeFolhas = canAccessSection('historico');
  if (!podeFolhas && !canAccessSection('equipamentos')) { grid.innerHTML = ''; return; }

  const seq = ++_painelSeq;
  grid.innerHTML = '<div class="pl-load" style="grid-column:1/-1;padding:60px 20px"><span class="pl-logo"></span>A carregar folhas de ponto…</div>';
  const kp = document.getElementById('painel-kpis');
  if (kp) kp.innerHTML = '';

  const [estado, ferias, kpis] = await Promise.all([htmlEstadoObrasSemana(), podeFolhas ? htmlFeriasFaltasSemana() : '', htmlKpisPainel()]);
  if (seq !== _painelSeq) return;
  grid.innerHTML = estado + ferias;
  if (kp) kp.innerHTML = kpis;
}

// ── Painel Principal — indicadores (presentes hoje, obras com ponto, horas extra, pedidos por aprovar) ──
// Só são desenhados no portal de computador (a app de telemóvel não mostra a faixa de indicadores).
const _TIPOS_PRESENTE = ['Presença', 'Normal', 'Hora Extra'];
const _KPI_IC = {
  pessoas: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  obra: '<path d="M3 21h18M5 21V8l7-4.5L19 8v13"/><path d="M9 21v-5h6v5M9 11h.01M15 11h.01M9 14h.01M15 14h.01"/>',
  relogio: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  carrinho: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
};
const _kpi = (ic, rot, n, foot) => `<div class="kpi"><span class="kpi-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${_KPI_IC[ic]}</svg></span><div class="kpi-b"><div class="kpi-l">${rot}</div><div class="kpi-n">${n}</div>${foot ? `<div class="kpi-f">${foot}</div>` : ''}</div></div>`;
const _kchip = (txt, cls) => `<span class="kpi-chip ${cls}">${txt}</span>`;

export async function htmlKpisPainel() {
  return ''; // a faixa de indicadores foi retirada do Painel Principal
  // eslint-disable-next-line no-unreachable
  if (!document.body.classList.contains('device-desktop')) return '';
  const podeFolhas = canAccessSection('historico'), podeCompras = canAccessSection('compras');
  if (!podeFolhas && !podeCompras) return '';
  const hoje = _ymd(new Date());
  const dias = _painelSemana(_pOffset);
  const ant = _painelSemana(_pOffset - 1);
  const q = async (fn, fb) => { try { const { data, error } = await fn(); if (error) throw error; return data || fb; } catch (e) { console.warn('painel (kpis):', e); return fb; } };
  const [dHoje, dSem, compras] = await Promise.all([
    podeFolhas ? q(() => sb.from('registos_ponto').select('colab_numero,obra_id,tipo').eq('data', hoje), []) : [],
    podeFolhas ? q(() => sb.from('registos_ponto').select('data,colab_numero,obra_id,tipo,entrada,saida').gte('data', _ymd(ant[0])).lte('data', _ymd(dias[6])), []) : [],
    podeCompras ? q(() => sb.from('pedidos_compra').select('estado,urgencia'), []) : [],
  ]);
  const out = [];
  if (podeFolhas) {
    const filtra = r => !_pObra || r.obra_id === _pObra;
    const presentes = new Set(dHoje.filter(r => filtra(r) && _TIPOS_PRESENTE.includes(r.tipo || 'Presença')).map(r => r.colab_numero));
    const ativos = S.COLABORADORES.filter(c => c.ativo).length;
    const obrasAtivas = S.OBRAS.filter(o => o.ativa);
    const obrasHoje = new Set(dHoje.filter(r => r.obra_id && _TIPOS_PRESENTE.includes(r.tipo || 'Presença')).map(r => r.obra_id));
    const comPonto = obrasAtivas.filter(o => obrasHoje.has(o.id)).length;
    const falta = obrasAtivas.length - comPonto;
    out.push(_kpi('pessoas', 'Presentes hoje', _pObra ? `${presentes.size}` : `${presentes.size}<small> / ${ativos}</small>`, ''));
    if (!_pObra) out.push(_kpi('obra', 'Obras com ponto registado', `${comPonto}<small> / ${obrasAtivas.length}</small>`, falta > 0 ? _kchip(`${falta} em falta`, 'k-warn') : _kchip('Todas registadas', 'k-ok')));
    const extraDe = (ds) => {
      const set = new Set(ds.map(_ymd));
      return dSem.filter(r => set.has(r.data) && filtra(r) && r.entrada && r.saida && _TIPOS_PRESENTE.includes(r.tipo || 'Presença'))
        .reduce((s, r) => s + calcH(r.entrada, r.saida, new Date(r.data + 'T12:00:00')).e, 0);
    };
    const eAtual = extraDe(dias), eAnt = extraDe(ant);
    const dif = eAnt > 0 ? Math.round(100 * (eAtual - eAnt) / eAnt) : null;
    out.push(_kpi('relogio', `Horas extra · ${_rotSemana().toLowerCase()}`, `${Math.round(eAtual)}<small> h</small>`,
      dif === null ? '' : dif > 0 ? _kchip(`▲ ${dif}% face à anterior`, 'k-warn') : dif < 0 ? _kchip(`▼ ${-dif}% face à anterior`, 'k-ok') : _kchip('Igual à anterior', 'k-info')));
  }
  if (podeCompras) {
    const pend = compras.filter(c => (c.estado || 'pendente') === 'pendente');
    const urg = pend.filter(c => c.urgencia === 'Urgente' || c.urgencia === 'Muito Urgente').length;
    out.push(_kpi('carrinho', 'Pedidos de compra por aprovar', `${pend.length}`, urg ? _kchip(`${urg} ${urg === 1 ? 'urgente' : 'urgentes'}`, 'k-bad') : ''));
  }
  return out.length ? `<div class="kpis">${out.join('')}</div>` : '';
}

// Cartão "Férias e faltas" da semana corrente — usado no Painel Principal e na
// Análise de Dados (telemóvel), para mostrarem exatamente o mesmo.
export async function htmlFeriasFaltasSemana() {
  const dias = _painelSemana();
  const semanaTxt = `${fmtPT(_ymd(dias[0]))} a ${fmtPT(_ymd(dias[6]))}`;
  const { registos, previstas } = await _painelCarregarSemana(dias);
  const iconAus = '<path d="M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V8h14v11z"/>';
  return _painelCardHtml('Férias e faltas', `${_rotSemana()} · ${semanaTxt}`, 'var(--orange)', 'var(--orange-bg)', iconAus, _painelHtmlAusentes(registos, previstas, dias));
}

// ── Painel Principal — estado das obras na semana (MO e EQ) ───────
// MO = disponibilidade da equipa: dias úteis sem férias/faltas (registadas ou previstas)
// EQ = equipamentos da obra que estão operacionais (não em avaria/manutenção/parados)
const _EQ_NAO_OP = ['manutencao', 'oficina', 'parada'];
const _EQ_ESTADO_TXT = { operacional: 'Operacional', manutencao: 'Manutenção', oficina: 'Em oficina', parada: 'Parada' };
const _EQ_ESTADO_CLS = { operacional: 'eq-est-ok', manutencao: 'eq-est-man', oficina: 'eq-est-man', parada: 'eq-est-par' };
let _estadoObras = new Map(); // obraId → dados calculados, para o detalhe

// "O057 - ZMC Lagos" e "0057 - ZMC Lagos" → 57 (a convenção de código varia entre O e 0)
function _obraCodigo(nome) {
  const m = /^\s*[O0]?\s*(\d{1,7})\b/i.exec(nome || '');
  return m ? parseInt(m[1], 10) : null;
}
const _normNome = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function _corPct(p) { return p >= 85 ? 'var(--green)' : p >= 65 ? 'var(--orange)' : 'var(--red)'; }

async function _estadoObrasCarregar(dias, podeMO, podeEQ) {
  const monAnt = _inicioLookback(dias);
  const ini = _ymd(dias[0]), fim = _ymd(dias[6]);
  const q = async (fn, fallback) => { try { const { data, error } = await fn(); if (error) throw error; return data || fallback; } catch (e) { console.warn('estado das obras:', e); return fallback; } };
  const [regs, prev, equips, manut] = await Promise.all([
    podeMO ? q(() => sb.from('registos_ponto').select('data,colab_numero,obra_id,tipo,entrada,saida').gte('data', _ymd(monAnt)).lte('data', fim), []) : [],
    podeMO ? q(() => sb.from('ferias_previstas').select('colab_numero,data').gte('data', ini).lte('data', fim), []) : [],
    podeEQ ? q(() => sb.from('equipamentos').select('id,nome,codigo,matricula,estado,ultimo_local,propriedade,categoria'), []) : [],
    podeEQ ? q(() => sb.from('eq_manutencoes').select('equip_id,descricao,data').eq('estado', 'pendente'), []) : [],
  ]);
  return { regs, prev, equips, manut };
}

function _estadoObrasCalcular(dias, { regs, prev, equips, manut }) {
  const uteis = dias.slice(0, 5).map(_ymd);
  const obras = S.OBRAS.filter(o => o.ativa);
  const porObra = new Map(obras.map(o => [o.id, { obra: o, equipa: new Map(), equips: [] }]));

  // Cada colaborador conta na obra do seu registo mais recente (esta semana ou a anterior)
  _obraPorColab(regs).forEach((obraId, n) => { porObra.get(obraId)?.equipa.set(n, {}); });

  const dia = new Map(); // "colab|data" → tipo
  regs.forEach(r => dia.set(r.colab_numero + '|' + r.data, r.tipo || 'Presença'));
  const previstas = new Set(prev.map(p => p.colab_numero + '|' + p.data));

  // horas da semana por colaborador (para a gaveta de detalhe da obra)
  const semana = new Set(dias.map(_ymd));
  const horasDe = new Map();
  regs.forEach(r => {
    if (!semana.has(r.data) || !r.entrada || !r.saida || !_TIPOS_PRESENTE.includes(r.tipo || 'Presença')) return;
    horasDe.set(r.colab_numero, (horasDe.get(r.colab_numero) || 0) + calcH(r.entrada.slice(0, 5), r.saida.slice(0, 5), new Date(r.data + 'T12:00:00')).t);
  });

  porObra.forEach(o => {
    o.horas = new Map([...o.equipa.keys()].map(n => [n, horasDe.get(n) || 0]));
    o.equipa.forEach((_, n) => {
      const cel = uteis.map(d => {
        const t = dia.get(n + '|' + d);
        if (t === 'Férias') return 'F';
        if (t === 'Falta Just.') return 'J';
        if (t && t.includes('Falta')) return 'I';
        if (t) return 'P';
        return previstas.has(n + '|' + d) ? 'V' : '-';
      });
      o.equipa.set(n, cel);
    });
    const total = o.equipa.size * uteis.length;
    o.aus = [...o.equipa.values()].reduce((s, c) => s + c.filter(x => 'FJIV'.includes(x) && x !== '-').length, 0);
    o.mo = total ? Math.round(100 * (total - o.aus) / total) : null;
    o.uteis = uteis;
  });

  // Equipamentos: ligados à obra pelo código (O057/0057) ou pelo nome do último local
  const porCodigo = new Map(), porNome = new Map();
  obras.forEach(o => { const c = _obraCodigo(o.nome); if (c != null) porCodigo.set(c, o.id); porNome.set(_normNome(o.nome), o.id); });
  const manutPor = new Map();
  manut.forEach(m => { if (!manutPor.has(m.equip_id)) manutPor.set(m.equip_id, []); manutPor.get(m.equip_id).push(m); });
  equips.forEach(e => {
    const c = _obraCodigo(e.ultimo_local);
    const id = (c != null && porCodigo.get(c)) || porNome.get(_normNome(e.ultimo_local));
    if (id) porObra.get(id).equips.push({ ...e, estado: e.estado || 'operacional', pend: manutPor.get(e.id) || [] });
  });
  porObra.forEach(o => {
    o.eqNaoOp = o.equips.filter(e => _EQ_NAO_OP.includes(e.estado)).length;
    o.eq = o.equips.length ? Math.round(100 * (o.equips.length - o.eqNaoOp) / o.equips.length) : null;
  });

  const fav = R.mFavObraIds?.(); // só no telemóvel (lista de ids); no computador não há filtro
  return [...porObra.values()].filter(o => _pObra ? o.obra.id === _pObra : (o.equipa.size || o.equips.length) && (!fav || fav.includes(o.obra.id)))
    .sort((a, b) => a.obra.nome.localeCompare(b.obra.nome, 'pt'));
}

// "O057 - ZMC Lagos" → código e nome em separado (no telemóvel o código fica numa linha própria)
function _eoNome(nome) {
  const m = String(nome || '').match(/^(O\d+)\s*[-–]\s*(.+)$/);
  return m ? `<span class="eo-cod">${_esc(m[1])}</span><span class="eo-sep"> - </span><span class="eo-nm">${_esc(m[2])}</span>` : _esc(nome);
}

function _eoMetrica(rot, pct, txt) {
  if (pct == null) return `<div class="eo-met"><span class="eo-rot">${rot}</span><span class="eo-txt" style="color:var(--gray-400)">—</span></div>`;
  return `<div class="eo-met" title="${_esc(txt)}"><span class="eo-rot">${rot}</span>
    <span class="eo-bar"><i style="width:${pct}%;background:${_corPct(pct)}"></i></span>
    <span class="eo-pct" style="color:${_corPct(pct)}">${pct}%</span></div>`;
}

export async function htmlEstadoObrasSemana() {
  const podeMO = canAccessSection('historico'), podeEQ = canAccessSection('equipamentos');
  if (!podeMO && !podeEQ) return '';
  const dias = _painelSemana(_pOffset);
  const semanaTxt = `${fmtPT(_ymd(dias[0]))} a ${fmtPT(_ymd(dias[6]))}`;
  // O estado dos equipamentos só existe "agora" (sem histórico), por isso o EQ só vale na semana atual
  const eqAtivo = podeEQ && _pOffset === 0;
  const lista = _estadoObrasCalcular(dias, await _estadoObrasCarregar(dias, podeMO, eqAtivo));
  _estadoObras = new Map(lista.map(o => [o.obra.id, { ...o, semanaTxt, podeMO, podeEQ, eqAtivo }]));
  const icon = '<path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10z"/>';

  const nota = podeEQ && !eqAtivo ? '<div class="eo-nota">EQ mostra o estado atual dos equipamentos, por isso só está disponível na semana atual.</div>' : '';

  const eqTit = (o) => eqAtivo ? `${o.equips.length - o.eqNaoOp} de ${o.equips.length} equipamentos operacionais` : 'Só disponível na semana atual';
  const corpo = nota + (lista.length ? lista.map(o => `<div class="eo-row" role="button" tabindex="0" onclick="abrirEstadoObra('${_esc(o.obra.id)}')" onkeydown="if(event.key==='Enter')abrirEstadoObra('${_esc(o.obra.id)}')">
      <div class="eo-nome">${_eoNome(o.obra.nome)}</div>
      <div class="eo-mets">
        ${podeMO ? _eoMetrica('MO', o.mo, `${o.equipa.size} pessoas · ${o.aus} dias de ausência`) : ''}
        ${podeEQ ? _eoMetrica('EQ', o.eq, eqTit(o)) : ''}
      </div>
      <span class="eo-chev" aria-hidden="true">›</span>
    </div>`).join('') : _painelVazio(_pObra ? 'Sem equipa nem equipamentos registados nesta obra.' : 'Sem dados de equipas ou equipamentos nas obras ativas.'));
  return _painelCardHtml('Estado das obras', `${_rotSemana()} · ${semanaTxt}<span class="eo-dica"> · toque numa obra para o detalhe</span>`, 'var(--blue-600)', 'var(--blue-50)', icon, corpo);
}

// Resumo de uma obra na semana atual (pesquisa da app de telemóvel); alimenta também o detalhe
export async function resumoObraSemana(obraId) {
  const podeMO = canAccessSection('historico'), podeEQ = canAccessSection('equipamentos');
  if (!podeMO && !podeEQ) return null;
  const dias = _painelSemana(0);
  const semanaTxt = `${fmtPT(_ymd(dias[0]))} a ${fmtPT(_ymd(dias[6]))}`;
  const dados = await _estadoObrasCarregar(dias, podeMO, podeEQ);
  const antes = _pObra; _pObra = obraId;
  let o;
  try { o = _estadoObrasCalcular(dias, dados)[0]; } finally { _pObra = antes; }
  if (!o) return { semanaTxt, podeMO, podeEQ, vazio: true };
  const info = { ...o, semanaTxt, podeMO, podeEQ, eqAtivo: podeEQ };
  _estadoObras.set(obraId, info);
  return info;
}

// ── Filtro geral do Painel (semana + obra) ───────────────────────
function _rotSemana() {
  return _pOffset === 0 ? 'Esta semana' : _pOffset === -1 ? 'Semana passada' : _pOffset === 1 ? 'Próxima semana'
    : _pOffset < 0 ? `Há ${-_pOffset} semanas` : `Daqui a ${_pOffset} semanas`;
}

// Barra com a semana e a obra; aplica-se a todos os cartões do Painel Principal
export function htmlFiltrosPainel() {
  if (!canAccessSection('historico') && !canAccessSection('equipamentos')) return '';
  const dias = _painelSemana();
  const opcoes = S.OBRAS.filter(o => o.ativa).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'))
    .map(o => `<option value="${_esc(o.id)}"${o.id === _pObra ? ' selected' : ''}>${_esc(o.nome)}</option>`).join('');
  return `<div class="eo-bar-nav">
    <div class="eo-sem">
      <button type="button" class="eo-nav" onclick="painelMudarSemana(-1)" title="Semana anterior" aria-label="Semana anterior">‹</button>
      <div class="eo-sem-txt"><b>${_rotSemana()}</b><small>${fmtPT(_ymd(dias[0]))} a ${fmtPT(_ymd(dias[6]))}</small></div>
      <button type="button" class="eo-nav" onclick="painelMudarSemana(1)" title="Semana seguinte" aria-label="Semana seguinte">›</button>
      ${_pOffset !== 0 ? '<button type="button" class="eo-hoje" onclick="painelMudarSemana(0)">Hoje</button>' : ''}
    </div>
    <select class="eo-sel" onchange="painelSetObra(this.value)" aria-label="Obra"><option value="">Todas as obras</option>${opcoes}</select>
  </div>`;
}

// Volta a desenhar o ecrã onde o filtro está (Painel no computador, Análise no telemóvel)
function _painelRedesenhar() {
  if (document.getElementById('sec-analise')?.classList.contains('active')) R.renderAnalise?.();
  else renderPainel();
}
export function painelMudarSemana(delta) { _pOffset = delta === 0 ? 0 : _pOffset + delta; _painelRedesenhar(); }
export function painelSetObra(id) { _pObra = id || ''; _painelRedesenhar(); }

const _MO_CEL = {
  P: ['✓', 'eo-c-ok', 'Presença'], F: ['F', 'eo-c-fer', 'Férias'], J: ['FJ', 'eo-c-fj', 'Falta justificada'],
  I: ['FI', 'eo-c-fi', 'Falta injustificada'], V: ['P', 'eo-c-prev', 'Férias previstas'], '-': ['·', 'eo-c-nd', 'Sem registo'],
};

const _DD_IC = {
  maquina: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  veiculo: '<path d="M5 17H3v-5l2-5h14l2 5v5h-2"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><path d="M3 12h18"/>',
  ferramenta: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  outro: '<path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
};
const _ddFechar = () => {
  document.getElementById('d-drawer')?.classList.remove('open');
  document.getElementById('d-scrim')?.classList.remove('open');
};
export function fecharGavetaObra() { _ddFechar(); }
// Abre a obra diretamente no Controlo de Obras (balanço de custos e proveitos)
export function abrirObraNoControlo(id) {
  window.goTo('producao');
  Promise.resolve(R.renderControloObras?.(true)).then(() => window.coAbrir?.(id));
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') _ddFechar(); });

// Portal em computador: detalhe da obra numa gaveta à direita (em vez da janela)
function _abrirEstadoObraGaveta(o) {
  let dr = document.getElementById('d-drawer');
  if (!dr) {
    document.body.insertAdjacentHTML('beforeend', '<div class="d-scrim" id="d-scrim"></div><aside class="d-drawer" id="d-drawer" aria-hidden="true"></aside>');
    dr = document.getElementById('d-drawer');
    document.getElementById('d-scrim').addEventListener('click', _ddFechar);
  }
  const m = String(o.obra.nome || '').match(/^(O\d+)\s*[-–]\s*(.+)$/);
  const cod = m ? m[1] : '', nome = m ? m[2] : o.obra.nome;
  const enc = [o.obra.encarregado_id, ...(o.obra.encarregados_extra || [])].filter(Boolean).map(i => S.USERS?.[i]?.nome || i);
  const dim = (cel, k) => cel.filter(c => c === k).length;
  const pessoas = [...o.equipa.entries()].map(([n, cel]) => ({ ...(_painelPessoa(n)), n, cel, h: o.horas?.get(n) || 0 }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  const tile = (l, v, cor) => `<div class="dd-tile"><small>${l}</small><b${cor ? ` style="color:${cor}"` : ''}>${v}</b></div>`;
  const pill = (t, c) => `<span class="dd-pill ${c}">${t}</span>`;
  const linhaPessoa = p => {
    const dp = dim(p.cel, 'P'), df = dim(p.cel, 'F'), dj = dim(p.cel, 'J'), di = dim(p.cel, 'I'), dv = dim(p.cel, 'V');
    const ini = (p.nome || '').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const pills = [dp ? pill(`${dp} ${dp === 1 ? 'dia' : 'dias'}${p.h ? ' · ' + fmtH(p.h) : ''}`, 'ok') : '', df ? pill(df === 5 ? 'Férias' : `Férias ${df}d`, 'info') : '',
      dv && !dp && !df ? pill('Férias previstas', 'info') : '', dj ? pill(`Falta just. ${dj}d`, 'warn') : '', di ? pill(`Falta injust. ${di}d`, 'bad') : ''].filter(Boolean).join('');
    return `<div class="dd-row"><span class="d-rav">${_esc(ini)}</span><div class="dd-tx"><b>${_esc(p.nome)}</b><small>${_esc(p.func || '—')}</small></div><div class="dd-pills">${pills || pill('Sem registo', 'mute')}</div></div>`;
  };
  const eqs = [...o.equips].sort((a, b) => (_EQ_NAO_OP.includes(b.estado) - _EQ_NAO_OP.includes(a.estado)) || a.nome.localeCompare(b.nome, 'pt'));
  const linhaEq = e => {
    const nao = _EQ_NAO_OP.includes(e.estado);
    const sub = [e.codigo, e.matricula, e.propriedade === 'aluguer' ? 'Aluguer' : ''].filter(Boolean).join(' · ');
    return `<div class="dd-row"><span class="d-ic sm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${_DD_IC[e.categoria] || _DD_IC.outro}</svg></span>
      <div class="dd-tx"><b>${_esc(e.nome)}</b><small>${_esc(sub || '—')}</small>${nao ? e.pend.slice(0, 2).map(x => `<small class="dd-warn">⚠ ${_esc(x.descricao)}${x.data ? ' · ' + fmtPT(x.data) : ''}</small>`).join('') : ''}</div>
      <div class="dd-pills">${pill(_EQ_ESTADO_TXT[e.estado] || _esc(e.estado), nao ? 'warn' : 'ok')}</div></div>`;
  };
  const tiles = (o.podeMO ? tile('Mão de obra · semana', o.mo == null ? '—' : o.mo + '%', o.mo == null ? '' : _corPct(o.mo)) : '')
    + (o.podeEQ ? tile('Equipamentos operacionais', o.eqAtivo && o.eq != null ? o.eq + '%' : '—', o.eqAtivo && o.eq != null ? _corPct(o.eq) : '') : '')
    + (o.podeMO ? tile('Pessoas em obra', o.equipa.size) + tile('Dias de ausência', o.aus) : '');
  dr.innerHTML = `<div class="dd-h"><button type="button" class="dd-x" onclick="fecharGavetaObra()" aria-label="Fechar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      <small>${_esc(cod)}${o.obra.local ? (cod ? ' · ' : '') + _esc(o.obra.local) : ''}</small><h2>${_esc(nome)}</h2><p>${enc.length ? 'Encarregado: ' + _esc(enc[0]) + (enc.length > 1 ? ` +${enc.length - 1}` : '') + ' · ' : ''}${_esc(o.semanaTxt)}</p></div>
    <div class="dd-b"><div class="dd-tiles">${tiles}</div>
      ${o.podeMO ? `<h4>Equipa esta semana</h4>${pessoas.length ? pessoas.map(linhaPessoa).join('') : '<div class="dd-vazio">Sem equipa registada nesta obra.</div>'}` : ''}
      ${o.podeEQ ? `<h4>Equipamentos</h4>${o.eqAtivo ? (eqs.length ? eqs.map(linhaEq).join('') : '<div class="dd-vazio">Sem equipamentos atribuídos a esta obra.</div>') : '<div class="dd-vazio">Os equipamentos só são mostrados na semana atual (não há histórico do estado).</div>'}` : ''}
    </div>
    <div class="dd-f"><button type="button" class="btn btn-secondary" onclick="fecharGavetaObra();goTo('historico')">Folha de ponto</button>
      <button type="button" class="btn btn-primary" onclick="fecharGavetaObra();abrirObraNoControlo('${_esc(o.obra.id)}')">Controlo de obras</button></div>`;
  dr.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => { dr.classList.add('open'); document.getElementById('d-scrim').classList.add('open'); });
}

export function abrirEstadoObra(id) {
  const o = _estadoObras.get(id);
  if (!o) return;
  if (document.body.classList.contains('device-desktop') && !document.body.classList.contains('enc-mode')) { _abrirEstadoObraGaveta(o); return; }
  document.getElementById('meo-title').textContent = o.obra.nome;
  document.getElementById('meo-sub').textContent = `Semana de ${o.semanaTxt}`;

  const cab = (rot, pct, resumo) => `<div class="eo-det-hdr">
    <div class="eo-det-pct" style="color:${pct == null ? 'var(--gray-400)' : _corPct(pct)}">${pct == null ? '—' : pct + '%'}</div>
    <div><div style="font-size:14px;font-weight:600;color:var(--gray-800)">${rot}</div><div style="font-size:12px;color:var(--gray-500)">${resumo}</div></div></div>`;

  let html = '';
  if (o.podeMO) {
    const linhas = [...o.equipa.entries()].map(([n, cel]) => ({ ...(_painelPessoa(n)), cel }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    html += `<div class="eo-sec">${cab('Mão-de-obra', o.mo, o.equipa.size
      ? `${o.equipa.size} pessoas · ${o.aus} de ${o.equipa.size * o.uteis.length} dias-pessoa com férias/faltas`
      : 'Sem equipa registada nesta obra')}
      ${linhas.length ? `<div class="eo-tab"><div class="eo-tr eo-th"><span></span>${_DIAS_CURTO.slice(0, 5).map(d => `<span>${d}</span>`).join('')}</div>
      ${linhas.map(p => `<div class="eo-tr"><span class="eo-pn"><b>${_esc(p.nome)}</b>${p.func ? `<small>${_esc(p.func)}</small>` : ''}</span>
        ${p.cel.map(c => `<span><i class="eo-c ${_MO_CEL[c][1]}" title="${_MO_CEL[c][2]}">${_MO_CEL[c][0]}</i></span>`).join('')}</div>`).join('')}</div>
      <div class="eo-leg">${['P', 'F', 'J', 'I', 'V', '-'].map(k => `<span><i class="eo-c ${_MO_CEL[k][1]}">${_MO_CEL[k][0]}</i> ${_MO_CEL[k][2]}</span>`).join('')}</div>` : ''}
    </div>`;
  }
  if (o.podeEQ && o.eqAtivo) {
    const eqs = [...o.equips].sort((a, b) => (_EQ_NAO_OP.includes(b.estado) - _EQ_NAO_OP.includes(a.estado)) || a.nome.localeCompare(b.nome, 'pt'));
    html += `<div class="eo-sec">${cab('Equipamentos', o.eq, o.equips.length
      ? `${o.equips.length - o.eqNaoOp} de ${o.equips.length} operacionais · ${o.eqNaoOp} em avaria/manutenção/parados`
      : 'Sem equipamentos atribuídos a esta obra')}
      ${eqs.map(e => {
        const nao = _EQ_NAO_OP.includes(e.estado);
        const sub = [e.codigo, e.matricula, e.propriedade === 'aluguer' ? 'Aluguer' : ''].filter(Boolean).join(' · ');
        return `<div class="eo-eq${nao ? ' nao' : ''}"><div style="min-width:0"><div class="eo-eq-n">${_esc(e.nome)}</div>
          ${sub ? `<small>${_esc(sub)}</small>` : ''}
          ${nao ? e.pend.slice(0, 2).map(m => `<small style="color:var(--orange)">⚠ ${_esc(m.descricao)}${m.data ? ' · ' + fmtPT(m.data) : ''}</small>`).join('') : ''}</div>
          <span class="eq-est-badge ${_EQ_ESTADO_CLS[e.estado] || 'eq-est-ok'}">${_EQ_ESTADO_TXT[e.estado] || _esc(e.estado)}</span></div>`;
      }).join('')}
    </div>`;
  }
  if (o.podeEQ && !o.eqAtivo) html += '<div class="eo-nota" style="margin-top:14px">Os equipamentos só são mostrados na semana atual (não há histórico do estado).</div>';
  document.getElementById('meo-body').innerHTML = html;
  openModal('modal-estado-obra');
}

// Lista de períodos: últimos 12 meses + o próximo, valor "ano-mês"
function _fechoPreencherMeses(sel){
  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const hoje = new Date();
  let html = '';
  for(let k = 1; k >= -12; k--){
    const d = new Date(hoje.getFullYear(), hoje.getMonth() + k, 1);
    html += `<option value="${d.getFullYear()}-${d.getMonth()+1}">${MESES[d.getMonth()]} ${d.getFullYear()}</option>`;
  }
  sel.innerHTML = html;
}

// Ao abrir a Folha de Fecho: fica sempre selecionado o mês atual
function abrirFechoMes(){
  const sel = document.getElementById('fecho-mes-sel');
  if(!sel) return;
  _fechoPreencherMeses(sel);
  const hoje = new Date();
  sel.value = `${hoje.getFullYear()}-${hoje.getMonth()+1}`;
  renderFechoMes();
}

async function renderFechoMes(){
  const sel = document.getElementById('fecho-mes-sel');
  if(!sel) return;
  if(!sel.options.length){ abrirFechoMes(); return; }
  const [ano, mesVal] = sel.value.split('-').map(Number);

  // Período: 22 do mês anterior → 21 do mês atual
  // Usar hora 12:00 para evitar problemas de timezone (UTC vs UTC+1)
  const dataIni = new Date(ano, mesVal === 1 ? -1 : mesVal - 2, 22, 12, 0, 0);
  const dataFim = new Date(ano, mesVal - 1, 21, 12, 0, 0);

  // Formatar datas para string YYYY-MM-DD sem desvio de timezone
  const fmtLocal = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return y + '-' + m + '-' + day;
  };

  const dIniStr = fmtLocal(dataIni);
  const dFimStr = fmtLocal(dataFim);

  // Atualiza info do período
  const infoEl = document.getElementById('fecho-periodo-info');
  if(infoEl) infoEl.textContent = 'Período: ' + dIniStr.split('-').reverse().join('/') + ' a ' + dFimStr.split('-').reverse().join('/');

  // seletor de mês em pílula (o <select> escondido continua a ser a fonte)
  const MES_L = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const lbl = document.getElementById('fecho-mes-lbl'), lsub = document.getElementById('fecho-mes-sub');
  if(lbl) lbl.textContent = MES_L[mesVal-1] + ' de ' + ano;
  if(lsub){ const h = new Date(); const d = (ano*12 + mesVal) - (h.getFullYear()*12 + h.getMonth()+1); lsub.textContent = d === 0 ? 'Mês atual' : d < 0 ? 'Histórico' : 'Próximo mês'; }

  const tbody = document.getElementById('fecho-tbody');
  if(tbody) tbody.innerHTML = '<tr><td colspan="8"><div class="pl-load"><span class="pl-logo"></span>A carregar dados…</div></td></tr>';

  try {
    window._fechoMesData = null; // nunca exportar dados de outro período/estado
    // Só dias de obra já aprovados pelo diretor de obra entram no fecho
    const {regs, pendentes} = await carregarRegistosFecho(dIniStr, dFimStr);
    if(infoEl && pendentes.length){
      const semObra = pendentes.filter(p => p.obraId === '_sem').length;
      infoEl.innerHTML = _esc(infoEl.textContent) + ' · <span style="color:var(--orange,#ea580c)">⚠ ' + pendentes.length
        + ' dia(s) de obra por aprovar pelo diretor de obra — não incluídos'
        + (semObra ? ' (' + semObra + ' sem obra)' : '') + '</span>';
    }

    // Construir mapa: data → colabNumero → registo
    const regMap = {};
    (regs||[]).forEach(r => {
      if(!regMap[r.data]) regMap[r.data] = {};
      regMap[r.data][String(r.colab_numero)] = r;
    });

    // Gerar lista de datas do período usando fmtLocal
    const datas = [];
    for(let d = new Date(dataIni); fmtLocal(d) <= dFimStr; d.setDate(d.getDate()+1)){
      datas.push(fmtLocal(new Date(d)));
    }

    // Calcular horas por colaborador
    const colabsAtivos = [...S.COLABORADORES].filter(c => c.ativo).sort((a,b) => a.n - b.n);
    const rows = [];

    for(const colab of colabsAtivos){
      const {n, nome, func} = colab;
      let totN = 0, totE = 0, dFer = 0, dFaltInj = 0, dFaltJust = 0;
      const obraHoras = {};

      for(const dk of datas){
        const r = (regMap[dk]||{})[String(n)];
        if(!r) continue;
        if(r.tipo === 'Folga') continue;
        if(r.tipo === 'Férias'){dFer++; continue;}
        if(r.tipo === 'Falta Injust.'){dFaltInj++; continue;}
        if(r.tipo === 'Falta Just.'){dFaltJust++; continue;}
        if(r.tipo && r.tipo.includes('Falta')){dFaltInj++; continue;} // compat. registos antigos
        const dateObj = new Date(dk + 'T12:00:00');
        const h = calcH(r.entrada ? r.entrada.slice(0,5) : '', r.saida ? r.saida.slice(0,5) : '', dateObj);
        totN += h.n;
        totE += h.e;
        const oId = r.obra_id || '_sem_obra';
        obraHoras[oId] = (obraHoras[oId]||0) + h.t;
      }

      const totT = totN + totE;
      if(totT === 0 && dFer === 0 && dFaltInj === 0 && dFaltJust === 0) continue;
      rows.push({n, nome, func, totN, totE, totT, obraHoras, dFer, dFaltInj, dFaltJust});
    }

    if(!tbody) return;

    if(rows.length === 0){
      tbody.innerHTML = '<tr><td colspan="8" class="fm-vazio">Sem registos aprovados para este período (' + dIniStr + ' a ' + dFimStr + ').' + (pendentes.length ? ' Aguardam aprovação do diretor de obra.' : '') + '</td></tr>';
      const totaisEl = document.getElementById('fecho-totais');
      if(totaisEl) totaisEl.style.display = 'none';
      const oc = document.getElementById('fecho-obras-card'); if(oc) oc.hidden = true;
      _fechoPassos(pendentes.length, 0);
      const dh = document.getElementById('fecho-det-h'); if(dh) dh.hidden = true;
      const ch = document.getElementById('fecho-chips'); if(ch) ch.innerHTML = '';
      return;
    }

    let globalN = 0, globalE = 0, globalT = 0, gFer = 0, gInj = 0, gJust = 0;
    const porObra = {};
    const htmlRows = rows.map((row) => {
      globalN += row.totN;
      globalE += row.totE;
      globalT += row.totT;
      gFer += row.dFer; gInj += row.dFaltInj; gJust += row.dFaltJust;
      Object.entries(row.obraHoras).forEach(([oId, h]) => { porObra[oId] = (porObra[oId] || 0) + h; });

      const obraEntries = Object.entries(row.obraHoras).sort((a,b) => b[1]-a[1]);
      const obraBadges = obraEntries.map(([oId, horas]) => {
        const pct = row.totT > 0 ? Math.round((horas / row.totT) * 100) : 0;
        const obra = S.OBRAS.find(o => String(o.id) === String(oId));
        const oNome = obra ? (obra.nome || obra.numero || oId) : (oId === '_sem_obra' ? 'Sem obra' : oId);
        return '<span class="fm-chip" title="' + _esc(oNome) + '">' + _esc(String(oNome).split(/\s[-–]\s/)[0]) + ' <em>' + pct + '%</em></span>';
      }).join('');
      const ini = (row.nome || '').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
      const pill = (v, cls) => v > 0 ? '<span class="hpc ' + cls + '">' + v + 'd</span>' : '<span class="fm-nil">—</span>';
      return '<tr>'
        + '<td class="fm-who"><div class="d-pp"><span class="d-rav">' + _esc(ini) + '</span><div><b>' + _esc(row.nome) + '</b><small>' + _esc(row.func || '—') + ' · Nº ' + row.n + '</small></div></div></td>'
        + '<td class="r n">' + fmtH(row.totN) + '</td>'
        + '<td class="r e' + (row.totE ? '' : ' z') + '">' + (row.totE ? '+' + fmtH(row.totE) : '—') + '</td>'
        + '<td class="r t">' + fmtH(row.totT) + '</td>'
        + '<td class="c">' + pill(row.dFer, 'fe') + '</td>'
        + '<td class="c">' + pill(row.dFaltInj, 'fi') + '</td>'
        + '<td class="c">' + pill(row.dFaltJust, 'fj') + '</td>'
        + '<td class="fm-obras">' + (obraBadges || '<span class="fm-nil">—</span>') + '</td>'
        + '</tr>';
    });
    tbody.innerHTML = htmlRows.join('');

    // Totais, estado por obra e passos do fecho
    const st = _fechoPorObra(regs || [], pendentes || []);
    const nVal = st.filter(o => o.ok).length;
    const totaisEl = document.getElementById('fecho-totais');
    if(totaisEl){
      totaisEl.style.display = '';
      const set = (id, t) => { const el = document.getElementById(id); if(el) el.textContent = t; };
      set('fecho-tot-n', fmtH(globalN)); set('fecho-tot-e', fmtH(globalE));
      set('fecho-tot-f', (gFer + gInj + gJust) + ' dias');
      set('fecho-tot-f-s', gInj + ' injust. · ' + gJust + ' just. · ' + gFer + ' férias');
      const v = document.getElementById('fecho-tot-v'); if(v) v.innerHTML = nVal + '<small> de ' + st.length + '</small>';
      const vs = document.getElementById('fecho-tot-v-s'); if(vs){ vs.textContent = (st.length - nVal) ? (st.length - nVal) + ' por validar' : 'Todas validadas'; vs.className = 'fm-chip-s ' + ((st.length - nVal) ? 'k-info' : 'k-ok'); }
    }
    window._fechoObras = st;
    _fechoRenderObras();
    _fechoPassos(pendentes.length, st.length);
    const dh = document.getElementById('fecho-det-h'); if(dh) dh.hidden = false;

    window._fechoMesData = {rows, mesVal, ano, dIniStr, dFimStr};

  } catch(err) {
    console.error('renderFechoMes error:', err);
    if(tbody) tbody.innerHTML = '<tr><td colspan="8" class="fm-vazio" style="color:var(--red)">Erro: ' + err.message + '</td></tr>';
  }
}

// ── Folha de Fecho: estado por obra, passos e filtro (portal em computador) ──
let _fechoFiltro = 'todas';
function _fechoPorObra(regs, pendentes){
  const m = new Map();
  const get = id => { if(!m.has(id)) m.set(id, { id, n: 0, e: 0, faltas: 0, dias: new Set(), pend: new Set() }); return m.get(id); };
  regs.forEach(r => {
    const o = get(r.obra_id || '_sem');
    o.dias.add(r.data);
    if(r.tipo && r.tipo.includes('Falta')) { o.faltas++; return; }
    if(r.tipo === 'Férias' || r.tipo === 'Folga') return;
    const h = calcH(r.entrada ? r.entrada.slice(0, 5) : '', r.saida ? r.saida.slice(0, 5) : '', new Date(r.data + 'T12:00:00'));
    o.n += h.n; o.e += h.e;
  });
  pendentes.forEach(p => get(p.obraId || '_sem').pend.add(p.data));
  return [...m.values()].map(o => {
    const ob = S.OBRAS.find(x => String(x.id) === String(o.id));
    const tot = o.dias.size + o.pend.size;
    const enc = ob ? [ob.encarregado_id, ...(ob.encarregados_extra || [])].filter(Boolean).map(i => S.USERS?.[i]?.nome || i) : [];
    return { ...o, nome: ob ? ob.nome : (o.id === '_sem' ? 'Sem obra' : o.id), enc: enc[0] || '—', prog: tot ? Math.round(100 * o.dias.size / tot) : 0, ok: o.pend.size === 0 && o.dias.size > 0 };
  }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
}
function _fechoRenderObras(){
  const st = window._fechoObras || [];
  const card = document.getElementById('fecho-obras-card'), tb = document.getElementById('fecho-obras'), ch = document.getElementById('fecho-chips');
  if(!card || !tb) return;
  const nVal = st.filter(o => o.ok).length;
  if(ch) ch.innerHTML = [['todas', 'Todas', st.length], ['ok', 'Validadas', nVal], ['pd', 'Por validar', st.length - nVal]]
    .map(([k, l, c]) => '<button type="button" class="d-chip-f' + (_fechoFiltro === k ? ' on' : '') + '" data-fmf="' + k + '">' + l + '<b>' + c + '</b></button>').join('');
  const lista = st.filter(o => _fechoFiltro === 'todas' || (_fechoFiltro === 'ok') === o.ok);
  card.hidden = !st.length;
  tb.innerHTML = lista.map(o => {
    const m = String(o.nome).match(/^(O\d+)\s*[-–]\s*(.+)$/);
    return '<tr><td class="fm-who">' + (m ? '<span class="d-cod">' + _esc(m[1]) + '</span> <b>' + _esc(m[2]) + '</b>' : '<b>' + _esc(o.nome) + '</b>') + '</td>'
      + '<td>' + _esc(o.enc) + '</td><td class="r n">' + fmtH(o.n + o.e) + '</td><td class="r e' + (o.e ? '' : ' z') + '">' + (o.e ? fmtH(o.e) : '—') + '</td><td class="r">' + (o.faltas || '—') + '</td>'
      + '<td><div class="fm-bar2"><i style="width:' + o.prog + '%;background:' + (o.ok ? 'var(--green)' : 'var(--orange)') + '"></i></div></td>'
      + '<td>' + (o.ok ? '<span class="dd-pill ok">Validada</span>' : '<span class="dd-pill warn">Por validar</span>') + '</td></tr>';
  }).join('') || '<tr><td colspan="7" class="fm-vazio">Sem obras para este filtro.</td></tr>';
}
function _fechoPassos(nPend, nObras){
  const box = document.getElementById('fecho-passos'); if(!box) return;
  const passo = (n, t, cls) => '<div class="' + cls + '"><em>' + (cls === 'dn' ? '✓' : n) + '</em>' + t + '</div>';
  const validacaoOk = nObras > 0 && nPend === 0;
  box.innerHTML = '<div class="fm-step">' + passo(1, 'Recolha de ponto', 'dn') + passo(2, 'Validação', validacaoOk ? 'dn' : 'cur') + passo(3, 'Aprovação', validacaoOk ? 'cur' : '') + passo(4, 'Processamento', '') + '</div>';
}
document.addEventListener('click', e => {
  const f = e.target.closest('[data-fmf]');
  if(f){ _fechoFiltro = f.dataset.fmf; _fechoRenderObras(); return; }
  const n = e.target.closest('[data-fnav]');
  if(n){
    const sel = document.getElementById('fecho-mes-sel'); if(!sel) return;
    const i = sel.selectedIndex + (+n.dataset.fnav);
    if(i >= 0 && i < sel.options.length){ sel.selectedIndex = i; renderFechoMes(); }
  }
});

async function exportFechoMes(){
  if(!window._fechoMesData || !window._fechoMesData.rows || !window._fechoMesData.rows.length){
    showToast('Carregue primeiro os dados clicando em Atualizar.');
    return;
  }
  const {rows, mesVal, ano, dIniStr, dFimStr} = window._fechoMesData;
  const mesNome = MESES_PT[mesVal-1];

  showToast('A gerar ficheiro Excel\u2026');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Plandese SA';
  const ws = workbook.addWorksheet('Folha de Fecho');

  ws.columns = [
    {header:'N\u00ba', key:'n', width:6},
    {header:'Nome', key:'nome', width:28},
    {header:'Fun\u00e7\u00e3o', key:'func', width:18},
    {header:'H.Normais', key:'hn', width:12},
    {header:'H.Extra', key:'he', width:10},
    {header:'Total', key:'ht', width:10},
    {header:'F\u00e9rias', key:'fer', width:9},
    {header:'F.Injust.', key:'finj', width:10},
    {header:'F.Just.', key:'fjust', width:10},
    {header:'Distribui\u00e7\u00e3o por Obra', key:'obras', width:50},
  ];

  // Linha de título (inserida antes do cabeçalho)
  ws.spliceRows(1, 0, []);
  ws.mergeCells('A1:J1');
  const titleCell = ws.getCell('A1');
  titleCell.value = 'Folha de Fecho \u2014 ' + mesNome + ' ' + ano + ' (' + dIniStr + ' a ' + dFimStr + ')';
  titleCell.font = {bold:true, size:13, color:{argb:'FF002060'}};
  titleCell.alignment = {horizontal:'center', vertical:'middle'};
  titleCell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FFD9E1F2'}};
  ws.getRow(1).height = 22;

  // Cabeçalhos da tabela
  const hdr = ws.getRow(2);
  ['N\u00ba','Nome','Fun\u00e7\u00e3o','H. Normais','H. Extra','Total Horas','F\u00e9rias','F.Injust.','F.Just.','Distribui\u00e7\u00e3o por Obra'].forEach((v,i) => {
    const cell = hdr.getCell(i+1);
    cell.value = v;
    cell.font = {bold:true, color:{argb:'FFFFFFFF'}};
    cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FF002060'}};
    cell.alignment = {horizontal:'center', vertical:'middle'};
  });
  hdr.height = 18;

  // Linhas de dados
  rows.forEach((row, i) => {
    const obraEntries = Object.entries(row.obraHoras).sort((a,b) => b[1]-a[1]);
    const obraStr = obraEntries.map(([oId, h]) => {
      const pct = row.totT > 0 ? Math.round((h/row.totT)*100) : 0;
      const obra = S.OBRAS.find(o => o.id === oId);
      const oNome = obra ? (obra.nome||obra.numero||oId) : (oId === '_sem_obra' ? 'Sem obra' : oId);
      return oNome + ': ' + pct + '%';
    }).join(' | ');

    const dataRow = ws.getRow(i+3);
    dataRow.values = [row.n, row.nome, row.func||'', fmtH(row.totN), fmtH(row.totE), fmtH(row.totT), row.dFer||0, row.dFaltInj||0, row.dFaltJust||0, obraStr];
    dataRow.eachCell(cell => {
      cell.alignment = {vertical:'middle', wrapText:true};
      if(i%2===1) cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FFF2F6FF'}};
    });
    dataRow.height = 16;
  });

  // Linha de totais
  const totRow = ws.getRow(rows.length+3);
  const globalN = rows.reduce((s,r) => s+r.totN, 0);
  const globalE = rows.reduce((s,r) => s+r.totE, 0);
  const globalT = rows.reduce((s,r) => s+r.totT, 0);
  const globalFer = rows.reduce((s,r) => s+(r.dFer||0), 0);
  const globalFaltInj = rows.reduce((s,r) => s+(r.dFaltInj||0), 0);
  const globalFaltJust = rows.reduce((s,r) => s+(r.dFaltJust||0), 0);
  totRow.values = ['', 'TOTAL (' + rows.length + ' trabalhadores)', '', fmtH(globalN), fmtH(globalE), fmtH(globalT), globalFer||'', globalFaltInj||'', globalFaltJust||'', ''];
  totRow.eachCell(cell => {
    cell.font = {bold:true, color:{argb:'FF002060'}};
    cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FFD9E1F2'}};
    cell.alignment = {vertical:'middle', horizontal:'center'};
  });
  totRow.height = 18;

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Folha_Fecho_' + mesNome + '_' + ano + '.xlsx';
  a.click();
  URL.revokeObjectURL(url);
  showToast('\u2713 Ficheiro exportado!');
}

export {
  renderPainel,
  renderFechoMes, abrirFechoMes, exportFechoMes
};
