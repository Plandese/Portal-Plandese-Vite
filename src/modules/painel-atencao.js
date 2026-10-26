// ═══════════════════════════════════════
//  PAINEL PRINCIPAL — "O que precisa da minha atenção",
//  cartões extra (gasóleo, equipamentos) e personalização por utilizador.
//  Cada bloco só aparece (e só consulta dados) se o perfil tiver acesso à secção respetiva.
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S, R } from '../state.js';
import { obraVisivelPara, obraEmCurso } from '../config.js';
import { canAccessSection } from './permissions.js';
import { podeAprovarObra } from './ponto.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const somaDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const eur = v => (v || 0).toLocaleString('pt-PT', { maximumFractionDigits: 0 }) + ' €';
const pl = (n, s, p) => `${n} ${n === 1 ? s : p}`;

const IC = {
  pessoas: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  ponto: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  carrinho: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  fatura: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
  aviso: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  equip: '<path d="M3 18a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M5 16v-4h5v4M10 12l4-7 5 5M19 10l1.5 4H17"/>',
  gota: '<path d="M12 2.7S5 10 5 14.5a7 7 0 0 0 14 0C19 10 12 2.7 12 2.7z"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
};
const svg = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[k]}</svg>`;

// ── Dados (uma só ronda de pedidos, em cache curto) ─────────────────────────
let _cache = null; // { user, ts, d }
const TTL = 45000;

async function lerTudo(montar) { // paginação: o Supabase devolve no máximo 1000 linhas por pedido
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await montar().range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

export async function carregarPainelDados(forcar = false) {
  const user = S.currentUser?.key || '';
  if (!forcar && _cache && _cache.user === user && Date.now() - _cache.ts < TTL) return _cache.d;
  const hojeD = new Date(), hoje = ymd(hojeD);
  const q = async (ativo, fn, fb) => { if (!ativo) return fb; try { return await fn(); } catch (e) { console.warn('painel (atenção):', e); return fb; } };
  const a = s => canAccessSection(s);
  const podePonto = a('historico'), podeCmp = a('compras'), podeFat = a('faturas'), podeApr = a('faturas-aprovar'), podeTes = a('tesouraria');
  const podeEq = a('equipamentos'), podeComb = a('combustivel');
  const seg = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); })();

  const [regsAntigos, aprov, regsHoje, pedidos, faturas, equips, manut, comb] = await Promise.all([
    q(podePonto, () => lerTudo(() => sb.from('registos_ponto').select('data,obra_id').gte('data', ymd(somaDias(hojeD, -14))).lt('data', hoje).order('data')), []),
    q(podePonto, () => lerTudo(() => sb.from('aprovacoes_ponto').select('obra_id,data').gte('data', ymd(somaDias(hojeD, -14))).order('data')), []),
    q(podePonto, async () => { const { data, error } = await sb.from('registos_ponto').select('colab_numero,obra_id,tipo').eq('data', hoje); if (error) throw error; return data || []; }, []),
    q(podeCmp, async () => { const { data, error } = await sb.from('pedidos_compra').select('id,estado,urgencia,obra_id'); if (error) throw error; return data || []; }, []),
    q(podeFat || podeApr || podeTes, async () => { const { data, error } = await sb.from('faturas').select('id,status,data_pag,total').in('status', ['extraida', 'rever', 'pendente_aprovacao', 'aguarda_diretor', 'aprovada']); if (error) throw error; return data || []; }, []),
    q(podeEq, async () => { const { data, error } = await sb.from('equipamentos').select('id,estado,ultimo_registo'); if (error) throw error; return data || []; }, []),
    q(podeEq, async () => { const { data, error } = await sb.from('eq_manutencoes').select('id').eq('estado', 'pendente'); if (error) throw error; return data || []; }, []),
    q(podeComb, async () => { const { data, error } = await sb.from('registos_combustivel').select('data,litros,obra_id,obra_nome,aprovacao').gte('data', seg); if (error) throw error; return data || []; }, []),
  ]);

  // Dias de obra com registos mas sem aprovação (só os que esta pessoa pode aprovar)
  const aprovados = new Set(aprov.map(r => r.obra_id + '|' + r.data));
  const pend = new Map();
  regsAntigos.forEach(r => {
    if (!r.obra_id) return;
    const k = r.obra_id + '|' + r.data;
    if (!aprovados.has(k) && !pend.has(k) && podeAprovarObra(r.obra_id)) pend.set(k, r);
  });

  const pedidosVis = pedidos.filter(p => obraVisivelPara(S.currentUser, S.OBRAS, p.obra_id));
  const pendPed = pedidosVis.filter(p => (p.estado || 'pendente') === 'pendente');
  const urgentes = pendPed.filter(p => p.urgencia === 'Urgente' || p.urgencia === 'Muito Urgente').length;

  const hojeMais5 = ymd(somaDias(hojeD, 5));
  const porValidar = faturas.filter(f => ['extraida', 'rever', 'pendente_aprovacao'].includes(f.status));
  const porAprovar = faturas.filter(f => f.status === 'aguarda_diretor');
  const aPagar = faturas.filter(f => f.status === 'aprovada' && f.data_pag);
  const vencidas = aPagar.filter(f => f.data_pag < hoje);
  const aVencer = aPagar.filter(f => f.data_pag >= hoje && f.data_pag <= hojeMais5);
  const somaTot = l => l.reduce((s, f) => s + (parseFloat(f.total) || 0), 0);

  const limite30 = Date.now() - 30 * 864e5;
  const semLocal = equips.filter(e => e.ultimo_registo && new Date(e.ultimo_registo).getTime() < limite30).length;

  const presentes = new Set(regsHoje.filter(r => ['Presença', 'Normal', 'Hora Extra'].includes(r.tipo || 'Presença') && obraVisivelPara(S.currentUser, S.OBRAS, r.obra_id)).map(r => r.colab_numero));
  const obrasComPonto = new Set(regsHoje.filter(r => r.obra_id).map(r => r.obra_id));
  const obrasMinhas = S.OBRAS.filter(o => obraEmCurso(o) && obraVisivelPara(S.currentUser, S.OBRAS, o.id));

  const litrosPorObra = new Map();
  comb.filter(r => r.aprovacao !== 'rejeitado' && obraVisivelPara(S.currentUser, S.OBRAS, r.obra_id)).forEach(r => {
    const nome = S.OBRAS.find(o => o.id === r.obra_id)?.nome || r.obra_nome || 'Sem obra';
    litrosPorObra.set(nome, (litrosPorObra.get(nome) || 0) + (parseFloat(r.litros) || 0));
  });

  const d = {
    acesso: { ponto: podePonto, cmp: podeCmp, fat: podeFat, apr: podeApr, tes: podeTes, eq: podeEq, comb: podeComb },
    pontoPend: pend.size,
    presentes: presentes.size, ativos: S.COLABORADORES.filter(c => c.ativo).length,
    obrasSemPonto: [0, 6].includes(hojeD.getDay()) ? 0 : obrasMinhas.filter(o => !obrasComPonto.has(o.id)).length, totalObras: obrasMinhas.length,
    pedPend: pendPed.length, pedUrg: urgentes,
    fatValidar: porValidar.length, fatAprovar: porAprovar.length,
    fatVenc: vencidas.length, fatVencEur: somaTot(vencidas), fatProx: aVencer.length, fatProxEur: somaTot(aVencer),
    eqParados: equips.filter(e => ['parada', 'oficina'].includes(e.estado)).length,
    manutPend: manut.length, semLocal,
    combPend: comb.filter(r => r.aprovacao === 'pendente').length,
    litrosSemana: [...litrosPorObra.values()].reduce((s, v) => s + v, 0),
    litrosPorObra: [...litrosPorObra.entries()].sort((x, y) => y[1] - x[1]),
  };
  _cache = { user, ts: Date.now(), d };
  return d;
}

export function invalidarPainelDados() { _cache = null; }

// ── "O que precisa da minha atenção" ────────────────────────────────────────
function itensAtencao(d) {
  const it = [];
  const add = (nivel, ic, txt, sec) => it.push({ nivel, ic, txt, sec });
  const a = d.acesso;
  if (a.ponto && d.pontoPend) add('warn', 'ponto', `${pl(d.pontoPend, 'dia de ponto', 'dias de ponto')} por aprovar`, 'historico');
  if (a.apr && d.fatAprovar) add('warn', 'fatura', `${pl(d.fatAprovar, 'fatura', 'faturas')} por aprovar`, 'faturas-aprovar');
  if (a.tes && d.fatVenc) add('bad', 'aviso', `${pl(d.fatVenc, 'fatura vencida', 'faturas vencidas')} (${eur(d.fatVencEur)})`, 'tesouraria');
  if (a.tes && d.fatProx) add('warn', 'fatura', `${pl(d.fatProx, 'fatura', 'faturas')} a vencer em 5 dias (${eur(d.fatProxEur)})`, 'tesouraria');
  if (a.fat && d.fatValidar) add('info', 'fatura', `${pl(d.fatValidar, 'fatura', 'faturas')} por validar`, 'faturas');
  if (a.cmp && d.pedPend) add(d.pedUrg ? 'bad' : 'warn', 'carrinho', `${pl(d.pedPend, 'pedido de compra', 'pedidos de compra')} por aprovar${d.pedUrg ? ` · ${pl(d.pedUrg, 'urgente', 'urgentes')}` : ''}`, 'compras');
  if (a.comb && d.combPend) add('warn', 'gota', `${pl(d.combPend, 'registo de gasóleo', 'registos de gasóleo')} por aprovar`, 'combustivel');
  if (a.eq && d.eqParados) add('bad', 'equip', `${pl(d.eqParados, 'equipamento parado ou em oficina', 'equipamentos parados ou em oficina')}`, 'equipamentos');
  if (a.eq && d.manutPend) add('info', 'equip', `${pl(d.manutPend, 'manutenção pendente', 'manutenções pendentes')}`, 'equipamentos');
  if (a.eq && d.semLocal) add('info', 'pin', `${pl(d.semLocal, 'equipamento', 'equipamentos')} sem localização há mais de 30 dias`, 'equipamentos');
  const ordem = { bad: 0, warn: 1, info: 2 };
  return it.sort((x, y) => ordem[x.nivel] - ordem[y.nivel]);
}

// max = nº de linhas visíveis (telemóvel: 4); as restantes ficam atrás de "Ver mais"
export async function htmlAtencao({ max = 0 } = {}) {
  const d = await carregarPainelDados();
  const itens = itensAtencao(d);
  if (!Object.values(d.acesso).some(Boolean)) return '';
  const linha = i => `<button type="button" class="pat-row pat-${i.nivel}" onclick="goTo('${i.sec}')"><span class="pat-ic">${svg(i.ic)}</span><span class="pat-tx">${esc(i.txt)}</span><span class="pat-chev" aria-hidden="true">›</span></button>`;
  const vis = max ? itens.slice(0, max) : itens, resto = max ? itens.slice(max) : [];
  const corpo = itens.length
    ? vis.map(linha).join('') + (resto.length ? `<details class="pat-mais"><summary>Ver mais ${resto.length}</summary>${resto.map(linha).join('')}</details>` : '')
    : '<div class="pat-ok"><span>✓</span> Está tudo em dia. Nada precisa da sua atenção.</div>';
  return `<div class="card pat-card"><div class="pat-h"><b>O que precisa da minha atenção</b>${itens.length ? `<span class="pat-n">${itens.length}</span>` : ''}</div>${corpo}</div>`;
}

// ── Cartões extra ───────────────────────────────────────────────────────────
function cartao(titulo, sub, ic, corpo) {
  return `<div class="card pc-card" style="padding:20px"><div class="pc-head" style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
    <div class="pc-ic" style="width:36px;height:36px;border-radius:9px;background:var(--blue-50);color:var(--blue-600);display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="display:flex;width:18px;height:18px">${svg(ic)}</span></div>
    <div><div class="pc-t" style="font-size:14px;font-weight:600;color:var(--gray-800)">${titulo}</div><div class="pc-s" style="font-size:11px;color:var(--gray-400)">${sub}</div></div></div>${corpo}</div>`;
}

export async function htmlCombustivelSemana() {
  const d = await carregarPainelDados();
  if (!d.acesso.comb) return '';
  const lista = d.litrosPorObra.slice(0, 6), max = Math.max(1, ...lista.map(x => x[1]));
  const corpo = lista.length
    ? lista.map(([nome, l]) => `<div class="pat-bar"><div class="pat-bar-l"><span>${esc(nome)}</span><b>${Math.round(l).toLocaleString('pt-PT')} L</b></div><div class="pat-bar-t"><i style="width:${(l / max) * 100}%"></i></div></div>`).join('')
    : '<div style="font-size:13px;color:var(--gray-400);padding:8px 0">Sem abastecimentos registados esta semana.</div>';
  return cartao('Gasóleo por obra', `Esta semana · ${Math.round(d.litrosSemana).toLocaleString('pt-PT')} L no total`, 'gota', corpo);
}

export async function htmlEquipamentosResumo() {
  const d = await carregarPainelDados();
  if (!d.acesso.eq) return '';
  const cel = (n, rot, cls) => `<button type="button" class="pat-cel ${cls}" onclick="goTo('equipamentos')"><b>${n}</b><span>${rot}</span></button>`;
  return cartao('Equipamentos', 'Estado atual', 'equip', `<div class="pat-cels">${cel(d.eqParados, 'Parados ou em oficina', d.eqParados ? 'pat-bad' : '')}${cel(d.manutPend, 'Manutenções pendentes', d.manutPend ? 'pat-warn' : '')}${cel(d.semLocal, 'Sem localização há 30 dias', '')}</div>`);
}

// ── Cartões do painel: ordem por perfil + personalização por utilizador ─────
export const CARTOES = {
  atencao: 'O que precisa da minha atenção',
  estado: 'Estado das obras',
  ferias: 'Férias e faltas',
  equipamentos: 'Equipamentos',
  combustivel: 'Gasóleo por obra',
};
const PADRAO = {
  admin: ['atencao', 'estado', 'ferias', 'equipamentos', 'combustivel'],
  diretor_obra: ['atencao', 'estado', 'ferias'],
  compras: ['atencao'],
  financeiro: ['atencao'],
  comercial: ['atencao', 'estado'],
};
const padrao = () => PADRAO[S.currentUser?.role] || ['atencao', 'estado', 'ferias'];

let _cfg = null, _cfgUser = null; // { ordem:[ids], zonas:{}, layout:{id:{c,w,y}} }
const lsKey = u => 'plandese_painel_cartoes_' + (u || '');
const zonaDe = (cfg, id) => cfg.zonas?.[id] === 'lateral' ? 'lateral' : 'principal';

export async function cartoesPainel() {
  const user = S.currentUser?.key || null;
  if (_cfg && _cfgUser === user) return _cfg;
  _cfgUser = user; _cfg = null;
  const ler = c => (c && Array.isArray(c.ordem)) ? { ordem: c.ordem.filter(id => CARTOES[id]), zonas: c.zonas || {}, layout: c.layout || {} } : Array.isArray(c) ? { ordem: c.filter(id => CARTOES[id]), zonas: {}, layout: {} } : null;
  if (user) {
    try {
      const { data, error } = await sb.from('utilizadores').select('painel_config').eq('username', user).single();
      if (error) throw error;
      _cfg = ler(data?.painel_config?.painel?.cartoes ? { ordem: data.painel_config.painel.cartoes, zonas: data.painel_config.painel.zonas, layout: data.painel_config.painel.layout } : null);
      try { localStorage.setItem(lsKey(user), JSON.stringify(_cfg)); } catch (e) { /* sem armazenamento */ }
    } catch (e) {
      try { _cfg = ler(JSON.parse(localStorage.getItem(lsKey(user)))); } catch (_) { /* sem cópia local */ }
    }
  }
  if (!_cfg) _cfg = { ordem: padrao(), zonas: {}, layout: {} };
  return _cfg;
}
export { zonaDe };

async function guardarCartoes(cfg) {
  const user = S.currentUser?.key || null;
  _cfg = cfg; _cfgUser = user;
  try { localStorage.setItem(lsKey(user), JSON.stringify(cfg)); } catch (e) { /* sem armazenamento */ }
  if (!user) return;
  try {
    const { data } = await sb.from('utilizadores').select('painel_config').eq('username', user).single();
    const painel_config = { ...(data?.painel_config || {}), painel: { cartoes: cfg.ordem, zonas: cfg.zonas, layout: cfg.layout || {} } };
    await sb.from('utilizadores').update({ painel_config }).eq('username', user);
  } catch (e) { console.warn('painel (guardar cartões):', e); }
}

// Janela de personalização (criada aqui, sem HTML no index): ordenar e esconder cartões
let _rascunho = [], _visiveis = new Set(), _zonas = {};
export async function abrirPersonalizarPainel() {
  const atual = await cartoesPainel();
  _visiveis = new Set(atual.ordem); _zonas = { ...atual.zonas };
  _rascunho = [...atual.ordem, ...Object.keys(CARTOES).filter(id => !atual.ordem.includes(id))];
  let m = document.getElementById('pcust-modal');
  if (!m) { m = document.createElement('div'); m.id = 'pcust-modal'; m.className = 'pcust-ov'; document.body.appendChild(m); m.addEventListener('mousedown', e => { if (e.target === m) fecharPersonalizarPainel(); }); }
  desenharPersonalizar();
  m.style.display = 'flex';
}
function desenharPersonalizar() {
  const m = document.getElementById('pcust-modal'); if (!m) return;
  m.innerHTML = `<div class="pcust"><div class="pcust-h"><b>Personalizar painel</b><small>Escolha o que quer ver. Para mudar de sítio, arraste os cartões no painel</small></div>
    <div class="pcust-l">${_rascunho.map((id, i) => `<div class="pcust-r${_visiveis.has(id) ? '' : ' off'}">
      <label><input type="checkbox" ${_visiveis.has(id) ? 'checked' : ''} onchange="pcustToggle('${id}',this.checked)"/><span>${esc(CARTOES[id])}</span></label>
      <span class="pcust-ar"><button type="button" ${i === 0 ? 'disabled' : ''} onclick="pcustMover('${id}',-1)" aria-label="Subir">▲</button><button type="button" ${i === _rascunho.length - 1 ? 'disabled' : ''} onclick="pcustMover('${id}',1)" aria-label="Descer">▼</button></span></div>`).join('')}</div>
    <div class="pcust-f"><button type="button" class="pcust-b" onclick="pcustRepor()">Repor predefinição</button><span style="flex:1"></span><button type="button" class="pcust-b" onclick="fecharPersonalizarPainel()">Cancelar</button><button type="button" class="pcust-b pcust-p" onclick="pcustGuardar()">Guardar</button></div></div>`;
}
export function pcustToggle(id, on) { if (on) _visiveis.add(id); else _visiveis.delete(id); desenharPersonalizar(); }
export function pcustZona(id, z) { _zonas[id] = z; }
export function pcustMover(id, dir) {
  const i = _rascunho.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= _rascunho.length) return;
  [_rascunho[i], _rascunho[j]] = [_rascunho[j], _rascunho[i]];
  desenharPersonalizar();
}
export function fecharPersonalizarPainel() { const m = document.getElementById('pcust-modal'); if (m) m.style.display = 'none'; }
export async function pcustGuardar() { const atual = await cartoesPainel(); await guardarCartoes({ ordem: _rascunho.filter(id => _visiveis.has(id)), zonas: _zonas, layout: atual.layout || {} }); fecharPersonalizarPainel(); R.renderPainel?.(); }
export async function pcustRepor() { await guardarCartoes({ ordem: padrao(), zonas: {}, layout: {} }); fecharPersonalizarPainel(); R.renderPainel?.(); }

// ── Painel livre (computador) ────────────────────────────────────────────────
// Grelha de 12 colunas com cartões posicionados à vontade (coluna, largura em colunas e altura em px,
// com encaixe). Nunca se sobrepõem e respeitam sempre a distância (GAP) entre si: ao largar um cartão,
// os que ficariam por baixo são empurrados para baixo.
const GAP = 20, COLS = 12, SNAP = 10, ESTREITO = 900, ALT_MIN = 90;
const LARG_PADRAO = { calendario: 4, favoritos: 4 };
const COL_PADRAO = { calendario: 8, favoritos: 8 };
const larguraPadrao = id => LARG_PADRAO[id] ?? 8;
const colunaPadrao = id => COL_PADRAO[id] ?? 0;
let _livre = null; // { el, ro, cfg, itens }
const info = { drag: null };

function dimensoes(el) {
  const W = el.clientWidth, colW = (W - (COLS - 1) * GAP) / COLS;
  return { W, colW, passo: colW + GAP };
}
const cartoesDoLivre = el => [...el.querySelectorAll(':scope > .pcard')].filter(c => c.style.display !== 'none');

function resolver(itens, primeiro) {
  const ord = [...itens].sort((a, b) => (a.id === primeiro ? -1 : b.id === primeiro ? 1 : 0) || ((a.y ?? 1e9) - (b.y ?? 1e9)) || (a.ordem - b.ordem));
  const postos = [];
  ord.forEach(k => {
    if (k.y == null) k.y = 0;
    for (let mexeu = true; mexeu;) {
      mexeu = false;
      postos.forEach(o => {
        if (k.c < o.c + o.w && o.c < k.c + k.w && k.y < o.y + o.h + GAP && o.y < k.y + k.h + GAP) { k.y = o.y + o.h + GAP; mexeu = true; }
      });
    }
    postos.push(k);
  });
}

export function aplicarLayoutLivre(primeiro) {
  if (!_livre) return;
  const { el, cfg } = _livre;
  const cards = cartoesDoLivre(el);
  const { W, colW, passo } = dimensoes(el);
  if (W < ESTREITO) { // ecrã estreito: cartões um por baixo do outro, sem arrastar
    el.classList.add('painel-livre-estreito'); el.style.height = '';
    el.querySelectorAll(':scope > .pcard').forEach(c => { c.style.left = c.style.top = c.style.width = ''; });
    return;
  }
  el.classList.remove('painel-livre-estreito');
  const itens = cards.map((c, i) => {
    const l = cfg.layout?.[c.dataset.card] || {};
    const w = Math.max(2, Math.min(COLS, l.w || larguraPadrao(c.dataset.card)));
    const cc = Math.max(0, Math.min(COLS - w, l.c ?? colunaPadrao(c.dataset.card)));
    const esc = l.r > 0 ? Math.max(0.5, Math.min(2, W / l.r)) : 1; // alturas e posição vertical acompanham a largura em que foram guardadas
    const fixa = l.h >= ALT_MIN ? Math.round(l.h * esc) : null;
    c.style.height = fixa ? fixa + 'px' : ''; c.classList.toggle('pcard-fixa', !!fixa);
    return { id: c.dataset.card, el: c, c: cc, w, y: l.y == null ? null : Math.round(l.y * esc), h: fixa || c.offsetHeight, hFixa: fixa, ordem: i };
  });
  resolver(itens, primeiro);
  itens.forEach(k => {
    k.el.style.left = k.c * passo + 'px'; k.el.style.top = k.y + 'px';
    k.el.style.width = k.w * colW + (k.w - 1) * GAP + 'px';
  });
  el.style.height = Math.max(0, ...itens.map(k => k.y + k.h)) + GAP + 'px';
  _livre.itens = itens;
}

async function guardarLayoutLivre() {
  if (!_livre?.itens) return;
  const atual = await cartoesPainel();
  const layout = {};
  const r = _livre.el.clientWidth;
  _livre.itens.forEach(k => { layout[k.id] = { c: k.c, w: k.w, y: k.y, r, ...(k.hFixa ? { h: k.hFixa } : {}) }; });
  await guardarCartoes({ ...atual, layout });
}

// cartoes = [{ id, html }]; "calendario" e "favoritos" são os blocos que já existiam na coluna lateral
export function montarPainelLivre(cartoes, cfg) {
  const sec = document.getElementById('sec-painel'); if (!sec) return;
  let el = document.getElementById('painel-livre');
  if (!el) {
    el = document.createElement('div'); el.id = 'painel-livre'; el.className = 'painel-livre';
    sec.querySelector('.painel-layout').before(el);
    el.addEventListener('pointerdown', iniciarArrasto);
    el.addEventListener('dblclick', async ev => {
      const rs = ev.target.closest('.pcard-rs'); if (!rs || !_livre) return;
      const id = rs.parentElement.dataset.card, cfg = _livre.cfg;
      if (cfg.layout?.[id]) { delete cfg.layout[id].w; delete cfg.layout[id].h; }
      aplicarLayoutLivre(id); guardarLayoutLivre();
    });
  }
  sec.classList.add('painel-modo-livre');
  const fixos = { calendario: document.getElementById('cal-widget'), favoritos: document.getElementById('painel-atalhos') };
  Object.entries(fixos).forEach(([id, node]) => {
    if (!node || el.querySelector(`:scope > .pcard[data-card="${id}"]`)) return;
    const w = document.createElement('div'); w.className = 'pcard'; w.dataset.card = id; w.appendChild(node); el.appendChild(w);
  });
  const ids = new Set([...cartoes.map(c => c.id), 'calendario', 'favoritos']);
  el.querySelectorAll(':scope > .pcard').forEach(c => { if (!ids.has(c.dataset.card)) c.remove(); });
  cartoes.forEach(({ id, html }) => {
    let w = el.querySelector(`:scope > .pcard[data-card="${id}"]`);
    if (!w) { w = document.createElement('div'); w.className = 'pcard'; w.dataset.card = id; el.appendChild(w); }
    w.innerHTML = html || '';
    w.style.display = html ? '' : 'none';
  });
  el.querySelectorAll(':scope > .pcard').forEach(c => {
    if (!c.querySelector(':scope > .pcard-rs')) { const h = document.createElement('span'); h.className = 'pcard-rs'; h.title = 'Arraste para mudar o tamanho (duplo clique repõe)'; c.appendChild(h); }
  });
  const ro = _livre?.ro || new ResizeObserver(() => { if (!info.drag) aplicarLayoutLivre(); });
  _livre = { el, cfg, itens: null, ro };
  ro.disconnect();
  el.querySelectorAll(':scope > .pcard').forEach(c => ro.observe(c));
  ro.observe(el);
  aplicarLayoutLivre();
}

export function desmontarPainelLivre() { document.getElementById('sec-painel')?.classList.remove('painel-modo-livre'); }

function iniciarArrasto(e) {
  if (!_livre || e.button > 0 || _livre.el.classList.contains('painel-livre-estreito')) return;
  if (e.target.closest('input,select,textarea,a,summary')) return;
  const card = e.target.closest('.pcard'); if (!card || card.parentElement !== _livre.el) return;
  const redim = !!e.target.closest('.pcard-rs');
  const { colW, passo } = dimensoes(_livre.el);
  const r0 = card.getBoundingClientRect(), p0 = _livre.el.getBoundingClientRect();
  const k = _livre.itens?.find(i => i.id === card.dataset.card); if (!k) return;
  const ini = { x: e.clientX, y: e.clientY, left: r0.left - p0.left, top: r0.top - p0.top, w: r0.width, h: r0.height };
  let moveu = false, ghost = null, novo = {};
  const mover = ev => {
    const dx = ev.clientX - ini.x, dy = ev.clientY - ini.y;
    if (!moveu && Math.hypot(dx, dy) < 6) return;
    if (!moveu) {
      moveu = true; info.drag = card; card.classList.add('pcard-ing'); document.body.classList.add('pcard-sel-off');
      ghost = document.createElement('div'); ghost.className = 'pcard-ghost'; _livre.el.appendChild(ghost);
    }
    if (redim) {
      const wCols = Math.max(2, Math.min(COLS - k.c, Math.round((ini.w + dx + GAP) / passo)));
      const alt = Math.max(ALT_MIN, Math.round((ini.h + dy) / SNAP) * SNAP);
      novo = { w: wCols, h: alt };
      card.style.width = wCols * colW + (wCols - 1) * GAP + 'px';
      card.style.height = alt + 'px'; card.classList.add('pcard-fixa');
      ghost.style.cssText = `left:${k.c * passo}px;top:${k.y}px;width:${wCols * colW + (wCols - 1) * GAP}px;height:${alt}px`;
    } else {
      card.style.left = ini.left + dx + 'px'; card.style.top = Math.max(0, ini.top + dy) + 'px';
      const c = Math.max(0, Math.min(COLS - k.w, Math.round((ini.left + dx) / passo)));
      const y = Math.max(0, Math.round((ini.top + dy) / SNAP) * SNAP);
      novo = { c, y };
      ghost.style.cssText = `left:${c * passo}px;top:${y}px;width:${card.offsetWidth}px;height:${card.offsetHeight}px`;
    }
  };
  const fim = () => {
    document.removeEventListener('pointermove', mover); document.removeEventListener('pointerup', fim); document.removeEventListener('pointercancel', fim);
    if (!moveu) return;
    ghost?.remove(); card.classList.remove('pcard-ing'); document.body.classList.remove('pcard-sel-off');
    const clique = ev => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', clique, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', clique, true), 0);
    const cfg = _livre.cfg; cfg.layout = cfg.layout || {};
    (_livre.itens || []).forEach(i => { cfg.layout[i.id] = { c: i.c, w: i.w, y: i.y, r: _livre.el.clientWidth, ...(i.hFixa ? { h: i.hFixa } : {}) }; }); // fixa as posições atuais de todos
    Object.assign(cfg.layout[card.dataset.card], novo);
    info.drag = null;
    aplicarLayoutLivre(card.dataset.card);
    guardarLayoutLivre();
  };
  document.addEventListener('pointermove', mover); document.addEventListener('pointerup', fim); document.addEventListener('pointercancel', fim);
}
