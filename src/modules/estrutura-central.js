// ═══════════════════════════════════════════════════════════════════
//  ESTRUTURA CENTRAL — todas as faturas do centro de custo O099 (CC Estrutura central).
//  Página só para o administrador e o financeiro (SECTION_ROLES em permissions.js);
//  o servidor aplica o mesmo limite por RLS (migração 20261118_estrutura_central.sql).
// ═══════════════════════════════════════════════════════════════════
import { sb } from '../supabase.js';
import { fmtPT } from '../utils/helpers.js';
import { abrirFaturaPorDbId } from './faturas.js';

let _rows = [];
let _grupo = 'todas';   // todas | por_aprovar | aprovadas | pagas
let _carregado = false;

const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const eur = v => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const hoje = () => new Date().toISOString().slice(0, 10);

// Estado → rótulo e cor da pílula (verde = ok, âmbar = atenção, vermelho = problema)
const ESTADOS = {
  extraida:           ['Por validar',          'info'],
  rever:              ['A rever',              'warn'],
  pendente_aprovacao: ['Por aprovar',          'warn'],
  aguarda_diretor:    ['Por aprovar',          'warn'],
  aprovada:           ['Aprovada',             'ok'],
  validada:           ['Aprovada',             'ok'],
  paga:               ['Paga',                 'mute'],
  rejeitada:          ['Rejeitada',            'bad'],
};
const POR_APROVAR = ['extraida', 'rever', 'pendente_aprovacao', 'aguarda_diretor'];
const APROVADAS = ['aprovada', 'validada'];

const grupoDe = {
  por_aprovar: r => POR_APROVAR.includes(r.status),
  aprovadas:   r => APROVADAS.includes(r.status),
  pagas:       r => r.status === 'paga',
};

async function carregar() {
  const { data, error } = await sb.from('faturas')
    .select('id,fornecedor,numero,total,data,data_pag,tipo_pagamento,status,centro_custo,centralgest_lancada')
    .ilike('centro_custo', 'O099%')
    .eq('teste', false)
    .order('data', { ascending: false, nullsFirst: false })
    .limit(2000);
  if (error) throw error;
  _rows = data || [];
  _carregado = true;
}

function filtrar() {
  const q = (document.getElementById('esc-q')?.value || '').trim().toLowerCase();
  const mes = document.getElementById('esc-mes')?.value || '';
  return _rows.filter(r => {
    if (_grupo !== 'todas' && !grupoDe[_grupo](r)) return false;
    if (mes && (r.data || '').slice(0, 7) !== mes) return false;
    if (q && !`${r.fornecedor || ''} ${r.numero || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

const nomeMes = ym => { const [a, m] = ym.split('-'); const t = new Date(Number(a), Number(m) - 1, 1).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); };

function desenhar() {
  const box = document.getElementById('esc-mapa');
  if (!box) return;

  // filtro de mês (mantém a seleção atual)
  const selM = document.getElementById('esc-mes');
  if (selM) {
    const atual = selM.value;
    const meses = [...new Set(_rows.map(r => (r.data || '').slice(0, 7)).filter(Boolean))].sort().reverse();
    selM.innerHTML = '<option value="">Todos os meses</option>' + meses.map(m => `<option value="${m}">${esc(nomeMes(m))}</option>`).join('');
    selM.value = meses.includes(atual) ? atual : '';
  }

  const chips = document.getElementById('esc-chips');
  if (chips) {
    chips.innerHTML = [['todas', 'Todas', _rows.length], ['por_aprovar', 'Por aprovar', _rows.filter(grupoDe.por_aprovar).length], ['aprovadas', 'Aprovadas', _rows.filter(grupoDe.aprovadas).length], ['pagas', 'Pagas', _rows.filter(grupoDe.pagas).length]]
      .map(([k, l, n]) => `<button type="button" class="d-chip-f${_grupo === k ? ' on' : ''}" data-esc-chip="${k}">${l}<b>${n}</b></button>`).join('');
  }

  const lista = filtrar();
  const total = lista.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const sub = document.getElementById('esc-sub');
  if (sub) sub.textContent = _rows.length
    ? `${lista.length} de ${_rows.length} fatura${_rows.length === 1 ? '' : 's'} · ${eur(total)}`
    : 'Faturas do centro de custo O099 — CC Estrutura central';

  if (!lista.length) {
    box.innerHTML = `<div class="d-empty" style="border:0">${_rows.length ? 'Nenhuma fatura corresponde aos filtros.' : 'Ainda não há faturas atribuídas à Estrutura central.'}</div>`;
    return;
  }

  const h = hoje();
  const linhas = lista.map(r => {
    const vencida = r.data_pag && r.data_pag < h && r.status !== 'paga' && r.status !== 'rejeitada';
    const [rot, cls] = ESTADOS[r.status] || [r.status || '—', 'mute'];
    return `<tr class="tes-row" data-esc-id="${r.id}" title="Clique para ver a fatura">
      <td class="tes-cc">${r.fornecedor ? esc(r.fornecedor) : '<span class="mut">Sem fornecedor</span>'}</td>
      <td><b>${esc(r.numero || '—')}</b></td>
      <td>${r.data ? fmtPT(r.data) : '<span class="mut">—</span>'}</td>
      <td class="${vencida ? 'tes-venc' : ''}">${r.data_pag ? fmtPT(r.data_pag) : '<span class="mut">—</span>'}${vencida ? ' <small>vencida</small>' : ''}</td>
      <td class="r"><b>${eur(r.total)}</b></td>
      <td><span class="dd-pill ${cls}">${esc(rot)}</span>${r.tipo_pagamento === 'debito_direto' ? ' <span class="dd-pill info">Débito direto</span>' : r.tipo_pagamento === 'referencia_mb' ? ' <span class="dd-pill info">Ref. MB</span>' : ''}</td>
    </tr>`;
  }).join('');

  box.innerHTML = `<div class="tbl-wrap"><table class="cmp-t tes-t">
    <thead><tr><th>Fornecedor</th><th>Fatura</th><th>Emissão</th><th>Vencimento</th><th class="r">Valor com IVA</th><th>Estado</th></tr></thead>
    <tbody class="tes-grp">${linhas}</tbody>
    <tfoot><tr><td colspan="4"><b>Total (${lista.length} fatura${lista.length === 1 ? '' : 's'})</b></td><td class="r"><b>${eur(total)}</b></td><td></td></tr></tfoot>
  </table></div>`;
}

export async function renderEstruturaCentral() {
  const box = document.getElementById('esc-mapa');
  if (!box) return;
  if (!_carregado) box.innerHTML = '<div class="d-empty" style="border:0">A carregar…</div>';
  try { await carregar(); } catch (e) {
    console.warn('Estrutura central:', e);
    box.innerHTML = '<div class="d-empty" style="border:0">Não foi possível carregar as faturas: ' + esc(e.message || e) + '</div>';
    return;
  }
  desenhar();
}

document.addEventListener('click', e => {
  const c = e.target.closest('[data-esc-chip]');
  if (c) { _grupo = c.dataset.escChip; desenhar(); return; }
  const r = e.target.closest('tr[data-esc-id]');
  if (r) abrirFaturaPorDbId(Number(r.dataset.escId));
});
document.addEventListener('input', e => { if (e.target.id === 'esc-q') desenhar(); });
document.addEventListener('change', e => { if (e.target.id === 'esc-mes') desenhar(); });
