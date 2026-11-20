// ═══════════════════════════════════════════════════════════════════
//  ESTRUTURA CENTRAL — todas as faturas do centro de custo O099 (CC Estrutura central).
//  Página só para o administrador e o financeiro (SECTION_ROLES em permissions.js);
//  o servidor aplica o mesmo limite por RLS (migração 20261118_estrutura_central.sql).
//  Seleção de faturas → descarga da lista em Excel; coluna CentralGest (lançada ou não).
//  Nada aqui mexe na Dropbox: marcar como lançada só grava a marca na base de dados.
// ═══════════════════════════════════════════════════════════════════
import { S } from '../state.js';
import { sb } from '../supabase.js';
import { fmtPT } from '../utils/helpers.js';
import { abrirFaturaPorDbId } from './faturas.js';

let _rows = [];
let _grupo = 'todas';   // todas | por_aprovar | aprovadas | pagas | lancadas | nao_lancadas
let _carregado = false;
const _sel = new Set();   // ids selecionados

const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const eur = v => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const hoje = () => new Date().toISOString().slice(0, 10);
const toast = m => (window.showToast ? window.showToast(m) : alert(m));
const nomeDe = k => S.USERS?.[k]?.nome || k || '';
const dmy = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }); };

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
  por_aprovar:  r => POR_APROVAR.includes(r.status),
  aprovadas:    r => APROVADAS.includes(r.status),
  pagas:        r => r.status === 'paga',
  lancadas:     r => !!r.centralgest_lancada,
  nao_lancadas: r => !r.centralgest_lancada,
};

async function carregar() {
  const { data, error } = await sb.from('faturas')
    .select('id,fornecedor,nif,numero,total,data,data_pag,tipo_pagamento,status,centro_custo,centralgest_lancada,centralgest_por,centralgest_em')
    .ilike('centro_custo', 'O099%')
    .eq('teste', false)
    .order('data', { ascending: false, nullsFirst: false })
    .limit(2000);
  if (error) throw error;
  _rows = data || [];
  const validos = new Set(_rows.map(r => r.id));
  [..._sel].forEach(id => { if (!validos.has(id)) _sel.delete(id); });
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

function desenharBarra() {
  const bar = document.getElementById('esc-bar');
  if (!bar) return;
  const sel = _rows.filter(r => _sel.has(r.id));
  if (!sel.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  const total = sel.reduce((s, r) => s + (Number(r.total) || 0), 0);
  bar.style.display = 'flex';
  bar.innerHTML = `<span class="tes-bar-n"><b>${sel.length}</b> fatura${sel.length === 1 ? '' : 's'} selecionada${sel.length === 1 ? '' : 's'} · <b>${eur(total)}</b></span>
    <span class="tes-bar-b"><button type="button" class="btn btn-sm tes-b-prop" data-esc-act="exportar-sel">Descarregar lista (Excel)</button><button type="button" class="btn btn-secondary btn-sm" data-esc-act="limpar">Limpar</button></span>`;
}

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
    chips.innerHTML = [['todas', 'Todas'], ['por_aprovar', 'Por aprovar'], ['aprovadas', 'Aprovadas'], ['pagas', 'Pagas'], ['lancadas', 'Lançadas'], ['nao_lancadas', 'Não lançadas']]
      .map(([k, l]) => `<button type="button" class="d-chip-f${_grupo === k ? ' on' : ''}" data-esc-chip="${k}">${l}<b>${k === 'todas' ? _rows.length : _rows.filter(grupoDe[k]).length}</b></button>`).join('');
  }

  const lista = filtrar();
  const total = lista.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const sub = document.getElementById('esc-sub');
  if (sub) sub.textContent = _rows.length
    ? `${lista.length} de ${_rows.length} fatura${_rows.length === 1 ? '' : 's'} · ${eur(total)}`
    : 'Faturas do centro de custo O099 — CC Estrutura central';

  desenharBarra();

  if (!lista.length) {
    box.innerHTML = `<div class="d-empty" style="border:0">${_rows.length ? 'Nenhuma fatura corresponde aos filtros.' : 'Ainda não há faturas atribuídas à Estrutura central.'}</div>`;
    return;
  }

  const h = hoje();
  const todas = lista.every(r => _sel.has(r.id));
  const linhas = lista.map(r => {
    const vencida = r.data_pag && r.data_pag < h && r.status !== 'paga' && r.status !== 'rejeitada';
    const [rot, cls] = ESTADOS[r.status] || [r.status || '—', 'mute'];
    const cg = r.centralgest_lancada
      ? `<button type="button" class="dd-pill ok tes-cg" data-esc-cg="${r.id}" title="Lançada${r.centralgest_por ? ' por ' + esc(nomeDe(r.centralgest_por)) : ''}${r.centralgest_em ? ' em ' + esc(dmy(r.centralgest_em)) : ''} — clique para desmarcar">Lançada</button>`
      : `<button type="button" class="dd-pill warn tes-cg" data-esc-cg="${r.id}" title="Clique para marcar como lançada no CentralGest">Não lançada</button>`;
    return `<tr class="tes-row" data-esc-id="${r.id}" title="Clique para ver a fatura">
      <td class="tes-ck"><input type="checkbox" data-esc-ck="${r.id}"${_sel.has(r.id) ? ' checked' : ''} aria-label="Selecionar fatura"/></td>
      <td class="tes-cc">${r.fornecedor ? esc(r.fornecedor) : '<span class="mut">Sem fornecedor</span>'}</td>
      <td><b>${esc(r.numero || '—')}</b></td>
      <td>${r.data ? fmtPT(r.data) : '<span class="mut">—</span>'}</td>
      <td class="${vencida ? 'tes-venc' : ''}">${r.data_pag ? fmtPT(r.data_pag) : '<span class="mut">—</span>'}${vencida ? ' <small>vencida</small>' : ''}</td>
      <td class="r"><b>${eur(r.total)}</b></td>
      <td><span class="dd-pill ${cls}">${esc(rot)}</span>${r.tipo_pagamento === 'debito_direto' ? ' <span class="dd-pill info">Débito direto</span>' : r.tipo_pagamento === 'referencia_mb' ? ' <span class="dd-pill info">Ref. MB</span>' : ''}</td>
      <td class="esc-cg-td">${cg}</td>
    </tr>`;
  }).join('');

  box.innerHTML = `<div class="tbl-wrap"><table class="cmp-t tes-t">
    <thead><tr><th class="tes-ck"><input type="checkbox" data-esc-ckall${todas ? ' checked' : ''} aria-label="Selecionar todas as faturas da lista"/></th><th>Fornecedor</th><th>Fatura</th><th>Emissão</th><th>Vencimento</th><th class="r">Valor com IVA</th><th>Estado</th><th>CentralGest</th></tr></thead>
    <tbody class="tes-grp">${linhas}</tbody>
    <tfoot><tr><td></td><td colspan="4"><b>Total (${lista.length} fatura${lista.length === 1 ? '' : 's'})</b></td><td class="r"><b>${eur(total)}</b></td><td colspan="2"></td></tr></tfoot>
  </table></div>`;
}

// Marca/desmarca como lançada no CentralGest (só a marca na base de dados — não mexe em ficheiros)
async function alternarCentralGest(id) {
  const r = _rows.find(x => x.id === id); if (!r) return;
  const nova = !r.centralgest_lancada;
  const upd = nova
    ? { centralgest_lancada: true, centralgest_por: S.currentUser?.key || null, centralgest_em: new Date().toISOString() }
    : { centralgest_lancada: false, centralgest_por: null, centralgest_em: null };
  const { error } = await sb.from('faturas').update(upd).eq('id', id);
  if (error) { console.warn('CentralGest:', error); toast('Não foi possível guardar a marca do CentralGest'); return; }
  Object.assign(r, upd);
  desenhar();
  toast(nova ? 'Marcada como lançada no CentralGest' : 'Marcada como não lançada');
}

// Lista em Excel (ExcelJS): título, tabela com filtros e total
async function exportar(linhas, nome) {
  const EJ = window.ExcelJS;
  if (!EJ) { toast('Exportação indisponível'); return; }
  if (!linhas.length) { toast('Sem faturas para descarregar'); return; }
  const AZUL = 'FF173F9F', TINTA = 'FF1B2130', LINHA = 'FFDDE2EA', ZEBRA = 'FFF5F7FC', F = 'Calibri';
  const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const dt = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
  const ord = linhas.slice().sort((x, y) => (x.data || '').localeCompare(y.data || ''));
  const total = ord.reduce((t, r) => t + (Number(r.total) || 0), 0);

  const wb = new EJ.Workbook();
  wb.creator = 'Plandese SA'; wb.created = new Date();
  const ws = wb.addWorksheet('Estrutura Central', { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }] });
  const cols = [['Fornecedor', 34], ['NIF', 13], ['Fatura', 20], ['Emissão', 12], ['Vencimento', 13], ['Total (€)', 15], ['Estado', 14], ['Pagamento', 15], ['CentralGest', 14], ['Lançada em', 13]];
  ws.columns = cols.map(([, w]) => ({ width: w }));
  const N = cols.length, ult = String.fromCharCode(64 + N);

  ws.mergeCells(`A1:${ult}1`);
  const t = ws.getCell('A1'); t.value = 'Plandese  ·  Estrutura Central';
  t.font = { name: F, size: 18, bold: true, color: { argb: 'FFFFFFFF' } }; t.fill = fill(AZUL);
  t.alignment = { vertical: 'middle', indent: 1 }; ws.getRow(1).height = 34;
  ws.mergeCells(`A2:${ult}2`);
  const s = ws.getCell('A2'); s.value = `Faturas do centro de custo O099  ·  ${ord.length} fatura${ord.length === 1 ? '' : 's'}  ·  gerada a ${new Date().toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' })}`;
  s.font = { name: F, size: 11, color: { argb: 'FFDCE6FA' } }; s.fill = fill(AZUL);
  s.alignment = { vertical: 'middle', indent: 1 }; ws.getRow(2).height = 22;
  ws.getRow(3).height = 8;

  const hr = ws.getRow(4); hr.height = 26;
  cols.forEach(([nm], i) => {
    const c = hr.getCell(i + 1); c.value = nm;
    c.font = { name: F, size: 11, bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = fill(AZUL);
    c.alignment = { vertical: 'middle', horizontal: i === 5 ? 'right' : [3, 4, 9].includes(i) ? 'center' : 'left', indent: i === 5 ? 0 : 1 };
  });

  const pag = { debito_direto: 'Débito direto', referencia_mb: 'Ref. MB', transferencia: 'Transferência' };
  ord.forEach((r, k) => {
    const row = ws.getRow(5 + k); row.height = 20;
    const vals = [r.fornecedor || '', r.nif || '', r.numero || '', dt(r.data), dt(r.data_pag), Number(r.total) || 0,
      (ESTADOS[r.status] || [r.status || ''])[0], pag[r.tipo_pagamento] || r.tipo_pagamento || '',
      r.centralgest_lancada ? 'Lançada' : 'Não lançada', dt((r.centralgest_em || '').slice(0, 10))];
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1); c.value = v;
      c.font = { name: F, size: 10.5, color: { argb: TINTA } };
      c.alignment = { vertical: 'middle', horizontal: i === 5 ? 'right' : [3, 4, 9].includes(i) ? 'center' : 'left', indent: [3, 4, 5, 9].includes(i) ? 0 : 1 };
      c.border = { bottom: { style: 'thin', color: { argb: LINHA } } };
      if (k % 2) c.fill = fill(ZEBRA);
    });
    row.getCell(4).numFmt = row.getCell(5).numFmt = row.getCell(10).numFmt = 'dd/mm/yyyy';
    row.getCell(6).numFmt = '#,##0.00 "€"'; row.getCell(6).font = { name: F, size: 10.5, bold: true, color: { argb: TINTA } };
    const cg = row.getCell(9);
    cg.font = { name: F, size: 10, bold: true, color: { argb: r.centralgest_lancada ? 'FF166534' : 'FFA35A08' } };
    cg.fill = fill(r.centralgest_lancada ? 'FFDFF5E7' : 'FFFFF0D9'); cg.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  const fim = 5 + ord.length, tr = ws.getRow(fim); tr.height = 24;
  for (let i = 1; i <= N; i++) {
    const c = tr.getCell(i); c.fill = fill('FFEAF0FC'); c.border = { top: { style: 'medium', color: { argb: AZUL } } };
    c.font = { name: F, size: 11.5, bold: true, color: { argb: AZUL } }; c.alignment = { vertical: 'middle', indent: 1 };
  }
  tr.getCell(1).value = 'TOTAL';
  tr.getCell(6).value = { formula: `SUBTOTAL(109,F5:F${fim - 1})`, result: total }; tr.getCell(6).numFmt = '#,##0.00 "€"';
  tr.getCell(6).alignment = { vertical: 'middle', horizontal: 'right' };
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: fim - 1, column: N } };
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '4:4' };

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url; a.download = `Plandese_${nome}_${hoje()}.xlsx`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Excel descarregado ✓');
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
  const act = e.target.closest('[data-esc-act]');
  if (act) {
    const a = act.dataset.escAct;
    if (a === 'exportar-sel') exportar(_rows.filter(r => _sel.has(r.id)), 'estrutura_central_selecionadas');
    else if (a === 'exportar-lista') exportar(_sel.size ? _rows.filter(r => _sel.has(r.id)) : filtrar(), 'estrutura_central');
    else if (a === 'limpar') { _sel.clear(); desenhar(); }
    return;
  }
  const cg = e.target.closest('[data-esc-cg]');
  if (cg) { alternarCentralGest(Number(cg.dataset.escCg)); return; }
  if (e.target.closest('#esc-mapa .tes-ck')) return;   // caixas de seleção não abrem a fatura
  const r = e.target.closest('tr[data-esc-id]');
  if (r) abrirFaturaPorDbId(Number(r.dataset.escId));
});
document.addEventListener('change', e => {
  const ck = e.target.closest('[data-esc-ck]');
  if (ck) { const id = Number(ck.dataset.escCk); if (ck.checked) _sel.add(id); else _sel.delete(id); desenhar(); return; }
  if (e.target.matches('[data-esc-ckall]')) { filtrar().forEach(r => { if (e.target.checked) _sel.add(r.id); else _sel.delete(r.id); }); desenhar(); return; }
  if (e.target.id === 'esc-mes') desenhar();
});
document.addEventListener('input', e => { if (e.target.id === 'esc-q') desenhar(); });
