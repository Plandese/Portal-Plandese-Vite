// ═══════════════════════════════════════════════════════════════════
//  GUIAS DE REMESSA (escritório) — as guias fotografadas pelos encarregados chegam aqui já em PDF
//  (pasta «Guias» da Dropbox). Quem trata das faturas abre o PDF e casa cada guia com a fatura do fornecedor.
//  Uma fatura pode ter várias guias. Depois de casadas, o portal compara as quantidades das guias com as da fatura
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
    const g = out.find(x => (ref && x.ref && x.ref === ref) || (!ref && !x.ref && normDesc(x.desc) === normDesc(desc)));
    const valor = Number(l.total) || 0;
    if (g) { g.qtd += qtd; g.valor += valor; } else out.push({ ref, desc, qtd, un: l.un || '', valor });
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
  G.forEach((g, k) => { if (!usadasG.has(k)) div.push({ tipo: 'so_guia', desc: g.desc, guia: g.qtd, un: g.un }); });
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

let _rows = [];            // guias_remessa
let _fat = new Map();      // id → fatura (só as já casadas)
let _tab = 'por_casar';    // por_casar | casadas | todas | porfatura
let _fest = 'todas';       // filtro do separador «Por fatura»: todas | incompletas | divergentes | completas
let _q = '';
let _ligado = false;
let _faturas = null;       // lista de faturas para escolher (carregada ao abrir o seletor)

const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = v => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const nomeDe = k => S.USERS?.[k]?.nome || k || '';
const toast = m => (window.showToast ? window.showToast(m) : alert(m));
const dataHora = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }); };
const casada = g => !!g.fatura_id;

async function carregar() {
  const { data, error } = await sb.from('guias_remessa')
    .select('id,numero,data,nif,fornecedor,obra_nome,linhas,paginas,pdf_path,fotos,foto_path,criado_por,criado_em,fatura_id,casada_em')
    .order('criado_em', { ascending: false }).limit(1000);
  if (error) throw error;
  _rows = data || [];
  const ids = [...new Set(_rows.map(g => g.fatura_id).filter(Boolean))];
  _fat = new Map();
  const cols = 'id,numero,fornecedor,nif,total,data,status,guias_ref,linhas';
  // faturas com guias casadas + faturas que referem guias (mesmo que ainda não haja nenhuma casada)
  const [a, b] = await Promise.all([
    ids.length ? sb.from('faturas').select(cols).in('id', ids) : { data: [] },
    sb.from('faturas').select(cols).not('guias_ref', 'is', null).order('data', { ascending: false, nullsFirst: false }).limit(1500),
  ]);
  (a.data || []).forEach(f => _fat.set(f.id, f));
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

// Separador «Por fatura»: como está a conferência das guias de cada fatura
function linhasPorFatura() {
  const q = _q.trim().toLowerCase();
  return [..._fat.values()].map(f => ({ f, v: verificar(f) }))
    .filter(({ f, v }) => {
      if (q && !`${f.fornecedor || ''} ${f.numero || ''}`.toLowerCase().includes(q)) return false;
      if (_fest === 'completas') return v.estado === 'ok';
      if (_fest === 'divergentes') return v.estado === 'divergente';
      if (_fest === 'incompletas') return v.estado !== 'ok' && v.estado !== 'divergente';
      return true;
    })
    // primeiro o que mais urgência tem: aprovadas pelo diretor mas ainda por conferir
    .sort((a, b) => (b.f.status === 'aprovada' && b.v.estado !== 'ok') - (a.f.status === 'aprovada' && a.v.estado !== 'ok') || (a.v.pct ?? -1) - (b.v.pct ?? -1));
}
function desenharPorFatura(box) {
  const todas = [..._fat.values()].map(f => verificar(f).estado);
  const cnt = k => k === 'todas' ? todas.length : todas.filter(e => k === 'completas' ? e === 'ok' : k === 'divergentes' ? e === 'divergente' : (e !== 'ok' && e !== 'divergente')).length;
  const sub = [['todas', 'Todas'], ['incompletas', 'Incompletas'], ['divergentes', 'Divergentes'], ['completas', 'Completas']]
    .map(([k, l]) => `<button type="button" class="d-chip-f${_fest === k ? ' on' : ''}" data-gre-fest="${k}">${l}<b>${cnt(k)}</b></button>`).join('');
  const lista = linhasPorFatura();
  const corpo = lista.length ? `<div class="tbl-wrap"><table class="cmp-t">
    <thead><tr><th>Fatura</th><th>Fornecedor</th><th class="r">Valor</th><th>Aprovação</th><th>Conferência</th><th>Guias</th><th>Estado</th></tr></thead>
    <tbody>${lista.map(({ f, v }) => {
      const nr = (v.refs || []).length, tem = nr - (v.faltam || []).length;
      const guiasTxt = nr ? `${tem}/${nr}` : String(v.guias?.length || 0);
      const aprov = f.status === 'aprovada' ? '<span class="dd-pill ok">Aprovada</span>' : `<span class="dd-pill mute">${esc(f.status ? String(f.status).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : '—')}</span>`;
      return `<tr data-gre-verif="${f.id}" style="cursor:pointer" title="Clique para ver o detalhe">
        <td><b>${esc(f.numero || '—')}</b></td><td>${esc(f.fornecedor || '—')}</td><td class="r">${eur(Number(f.total))}</td><td>${aprov}</td>
        <td>${v.pct != null ? barraPct(v.pct, corPct(v)) : '<span class="mut">—</span>'}</td>
        <td>${guiasTxt}</td><td>${pillVerif(f)}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="d-empty" style="border:0">Sem faturas para mostrar.</div>';
  box.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${sub}</div>
    <div class="mut" style="font-size:12.5px;margin-bottom:10px">Faturas que referem guias ou já têm guias associadas. A percentagem é o valor da fatura já coberto pelas quantidades recebidas (tolerância de 2%).</div>${corpo}`;
}

function pillVerif(f) {
  const v = verificar(f), [t, c] = VERIF_PILL[v.estado] || VERIF_PILL.sem_dados;
  const n = v.estado === 'divergente' ? ` (${v.div.length})` : v.estado === 'faltam' ? ` (${v.faltam.length})` : '';
  return `<button type="button" class="dd-pill ${c}" data-gre-verif="${f?.id || ''}" style="border:0;cursor:pointer;font-family:inherit" title="Ver a comparação com a fatura">${t}${n}</button>`;
}

function verDetalhe(faturaId) {
  const f = _fat.get(faturaId); if (!f) return;
  const v = verificar(f);
  document.getElementById('modal-gre-verif')?.remove();
  const el = document.createElement('div');
  el.className = 'modal-bg open'; el.id = 'modal-gre-verif';
  const [t, c] = VERIF_PILL[v.estado] || VERIF_PILL.sem_dados;
  let corpo = '';
  if (v.estado === 'ok') corpo = '<div style="padding:14px;border-radius:14px;background:#dff5e7;color:#166534;font-weight:600">Os materiais e as quantidades das guias coincidem com a fatura.</div>';
  else if (v.estado === 'divergente') corpo = `<table class="cmp-t" style="margin-top:6px"><thead><tr><th>Material</th><th class="r">Fatura</th><th class="r">Guias</th></tr></thead><tbody>${v.div.map(d => `<tr>
      <td>${esc(d.desc)}${d.tipo === 'so_fatura' ? '<br><small style="color:#b3261e">Faturado mas não vem nas guias</small>' : d.tipo === 'so_guia' ? '<br><small style="color:#b3261e">Vem nas guias mas não está na fatura</small>' : ''}</td>
      <td class="r">${d.fatura != null ? fmtQtd(d.fatura) + ' ' + esc(d.un || '') : '—'}</td>
      <td class="r">${d.guia != null ? fmtQtd(d.guia) + ' ' + esc(d.un || '') : '—'}</td></tr>`).join('')}</tbody></table>`;
  else if (v.estado === 'faltam') corpo = `<div style="padding:14px;border-radius:14px;background:#fff0d9;color:#a35a08">A fatura refere ${v.faltam.length === 1 ? 'uma guia que ainda não foi associada' : v.faltam.length + ' guias que ainda não foram associadas'}: <b>${esc(v.faltam.join(', '))}</b>.<br>A comparação faz-se quando todas estiverem casadas.</div>`;
  else if (v.estado === 'sem_guias') corpo = `<div style="padding:14px;border-radius:14px;background:#eef1f6;color:#5d6678">Ainda não há guias associadas a esta fatura${v.refs?.length ? '. Refere: <b>' + esc(v.refs.join(', ')) + '</b>' : ''}.</div>`;
  else if (v.estado === 'sem_artigos') corpo = '<div style="padding:14px;border-radius:14px;background:#eef1f6;color:#5d6678">A fatura não tem artigos lidos, por isso não há o que comparar.</div>';
  else if (v.estado === 'sem_leitura') corpo = '<div style="padding:14px;border-radius:14px;background:#eef1f6;color:#5d6678">Alguma guia ainda não tem os materiais lidos. Use «Ler dados em falta» ou abra a guia.</div>';
  el.innerHTML = `<div class="modal" style="width:min(680px,96vw);max-height:92vh;overflow-y:auto">
    <div class="modal-title">Fatura ${esc(f.numero || '')}</div>
    <div class="modal-sub">${esc(f.fornecedor || '')} · ${v.guias?.length || 0} guia${(v.guias?.length || 0) === 1 ? '' : 's'} associada${(v.guias?.length || 0) === 1 ? '' : 's'}: ${esc((v.guias || []).map(g => g.numero || '—').join(', '))}</div>
    <div style="margin:12px 0;display:flex;align-items:center;gap:10px"><span class="dd-pill ${c}">${t}</span>${v.pct != null ? barraPct(v.pct) : ''}</div>
    ${corpo}
    <div class="modal-footer"><button class="btn btn-secondary" data-gre-fechar-verif>Fechar</button></div>
  </div>`;
  document.body.appendChild(el);
}

function desenhar() {
  const emFalta = _rows.filter(g => !g.fornecedor && !g.numero && !g.data);
  const hdr = document.getElementById('gre-hdr-act');
  const porCasarNum = _rows.filter(g => !casada(g) && g.numero).length;
  if (hdr) hdr.innerHTML = (porCasarNum ? '<button type="button" class="btn btn-secondary btn-sm" data-gre-auto title="Casa as guias com as faturas que referem o mesmo nº de guia">Casar automaticamente</button>' : '') + (emFalta.length ? `<button type="button" class="btn btn-secondary btn-sm" data-gre-ler-todas title="Lê o fornecedor, o nº e a data nas guias que estão em branco">Ler dados em falta (${emFalta.length})</button>` : '');
  const chips = document.getElementById('gre-chips');
  if (chips) {
    const por = _rows.filter(g => !casada(g)), cas = _rows.filter(casada);
    chips.innerHTML = [['por_casar', 'Por casar', por], ['casadas', 'Casadas', cas], ['todas', 'Todas', _rows], ['porfatura', 'Por fatura', [..._fat.values()]]]
      .map(([k, l, a]) => `<button type="button" class="d-chip-f${_tab === k ? ' on' : ''}" data-gre-tab="${k}">${l}<b>${a.length}</b></button>`).join('');
  }
  const box = document.getElementById('gre-mapa'); if (!box) return;
  if (_tab === 'porfatura') return desenharPorFatura(box);
  const lista = filtrar();
  if (!lista.length) { box.innerHTML = '<div class="d-empty" style="border:0">Sem guias para mostrar.</div>'; return; }
  box.innerHTML = `<div class="tbl-wrap"><table class="cmp-t">
    <thead><tr><th>Data da guia</th><th>Fornecedor</th><th>Obra</th><th>Nº da guia</th><th>Fatura</th><th>Verificação</th><th></th></tr></thead>
    <tbody>${lista.map(g => {
      const f = _fat.get(g.fatura_id);
      const pdf = g.pdf_path
        ? `<button type="button" class="btn btn-secondary btn-sm" data-gre-pdf="${g.id}">Abrir PDF</button>`
        : `<button type="button" class="btn btn-secondary btn-sm" data-gre-gerar="${g.id}" title="O PDF ainda não foi gerado">Gerar PDF</button>`;
      const fat = casada(g)
        ? `<span class="dd-pill ok" title="Casada em ${esc(dataHora(g.casada_em))}">${f ? esc(f.numero || '—') + ' · ' + esc(f.fornecedor || '') : 'Fatura ' + g.fatura_id}</span>`
        : '<span class="dd-pill mute">Por casar</span>';
      const acao = casada(g)
        ? `<button type="button" class="btn btn-secondary btn-sm" data-gre-desf="${g.id}">Desfazer</button>`
        : `<button type="button" class="btn btn-sm" data-gre-casar="${g.id}">Casar com fatura</button>`;
      return `<tr data-gre-ver="${g.id}" style="cursor:pointer" title="Clique para ver as fotografias">
        <td>${g.data ? esc(fmtPT(g.data)) : '<span class="mut" title="Clique na guia para indicar a data de receção">Sem data</span>'}</td>
        <td>${g.fornecedor ? '<b>' + esc(g.fornecedor) + '</b>' : '<span class="mut">—</span>'}</td>
        <td>${g.obra_nome ? esc(g.obra_nome) : '<span class="mut">—</span>'}</td>
        <td>${g.numero ? '<b>' + esc(g.numero) + '</b>' : '<span class="mut">—</span>'}</td>
        <td>${fat}</td>
        <td>${casada(g) ? pillVerif(f) : '<span class="mut">—</span>'}</td>
        <td style="white-space:nowrap;display:flex;gap:6px;justify-content:flex-end">${pdf}${acao}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

// ── Fotografias ──────────────────────────────────────────────────
async function guardarDados(id) {
  const m = document.getElementById('modal-gre-fotos'); if (!m) return;
  const upd = { data: m.querySelector('#gre-data').value || null, numero: m.querySelector('#gre-numf').value.trim() || null, fornecedor: m.querySelector('#gre-forn').value.trim() || null };
  const { error } = await sb.from('guias_remessa').update(upd).eq('id', id);
  if (error) { toast('Não foi possível guardar: ' + (error.message || error)); return; }
  Object.assign(_rows.find(x => x.id === id) || {}, upd);
  desenhar();
  toast('Dados da guia guardados ✓');
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
    <div id="gre-fotos" style="flex:1;min-height:0;overflow-y:auto;margin-top:10px;display:flex;flex-direction:column;gap:12px"><div style="padding:14px;color:#6a7284">A carregar…</div></div>
    <div class="modal-footer">${g.pdf_path ? '<button class="btn btn-secondary" data-gre-pdf="' + g.id + '">Abrir PDF</button>' : ''}<button class="btn btn-secondary" data-gre-fechar-fotos>Fechar</button></div>
  </div>`;
  document.body.appendChild(el);
  const box = el.querySelector('#gre-fotos');
  try {
    const { data, error } = await sb.storage.from('guias-remessa').createSignedUrls(caminhos, 3600);
    if (error) throw error;
    const urls = (data || []).filter(d => d.signedUrl);
    if (!urls.length) throw new Error('sem fotografias');
    box.innerHTML = urls.map((d, i) => `<a href="${d.signedUrl}" target="_blank" rel="noopener" title="Abrir em tamanho real"><img src="${d.signedUrl}" alt="Página ${i + 1}" style="width:100%;border:1px solid #dde2ea;border-radius:14px;display:block"></a>`).join('');
  } catch (e) {
    console.warn('Guias (fotos):', e);
    box.innerHTML = '<div style="padding:14px;color:#b3261e">Não foi possível carregar as fotografias.</div>';
  }
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
      const r = await sb.functions.invoke('guias-pdf', { body: { guia_id: lista[i].id, so_ler: true } });
      if (!r.error && r.data?.ok && r.data.lido) ok++;
    } catch (e) { console.warn('Guias (ler):', e); }
  }
  toast(`${ok} de ${lista.length} guias lidas`);
  await carregar(); desenhar();
}

async function gerarPdf(id) {
  toast('A gerar o PDF…');
  try {
    const r = await sb.functions.invoke('guias-pdf', { body: { guia_id: id } });
    if (r.error || !r.data?.ok) throw new Error(r.data?.error || r.error?.message || 'sem resposta');
    toast('PDF gerado ✓');
    await carregar(); desenhar();
  } catch (e) { toast('Não foi possível gerar o PDF: ' + String(e.message || e).slice(0, 200)); }
}

// ── Casar com fatura ─────────────────────────────────────────────
async function carregarFaturas() {
  if (_faturas) return _faturas;
  const { data, error } = await sb.from('faturas')
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
    <div class="modal-title">Casar guia com fatura</div>
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
  const upd = { fatura_id: faturaId, estado: 'casada', casada_em: new Date().toISOString() };
  if (numero) upd.numero = numero;
  const g0 = _rows.find(x => x.id === guiaId), fat0 = (_faturas || []).find(x => x.id === faturaId);
  if (!g0?.fornecedor && fat0?.fornecedor) upd.fornecedor = fat0.fornecedor;
  const dt = modal?.querySelector('#gre-dt')?.value;
  if (dt) upd.data = dt;
  const { error } = await sb.from('guias_remessa').update(upd).eq('id', guiaId);
  if (error) { toast('Não foi possível casar: ' + (error.message || error)); return; }
  modal?.remove();
  toast('Guia casada com a fatura ✓');
  await carregar(); desenhar();
}

// Casa as guias por casar com a fatura que refere o mesmo nº de guia (e o mesmo fornecedor, quando há NIF)
async function casarAutomatico(btn) {
  btn.disabled = true;
  try {
    await carregarFaturas();
    let n = 0, ambiguas = 0;
    for (const g of _rows.filter(x => !casada(x) && x.numero)) {
            const cands = _faturas.filter(f => (f.guias_ref || []).some(r => mesmaGuia(r, g.numero)) && (!g.nif || !f.nif || g.nif === f.nif));
      if (cands.length > 1) { ambiguas++; continue; }
      if (cands.length !== 1) continue;
      const upd = { fatura_id: cands[0].id, estado: 'casada', casada_em: new Date().toISOString() };
      if (!g.fornecedor && cands[0].fornecedor) upd.fornecedor = cands[0].fornecedor;
      const { error } = await sb.from('guias_remessa').update(upd).eq('id', g.id);
      if (!error) n++;
    }
    toast(n ? `${n} guia${n === 1 ? '' : 's'} casada${n === 1 ? '' : 's'} automaticamente ✓${ambiguas ? ` (${ambiguas} ambígua${ambiguas === 1 ? '' : 's'}, ficam para casar à mão)` : ''}` : 'Nenhuma guia encontrou fatura com o mesmo nº de guia');
    await carregar(); desenhar();
  } catch (e) { toast('Não foi possível casar automaticamente: ' + String(e.message || e).slice(0, 200)); }
  btn.disabled = false;
}

async function desfazer(id) {
  if (!confirm('Desfazer o casamento desta guia com a fatura?')) return;
  const { error } = await sb.from('guias_remessa').update({ fatura_id: null, estado: 'por_casar', casada_em: null }).eq('id', id);
  if (error) { toast('Não foi possível desfazer: ' + (error.message || error)); return; }
  await carregar(); desenhar();
}

function ligar() {
  if (_ligado) return;
  const sec = document.getElementById('sec-guias');
  if (!sec) return;
  _ligado = true;
  sec.addEventListener('click', e => {
    const t = e.target.closest('[data-gre-auto],[data-gre-verif],[data-gre-ler-todas],[data-gre-tab],[data-gre-fest],[data-gre-pdf],[data-gre-gerar],[data-gre-casar],[data-gre-desf],[data-gre-ver]');
    if (!t) return;
    if (t.dataset.greAuto !== undefined) casarAutomatico(t);
    else if (t.dataset.greVerif) verDetalhe(Number(t.dataset.greVerif));
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
  const fm = document.getElementById('modal-gre-fotos');
  const gd = fm && e.target.closest('[data-gre-guardar]');
  if (gd) { guardarDados(Number(gd.dataset.greGuardar)); return; }
  if (fm && (e.target.closest('[data-gre-fechar-fotos]') || e.target === fm)) { fm.remove(); return; }
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

// Conferência de UMA fatura (para o ecrã de aprovação do diretor): lê as guias casadas com ela e compara
export async function conferenciaFatura(dbId, linhas, guiasRef) {
  if (!dbId) return null;
  const { data, error } = await sb.from('guias_remessa').select('id,numero,linhas,fatura_id').eq('fatura_id', dbId);
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
  try { await carregar(); } catch (e) {
    console.warn('Guias:', e);
    box.innerHTML = '<div class="d-empty" style="border:0">Não foi possível carregar: ' + esc(e.message || e) + '</div>';
    return;
  }
  desenhar();
}
