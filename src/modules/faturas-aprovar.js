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
    box.innerHTML = '<div class="d-empty" style="border:0">Sem faturas por aprovar. ✓</div>';
    return;
  }

  const grupos = new Map();
  lista.forEach(r => { const k = r.centro_custo || ''; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(r); });
  const chaves = [...grupos.keys()].sort((a, b) => a.localeCompare(b, 'pt'));
  const h = new Date().toISOString().slice(0, 10);
  let total = 0;

  const corpo = chaves.map(k => {
    const rs = grupos.get(k);
    const sub = rs.reduce((s, r) => s + (Number(r.total) || 0), 0);
    total += sub;
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
    return `<tbody class="tes-grp"><tr class="tes-gh"><td colspan="3">${esc(k)} <small>${rs.length} fatura${rs.length === 1 ? '' : 's'}</small></td><td class="r"><b>${eur(sub)}</b></td><td colspan="2"></td></tr>${linhas}</tbody>`;
  }).join('');

  box.innerHTML = `<div class="tbl-wrap"><table class="cmp-t tes-t">
    <thead><tr><th>Fornecedor</th><th>Fatura</th><th>Data</th><th class="r">Valor com IVA</th><th>Vencimento</th><th></th></tr></thead>
    ${corpo}
    <tfoot><tr><td colspan="3"><b>Total por aprovar (${lista.length} faturas)</b></td><td class="r"><b>${eur(total)}</b></td><td colspan="2"></td></tr></tfoot>
  </table></div>`;
}

export async function renderFaturasAprovar() {
  const box = document.getElementById('far-mapa');
  if (!box) return;
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
  const r = e.target.closest('tr[data-far-id]');
  if (r) abrirFaturaPorDbId(Number(r.dataset.farId));
});
document.addEventListener('input', e => { if (e.target.id === 'far-q') desenhar(); });
document.addEventListener('change', e => { if (e.target.id === 'far-cc') desenhar(); });
