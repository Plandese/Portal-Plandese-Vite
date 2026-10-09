// ═══════════════════════════════════════════════════════════════════
//  TESOURARIA — mapa de todas as faturas inseridas, organizado por centro de custo
//  Colunas: Centro de custo · Fornecedor · Fatura · Valor com IVA · Vencimento
// ═══════════════════════════════════════════════════════════════════
import { sb } from '../supabase.js';
import { fmtPT } from '../utils/helpers.js';

let _rows = [];
let _estado = 'todas';   // todas | pendentes | aprovadas
let _carregado = false;

const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const eur = v => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const hoje = () => new Date().toISOString().slice(0, 10);

const PENDENTES = ['extraida', 'rever', 'pendente_aprovacao'];
const APROVADAS = ['aprovada', 'validada', 'paga'];

async function carregar() {
  const { data, error } = await sb.from('faturas')
    .select('id,fornecedor,numero,total,data,data_pag,status,centro_custo')
    .neq('status', 'rejeitada')
    .order('data_pag', { ascending: true, nullsFirst: false })
    .limit(2000);
  if (error) throw error;
  _rows = data || [];
  _carregado = true;
}

function filtrar() {
  const q = (document.getElementById('tes-q')?.value || '').trim().toLowerCase();
  const cc = document.getElementById('tes-cc')?.value || '';
  return _rows.filter(r => {
    if (_estado === 'pendentes' && !PENDENTES.includes(r.status)) return false;
    if (_estado === 'aprovadas' && !APROVADAS.includes(r.status)) return false;
    if (cc && (r.centro_custo || '') !== (cc === '__sem__' ? '' : cc)) return false;
    if (q && !`${r.fornecedor || ''} ${r.numero || ''} ${r.centro_custo || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function desenhar() {
  const box = document.getElementById('tes-mapa');
  if (!box) return;

  // opções do filtro de centro de custo (mantém a seleção atual)
  const sel = document.getElementById('tes-cc');
  if (sel) {
    const atual = sel.value;
    const ccs = [...new Set(_rows.map(r => r.centro_custo || ''))].sort((a, b) => a.localeCompare(b, 'pt'));
    sel.innerHTML = '<option value="">Todos os centros de custo</option>'
      + ccs.map(c => c === '' ? '<option value="__sem__">Sem centro de custo</option>' : `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.value = [...sel.options].some(o => o.value === atual) ? atual : '';
  }

  const chips = document.getElementById('tes-chips');
  if (chips) {
    const n = l => l.length;
    chips.innerHTML = [['todas', 'Todas', _rows], ['pendentes', 'Por aprovar', _rows.filter(r => PENDENTES.includes(r.status))], ['aprovadas', 'Aprovadas', _rows.filter(r => APROVADAS.includes(r.status))]]
      .map(([k, l, arr]) => `<button type="button" class="d-chip-f${_estado === k ? ' on' : ''}" data-tes-chip="${k}">${l}<b>${n(arr)}</b></button>`).join('');
  }

  const lista = filtrar();
  if (!lista.length) {
    box.innerHTML = '<div class="d-empty" style="border:0">Sem faturas para mostrar.</div>';
    return;
  }

  // agrupa por centro de custo (ordem alfabética; "sem centro de custo" no fim)
  const grupos = new Map();
  lista.forEach(r => { const k = r.centro_custo || ''; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(r); });
  const chaves = [...grupos.keys()].sort((a, b) => a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'pt'));
  const h = hoje();
  let total = 0;

  const corpo = chaves.map(k => {
    const rs = grupos.get(k).sort((a, b) => (a.data_pag || '9999') .localeCompare(b.data_pag || '9999'));
    const sub = rs.reduce((s, r) => s + (Number(r.total) || 0), 0);
    total += sub;
    const linhas = rs.map(r => {
      const vencida = r.data_pag && r.data_pag < h && !['paga'].includes(r.status);
      return `<tr>
        <td class="tes-cc">${k ? esc(k) : '<span class="mut">Sem centro de custo</span>'}</td>
        <td>${esc(r.fornecedor || '—')}</td>
        <td><b>${esc(r.numero || '—')}</b></td>
        <td class="r"><b>${eur(r.total)}</b></td>
        <td class="${vencida ? 'tes-venc' : ''}">${r.data_pag ? fmtPT(r.data_pag) : '<span class="mut">—</span>'}${vencida ? ' <small>vencida</small>' : ''}</td>
      </tr>`;
    }).join('');
    return `<tbody class="tes-grp"><tr class="tes-gh"><td colspan="3">${k ? esc(k) : 'Sem centro de custo'} <small>${rs.length} fatura${rs.length === 1 ? '' : 's'}</small></td><td class="r"><b>${eur(sub)}</b></td><td></td></tr>${linhas}</tbody>`;
  }).join('');

  box.innerHTML = `<div class="tbl-wrap"><table class="cmp-t tes-t">
    <thead><tr><th>Centro de custo</th><th>Fornecedor</th><th>Fatura</th><th class="r">Valor com IVA</th><th>Vencimento</th></tr></thead>
    ${corpo}
    <tfoot><tr><td colspan="3"><b>Total (${lista.length} faturas)</b></td><td class="r"><b>${eur(total)}</b></td><td></td></tr></tfoot>
  </table></div>`;
}

export async function renderTesouraria() {
  const box = document.getElementById('tes-mapa');
  if (!box) return;
  if (!_carregado) box.innerHTML = '<div class="d-empty" style="border:0">A carregar…</div>';
  try { await carregar(); } catch (e) {
    console.warn('Tesouraria:', e);
    box.innerHTML = '<div class="d-empty" style="border:0">Não foi possível carregar as faturas: ' + esc(e.message || e) + '</div>';
    return;
  }
  desenhar();
}

document.addEventListener('click', e => {
  const c = e.target.closest('[data-tes-chip]');
  if (c) { _estado = c.dataset.tesChip; desenhar(); }
});
document.addEventListener('input', e => { if (e.target.id === 'tes-q') desenhar(); });
document.addEventListener('change', e => { if (e.target.id === 'tes-cc') desenhar(); });
