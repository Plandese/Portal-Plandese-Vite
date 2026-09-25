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
  return `<div class="card" style="padding:20px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <div style="width:36px;height:36px;border-radius:9px;background:${bgIcon};color:${corIcon};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px">${iconPath}</svg>
      </div>
      <div>
        <div style="font-size:14px;font-weight:600;color:var(--gray-800)">${titulo}</div>
        <div style="font-size:11px;color:var(--gray-400)">${subtitulo}</div>
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

  const [estado, ferias] = await Promise.all([htmlEstadoObrasSemana(), podeFolhas ? htmlFeriasFaltasSemana() : '']);
  if (seq !== _painelSeq) return;
  grid.innerHTML = estado + ferias;
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
    podeMO ? q(() => sb.from('registos_ponto').select('data,colab_numero,obra_id,tipo').gte('data', _ymd(monAnt)).lte('data', fim), []) : [],
    podeMO ? q(() => sb.from('ferias_previstas').select('colab_numero,data').gte('data', ini).lte('data', fim), []) : [],
    podeEQ ? q(() => sb.from('equipamentos').select('id,nome,codigo,matricula,estado,ultimo_local,propriedade'), []) : [],
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

  porObra.forEach(o => {
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

  return [...porObra.values()].filter(o => _pObra ? o.obra.id === _pObra : (o.equipa.size || o.equips.length))
    .sort((a, b) => a.obra.nome.localeCompare(b.obra.nome, 'pt'));
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
      <div class="eo-nome">${_esc(o.obra.nome)}</div>
      <div class="eo-mets">
        ${podeMO ? _eoMetrica('MO', o.mo, `${o.equipa.size} pessoas · ${o.aus} dias de ausência`) : ''}
        ${podeEQ ? _eoMetrica('EQ', o.eq, eqTit(o)) : ''}
      </div>
    </div>`).join('') : _painelVazio(_pObra ? 'Sem equipa nem equipamentos registados nesta obra.' : 'Sem dados de equipas ou equipamentos nas obras ativas.'));
  return _painelCardHtml('Estado das obras', `${_rotSemana()} · ${semanaTxt} · toque numa obra para o detalhe`, 'var(--blue-600)', 'var(--blue-50)', icon, corpo);
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

export function abrirEstadoObra(id) {
  const o = _estadoObras.get(id);
  if (!o) return;
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

  const tbody = document.getElementById('fecho-tbody');
  if(tbody) tbody.innerHTML = '<tr><td colspan="10"><div class="pl-load"><span class="pl-logo"></span>A carregar dados…</div></td></tr>';

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
      tbody.innerHTML = '<tr><td colspan="10" style="padding:40px;text-align:center;color:var(--gray-400)">Sem registos aprovados para este período (' + dIniStr + ' a ' + dFimStr + ').' + (pendentes.length ? ' Aguardam aprovação do diretor de obra.' : '') + '</td></tr>';
      const totaisEl = document.getElementById('fecho-totais');
      if(totaisEl) totaisEl.style.display = 'none';
      return;
    }

    let globalN = 0, globalE = 0, globalT = 0;
    const htmlRows = rows.map((row, i) => {
      globalN += row.totN;
      globalE += row.totE;
      globalT += row.totT;

      const obraEntries = Object.entries(row.obraHoras).sort((a,b) => b[1]-a[1]);
      const obraBadges = obraEntries.map(([oId, horas]) => {
        const pct = row.totT > 0 ? Math.round((horas / row.totT) * 100) : 0;
        const obra = S.OBRAS.find(o => String(o.id) === String(oId));
        const oNome = obra ? (obra.nome || obra.numero || oId) : (oId === '_sem_obra' ? 'Sem obra' : oId);
        return '<span style="display:inline-flex;align-items:center;gap:4px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:2px 8px;font-size:11px;font-weight:600;color:#1d4ed8;white-space:nowrap;margin:2px 2px 2px 0">' + oNome + ' <span style="color:#6b7280">' + pct + '%</span></span>';
      }).join('');

      const bg = i % 2 === 0 ? '' : 'background:var(--gray-50)';
      return '<tr style="' + bg + '">'
        + '<td style="padding:10px 14px;color:var(--gray-500);font-family:monospace;font-size:12px">' + row.n + '</td>'
        + '<td style="padding:10px 14px;font-weight:600;color:var(--gray-900)">' + row.nome + '</td>'
        + '<td style="padding:10px 14px;color:var(--gray-600);font-size:12px">' + (row.func||'—') + '</td>'
        + '<td style="padding:10px 14px;text-align:right;font-family:monospace;color:var(--gray-700)">' + fmtH(row.totN) + '</td>'
        + '<td style="padding:10px 14px;text-align:right;font-family:monospace;color:#3b82f6">' + fmtH(row.totE) + '</td>'
        + '<td style="padding:10px 14px;text-align:right;font-family:monospace;font-weight:700;color:var(--green)">' + fmtH(row.totT) + '</td>'
        + '<td style="padding:10px 14px;text-align:center;font-family:monospace;color:#16a34a;font-weight:600">' + (row.dFer > 0 ? row.dFer + 'd' : '—') + '</td>'
        + '<td style="padding:10px 14px;text-align:center;font-family:monospace;color:#dc2626;font-weight:600">' + (row.dFaltInj > 0 ? row.dFaltInj + 'd' : '—') + '</td>'
        + '<td style="padding:10px 14px;text-align:center;font-family:monospace;color:#dc2626;font-weight:600">' + (row.dFaltJust > 0 ? row.dFaltJust + 'd' : '—') + '</td>'
        + '<td style="padding:10px 14px">' + (obraBadges || '<span style="color:var(--gray-300);font-size:12px">—</span>') + '</td>'
        + '</tr>';
    });
    tbody.innerHTML = htmlRows.join('');

    // Totais rodapé
    const totaisEl = document.getElementById('fecho-totais');
    if(totaisEl){
      totaisEl.style.display = '';
      document.getElementById('fecho-tot-n').textContent = fmtH(globalN);
      document.getElementById('fecho-tot-e').textContent = fmtH(globalE);
      document.getElementById('fecho-tot-t').textContent = fmtH(globalT);
      document.getElementById('fecho-tot-w').textContent = rows.length;
    }

    window._fechoMesData = {rows, mesVal, ano, dIniStr, dFimStr};

  } catch(err) {
    console.error('renderFechoMes error:', err);
    if(tbody) tbody.innerHTML = '<tr><td colspan="10" style="padding:32px;text-align:center;color:var(--red)">Erro: ' + err.message + '</td></tr>';
  }
}

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
