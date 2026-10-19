// ═══════════════════════════════════════════════════════════════════
//  FATURAS LANÇADAS — valor por artigo, por obra, das faturas lidas e já aprovadas pelo diretor de obra.
//  Só entram aqui as faturas aprovadas (aprovada / validada / paga). As linhas que o portal não
//  conseguiu associar ao catálogo ficam em "Por associar" e resolvem-se aqui (diálogo de artigos).
// ═══════════════════════════════════════════════════════════════════
import { sb } from '../supabase.js';
import { fmtPT } from '../utils/helpers.js';
import { associarAuto, perguntarArtigos } from './faturas-artigos.js';

const APROVADAS = ['aprovada', 'validada', 'paga'];
let _rows = [];
let _obra = '';
let _q = '';
let _tab = 'artigos';        // artigos | pendentes
const _abertos = new Set();  // chaves de artigos expandidos
let _ligado = false;

const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const eur = v => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const qtdF = v => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString('pt-PT', { maximumFractionDigits: 3 });
const valorLinha = l => l.total != null ? Number(l.total) : (l.qtd != null && l.pu != null ? Number(l.qtd) * Number(l.pu) : 0);
const toast = m => (window.showToast ? window.showToast(m) : alert(m));

async function carregar() {
  const { data, error } = await sb.from('faturas')
    .select('id,fornecedor,nif,numero,data,centro_custo,status,linhas')
    .in('status', APROVADAS)
    .order('data', { ascending: false, nullsFirst: false })
    .limit(2000);
  if (error) throw error;
  _rows = (data || []).map(r => ({ ...r, linhas: Array.isArray(r.linhas) ? r.linhas : [] })).filter(r => r.linhas.length);
}

// Todas as linhas (com a fatura de origem), já filtradas por obra/pesquisa
function linhasFiltradas() {
  const q = _q.trim().toLowerCase();
  const out = [];
  for (const f of _rows) {
    if (_obra && (f.centro_custo || '') !== (_obra === '__sem__' ? '' : _obra)) continue;
    f.linhas.forEach((l, idx) => {
      if (q && !`${l.desc} ${l.art_nome} ${l.art_ref} ${f.fornecedor} ${f.numero}`.toLowerCase().includes(q)) return;
      out.push({ f, l, idx });
    });
  }
  return out;
}

function desenhar() {
  const box = document.getElementById('flan-mapa');
  if (!box) return;

  // filtro de obras (mantém a seleção)
  const sel = document.getElementById('flan-obra');
  if (sel) {
    const ccs = [...new Set(_rows.map(r => r.centro_custo || ''))].sort((a, b) => a.localeCompare(b, 'pt'));
    sel.innerHTML = '<option value="">Todas as obras</option>' + ccs.map(c => c === '' ? '<option value="__sem__">Sem centro de custo</option>' : `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.value = [...sel.options].some(o => o.value === _obra) ? _obra : '';
    _obra = sel.value;
  }

  const todas = linhasFiltradas();
  const pend = todas.filter(x => x.l.estado === 'pendente');
  const ign = todas.filter(x => x.l.estado === 'ignorado').length;
  const ok = todas.filter(x => x.l.estado === 'auto' || x.l.estado === 'manual');

  const chips = document.getElementById('flan-chips');
  if (chips) chips.innerHTML = [['artigos', 'Valor por artigo', ok.length], ['pendentes', 'Por associar', pend.length]]
    .map(([k, l, n]) => `<button type="button" class="d-chip-f${_tab === k ? ' on' : ''}${k === 'pendentes' && n ? ' warn' : ''}" data-flan-tab="${k}">${l}<b>${n}</b></button>`).join('');

  if (!todas.length) { box.innerHTML = '<div class="d-empty" style="border:0">Ainda não há faturas aprovadas com artigos lidos.</div>'; return; }
  box.innerHTML = _tab === 'pendentes' ? htmlPendentes(pend) : htmlArtigos(ok, pend.length, ign);
}

function htmlArtigos(ok, nPend, nIgn) {
  if (!ok.length) return `<div class="d-empty" style="border:0">Sem artigos associados${nPend ? ` — ${nPend} linha${nPend === 1 ? '' : 's'} por associar` : ''}.</div>`;
  // obra → artigo → linhas
  const obras = new Map();
  for (const x of ok) {
    const o = x.f.centro_custo || '';
    if (!obras.has(o)) obras.set(o, new Map());
    const k = `${x.l.art_ref}|${x.l.art_nome}`;
    const m = obras.get(o);
    if (!m.has(k)) m.set(k, { k, nome: x.l.art_nome, ref: x.l.art_ref, xs: [] });
    m.get(k).xs.push(x);
  }
  let totalGeral = 0;
  const corpo = [...obras.keys()].sort((a, b) => a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'pt')).map(o => {
    const arts = [...obras.get(o).values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    let subObra = 0;
    const linhasArt = arts.map(a => {
      const val = a.xs.reduce((s, x) => s + valorLinha(x.l), 0);
      const qtd = a.xs.reduce((s, x) => s + (Number(x.l.qtd) || 0), 0);
      const un = [...new Set(a.xs.map(x => x.l.un).filter(Boolean))];
      subObra += val;
      const chave = `${o}|${a.k}`;
      const aberto = _abertos.has(chave);
      const det = aberto ? a.xs.sort((p, q) => (q.f.data || '').localeCompare(p.f.data || '')).map(x => `<tr class="flan-det">
          <td colspan="2" style="padding-left:34px"><span class="mut">${esc(x.l.desc)}</span></td>
          <td>${esc(x.f.fornecedor || '')} · <b>${esc(x.f.numero || '')}</b>${x.f.data ? ' · ' + esc(fmtPT(x.f.data)) : ''}</td>
          <td class="r">${qtdF(x.l.qtd)} ${esc(x.l.un || '')}</td><td class="r">${eur(x.l.pu)}</td><td class="r">${eur(valorLinha(x.l))}</td></tr>`).join('') : '';
      return `<tr class="flan-art" data-flan-art="${esc(chave)}" style="cursor:pointer" title="Ver as linhas das faturas">
          <td colspan="2">${aberto ? '▾' : '▸'} ${esc(a.nome)}${a.ref ? ` <span class="mut">${esc(a.ref)}</span>` : ''}</td>
          <td><span class="mut">${a.xs.length} linha${a.xs.length === 1 ? '' : 's'}</span></td>
          <td class="r">${qtdF(qtd)} ${esc(un.join('/'))}</td><td class="r">${qtd ? eur(val / qtd) : '—'}</td><td class="r"><b>${eur(val)}</b></td></tr>${det}`;
    }).join('');
    totalGeral += subObra;
    return `<tbody class="tes-grp"><tr class="tes-gh"><td colspan="5">${o ? esc(o) : 'Sem centro de custo'} <small>${arts.length} artigo${arts.length === 1 ? '' : 's'}</small></td><td class="r"><b>${eur(subObra)}</b></td></tr>${linhasArt}</tbody>`;
  }).join('');
  return `${nPend ? `<div class="flan-aviso" style="padding:10px 14px;background:#fffbeb;border-bottom:1px solid #fcd34d;font-size:13px">⚠ ${nPend} linha${nPend === 1 ? '' : 's'} por associar a um artigo (não contam nos valores abaixo). <button type="button" class="btn btn-secondary btn-sm" data-flan-tab="pendentes">Associar agora</button></div>` : ''}
    <div class="tbl-wrap"><table class="cmp-t tes-t">
    <thead><tr><th colspan="2">Artigo</th><th>Origem</th><th class="r">Quantidade</th><th class="r">Preço médio (s/ IVA)</th><th class="r">Valor (s/ IVA)</th></tr></thead>
    ${corpo}
    <tfoot><tr><td colspan="5"><b>Total</b>${nIgn ? ` <span class="mut">· ${nIgn} linha${nIgn === 1 ? '' : 's'} ignorada${nIgn === 1 ? '' : 's'}</span>` : ''}</td><td class="r"><b>${eur(totalGeral)}</b></td></tr></tfoot></table></div>`;
}

function htmlPendentes(pend) {
  if (!pend.length) return '<div class="d-empty" style="border:0">Tudo associado. 👌</div>';
  const porFatura = new Map();
  pend.forEach(x => { if (!porFatura.has(x.f.id)) porFatura.set(x.f.id, { f: x.f, ls: [] }); porFatura.get(x.f.id).ls.push(x.l); });
  const corpo = [...porFatura.values()].map(({ f, ls }) => `<tbody class="tes-grp"><tr class="tes-gh"><td colspan="3">${esc(f.fornecedor || '')} · <b>${esc(f.numero || '')}</b> <small>${esc(f.centro_custo || 'Sem centro de custo')}</small></td><td class="r"><button type="button" class="btn btn-primary btn-sm" data-flan-assoc="${f.id}">Associar ${ls.length} linha${ls.length === 1 ? '' : 's'}</button></td></tr>
    ${ls.map(l => `<tr><td>${esc(l.desc)}${l.ref_forn ? ` <span class="mut">${esc(l.ref_forn)}</span>` : ''}</td><td class="r">${qtdF(l.qtd)} ${esc(l.un || '')}</td><td class="r">${eur(l.pu)}</td><td class="r"><b>${eur(valorLinha(l))}</b></td></tr>`).join('')}</tbody>`).join('');
  return `<div class="tbl-wrap"><table class="cmp-t tes-t"><thead><tr><th>Descrição na fatura</th><th class="r">Quantidade</th><th class="r">Preço un.</th><th class="r">Valor (s/ IVA)</th></tr></thead>${corpo}</table></div>`;
}

async function associar(id) {
  const f = _rows.find(r => r.id === id); if (!f) return;
  const obj = { _dbId: f.id, fornecedor: f.fornecedor, numero: f.numero, nif: f.nif, linhas: f.linhas.map(l => ({ ...l })) };
  await associarAuto(obj);
  await perguntarArtigos(obj, {
    onSave: async x => {
      const lin = x.linhas.map(({ _cands, _via, ...l }) => l);   // sem dados temporários de sugestão
      const { error } = await sb.from('faturas').update({ linhas: lin }).eq('id', f.id);
      if (error) { toast('Não foi possível guardar: ' + (error.message || error)); throw error; }
      f.linhas = lin;
    },
  });
  desenhar();
}

function exportar() {
  const X = window.XLSX;
  if (!X) { toast('Biblioteca de Excel indisponível'); return; }
  const ok = linhasFiltradas().filter(x => x.l.estado === 'auto' || x.l.estado === 'manual');
  if (!ok.length) { toast('Sem linhas para exportar'); return; }
  const rows = ok.map(({ f, l }) => ({
    Obra: f.centro_custo || '', 'Ref. artigo': l.art_ref || '', Artigo: l.art_nome, 'Descrição na fatura': l.desc,
    Fornecedor: f.fornecedor || '', Fatura: f.numero || '', Data: f.data || '', Quantidade: l.qtd, Un: l.un || '',
    'Preço un. (s/ IVA)': l.pu, 'Valor (s/ IVA)': Math.round(valorLinha(l) * 100) / 100,
  }));
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows), 'Faturas lançadas');
  X.writeFile(wb, `faturas_lancadas_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function ligar() {
  if (_ligado) return;
  const sec = document.getElementById('sec-faturas-lancadas');
  if (!sec) return;
  _ligado = true;
  sec.addEventListener('click', e => {
    const t = e.target.closest('[data-flan-tab],[data-flan-art],[data-flan-assoc],[data-flan-exp]');
    if (!t) return;
    if (t.dataset.flanTab) { _tab = t.dataset.flanTab; desenhar(); }
    else if (t.dataset.flanArt) { const k = t.dataset.flanArt; _abertos.has(k) ? _abertos.delete(k) : _abertos.add(k); desenhar(); }
    else if (t.dataset.flanAssoc) associar(Number(t.dataset.flanAssoc));
    else if (t.dataset.flanExp !== undefined) exportar();
  });
  document.getElementById('flan-obra')?.addEventListener('change', e => { _obra = e.target.value; desenhar(); });
  document.getElementById('flan-q')?.addEventListener('input', e => { _q = e.target.value; desenhar(); });
}

export async function renderFaturasLancadas() {
  const box = document.getElementById('flan-mapa');
  if (!box) return;
  ligar();
  if (!_rows.length) box.innerHTML = '<div class="d-empty" style="border:0">A carregar…</div>';
  try { await carregar(); } catch (e) {
    console.warn('Faturas lançadas:', e);
    box.innerHTML = '<div class="d-empty" style="border:0">Não foi possível carregar: ' + esc(e.message || e) + '</div>';
    return;
  }
  desenhar();
}
