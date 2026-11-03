// ═══════════════════════════════════════════════════════════════════
//  GUIAS DE REMESSA (escritório) — as guias fotografadas pelos encarregados chegam aqui já em PDF
//  (pasta «Guias» da Dropbox). O portal sincroniza sozinho cada guia com a fatura do fornecedor (motor fn_sincronizar_guias,
//  na base de dados: referência da guia, obra, datas, materiais e quantidades/valor); só ficam pendentes as que não fazem sentido.
//  Uma fatura pode ter várias guias. Depois de sincronizadas, o portal compara as quantidades das guias com as da fatura
//  (soma de todas as guias da fatura) e assinala as divergências.
// ═══════════════════════════════════════════════════════════════════
import { S } from '../state.js';
import { sb } from '../supabase.js';
import { fmtPT } from '../utils/helpers.js';
import { dropboxDownload } from './dropbox.js';

// ── Comparação guia ↔ fatura ─────────────────────────────────────
const semAcentos = t => String(t == null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const normNumero = t => String(t == null ? '' : t).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
// Duas referências de guia são a mesma se forem iguais ou se uma terminar na outra («Guia de Remessa no. 40848» ≈ «40848»)
const mesmaGuia = (a, b) => { const x = normNumero(a), y = normNumero(b); if (!x || !y) return false; if (x === y) return true; const [c, l] = x.length < y.length ? [x, y] : [y, x]; return c.length >= 5 && l.endsWith(c); };
const normDesc = t => semAcentos(t).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const normRef = t => String(t == null ? '' : t).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const tokens = t => new Set(normDesc(t).split(' ').filter(w => w.length > 1));
function similar(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let i = 0; A.forEach(w => { if (B.has(w)) i++; });
  return i / (A.size + B.size - i);
}
// Junta linhas repetidas do mesmo material (mesma referência ou descrição) somando as quantidades
function agrupar(linhas) {
  const out = [];
  (linhas || []).forEach(l => {
    const qtd = Number(l.qtd);
    if (!isFinite(qtd)) return;
    const ref = normRef(l.ref_forn ?? l.ref_fornecedor), desc = l.desc ?? l.descricao ?? '';
    // mesma referência, ou mesma descrição quando uma das linhas vem sem referência (a leitura da guia nem sempre a apanha)
    const g = out.find(x => (ref && x.ref && x.ref === ref) || ((!ref || !x.ref) && normDesc(x.desc) === normDesc(desc)));
    const valor = Number(l.total) || 0;
    if (g) { g.qtd += qtd; g.valor += valor; if (!g.ref && ref) g.ref = ref; } else out.push({ ref, desc, qtd, un: l.un || '', valor });
  });
  return out;
}
// O que a fatura cobra vs o que as guias entregaram → lista de divergências
function compararLinhas(linhasFatura, linhasGuias) {
  const F = agrupar(linhasFatura), G = agrupar(linhasGuias), usadasG = new Set(), div = [];
  F.forEach(f => {
    let j = G.findIndex((g, k) => !usadasG.has(k) && f.ref && g.ref && f.ref === g.ref);
    if (j < 0) {
      let melhor = 0;
      G.forEach((g, k) => { if (usadasG.has(k)) return; const sc = similar(f.desc, g.desc); if (sc > melhor) { melhor = sc; j = k; } });
      if (melhor < 0.6) j = -1;
    }
    if (j < 0) { div.push({ tipo: 'so_fatura', desc: f.desc, fatura: f.qtd, un: f.un }); return; }
    usadasG.add(j);
    if (Math.abs(f.qtd - G[j].qtd) > Math.max(0.0009, TOLERANCIA * f.qtd)) div.push({ tipo: 'qtd', desc: f.desc, fatura: f.qtd, guia: G[j].qtd, un: f.un || G[j].un });
  });
  // O transporte vem nas guias mas não é um artigo da fatura (ou vem noutra fatura): não conta como diferença
  G.forEach((g, k) => { if (!usadasG.has(k) && !/^transp/.test(normDesc(g.desc))) div.push({ tipo: 'so_guia', desc: g.desc, guia: g.qtd, un: g.un }); });
  return div;
}
// Diferenças até 2% da quantidade faturada contam como certas
const TOLERANCIA = 0.02;
// Percentagem do valor da fatura já coberta pelas guias (cada linha conta o que foi recebido, até 100%, ponderada pelo valor)
function percentagem(linhasFatura, linhasGuias) {
  const F = agrupar(linhasFatura).filter(f => f.qtd > 0), G = agrupar(linhasGuias), usadas = new Set();
  if (!F.length) return null;
  const comValor = F.some(f => f.valor > 0);
  let soma = 0, peso = 0;
  F.forEach(f => {
    let j = G.findIndex((g, k) => !usadas.has(k) && f.ref && g.ref && f.ref === g.ref);
    if (j < 0) {
      let melhor = 0;
      G.forEach((g, k) => { if (usadas.has(k)) return; const sc = similar(f.desc, g.desc); if (sc > melhor) { melhor = sc; j = k; } });
      if (melhor < 0.6) j = -1;
    }
    let cob = 0;
    if (j >= 0) { usadas.add(j); cob = Math.min(G[j].qtd / f.qtd, 1); if (cob >= 1 - TOLERANCIA) cob = 1; }
    const w = comValor ? f.valor : 1;
    soma += w * cob; peso += w;
  });
  return peso ? Math.round(soma / peso * 100) : null;
}
// Para cada linha da fatura: quanto já chegou nas guias e a percentagem (linhas repetidas do mesmo material partilham o total)
function coberturaPorArtigo(linhasFatura, linhasGuias) {
  const G = agrupar(linhasGuias), usadas = new Set(), grupos = [];
  (linhasFatura || []).forEach((l, i) => {
    const ref = normRef(l.ref_forn ?? l.ref_fornecedor), desc = l.desc ?? l.descricao ?? '';
    const g = grupos.find(x => (ref && x.ref && x.ref === ref) || (!ref && !x.ref && normDesc(x.desc) === normDesc(desc)));
    const qtd = Number(l.qtd) || 0;
    if (g) { g.qtd += qtd; g.idx.push(i); } else grupos.push({ ref, desc, qtd, idx: [i] });
  });
  const out = new Array((linhasFatura || []).length).fill(null);
  grupos.forEach(f => {
    let j = G.findIndex((g, k) => !usadas.has(k) && f.ref && g.ref && f.ref === g.ref);
    if (j < 0) {
      let melhor = 0;
      G.forEach((g, k) => { if (usadas.has(k)) return; const sc = similar(f.desc, g.desc); if (sc > melhor) { melhor = sc; j = k; } });
      if (melhor < 0.6) j = -1;
    }
    let rec = 0;
    if (j >= 0) { usadas.add(j); rec = G[j].qtd; }
    let pct = f.qtd > 0 ? Math.min(rec / f.qtd, 1) : (rec > 0 ? 1 : 0);
    if (pct >= 1 - TOLERANCIA) pct = 1;
    f.idx.forEach(i => { out[i] = { rec, pct: Math.round(pct * 100), un: j >= 0 ? G[j].un : '', excesso: f.qtd > 0 && rec > f.qtd * (1 + TOLERANCIA) }; });
  });
  return out;
}
const fmtQtd = n => Number(n).toLocaleString('pt-PT', { maximumFractionDigits: 3 });

// Verificação de uma fatura com todas as guias que lhe estão associadas
function verificar(f, guias = _rows.filter(g => g.fatura_id === f?.id)) {
  if (!f) return { estado: 'sem_dados' };
  const refs = (f.guias_ref || []).filter(Boolean);
  const faltam = refs.filter(r => !guias.some(g => mesmaGuia(g.numero, r)));
  if (!(f.linhas || []).length) return { estado: 'sem_artigos', guias, refs, faltam, pct: null };
  const lidas = guias.filter(g => (g.linhas || []).length);
  const pct = percentagem(f.linhas, lidas.flatMap(g => g.linhas));
  if (!guias.length) return { estado: 'sem_guias', guias, refs, faltam, pct: 0 };
  if (guias.some(g => !(g.linhas || []).length)) return { estado: 'sem_leitura', guias, refs, faltam, pct };
  const div = compararLinhas(f.linhas, guias.flatMap(g => g.linhas || []));
  if (faltam.length) return { estado: 'faltam', guias, refs, faltam, div, pct };
  return { estado: div.length ? 'divergente' : 'ok', guias, refs, div, faltam, pct };
}
const VERIF_PILL = {
  ok: ['Bate certo ✓', 'ok'], divergente: ['Divergente', 'bad'], faltam: ['Faltam guias', 'warn'],
  sem_artigos: ['Fatura sem artigos', 'mute'], sem_guias: ['Sem guias', 'mute'], sem_leitura: ['Guia por ler', 'mute'], sem_dados: ['—', 'mute'],
};

// Tabelas em uso: as do portal por omissão; a página de teste (guias-teste.html) aponta para as suas (gt_*)
const T = { guias: 'guias_remessa', faturas: 'faturas', rpc: 'fn_sincronizar_guias' };
export function configurarGuias(cfg) { Object.assign(T, cfg); }

let _rows = [];            // guias
let _fat = new Map();      // id → fatura (só as já casadas)
let _tab = 'faturas';      // faturas | soltas
let _fest = 'por_tratar';   // filtro da lista de faturas: por_tratar | div | ok | sem_ref | todas
let _q = '';
let _ligado = false;
let _todas = [];          // todas as faturas do portal (separador «Faturas»)
let _faturas = null;       // lista de faturas para escolher (carregada ao abrir o seletor)

const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = v => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const nomeDe = k => S.USERS?.[k]?.nome || k || '';
const toast = m => (window.showToast ? window.showToast(m) : alert(m));
const dataHora = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }); };
const casada = g => !!g.fatura_id;

async function carregar() {
  const { data, error } = await sb.from(T.guias)
    .select('id,numero,data,nif,fornecedor,obra_nome,linhas,paginas,pdf_path,fotos,foto_path,criado_por,criado_em,fatura_id,casada_em,sync_auto,sync_score,sync_motivo,sync_nota,sync_bloqueada')
    .order('criado_em', { ascending: false }).limit(1000);
  if (error) throw error;
  _rows = data || [];
  const ids = [...new Set(_rows.map(g => g.fatura_id).filter(Boolean))];
  _fat = new Map();
  const cols = 'id,numero,fornecedor,nif,total,data,status,guias_ref,linhas';
  // faturas com guias casadas + faturas que referem guias (mesmo que ainda não haja nenhuma casada)
  const [a, b] = await Promise.all([
    ids.length ? sb.from(T.faturas).select(cols).in('id', ids) : { data: [] },
    sb.from(T.faturas).select(cols).not('guias_ref', 'is', null).order('data', { ascending: false, nullsFirst: false }).limit(1500),
  ]);
  (a.data || []).forEach(f => _fat.set(f.id, f));
  const t = await sb.from(T.faturas).select('id,numero,fornecedor,nif,total,data,status,guias_ref,linhas,centro_custo,teste').order('data', { ascending: false, nullsFirst: false }).limit(3000);
  _todas = t.data || [];
  (b.data || []).filter(f => Array.isArray(f.guias_ref) && f.guias_ref.length).forEach(f => _fat.set(f.id, f));
}

function filtrar() {
  const q = _q.trim().toLowerCase();
  return _rows.filter(g => {
    if (_tab === 'por_casar' && casada(g)) return false;
    if (_tab === 'casadas' && !casada(g)) return false;
    if (q) {
      const f = _fat.get(g.fatura_id);
      const txt = `${g.fornecedor || ''} ${g.numero || ''} ${g.data ? fmtPT(g.data) : ''} ${g.obra_nome || ''} ${f?.numero || ''} ${f?.fornecedor || ''}`.toLowerCase();
      if (!txt.includes(q)) return false;
    }
    return true;
  });
}

const corPct = v => v.estado === 'divergente' ? '#b3261e' : v.estado === 'ok' ? '#1f8a4c' : v.pct ? '#c77700' : '#9aa3b5';
function barraPct(p, cor) {
  return `<span style="display:inline-flex;align-items:center;gap:8px;min-width:150px"><span style="flex:1;height:8px;border-radius:99px;background:#e6eaf1;overflow:hidden;min-width:90px"><span style="display:block;height:100%;width:${p}%;background:${cor || '#173f9f'};border-radius:99px"></span></span><b style="font-size:13px;min-width:38px;text-align:right">${p}%</b></span>`;
}

// ── Ecrã centrado na fatura ──────────────────────────────────────
// Separador «Faturas»: cada fatura com o que falta fazer; ao abrir vê-se tudo (guias, artigos, quantidades) numa só janela.
// Separador «Guias sem fatura»: as guias ainda soltas, com a fatura certa já sugerida quando é 100% certa.
const estadoFat = st => st === 'aprovada' || st === 'paga' ? 'ok' : st === 'rejeitada' ? 'bad' : 'mute';
const rotuloEstado = st => st ? String(st).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : '—';
const soltas = () => _rows.filter(g => !casada(g));
// A fatura refere esta guia (mesmo nº) e o fornecedor não é contrariado pelo NIF
const refere = (f, g) => !!normNumero(g.numero) && (f.guias_ref || []).some(r => mesmaGuia(r, g.numero)) && (!g.nif || !f.nif || g.nif === f.nif);
// guia solta → fatura, só quando uma única fatura a refere (certeza total)
function sugestoes() {
  const m = new Map();
  soltas().forEach(g => { const c = _todas.filter(f => refere(f, g)); if (c.length === 1) m.set(g.id, c[0]); });
  return m;
}
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
const POR_TRATAR = ['div', 'casar', 'ler', 'espera'];
// Situação de uma fatura e o próximo passo
function situacao(f, sug) {
  const v = verificar(f), refs = v.refs.length;
  const prontas = [...sug.values()].filter(x => x.id === f.id).length;
  let k, passo;
  if (!refs && !v.guias.length) { k = 'sem_ref'; passo = 'Não refere guias'; }
  else if (v.estado === 'ok') { k = 'ok'; passo = 'Nada a fazer'; }
  else if (v.estado === 'sem_artigos' && v.guias.length) { k = 'ok'; passo = 'Sincronizada por valor'; }
  else if (v.estado === 'divergente') { k = 'div'; passo = 'Rever ' + plural(v.div.length, 'diferença', 'diferenças'); }
  else if (prontas) { k = 'casar'; passo = 'Sincronizar ' + plural(prontas, 'guia', 'guias'); }
  else if (v.estado === 'sem_leitura') { k = 'ler'; passo = 'Ler os artigos de uma guia'; }
  else { k = 'espera'; passo = v.faltam?.length ? 'Faltam ' + plural(v.faltam.length, 'guia', 'guias') : 'À espera das guias'; }
  return { v, k, passo, prontas };
}
const SIT_PILL = { ok: ['Bate certo ✓', 'ok'], div: ['Divergente', 'bad'], casar: ['Por sincronizar', 'info'], ler: ['Guia por ler', 'warn'], espera: ['À espera de guias', 'warn'], sem_ref: ['Sem guias a conferir', 'mute'] };
const SIT_ORDEM = { div: 0, casar: 1, ler: 2, espera: 3, ok: 4, sem_ref: 5 };
const corSit = k => k === 'div' ? '#b3261e' : k === 'ok' ? '#1f8a4c' : '#c77700';

function desenharListaFaturas(box, sug) {
  const q = _q.trim().toLowerCase();
  const todas = _todas.map(f => ({ f, s: situacao(f, sug) }));
  const noFiltro = k => _fest === 'todas' || (_fest === 'por_tratar' ? POR_TRATAR.includes(k) : _fest === k);
  const cnt = k => todas.filter(x => k === 'todas' || (k === 'por_tratar' ? POR_TRATAR.includes(x.s.k) : x.s.k === k)).length;
  const sub = [['por_tratar', 'Por tratar'], ['div', 'Divergentes'], ['ok', 'Completas'], ['sem_ref', 'Sem guias a conferir'], ['todas', 'Todas']]
    .map(([k, l]) => `<button type="button" class="d-chip-f${_fest === k ? ' on' : ''}" data-gre-fest="${k}">${l}<b>${cnt(k)}</b></button>`).join('');
  const lista = todas.filter(({ f, s }) => noFiltro(s.k) && (!q || `${f.fornecedor || ''} ${f.numero || ''} ${(f.guias_ref || []).join(' ')}`.toLowerCase().includes(q)))
    .sort((a, b) => SIT_ORDEM[a.s.k] - SIT_ORDEM[b.s.k] || String(b.f.data || '').localeCompare(String(a.f.data || '')));
  const corpo = lista.length ? `<div class="tbl-wrap"><table class="cmp-t">
    <thead><tr><th>Data</th><th>Fatura</th><th class="r">Valor</th><th>Guias</th><th>Conferência</th><th>Estado</th><th>Próximo passo</th></tr></thead>
    <tbody>${lista.map(({ f, s }) => {
      const nr = s.v.refs.length, tem = nr - (s.v.faltam || []).length;
      const [t, c] = SIT_PILL[s.k];
      return `<tr data-gre-fat="${f.id}" style="cursor:pointer" title="Clique para abrir a fatura">
        <td>${f.data ? esc(fmtPT(f.data)) : '<span class="mut">—</span>'}</td>
        <td><b>${esc(f.numero || '—')}</b>${f.teste ? ' <span class="dd-pill mute" title="Fatura carregada só para este teste; não aparece nas outras páginas">Teste</span>' : ''}<br><small class="mut">${esc(f.centro_custo || '')}</small></td>
        <td class="r">${eur(Number(f.total))}</td>
        <td>${nr ? `${tem}/${nr}` : s.v.guias.length ? String(s.v.guias.length) : '<span class="mut">—</span>'}</td>
        <td>${s.v.pct != null && (nr || s.v.guias.length) ? barraPct(s.v.pct, corSit(s.k)) : s.v.guias.length ? '<span class="mut" title="A fatura não tem artigos lidos: as guias foram sincronizadas pelo valor">Por valor</span>' : '<span class="mut">—</span>'}</td>
        <td><span class="dd-pill ${c}">${t}</span></td>
        <td>${s.k === 'ok' || s.k === 'sem_ref' ? `<span class="mut">${esc(s.passo)}</span>` : `<b>${esc(s.passo)}</b>`}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="d-empty" style="border:0">Sem faturas para mostrar.</div>';
  box.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;padding:14px 16px 0">${sub}</div>
    <div class="mut" style="font-size:12.5px;padding:10px 16px">Cada fatura mostra o que falta para a conferência ficar completa. A percentagem é o valor já coberto pelas quantidades das guias sincronizadas (tolerância de 2%).</div>${corpo}`;
}

function desenharSoltas(box, sug) {
  const q = _q.trim().toLowerCase();
  const lista = soltas().filter(g => !q || `${g.fornecedor || ''} ${g.numero || ''} ${g.obra_nome || ''}`.toLowerCase().includes(q))
    .sort((a, b) => (sug.has(b.id) - sug.has(a.id)) || String(b.criado_em || '').localeCompare(String(a.criado_em || '')));
  if (!lista.length) { box.innerHTML = '<div class="d-empty" style="border:0">Todas as guias estão sincronizadas com uma fatura.</div>'; return; }
  box.innerHTML = `<div class="mut" style="font-size:12.5px;padding:14px 16px 10px">A sincronização é automática. Estas são as guias que o portal não conseguiu ligar a uma fatura com segurança; a coluna «Porque está pendente» explica o motivo.</div>
    <div class="tbl-wrap"><table class="cmp-t">
    <thead><tr><th>Data da guia</th><th>Fornecedor</th><th>Obra</th><th>Nº da guia</th><th>Porque está pendente</th><th></th></tr></thead>
    <tbody>${lista.map(g => {
      const f = sug.get(g.id);
      const pdf = g.pdf_path ? `<button type="button" class="btn btn-secondary btn-sm" data-gre-pdf="${g.id}">Abrir PDF</button>` : `<button type="button" class="btn btn-secondary btn-sm" data-gre-gerar="${g.id}" title="O PDF ainda não foi gerado">Gerar PDF</button>`;
      return `<tr data-gre-ver="${g.id}" style="cursor:pointer" title="Clique para ver os artigos e a fotografia">
        <td>${g.data ? esc(fmtPT(g.data)) : '<span class="mut">Sem data</span>'}</td>
        <td>${g.fornecedor ? '<b>' + esc(g.fornecedor) + '</b>' : '<span class="mut">—</span>'}</td>
        <td>${g.obra_nome ? esc(g.obra_nome) : '<span class="mut">—</span>'}</td>
        <td>${g.numero ? '<b>' + esc(g.numero) + '</b>' : '<span class="mut">—</span>'}</td>
        <td>${f ? `<span class="dd-pill info">${esc(f.numero || '—')}</span> <small class="mut">refere esta guia</small> ` : ''}${g.sync_bloqueada ? '<small class="mut">Sincronização removida à mão. </small>' : ''}<small class="mut">${esc(g.sync_nota || 'A aguardar a próxima sincronização.')}</small></td>
        <td style="white-space:nowrap;display:flex;gap:6px;justify-content:flex-end">${pdf}${f ? `<button type="button" class="btn btn-sm" data-gre-cf="${g.id}:${f.id}">Sincronizar</button>` : `<button type="button" class="btn btn-secondary btn-sm" data-gre-casar="${g.id}">Escolher fatura</button>`}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

// Janela única da fatura: guias, artigos e conferência
function abrirFatura(id) {
  const f = _todas.find(x => x.id === id); if (!f) return;
  const sug = sugestoes(), s = situacao(f, sug), v = s.v;
  const linhas = f.linhas || [], refs = (Array.isArray(f.guias_ref) ? f.guias_ref : []).filter(Boolean);
  const casadasG = _rows.filter(g => g.fatura_id === f.id), lidas = casadasG.filter(g => (g.linhas || []).length);
  const cob = lidas.length ? coberturaPorArtigo(linhas, lidas.flatMap(g => g.linhas)) : null;
  const solta = r => soltas().find(g => mesmaGuia(g.numero, r) && (!g.nif || !f.nif || g.nif === f.nif));
  const btn = (a, t, cls = 'btn-secondary') => `<button type="button" class="btn ${cls} btn-sm" ${a}>${t}</button>`;
  const lin = (num, pill, acoes, nota) => `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid #eef1f6"><b style="min-width:150px">${esc(num || '—')}</b>${pill}<span class="mut" style="flex:1;font-size:12.5px">${nota || ''}</span><span style="display:flex;gap:6px">${acoes}</span></div>`;
  const linhaCasada = g => lin(g.numero, `<span class="dd-pill ok">Sincronizada ✓</span>${g.sync_auto ? `<span class="dd-pill info" title="Sincronizada automaticamente pelo portal">Automática${g.sync_score ? ' · ' + g.sync_score + '%' : ''}</span>` : '<span class="dd-pill mute">Manual</span>'}`, btn(`data-gre-ver="${g.id}"`, 'Ver') + (g.pdf_path ? btn(`data-gre-pdf="${g.id}"`, 'PDF') : '') + btn(`data-gre-df="${g.id}"`, 'Remover'), esc(g.sync_motivo || '') + ((g.linhas || []).length ? '' : ' · artigos por ler'));
  const usadas = new Set();
  const guiaRows = refs.map(r => {
    const c = casadasG.find(g => mesmaGuia(g.numero, r));
    if (c) { usadas.add(c.id); return linhaCasada(c); }
    const sl = solta(r);
    if (sl) return lin(r, '<span class="dd-pill info">Recebida, por sincronizar</span>', btn(`data-gre-ver="${sl.id}"`, 'Ver') + btn(`data-gre-cf="${sl.id}:${f.id}"`, 'Sincronizar', 'btn-primary'), sl.sync_nota ? esc(sl.sync_nota) : (sug.get(sl.id)?.id === f.id ? 'só esta fatura a refere' : 'outra fatura também a refere'));
    return lin(r, '<span class="dd-pill mute">Ainda não chegou</span>', '', 'a fatura refere esta guia, mas ainda não foi carregada');
  });
  casadasG.filter(g => !usadas.has(g.id)).forEach(g => guiaRows.push(linhaCasada(g)));
  const outras = soltas().filter(g => !refs.some(r => mesmaGuia(g.numero, r)) && ((g.nif && f.nif && g.nif === f.nif) || (g.fornecedor && f.fornecedor && similar(g.fornecedor, f.fornecedor) >= 0.6)));
  const outrasHtml = outras.length ? `<details style="margin-top:8px"><summary style="cursor:pointer;font-size:13px;color:#173f9f;font-weight:600">Outras guias pendentes deste fornecedor (${outras.length}) — a fatura não as refere</summary><div style="border:1px solid #dde2ea;border-radius:14px;margin-top:8px;overflow:hidden">${outras.map(g => lin(g.numero, '<span class="dd-pill mute">Pendente</span>', btn(`data-gre-ver="${g.id}"`, 'Ver') + btn(`data-gre-cf="${g.id}:${f.id}"`, 'Sincronizar mesmo assim'), g.data ? esc(fmtPT(g.data)) : '')).join('')}</div></details>` : '';
  const divTxt = d => d.tipo === 'so_fatura' ? `${esc(d.desc)}: faturado ${fmtQtd(d.fatura)} ${esc(d.un || '')} e não vem nas guias` : d.tipo === 'so_guia' ? `${esc(d.desc)}: vem nas guias (${fmtQtd(d.guia)} ${esc(d.un || '')}) e não está na fatura` : `${esc(d.desc)}: fatura ${fmtQtd(d.fatura)} ${esc(d.un || '')} · guias ${fmtQtd(d.guia)} ${esc(d.un || '')}`;
  const estilo = { ok: ['#dff5e7', '#166534'], div: ['#fde4e1', '#b3261e'], casar: ['#e4ecfb', '#173f9f'], ler: ['#fff0d9', '#a35a08'], espera: ['#fff0d9', '#a35a08'], sem_ref: ['#eef1f6', '#5d6678'] }[s.k];
  const msg = {
    ok: v.estado === 'sem_artigos' ? 'As guias estão sincronizadas pelo valor da fatura. Como a fatura não tem artigos lidos, não há quantidades para conferir.' : 'Tudo certo: as quantidades das guias coincidem com a fatura.',
    div: `Há ${plural(v.div?.length || 0, 'diferença', 'diferenças')} entre a fatura e as guias:<ul style="margin:6px 0 0 18px;padding:0;font-weight:500">${(v.div || []).map(d => `<li>${divTxt(d)}</li>`).join('')}</ul>`,
    casar: `Há ${plural(s.prontas, 'guia que refere', 'guias que referem')} esta fatura mas o portal não a sincronizou sozinho. Confirme abaixo.`,
    ler: 'Há guias sincronizadas sem os artigos lidos. Abra a guia («Ver») para a ler.',
    espera: v.faltam?.length ? `Ainda faltam as guias: <b>${esc(v.faltam.join(', '))}</b>. A comparação final faz-se quando chegarem todas.` : 'Ainda não há guias sincronizadas com esta fatura.',
    sem_ref: 'Esta fatura não refere guias (por exemplo, custos de transporte), por isso não há nada a conferir.',
  }[s.k];
  const tabela = linhas.length ? `<div style="max-height:34vh;overflow:auto;border:1px solid #dde2ea;border-radius:14px"><table class="cmp-t">
    <thead><tr><th>Ref.</th><th>Artigo</th><th class="r">Qtd. faturada</th><th>Un.</th><th class="r">Total</th><th>Recebido nas guias</th></tr></thead>
    <tbody>${linhas.map((l, i) => {
      const c = cob?.[i];
      const rec = !c ? '<span class="mut">—</span>' : `<div style="display:flex;align-items:center;gap:8px;white-space:nowrap">${barraPct(c.pct, c.pct >= 100 ? '#1f8a4c' : c.pct > 0 ? '#c77700' : '#b3261e')}<span class="mut" style="font-size:12.5px">${fmtQtd(c.rec)} ${esc(l.un || c.un || '')}${c.excesso ? ' <b style="color:#b3261e">a mais</b>' : ''}</span></div>`;
      return `<tr><td>${esc(l.ref_forn || '—')}</td><td><b>${esc(l.desc || '—')}</b></td><td class="r">${l.qtd != null ? fmtQtd(l.qtd) : '—'}</td><td>${esc(l.un || '—')}</td><td class="r">${eur(l.total)}</td><td>${rec}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<div style="padding:12px 14px;border-radius:14px;background:#eef1f6;color:#5d6678">Esta fatura não tem artigos lidos.</div>';
  const tit = t => `<div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#5d6678;margin:18px 0 8px">${t}</div>`;
  document.getElementById('modal-gre-verif')?.remove();
  const el = document.createElement('div');
  el.className = 'modal-bg open'; el.id = 'modal-gre-verif'; el.dataset.fatura = f.id;
  el.innerHTML = `<div class="modal" style="width:min(940px,96vw);max-height:92vh;overflow-y:auto">
    <div class="modal-title">Fatura ${esc(f.numero || '—')}</div>
    <div class="modal-sub">${esc(f.fornecedor || '')}${f.data ? ' · ' + esc(fmtPT(f.data)) : ''} · ${eur(Number(f.total))}${f.centro_custo ? ' · ' + esc(f.centro_custo) : ''}</div>
    <div style="margin-top:14px;padding:14px 16px;border-radius:16px;background:${estilo[0]};color:${estilo[1]};font-weight:600;line-height:1.45">${msg}${v.pct != null && (refs.length || casadasG.length) ? `<div style="margin-top:10px;color:#1b2130">${barraPct(v.pct, corSit(s.k))}</div>` : ''}</div>
    ${refs.length || casadasG.length ? tit('1 · Guias desta fatura') + `<div style="border:1px solid #dde2ea;border-radius:14px;overflow:hidden">${guiaRows.join('')}</div>` + outrasHtml : (outrasHtml ? tit('Guias') + outrasHtml : '')}
    ${tit((refs.length || casadasG.length ? '2 · ' : '') + 'Artigos e quantidades')}${tabela}
    <div class="modal-footer">${s.prontas ? `<button class="btn btn-primary" data-gre-cf-all="${f.id}">Sincronizar ${plural(s.prontas, 'guia', 'guias')}</button>` : ''}<button class="btn btn-secondary" data-gre-fechar-verif>Fechar</button></div>
  </div>`;
  document.body.appendChild(el);
}

function desenhar() {
  const sug = sugestoes();
  const emFalta = _rows.filter(g => !g.fornecedor && !g.numero && !g.data);
  const hdr = document.getElementById('gre-hdr-act');
  const pend = soltas().filter(g => !g.sync_bloqueada).length;
  if (hdr) hdr.innerHTML = `<button type="button" class="btn btn-sm" data-gre-auto title="O portal sincroniza sozinho; isto força uma nova passagem agora">Sincronizar${pend ? ' (' + pend + ' pendentes)' : ''}</button>` + (emFalta.length ? `<button type="button" class="btn btn-secondary btn-sm" data-gre-ler-todas title="Lê o fornecedor, o nº e a data nas guias que estão em branco">Ler dados em falta (${emFalta.length})</button>` : '');
  const chips = document.getElementById('gre-chips');
  if (chips) chips.innerHTML = [['faturas', 'Faturas', _todas.filter(f => POR_TRATAR.includes(situacao(f, sug).k))], ['soltas', 'Guias pendentes', soltas()]]
    .map(([k, l, a]) => `<button type="button" class="d-chip-f${_tab === k ? ' on' : ''}" data-gre-tab="${k}">${l}<b>${a.length}</b></button>`).join('');
  const box = document.getElementById('gre-mapa'); if (!box) return;
  if (_tab === 'soltas') desenharSoltas(box, sug); else desenharListaFaturas(box, sug);
  const m = document.getElementById('modal-gre-verif');
  if (m?.dataset.fatura) abrirFatura(Number(m.dataset.fatura));
}

// ── Fotografias ──────────────────────────────────────────────────
async function guardarDados(id) {
  const m = document.getElementById('modal-gre-fotos'); if (!m) return;
  const upd = { data: m.querySelector('#gre-data').value || null, numero: m.querySelector('#gre-numf').value.trim() || null, fornecedor: m.querySelector('#gre-forn').value.trim() || null };
  const { error } = await sb.from(T.guias).update(upd).eq('id', id);
  if (error) { toast('Não foi possível guardar: ' + (error.message || error)); return; }
  Object.assign(_rows.find(x => x.id === id) || {}, upd);
  desenhar();
  toast('Dados da guia guardados ✓');
}

// Artigos, quantidades e unidades lidos na guia
function artigosGuia(g) {
  const linhas = g.linhas || [];
  const f = casada(g) ? _fat.get(g.fatura_id) : null;
  const info = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
    <span class="dd-pill ${f ? 'ok' : 'mute'}">${f ? 'Fatura ' + esc(f.numero || '—') : 'Pendente'}</span>
    ${g.paginas ? `<span class="dd-pill mute">${g.paginas} pág.</span>` : ''}
    ${g.nif ? `<span class="dd-pill mute">NIF ${esc(g.nif)}</span>` : ''}
    <span class="dd-pill mute">${linhas.length} artigo${linhas.length === 1 ? '' : 's'}</span></div>`;
  if (!linhas.length) return info + '<div style="margin-top:10px;padding:12px 14px;border-radius:14px;background:#eef1f6;color:#5d6678">Os artigos desta guia ainda não foram lidos. Use «Gerar PDF» ou «Ler dados em falta» para os ler.</div>';
  return info + `<div style="margin-top:10px;max-height:48vh;overflow:auto;border:1px solid #dde2ea;border-radius:14px"><table class="cmp-t">
    <thead><tr><th>Ref.</th><th>Artigo</th><th class="r">Qtd.</th><th>Un.</th></tr></thead>
    <tbody>${linhas.map(l => `<tr><td>${esc(l.ref_forn || '—')}</td><td><b>${esc(l.desc || '—')}</b></td><td class="r">${fmtQtd(l.qtd)}</td><td>${esc(l.un || '—')}</td></tr>`).join('')}</tbody></table></div>`;
}

// Abre uma página nova só com a(s) imagem(ns) da guia
async function abrirFoto(id) {
  const g = _rows.find(x => x.id === id); if (!g) return;
  const caminhos = (Array.isArray(g.fotos) && g.fotos.length ? g.fotos : [g.foto_path]).filter(Boolean);
  const w = window.open('', '_blank');   // abre já, para o bloqueador de popups não impedir
  try {
    const { data, error } = await sb.storage.from('guias-remessa').createSignedUrls(caminhos, 3600);
    if (error) throw error;
    const urls = (data || []).filter(d => d.signedUrl).map(d => d.signedUrl);
    if (!urls.length) throw new Error('sem fotografias');
    if (!w) { window.open(urls[0], '_blank'); return; }
    w.document.write('<!doctype html><meta charset="utf-8"><title>Guia ' + esc(g.numero || '') + '</title><body style="margin:0;background:#1b2130;display:flex;flex-direction:column;align-items:center;gap:12px;padding:12px">' + urls.map((u, k) => '<img src="' + u + '" alt="Página ' + (k + 1) + '" style="max-width:100%;height:auto;display:block">').join('') + '</body>');
    w.document.close();
  } catch (e) {
    w?.close();
    console.warn('Guias (fotos):', e);
    toast('Não foi possível abrir a fotografia.');
  }
}

async function verFotos(id) {
  const g = _rows.find(x => x.id === id); if (!g) return;
  const caminhos = (Array.isArray(g.fotos) && g.fotos.length ? g.fotos : [g.foto_path]).filter(Boolean);
  document.getElementById('modal-gre-fotos')?.remove();
  const el = document.createElement('div');
  el.className = 'modal-bg open'; el.id = 'modal-gre-fotos'; el.dataset.guia = id;
  el.innerHTML = `<div class="modal" style="width:min(760px,96vw);max-height:94vh;display:flex;flex-direction:column">
    <div class="modal-title">Guia${g.numero ? ' ' + esc(g.numero) : ''}</div>
    <div class="modal-sub">Enviada por ${esc(nomeDe(g.criado_por))} em ${esc(dataHora(g.criado_em))}${g.obra_nome ? ' · ' + esc(g.obra_nome) : ''}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;align-items:flex-end">
      <label style="flex:2 1 100%;font-size:12px;font-weight:700;text-transform:uppercase;color:#5d6678">Fornecedor<input id="gre-forn" value="${esc(g.fornecedor || '')}" placeholder="Nome do fornecedor" style="display:block;width:100%;height:46px;margin-top:6px;border:1.5px solid #b9c1ce;border-radius:14px;padding:0 14px;font-size:15px;font-family:inherit;box-sizing:border-box"></label>
      <label style="flex:1;min-width:170px;font-size:12px;font-weight:700;text-transform:uppercase;color:#5d6678">Data da guia (receção do material)<input id="gre-data" type="date" value="${esc(g.data || '')}" style="display:block;width:100%;height:46px;margin-top:6px;border:1.5px solid #b9c1ce;border-radius:14px;padding:0 14px;font-size:15px;font-family:inherit;box-sizing:border-box"></label>
      <label style="flex:1;min-width:170px;font-size:12px;font-weight:700;text-transform:uppercase;color:#5d6678">Nº da guia<input id="gre-numf" value="${esc(g.numero || '')}" placeholder="Ex.: GR 2026/1234" style="display:block;width:100%;height:46px;margin-top:6px;border:1.5px solid #b9c1ce;border-radius:14px;padding:0 14px;font-size:15px;font-family:inherit;box-sizing:border-box"></label>
      <button class="btn btn-primary" data-gre-guardar="${g.id}" style="height:46px">Guardar</button>
    </div>
    ${artigosGuia(g)}
    <div class="modal-footer"><button class="btn btn-secondary" data-gre-foto="${g.id}">Ver fotografia${caminhos.length === 1 ? '' : 's'}</button>${g.pdf_path ? '<button class="btn btn-secondary" data-gre-pdf="' + g.id + '">Abrir PDF</button>' : ''}<button class="btn btn-secondary" data-gre-fechar-fotos>Fechar</button></div>
  </div>`;
  document.body.appendChild(el);
}

// ── PDF ──────────────────────────────────────────────────────────
async function abrirPdf(id) {
  const g = _rows.find(x => x.id === id); if (!g?.pdf_path) return;
  const w = window.open('', '_blank');   // abre já, para o bloqueador de popups não impedir
  try {
    const blob = await dropboxDownload(g.pdf_path);
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    if (w) w.location.href = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    w?.close();
    console.warn('Guias (abrir PDF):', e);
    toast('Não foi possível abrir o PDF: ' + String(e.message || e).slice(0, 200));
  }
}

// Lê (com o Claude, no servidor) fornecedor, nº e data das guias ainda em branco
async function lerEmFalta(btn) {
  const lista = _rows.filter(g => !g.fornecedor && !g.numero && !g.data);
  if (!lista.length) return;
  btn.disabled = true;
  let ok = 0;
  for (let i = 0; i < lista.length; i++) {
    btn.textContent = `A ler… ${i + 1}/${lista.length}`;
    try {
      const r = await sb.functions.invoke('guias-pdf', { body: { guia_id: lista[i].id, so_ler: true, tabela: T.guias } });
      if (!r.error && r.data?.ok && r.data.lido) ok++;
    } catch (e) { console.warn('Guias (ler):', e); }
  }
  toast(`${ok} de ${lista.length} guias lidas`);
  await carregar(); desenhar();
}

async function gerarPdf(id) {
  toast('A gerar o PDF…');
  try {
    const r = await sb.functions.invoke('guias-pdf', { body: { guia_id: id, tabela: T.guias } });
    if (r.error || !r.data?.ok) throw new Error(r.data?.error || r.error?.message || 'sem resposta');
    toast('PDF gerado ✓');
    await carregar(); desenhar();
  } catch (e) { toast('Não foi possível gerar o PDF: ' + String(e.message || e).slice(0, 200)); }
}

// ── Sincronização manual (para o que o motor deixou pendente) ─────────────────────────────────────────────
async function carregarFaturas() {
  if (_faturas) return _faturas;
  const { data, error } = await sb.from(T.faturas)
    .select('id,numero,fornecedor,nif,data,total,status,guias_ref')
    
    .order('data', { ascending: false, nullsFirst: false }).limit(1500);
  if (error) throw error;
  _faturas = data || [];
  return _faturas;
}

// Relevância de uma fatura para uma guia: 3 = refere o nº desta guia; 2 = mesmo fornecedor
function relevancia(g, f) {
  const n = normNumero(g.numero);
  if (n && (f.guias_ref || []).some(r => mesmaGuia(r, g.numero))) return 3;
  if ((g.nif && f.nif && g.nif === f.nif) || (g.fornecedor && f.fornecedor && similar(g.fornecedor, f.fornecedor) >= 0.6)) return 2;
  return 0;
}

function desenharFaturas(modal, guiaId) {
  const g = _rows.find(x => x.id === guiaId) || {};
  const q = modal.querySelector('#gre-fq').value.trim().toLowerCase();
  const l = (_faturas || []).filter(f => !q || `${f.fornecedor || ''} ${f.numero || ''}`.toLowerCase().includes(q))
    .map(f => ({ f, r: relevancia(g, f) })).sort((a, b) => b.r - a.r).slice(0, 60).map(x => ({ ...x.f, _r: x.r }));
  modal.querySelector('#gre-flista').innerHTML = l.length
    ? l.map(f => `<button type="button" class="gre-f" data-gre-esc="${f.id}" style="display:flex;justify-content:space-between;gap:12px;width:100%;padding:10px 12px;border:0;border-bottom:1px solid #eef1f6;background:#fff;font-family:inherit;text-align:left;cursor:pointer">
        <span><b style="font-size:13px">${esc(f.fornecedor || 'Sem fornecedor')}</b><br><small style="color:#6a7284">${esc(f.numero || '—')} · ${f.data ? esc(fmtPT(f.data)) : 'sem data'}</small>${f._r === 3 ? ' <span class="dd-pill ok" style="height:20px;font-size:11px">Refere esta guia</span>' : f._r === 2 ? ' <span class="dd-pill info" style="height:20px;font-size:11px">Mesmo fornecedor</span>' : ''}</span>
        <span style="font-weight:700;font-size:13px;white-space:nowrap">${eur(f.total)}</span></button>`).join('')
    : '<div style="padding:14px;color:#6a7284">Nenhuma fatura encontrada</div>';
}

async function abrirSeletor(id) {
  document.getElementById('modal-gre')?.remove();
  const g = _rows.find(x => x.id === id); if (!g) return;
  const el = document.createElement('div');
  el.className = 'modal-bg open'; el.id = 'modal-gre'; el.dataset.guia = id;
  el.innerHTML = `<div class="modal" style="width:560px">
    <div class="modal-title">Sincronizar guia com fatura</div>
    <div class="modal-sub">Guia enviada por ${esc(nomeDe(g.criado_por))} em ${esc(dataHora(g.criado_em))}${g.obra_nome ? ' · ' + esc(g.obra_nome) : ''}</div>
    <label style="display:block;font-size:12px;font-weight:700;text-transform:uppercase;color:#5d6678;margin:12px 0 6px">Nº da guia (opcional)</label>
    <input id="gre-num" value="${esc(g.numero || '')}" placeholder="Ex.: GR 2026/1234" style="width:100%;height:46px;border:1.5px solid #b9c1ce;border-radius:14px;padding:0 14px;font-size:15px;font-family:inherit;box-sizing:border-box">
    <label style="display:block;font-size:12px;font-weight:700;text-transform:uppercase;color:#5d6678;margin:14px 0 6px">Data da guia (receção do material)</label>
    <input id="gre-dt" type="date" value="${esc(g.data || '')}" style="width:100%;height:46px;border:1.5px solid #b9c1ce;border-radius:14px;padding:0 14px;font-size:15px;font-family:inherit;box-sizing:border-box">
    <label style="display:block;font-size:12px;font-weight:700;text-transform:uppercase;color:#5d6678;margin:14px 0 6px">Fatura</label>
    <input id="gre-fq" placeholder="Pesquisar fornecedor ou nº da fatura…" style="width:100%;height:46px;border:1.5px solid #b9c1ce;border-radius:14px;padding:0 14px;font-size:15px;font-family:inherit;box-sizing:border-box">
    <div id="gre-flista" style="margin-top:10px;max-height:300px;overflow-y:auto;border:1px solid #dde2ea;border-radius:14px"><div style="padding:14px;color:#6a7284">A carregar…</div></div>
    <div class="modal-footer"><button class="btn btn-secondary" data-gre-fechar>Cancelar</button></div>
  </div>`;
  document.body.appendChild(el);
  try { await carregarFaturas(); desenharFaturas(el, id); }
  catch (e) { el.querySelector('#gre-flista').innerHTML = '<div style="padding:14px;color:#b3261e">Não foi possível carregar as faturas.</div>'; }
}

async function casar(guiaId, faturaId) {
  const modal = document.getElementById('modal-gre');
  const numero = modal?.querySelector('#gre-num')?.value.trim() || null;
  const upd = { fatura_id: faturaId, estado: 'casada', casada_em: new Date().toISOString(), sync_auto: false, sync_score: null, sync_motivo: 'Sincronizada manualmente', sync_nota: null, sync_bloqueada: false };
  if (numero) upd.numero = numero;
  const g0 = _rows.find(x => x.id === guiaId), fat0 = (_faturas || []).find(x => x.id === faturaId);
  if (!g0?.fornecedor && fat0?.fornecedor) upd.fornecedor = fat0.fornecedor;
  const dt = modal?.querySelector('#gre-dt')?.value;
  if (dt) upd.data = dt;
  const { error } = await sb.from(T.guias).update(upd).eq('id', guiaId);
  if (error) { toast('Não foi possível sincronizar: ' + (error.message || error)); return; }
  modal?.remove();
  toast('Guia sincronizada com a fatura ✓');
  await carregar(); desenhar();
}

// Força uma passagem do motor de sincronização (corre sozinho na base de dados sempre que chega uma guia ou uma fatura)
async function sincronizar(btn) {
  if (btn) btn.disabled = true;
  try {
    const { data, error } = await sb.rpc(T.rpc);
    if (error) throw error;
    const n = (data?.por_referencia || 0) + (data?.por_conjunto || 0);
    toast(n ? `${plural(n, 'guia sincronizada', 'guias sincronizadas')} automaticamente ✓${data?.pendentes ? ` · ${data.pendentes} pendentes` : ''}` : data?.pendentes ? `Nada de novo: ${data.pendentes} guias continuam pendentes` : 'Tudo sincronizado ✓');
    await carregar(); desenhar();
  } catch (e) { toast('Não foi possível sincronizar: ' + String(e.message || e).slice(0, 200)); }
  if (btn) btn.disabled = false;
}

async function desfazer(id) {
  if (!confirm('Remover a sincronização desta guia com a fatura? O portal não a volta a sincronizar sozinho.')) return;
  const { error } = await sb.from(T.guias).update({ fatura_id: null, estado: 'por_casar', casada_em: null, sync_auto: false, sync_score: null, sync_motivo: null, sync_nota: null, sync_bloqueada: true }).eq('id', id);
  if (error) { toast('Não foi possível remover: ' + (error.message || error)); return; }
  await carregar(); desenhar();
}

// Casa uma guia com uma fatura (a janela da fatura, se estiver aberta, atualiza-se sozinha)
async function casarUma(guiaId, faturaId) {
  const g = _rows.find(x => x.id === guiaId), f = _todas.find(x => x.id === faturaId);
  const upd = { fatura_id: faturaId, estado: 'casada', casada_em: new Date().toISOString(), sync_auto: false, sync_score: null, sync_motivo: 'Sincronizada manualmente', sync_nota: null, sync_bloqueada: false };
  if (!g?.fornecedor && f?.fornecedor) upd.fornecedor = f.fornecedor;
  const { error } = await sb.from(T.guias).update(upd).eq('id', guiaId);
  if (error) { toast('Não foi possível sincronizar: ' + (error.message || error)); return; }
  toast('Guia sincronizada com a fatura ✓');
  await carregar(); desenhar();
}
// Casa de uma vez as guias que só esta fatura refere
async function casarProntas(faturaId) {
  const ids = [...sugestoes()].filter(([, f]) => f.id === faturaId).map(([id]) => id);
  if (!ids.length) return;
  const { error } = await sb.from(T.guias).update({ fatura_id: faturaId, estado: 'casada', casada_em: new Date().toISOString(), sync_auto: false, sync_score: null, sync_motivo: 'Sincronizada manualmente', sync_nota: null, sync_bloqueada: false }).in('id', ids);
  if (error) { toast('Não foi possível sincronizar: ' + (error.message || error)); return; }
  toast(`${plural(ids.length, 'guia sincronizada', 'guias sincronizadas')} ✓`);
  await carregar(); desenhar();
}

function ligar() {
  if (_ligado) return;
  const sec = document.getElementById('sec-guias');
  if (!sec) return;
  _ligado = true;
  sec.addEventListener('click', e => {
    const t = e.target.closest('[data-gre-auto],[data-gre-fat],[data-gre-cf],[data-gre-ler-todas],[data-gre-tab],[data-gre-fest],[data-gre-pdf],[data-gre-gerar],[data-gre-casar],[data-gre-desf],[data-gre-ver]');
    if (!t) return;
    if (t.dataset.greAuto !== undefined) sincronizar(t);
    else if (t.dataset.greFat) abrirFatura(Number(t.dataset.greFat));
    else if (t.dataset.greCf) { const [g, f] = t.dataset.greCf.split(':').map(Number); casarUma(g, f); }
    else if (t.dataset.greLerTodas !== undefined) lerEmFalta(t);
    else if (t.dataset.greFest) { _fest = t.dataset.greFest; desenhar(); }
    else if (t.dataset.greTab) { _tab = t.dataset.greTab; desenhar(); }
    else if (t.dataset.grePdf) abrirPdf(Number(t.dataset.grePdf));
    else if (t.dataset.greGerar) gerarPdf(Number(t.dataset.greGerar));
    else if (t.dataset.greCasar) abrirSeletor(Number(t.dataset.greCasar));
    else if (t.dataset.greDesf) desfazer(Number(t.dataset.greDesf));
    else if (t.dataset.greVer) verFotos(Number(t.dataset.greVer));
  });
  document.getElementById('gre-q')?.addEventListener('input', e => { _q = e.target.value; desenhar(); });
}

// seletor de fatura (janela criada dinamicamente)
document.addEventListener('click', e => {
  const vm = document.getElementById('modal-gre-verif');
  if (vm && (e.target.closest('[data-gre-fechar-verif]') || e.target === vm)) { vm.remove(); return; }
  if (vm) {
    const cf = e.target.closest('[data-gre-cf]'), ca = e.target.closest('[data-gre-cf-all]'), df = e.target.closest('[data-gre-df]'), vr = e.target.closest('[data-gre-ver]'), pf = e.target.closest('[data-gre-pdf]');
    if (cf) { const [g, f] = cf.dataset.greCf.split(':').map(Number); casarUma(g, f); return; }
    if (ca) { casarProntas(Number(ca.dataset.greCfAll)); return; }
    if (df) { desfazer(Number(df.dataset.greDf)); return; }
    if (vr) { verFotos(Number(vr.dataset.greVer)); return; }
    if (pf) { abrirPdf(Number(pf.dataset.grePdf)); return; }
  }
  const fm = document.getElementById('modal-gre-fotos');
  const gd = fm && e.target.closest('[data-gre-guardar]');
  if (gd) { guardarDados(Number(gd.dataset.greGuardar)); return; }
  if (fm && (e.target.closest('[data-gre-fechar-fotos]') || e.target === fm)) { fm.remove(); return; }
  if (fm && e.target.closest('[data-gre-foto]')) { abrirFoto(Number(e.target.closest('[data-gre-foto]').dataset.greFoto)); return; }
  if (fm && e.target.closest('[data-gre-pdf]')) { abrirPdf(Number(e.target.closest('[data-gre-pdf]').dataset.grePdf)); return; }
  const m = document.getElementById('modal-gre'); if (!m) return;
  if (e.target.closest('[data-gre-fechar]') || e.target === m) { m.remove(); return; }
  const f = e.target.closest('[data-gre-esc]');
  if (f) casar(Number(m.dataset.guia), Number(f.dataset.greEsc));
});
document.addEventListener('input', e => {
  if (e.target.id !== 'gre-fq') return;
  const m = document.getElementById('modal-gre'); if (m) desenharFaturas(m, Number(m.dataset.guia));
});

// Conferência de UMA fatura (para o ecrã de aprovação do diretor): lê as guias sincronizadas com ela e compara
export async function conferenciaFatura(dbId, linhas, guiasRef) {
  if (!dbId) return null;
  const { data, error } = await sb.from(T.guias).select('id,numero,linhas,fatura_id').eq('fatura_id', dbId);
  if (error) throw error;
  const v = verificar({ id: dbId, linhas: linhas || [], guias_ref: guiasRef || [] }, data || []);
  const resumo = { faltam: `faltam guias: ${(v.faltam || []).join(', ')}`, divergente: `${(v.div || []).length} divergência(s) nas quantidades`, sem_guias: 'ainda não há guias associadas', sem_leitura: 'há guias por ler' }[v.estado] || '';
  return { estado: v.estado, pct: v.pct, guias: v.guias.length, refs: (v.refs || []).length, faltam: v.faltam || [], div: v.div || [], resumo };
}

// Conferência (% e estado) das faturas que referem guias ou já têm guias associadas — usada na Tesouraria
export async function conferenciasFaturas() {
  await carregar();
  const m = new Map();
  _fat.forEach(f => { const v = verificar(f); m.set(f.id, { pct: v.pct, estado: v.estado, guias: v.guias.length, refs: (v.refs || []).length }); });
  return m;
}

export async function renderGuiasEscritorio() {
  const box = document.getElementById('gre-mapa');
  if (!box) return;
  ligar();
  _faturas = null;   // volta a ler as faturas na próxima escolha
  if (!_rows.length) box.innerHTML = '<div class="d-empty" style="border:0">A carregar…</div>';
  try { try { await sb.rpc(T.rpc); } catch (e) { console.warn('Sincronizar:', e); } await carregar(); } catch (e) {
    console.warn('Guias:', e);
    box.innerHTML = '<div class="d-empty" style="border:0">Não foi possível carregar: ' + esc(e.message || e) + '</div>';
    return;
  }
  desenhar();
}
