// ═══════════════════════════════════════════════════════════════════
//  FATURAS POR APROVAR — faturas com o centro de custo já confirmado pelo financeiro,
//  organizadas por obra, a aguardar a aprovação (e carimbo) do diretor de obra.
//  Cada diretor vê as faturas das suas obras; o administrador e o financeiro vêem todas.
// ═══════════════════════════════════════════════════════════════════
import { S } from '../state.js';
import { sb } from '../supabase.js';
import { fmtPT } from '../utils/helpers.js';
import { abrirFaturaPorDbId, carregarPastasFaturas } from './faturas.js';

let _rows = [];
let _obra = null;   // centro de custo aberto (null = cartões das obras)

const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const eur = v => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

// Obras (nomes) em que o utilizador atual é diretor; null = vê todas
function obrasVisiveis() {
  const role = S.currentUser?.role, uKey = S.currentUser?.key;
  if (role === 'admin' || role === 'financeiro') return null;
  return new Set((S.OBRAS || [])
    .filter(o => o.diretor_id === uKey || (o.diretores_extra || []).includes(uKey))
    .map(o => o.nome));
}

async function carregar() {
  const { data, error } = await sb.from('faturas')
    .select('id,fornecedor,numero,total,data,data_pag,status,centro_custo')
    .eq('status', 'aguarda_diretor')
    .order('data_pag', { ascending: true, nullsFirst: false })
    .limit(2000);
  if (error) throw error;
  const vis = obrasVisiveis();
  _rows = (data || []).filter(r => !vis || vis.has(r.centro_custo));
}

function filtrar() {
  const q = (document.getElementById('far-q')?.value || '').trim().toLowerCase();
  const cc = document.getElementById('far-cc')?.value || '';
  return _rows.filter(r => {
    if (cc && (r.centro_custo || '') !== cc) return false;
    if (q && !`${r.fornecedor || ''} ${r.numero || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function desenhar() {
  const box = document.getElementById('far-mapa');
  if (!box) return;

  const sel = document.getElementById('far-cc');
  if (sel) {
    const atual = sel.value;
    const ccs = [...new Set(_rows.map(r => r.centro_custo || ''))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt'));
    sel.innerHTML = '<option value="">Todas as obras</option>' + ccs.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.value = ccs.includes(atual) ? atual : '';
  }
  const sub = document.getElementById('far-sub');
  if (sub) sub.textContent = _rows.length
    ? `${_rows.length} fatura${_rows.length === 1 ? '' : 's'} a aguardar a sua aprovação — abra a fatura, confirme e coloque o carimbo`
    : 'Faturas com centro de custo confirmado, a aguardar a aprovação do diretor de obra';

  const lista = filtrar();
  if (!lista.length) {
    _obra = null;   // sem nada para mostrar (ex.: acabou de aprovar a última): volta aos cartões
    box.innerHTML = `<div class="d-empty" style="border:0">${_rows.length ? 'Nenhuma fatura corresponde à pesquisa.' : 'Sem faturas por aprovar. ✓'}</div>`;
    return;
  }

  const grupos = new Map();
  lista.forEach(r => { const k = r.centro_custo || ''; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(r); });
  const chaves = [...grupos.keys()].sort((a, b) => a.localeCompare(b, 'pt'));
  const h = new Date().toISOString().slice(0, 10);

  // Dentro de uma obra: lista das faturas dessa obra
  if (_obra !== null && !grupos.has(_obra)) _obra = null;
  if (_obra !== null) { desenharObra(box, _obra, grupos.get(_obra), h); return; }

  // Cartões: um por obra com faturas por aprovar
  let total = 0;
  const cartoes = chaves.map(k => {
    const rs = grupos.get(k);
    const sub = rs.reduce((s, r) => s + (Number(r.total) || 0), 0);
    total += sub;
    const venc = rs.filter(r => r.data_pag && r.data_pag < h).length;
    const prox = rs.map(r => r.data_pag).filter(Boolean).sort()[0];
    return `<button type="button" class="far-card" data-far-obra="${esc(k)}" title="Ver as faturas desta obra">
      <span class="far-card-top">
        <span class="far-card-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/></svg></span>
        <span class="far-card-tt"><b>${esc(k || 'Sem centro de custo')}</b><small>${rs.length} fatura${rs.length === 1 ? '' : 's'} por aprovar</small></span>
        <span class="far-card-n">${rs.length}</span>
      </span>
      <span class="far-card-tot">${eur(sub)}</span>
      <span class="far-card-foot">${venc
        ? `<span class="dd-pill bad">${venc} vencida${venc === 1 ? '' : 's'}</span>`
        : (prox ? `<span class="far-card-mut">Próx. vencimento ${fmtPT(prox)}</span>` : '<span class="far-card-mut">Sem vencimento</span>')}
        <span class="far-card-go">Ver faturas →</span></span>
    </button>`;
  }).join('');

  box.innerHTML = `<div class="far-sum"><span><b>${chaves.length}</b> obra${chaves.length === 1 ? '' : 's'}</span><span><b>${lista.length}</b> fatura${lista.length === 1 ? '' : 's'}</span><span>Total por aprovar <b>${eur(total)}</b></span></div>
    <div class="far-cards">${cartoes}</div>`;
}

// Página de uma obra: lista das faturas por aprovar
function desenharObra(box, obra, rs, h) {
  const total = rs.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const linhas = rs.map(r => {
    const vencida = r.data_pag && r.data_pag < h;
    return `<tr class="tes-row" data-far-id="${r.id}" title="Clique para ver a fatura e aprovar">
      <td>${esc(r.fornecedor || '—')}</td>
      <td><b>${esc(r.numero || '—')}</b></td>
      <td>${r.data ? fmtPT(r.data) : '—'}</td>
      <td class="r"><b>${eur(r.total)}</b></td>
      <td class="${vencida ? 'tes-venc' : ''}">${r.data_pag ? fmtPT(r.data_pag) : '<span class="mut">—</span>'}${vencida ? ' <small>vencida</small>' : ''}</td>
      <td class="r"><span class="dd-pill info">Aprovar</span></td>
    </tr>`;
  }).join('');
  box.innerHTML = `<div class="far-obra-hdr">
      <button type="button" class="btn btn-secondary btn-sm" data-far-back="1">← Todas as obras</button>
      <div class="far-obra-tt"><b>${esc(obra || 'Sem centro de custo')}</b><small>${rs.length} fatura${rs.length === 1 ? '' : 's'} por aprovar · ${eur(total)}</small></div>
    </div>
    <div class="tbl-wrap"><table class="cmp-t tes-t">
      <thead><tr><th>Fornecedor</th><th>Fatura</th><th>Data</th><th class="r">Valor com IVA</th><th>Vencimento</th><th></th></tr></thead>
      <tbody class="tes-grp">${linhas}</tbody>
      <tfoot><tr><td colspan="3"><b>Total (${rs.length} fatura${rs.length === 1 ? '' : 's'})</b></td><td class="r"><b>${eur(total)}</b></td><td colspan="2"></td></tr></tfoot>
    </table></div>`;
}

export async function renderFaturasAprovar(opts) {
  const box = document.getElementById('far-mapa');
  if (!box) return;
  if (opts?.reset) _obra = null;   // ao abrir a secção começa nos cartões; ao atualizar mantém a obra aberta
  carregarPastasFaturas();   // pastas partilhadas da Dropbox (para guardar as aprovadas)
  box.innerHTML = '<div class="d-empty" style="border:0">A carregar…</div>';
  try { await carregar(); } catch (e) {
    console.warn('Faturas por aprovar:', e);
    box.innerHTML = '<div class="d-empty" style="border:0">Não foi possível carregar as faturas: ' + esc(e.message || e) + '</div>';
    return;
  }
  desenhar();
}

document.addEventListener('click', e => {
  const c = e.target.closest('[data-far-obra]');
  if (c) { _obra = c.dataset.farObra; desenhar(); document.getElementById('sec-faturas-aprovar')?.scrollIntoView?.({ block: 'start' }); return; }
  if (e.target.closest('[data-far-back]')) { _obra = null; desenhar(); return; }
  const r = e.target.closest('tr[data-far-id]');
  if (r) abrirFaturaPorDbId(Number(r.dataset.farId));
});
document.addEventListener('input', e => { if (e.target.id === 'far-q') desenhar(); });
document.addEventListener('change', e => { if (e.target.id === 'far-cc') desenhar(); });
