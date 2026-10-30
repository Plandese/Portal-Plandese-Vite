// ═══════════════════════════════════════════════════════════════════
//  TESOURARIA — mapa das faturas aprovadas (já com centro de custo), organizado por fornecedor
//  Colunas: Fornecedor · Centro de custo · Fatura · Valor com IVA · Vencimento · Estado
//  Propostas de pagamento: quem pode (administrador + lista em app_config) seleciona faturas e propõe-nas;
//  as propostas ficam a amarelo. Só o administrador marca como paga (em lote).
// ═══════════════════════════════════════════════════════════════════
import { S } from '../state.js';
import { sb } from '../supabase.js';
import { fmtPT } from '../utils/helpers.js';
import { abrirFaturaPorDbId, faturaSemFicheiro } from './faturas.js';
import { dropboxDownload } from './dropbox.js';

let _rows = [];
let _estado = 'todas';   // todas | por_pagar | propostas | pagas
let _carregado = false;
let _podePropor = false;
let _proponentes = [];   // usernames (lista em app_config.tesouraria_proponentes)
const _sel = new Set();  // ids selecionados

const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const eur = v => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const hoje = () => new Date().toISOString().slice(0, 10);
const ehAdmin = () => S.currentUser?.role === 'admin';
const nomeDe = k => S.USERS?.[k]?.nome || k || '';
const dm = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' }); };
const dmy = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }); };
const toast = m => (window.showToast ? window.showToast(m) : alert(m));

// A Tesouraria recebe as faturas assim que são aprovadas com centro de custo
const APROVADAS = ['aprovada', 'validada', 'paga'];
const POR_PAGAR = ['aprovada', 'validada'];
const porPagar = r => POR_PAGAR.includes(r.status);
const proposta = r => porPagar(r) && !!r.proposta_por;

async function carregar() {
  const { data, error } = await sb.from('faturas')
    .select('id,dropbox_path,fornecedor,nif,numero,total,data,data_pag,tipo_pagamento,status,centro_custo,proposta_por,proposta_em,pago_por,pago_em')
    .in('status', APROVADAS)
    .order('data_pag', { ascending: true, nullsFirst: false })
    .limit(2000);
  if (error) throw error;
  _rows = data || [];
  // limpa seleções de faturas que já não estão por pagar
  const validos = new Set(_rows.filter(porPagar).map(r => r.id));
  [..._sel].forEach(id => { if (!validos.has(id)) _sel.delete(id); });

  try {
    const [{ data: ok }, { data: cfg }] = await Promise.all([
      sb.rpc('fn_pode_propor'),
      sb.from('app_config').select('value').eq('key', 'tesouraria_proponentes').maybeSingle(),
    ]);
    _podePropor = ok === true;
    _proponentes = Array.isArray(cfg?.value) ? cfg.value : [];
  } catch (e) { console.warn('Tesouraria (permissões):', e); _podePropor = false; }
  _carregado = true;
}

function filtrar() {
  const q = (document.getElementById('tes-q')?.value || '').trim().toLowerCase();
  const cc = document.getElementById('tes-cc')?.value || '';
  return _rows.filter(r => {
    if (_estado === 'por_pagar' && !porPagar(r)) return false;
    if (_estado === 'propostas' && !proposta(r)) return false;
    if (_estado === 'pagas' && r.status !== 'paga') return false;
    if (cc && (r.centro_custo || '') !== (cc === '__sem__' ? '' : cc)) return false;
    if (q && !`${r.fornecedor || ''} ${r.numero || ''} ${r.centro_custo || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function desenharBarra() {
  const bar = document.getElementById('tes-bar');
  if (!bar) return;
  const sel = _rows.filter(r => _sel.has(r.id));
  if (!sel.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  const total = sel.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const novas = sel.filter(r => !r.proposta_por).length;
  const minhas = sel.filter(r => r.proposta_por && (ehAdmin() || r.proposta_por === S.currentUser?.key)).length;
  const btn = [];
  if (_podePropor && novas) btn.push(`<button type="button" class="btn btn-sm tes-b-prop" data-tes-act="propor">Propor a pagamento (${novas})</button>`);
  if (_podePropor && minhas) btn.push(`<button type="button" class="btn btn-secondary btn-sm" data-tes-act="retirar">Retirar proposta (${minhas})</button>`);
  if (ehAdmin()) btn.push(`<button type="button" class="btn btn-sm tes-b-pago" data-tes-act="pago">Marcar como pago (${sel.length})</button>`);
  btn.push('<button type="button" class="btn btn-secondary btn-sm" data-tes-act="exportar">Exportar</button>');
  btn.push('<button type="button" class="btn btn-secondary btn-sm" data-tes-act="limpar">Limpar</button>');
  bar.style.display = 'flex';
  bar.innerHTML = `<span class="tes-bar-n"><b>${sel.length}</b> fatura${sel.length === 1 ? '' : 's'} selecionada${sel.length === 1 ? '' : 's'} · <b>${eur(total)}</b></span><span class="tes-bar-b">${btn.join('')}</span>`;
}

function desenhar() {
  const box = document.getElementById('tes-mapa');
  if (!box) return;

  // botões do cabeçalho (só para quem gere as propostas)
  const hdr = document.getElementById('tes-hdr-act');
  if (hdr) {
    hdr.innerHTML = (ehAdmin() ? '<button type="button" class="btn btn-secondary btn-sm" data-tes-act="quem">Quem propõe…</button>' : '')
      + '<button type="button" class="btn btn-secondary btn-sm" data-tes-act="exportar-prop">Exportar Excel</button>'
      + (document.getElementById('tes-cc')?.value ? '<button type="button" class="btn btn-secondary btn-sm" data-tes-act="zip">Descarregar faturas (ZIP)</button>' : '');
  }

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
    chips.innerHTML = [['todas', 'Todas', _rows], ['por_pagar', 'Por pagar', _rows.filter(porPagar)], ['propostas', 'Propostas', _rows.filter(proposta)], ['pagas', 'Pagas', _rows.filter(r => r.status === 'paga')]]
      .map(([k, l, arr]) => `<button type="button" class="d-chip-f${_estado === k ? ' on' : ''}" data-tes-chip="${k}">${l}<b>${arr.length}</b></button>`).join('');
  }

  const lista = filtrar();
  if (!lista.length) {
    box.innerHTML = '<div class="d-empty" style="border:0">Sem faturas para mostrar.</div>';
    desenharBarra();
    return;
  }

  // agrupa por fornecedor (ordem alfabética; "sem fornecedor" no fim)
  const grupos = new Map();
  lista.forEach(r => { const k = (r.fornecedor || '').trim(); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(r); });
  const chaves = [...grupos.keys()].sort((a, b) => a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'pt'));
  const h = hoje();
  const podeSel = _podePropor || ehAdmin();
  let total = 0, totalProp = 0;

  const corpo = chaves.map(k => {
    const rs = grupos.get(k).sort((a, b) => (a.data_pag || '9999').localeCompare(b.data_pag || '9999'));
    const sub = rs.reduce((s, r) => s + (Number(r.total) || 0), 0);
    total += sub;
    const elegiveis = rs.filter(porPagar);
    const todas = elegiveis.length > 0 && elegiveis.every(r => _sel.has(r.id));
    const linhas = rs.map(r => {
      const vencida = r.data_pag && r.data_pag < h && r.status !== 'paga';
      const prop = proposta(r);
      if (prop) totalProp += Number(r.total) || 0;
      const marcada = _sel.has(r.id);
      const estado = r.status === 'paga'
        ? `<span class="dd-pill mute" title="${r.pago_por ? 'Paga por ' + esc(nomeDe(r.pago_por)) + ' em ' + esc(dm(r.pago_em)) : 'Paga'}">Paga</span>`
        : prop ? `<span class="dd-pill warn tes-pill-prop" title="Proposta a pagamento por ${esc(nomeDe(r.proposta_por))} em ${esc(dmy(r.proposta_em))}">Proposta a pagamento por: ${esc(nomeDe(r.proposta_por))} (${esc(dmy(r.proposta_em))})</span>`
        : '<span class="mut">—</span>';
      return `<tr class="tes-row${prop ? ' tes-prop' : ''}${marcada ? ' tes-sel' : ''}" data-tes-id="${r.id}" title="Clique para ver os detalhes da fatura">
        ${podeSel ? `<td class="tes-ck">${porPagar(r) ? `<input type="checkbox" data-tes-ck="${r.id}"${marcada ? ' checked' : ''} aria-label="Selecionar fatura"/>` : ''}</td>` : ''}
        <td class="tes-cc">${k ? esc(k) : '<span class="mut">Sem fornecedor</span>'}</td>
        <td>${r.centro_custo ? esc(r.centro_custo) : '<span class="mut">Sem centro de custo</span>'}</td>
        <td><b>${esc(r.numero || '—')}</b></td>
        <td class="r"><b>${eur(r.total)}</b></td>
        <td class="${vencida ? 'tes-venc' : ''}">${r.data_pag ? fmtPT(r.data_pag) : '<span class="mut">—</span>'}${vencida ? ' <small>vencida</small>' : ''}</td>
        <td>${estado}${r.tipo_pagamento === 'debito_direto' ? ' <span class="dd-pill info" title="Fatura a débito direto">Débito direto</span>' : r.tipo_pagamento === 'referencia_mb' ? ' <span class="dd-pill info" title="Fatura com referência MB">Ref. MB</span>' : ''}${faturaSemFicheiro(r.id) ? ' <span class="dd-pill bad" title="O ficheiro desta fatura já não existe na Dropbox">Sem ficheiro</span>' : ''}</td>
      </tr>`;
    }).join('');
    const ckG = podeSel ? `<td class="tes-ck">${elegiveis.length ? `<input type="checkbox" data-tes-ckg="${esc(k)}"${todas ? ' checked' : ''} aria-label="Selecionar todas as faturas deste fornecedor"/>` : ''}</td>` : '';
    return `<tbody class="tes-grp"><tr class="tes-gh">${ckG}<td colspan="3">${k ? esc(k) : 'Sem fornecedor'} <small>${rs.length} fatura${rs.length === 1 ? '' : 's'}</small></td><td class="r"><b>${eur(sub)}</b></td><td colspan="2"></td></tr>${linhas}</tbody>`;
  }).join('');

  const colsAntes = podeSel ? 4 : 3;
  box.innerHTML = `<div class="tbl-wrap"><table class="cmp-t tes-t">
    <thead><tr>${podeSel ? '<th class="tes-ck"></th>' : ''}<th>Fornecedor</th><th>Centro de custo</th><th>Fatura</th><th class="r">Valor com IVA</th><th>Vencimento</th><th>Estado</th></tr></thead>
    ${corpo}
    <tfoot><tr><td colspan="${colsAntes}"><b>Total (${lista.length} faturas)</b>${totalProp ? ` · <span class="tes-prop-tot">Propostas: ${eur(totalProp)}</span>` : ''}</td><td class="r"><b>${eur(total)}</b></td><td colspan="2"></td></tr></tfoot>
  </table></div>`;
  desenharBarra();
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

// ── Ações ───────────────────────────────────────────────────────────
async function recarregar() { try { await carregar(); } catch (e) { console.warn(e); } desenhar(); }

async function propor(propor) {
  const sel = _rows.filter(r => _sel.has(r.id));
  const ids = sel.filter(r => propor ? !r.proposta_por : r.proposta_por).map(r => r.id);
  if (!ids.length) return;
  const { data, error } = await sb.rpc('fn_propor_pagamento', { p_ids: ids, p_propor: propor });
  if (error) { toast('Não foi possível guardar: ' + (error.message || error)); return; }
  toast(propor ? `${data} fatura${data === 1 ? '' : 's'} proposta${data === 1 ? '' : 's'} a pagamento` : `${data} proposta${data === 1 ? '' : 's'} retirada${data === 1 ? '' : 's'}`);
  _sel.clear();
  await recarregar();
}

async function marcarPago() {
  const sel = _rows.filter(r => _sel.has(r.id) && porPagar(r));
  if (!sel.length) return;
  const total = sel.reduce((s, r) => s + (Number(r.total) || 0), 0);
  if (!confirm(`Marcar ${sel.length} fatura${sel.length === 1 ? '' : 's'} como paga${sel.length === 1 ? '' : 's'} (${eur(total)})?`)) return;
  const { data, error } = await sb.rpc('fn_marcar_pago', { p_ids: sel.map(r => r.id) });
  if (error) { toast('Não foi possível marcar como pago: ' + (error.message || error)); return; }
  toast(`${data} fatura${data === 1 ? '' : 's'} marcada${data === 1 ? '' : 's'} como paga${data === 1 ? '' : 's'}`);
  _sel.clear();
  await recarregar();
}

// Excel profissional (ExcelJS): título, resumo, tabela com filtros e totais + folha de resumo por centro de custo
const _XL_AZUL = 'FF173F9F', _XL_TINTA = 'FF1B2130', _XL_LINHA = 'FFDDE2EA', _XL_ZEBRA = 'FFF5F7FC';
const _XL_FONTE = 'Calibri';
const _xlData = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
const _xlFill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const _xlBorda = argb => ({ style: 'thin', color: { argb } });
const _XL_ESTADO = { 'Paga': ['FFDFF5E7', 'FF166534'], 'Proposta de pagamento': ['FFFFF0D9', 'FFA35A08'], 'Por pagar': ['FFEAF0FC', 'FF173F9F'] };

async function exportar(linhas, nome) {
  const EJ = window.ExcelJS;
  if (!EJ) { toast('Exportação indisponível'); return; }
  if (!linhas.length) { toast('Sem faturas para exportar'); return; }
  const hojeIso = hoje();
  const estadoDe = r => r.status === 'paga' ? 'Paga' : proposta(r) ? 'Proposta de pagamento' : 'Por pagar';
  const ord = linhas.slice().sort((x, y) => (x.centro_custo || '').localeCompare(y.centro_custo || '', 'pt') || (x.data_pag || '').localeCompare(y.data_pag || ''));
  const total = ord.reduce((t, r) => t + (Number(r.total) || 0), 0);
  const porEstado = e => ord.filter(r => estadoDe(r) === e).reduce((t, r) => t + (Number(r.total) || 0), 0);
  const vencidas = ord.filter(r => porPagar(r) && r.data_pag && r.data_pag < hojeIso);

  const wb = new EJ.Workbook();
  wb.creator = 'Plandese SA'; wb.created = new Date();
  const ws = wb.addWorksheet('Tesouraria', { views: [{ state: 'frozen', ySplit: 7, showGridLines: false }] });
  const cols = [
    ['Centro de custo', 26], ['Fornecedor', 34], ['NIF', 13], ['Fatura', 17], ['Data', 12], ['Vencimento', 13],
    ['Total (€)', 15], ['Estado', 22], ['Pagamento', 15], ['Proposta por', 20], ['Proposta em', 13], ['Pago em', 13],
  ];
  ws.columns = cols.map(([, w]) => ({ width: w }));
  const N = cols.length, ult = String.fromCharCode(64 + N);

  // Título
  ws.mergeCells(`A1:${ult}1`);
  const t = ws.getCell('A1'); t.value = 'Plandese  ·  Tesouraria';
  t.font = { name: _XL_FONTE, size: 20, bold: true, color: { argb: 'FFFFFFFF' } }; t.fill = _xlFill(_XL_AZUL);
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }; ws.getRow(1).height = 38;
  ws.mergeCells(`A2:${ult}2`);
  const sub = ws.getCell('A2'); sub.value = `Lista de faturas aprovadas  ·  gerada a ${new Date().toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' })}  ·  por ${nomeDe(S.currentUser?.key) || 'utilizador'}`;
  sub.font = { name: _XL_FONTE, size: 11, color: { argb: 'FFDCE6FA' } }; sub.fill = _xlFill(_XL_AZUL);
  sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }; ws.getRow(2).height = 22;
  ws.getRow(3).height = 10;

  // Resumo (4 indicadores)
  const kpis = [
    ['Faturas', ord.length, '0'], ['Total', total, '#,##0.00 "€"'], ['Por pagar', porEstado('Por pagar') + porEstado('Proposta de pagamento'), '#,##0.00 "€"'],
    ['Pagas', porEstado('Paga'), '#,##0.00 "€"'], ['Vencidas', vencidas.reduce((x, r) => x + (Number(r.total) || 0), 0), '#,##0.00 "€"'],
  ];
  const pos = [['A', 'A'], ['B', 'B'], ['C', 'E'], ['F', 'G'], ['H', 'I']];
  kpis.forEach(([rot, val, fmt], i) => {
    const [c1, c2] = pos[i];
    if (c1 !== c2) { ws.mergeCells(`${c1}4:${c2}4`); ws.mergeCells(`${c1}5:${c2}5`); }
    const l = ws.getCell(`${c1}4`), v = ws.getCell(`${c1}5`);
    l.value = rot.toUpperCase(); l.font = { name: _XL_FONTE, size: 9, bold: true, color: { argb: 'FF5D6678' } };
    v.value = val; v.numFmt = fmt; v.font = { name: _XL_FONTE, size: 15, bold: true, color: { argb: rot === 'Vencidas' && val > 0 ? 'FFB3261E' : _XL_AZUL } };
    [l, v].forEach(c => { c.fill = _xlFill('FFEAF0FC'); c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }; });
  });
  ws.getRow(4).height = 18; ws.getRow(5).height = 26; ws.getRow(6).height = 10;

  // Cabeçalho da tabela
  const hr = ws.getRow(7); hr.height = 28;
  cols.forEach(([nm], i) => {
    const c = hr.getCell(i + 1); c.value = nm;
    c.font = { name: _XL_FONTE, size: 11, bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = _xlFill(_XL_AZUL);
    c.alignment = { vertical: 'middle', horizontal: [5, 6, 7, 11, 12].includes(i) ? (i === 6 ? 'right' : 'center') : 'left', indent: i === 6 ? 0 : 1 };
  });

  // Linhas
  ord.forEach((r, k) => {
    const row = ws.getRow(8 + k); row.height = 21;
    const est = estadoDe(r);
    const venc = porPagar(r) && r.data_pag && r.data_pag < hojeIso;
    const vals = [r.centro_custo || '—', r.fornecedor || '', r.nif || '', r.numero || '', _xlData(r.data), _xlData(r.data_pag), Number(r.total) || 0, est,
      r.tipo_pagamento || '', nomeDe(r.proposta_por), r.proposta_em ? new Date(r.proposta_em) : null, _xlData((r.pago_em || '').slice(0, 10))];
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1); c.value = v;
      c.font = { name: _XL_FONTE, size: 10.5, color: { argb: _XL_TINTA } };
      c.alignment = { vertical: 'middle', horizontal: [4, 5, 10, 11].includes(i) ? 'center' : i === 6 ? 'right' : 'left', indent: [4, 5, 6, 10, 11].includes(i) ? 0 : 1 };
      c.border = { bottom: _xlBorda(_XL_LINHA) };
      if (k % 2) c.fill = _xlFill(_XL_ZEBRA);
    });
    row.getCell(5).numFmt = row.getCell(6).numFmt = row.getCell(11).numFmt = row.getCell(12).numFmt = 'dd/mm/yyyy';
    row.getCell(7).numFmt = '#,##0.00 "€"'; row.getCell(7).font = { name: _XL_FONTE, size: 10.5, bold: true, color: { argb: _XL_TINTA } };
    const [bg, fg] = _XL_ESTADO[est];
    const ce = row.getCell(8); ce.fill = _xlFill(bg); ce.font = { name: _XL_FONTE, size: 10, bold: true, color: { argb: fg } }; ce.alignment = { vertical: 'middle', horizontal: 'center' };
    if (venc) row.getCell(6).font = { name: _XL_FONTE, size: 10.5, bold: true, color: { argb: 'FFB3261E' } };
  });

  // Total
  const fim = 8 + ord.length, tr = ws.getRow(fim); tr.height = 26;
  for (let i = 1; i <= N; i++) {
    const c = tr.getCell(i); c.fill = _xlFill('FFEAF0FC'); c.border = { top: { style: 'medium', color: { argb: _XL_AZUL } } };
    c.font = { name: _XL_FONTE, size: 11.5, bold: true, color: { argb: _XL_AZUL } }; c.alignment = { vertical: 'middle', indent: 1 };
  }
  tr.getCell(1).value = 'TOTAL';
  tr.getCell(7).value = { formula: `SUBTOTAL(109,G8:G${fim - 1})`, result: total }; tr.getCell(7).numFmt = '#,##0.00 "€"'; tr.getCell(7).alignment = { vertical: 'middle', horizontal: 'right' };
  ws.autoFilter = { from: { row: 7, column: 1 }, to: { row: fim - 1, column: N } };

  // Impressão
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: .4, right: .4, top: .5, bottom: .6, header: .3, footer: .3 }, printTitlesRow: '7:7' };
  ws.headerFooter = { oddFooter: '&L&"Calibri"&9Plandese · Tesouraria&R&"Calibri"&9Página &P de &N' };

  // Folha de resumo por centro de custo
  const rs = wb.addWorksheet('Resumo por centro de custo', { views: [{ showGridLines: false }] });
  rs.columns = [{ width: 34 }, { width: 12 }, { width: 18 }, { width: 18 }, { width: 18 }];
  rs.mergeCells('A1:E1'); const rt = rs.getCell('A1'); rt.value = 'Resumo por centro de custo';
  rt.font = { name: _XL_FONTE, size: 16, bold: true, color: { argb: 'FFFFFFFF' } }; rt.fill = _xlFill(_XL_AZUL); rt.alignment = { vertical: 'middle', indent: 1 }; rs.getRow(1).height = 32;
  ['Centro de custo', 'Faturas', 'Total (€)', 'Por pagar (€)', 'Pago (€)'].forEach((h, i) => {
    const c = rs.getCell(3, i + 1); c.value = h; c.font = { name: _XL_FONTE, bold: true, size: 11, color: { argb: _XL_AZUL } }; c.fill = _xlFill('FFEAF0FC');
    c.border = { bottom: { style: 'medium', color: { argb: _XL_AZUL } } }; c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'right', indent: i === 0 ? 1 : 0 };
  });
  rs.getRow(3).height = 24;
  const grupos = new Map();
  ord.forEach(r => {
    const k = r.centro_custo || '—'; const g = grupos.get(k) || { n: 0, t: 0, p: 0, g: 0 };
    g.n++; g.t += Number(r.total) || 0; if (r.status === 'paga') g.g += Number(r.total) || 0; else g.p += Number(r.total) || 0; grupos.set(k, g);
  });
  let rr = 4;
  [...grupos.entries()].sort((x, y) => y[1].t - x[1].t).forEach(([k, g], i) => {
    [k, g.n, g.t, g.p, g.g].forEach((v, j) => {
      const c = rs.getCell(rr, j + 1); c.value = v; c.font = { name: _XL_FONTE, size: 10.5, color: { argb: _XL_TINTA } };
      c.alignment = { vertical: 'middle', horizontal: j === 0 ? 'left' : 'right', indent: j === 0 ? 1 : 0 }; c.border = { bottom: _xlBorda(_XL_LINHA) };
      if (j >= 2) c.numFmt = '#,##0.00 "€"'; if (i % 2) c.fill = _xlFill(_XL_ZEBRA);
    });
    rs.getRow(rr).height = 20; rr++;
  });
  const totRow = rs.getRow(rr); totRow.height = 24;
  ['TOTAL', { f: `SUM(B4:B${rr - 1})` }, { f: `SUM(C4:C${rr - 1})` }, { f: `SUM(D4:D${rr - 1})` }, { f: `SUM(E4:E${rr - 1})` }].forEach((v, j) => {
    const c = totRow.getCell(j + 1); c.value = typeof v === 'string' ? v : { formula: v.f };
    c.font = { name: _XL_FONTE, size: 11.5, bold: true, color: { argb: _XL_AZUL } }; c.fill = _xlFill('FFEAF0FC'); c.border = { top: { style: 'medium', color: { argb: _XL_AZUL } } };
    c.alignment = { vertical: 'middle', horizontal: j === 0 ? 'left' : 'right', indent: j === 0 ? 1 : 0 }; if (j >= 2) c.numFmt = '#,##0.00 "€"';
  });
  rs.pageSetup = { orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const al = document.createElement('a'); al.href = url; al.download = `Plandese_${nome}_${hojeIso}.xlsx`; al.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Excel gerado ✓');
}

// Descarrega num ZIP (abre no WinRAR) os ficheiros das faturas do filtro atual
const nomeSeguro = t => String(t || '').replace(/[\/:*?"<>|]+/g, '_').trim();
async function descarregarZip(btn) {
  const lista = filtrar().filter(r => r.dropbox_path);
  if (!lista.length) { toast('Sem ficheiros de faturas neste filtro'); return; }
  const cc = document.getElementById('tes-cc')?.value;
  const nomeCc = cc === '__sem__' ? 'Sem centro de custo' : cc;
  const txt = btn.textContent; btn.disabled = true;
  try {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    const usados = new Set();
    let falhas = 0;
    for (let i = 0; i < lista.length; i++) {
      btn.textContent = `A preparar… ${i + 1}/${lista.length}`;
      const r = lista[i];
      try {
        const blob = await dropboxDownload(r.dropbox_path);
        const orig = r.dropbox_path.split('/').pop();
        let nome = `${nomeSeguro(r.fornecedor)}/${nomeSeguro(orig)}`;
        for (let n = 2; usados.has(nome.toLowerCase()); n++) nome = `${nomeSeguro(r.fornecedor)}/${n}_${nomeSeguro(orig)}`;
        usados.add(nome.toLowerCase());
        zip.file(nome, blob);
      } catch (e) { console.warn('ZIP faturas:', r.dropbox_path, e); falhas++; }
    }
    if (falhas === lista.length) { toast('Não foi possível obter os ficheiros da Dropbox'); return; }
    btn.textContent = 'A compactar…';
    const out = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(out);
    const al = document.createElement('a'); al.href = url; al.download = `Faturas_${nomeSeguro(nomeCc)}_${hoje()}.zip`; al.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`ZIP gerado ✓ (${lista.length - falhas} faturas${falhas ? `, ${falhas} sem ficheiro` : ''})`);
  } catch (e) { console.error(e); toast('Erro ao gerar o ZIP'); }
  finally { btn.disabled = false; btn.textContent = txt; }
}

// Administrador escolhe quem pode propor pagamentos
function abrirQuemPropoe() {
  const users = Object.entries(S.USERS || {})
    .filter(([, u]) => u && u.role && !['admin', 'encarregado'].includes(u.role))
    .sort((a, b) => (a[1].nome || a[0]).localeCompare(b[1].nome || b[0], 'pt'));
  const antigo = document.getElementById('modal-tes-prop'); if (antigo) antigo.remove();
  const el = document.createElement('div');
  el.className = 'modal-bg open'; el.id = 'modal-tes-prop';
  el.innerHTML = `<div class="modal" style="width:460px">
    <div class="modal-title">Quem pode propor pagamentos</div>
    <div class="modal-sub">Os administradores podem sempre propor e marcar como pago. Escolha os restantes utilizadores que podem propor faturas a pagamento.</div>
    <div class="tes-quem">${users.length ? users.map(([k, u]) => `<label class="tes-quem-i"><input type="checkbox" value="${esc(k)}"${_proponentes.includes(k) ? ' checked' : ''}/> <span>${esc(u.nome || k)}</span> <small>${esc(u.role)}</small></label>`).join('') : '<div class="mut">Sem utilizadores disponíveis.</div>'}</div>
    <div class="modal-footer"><button class="btn btn-secondary" data-tes-quem="x">Cancelar</button><button class="btn btn-primary" data-tes-quem="ok">Guardar</button></div>
  </div>`;
  document.body.appendChild(el);
}

async function guardarQuemPropoe() {
  const el = document.getElementById('modal-tes-prop'); if (!el) return;
  const lista = [...el.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);
  const { error } = await sb.from('app_config').upsert({ key: 'tesouraria_proponentes', value: lista, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) { toast('Não foi possível guardar: ' + (error.message || error)); return; }
  _proponentes = lista;
  el.remove();
  toast('Lista de quem pode propor pagamentos guardada');
}

document.addEventListener('click', e => {
  const q = e.target.closest('[data-tes-quem]');
  if (q) { if (q.dataset.tesQuem === 'ok') guardarQuemPropoe(); else document.getElementById('modal-tes-prop')?.remove(); return; }

  const a = e.target.closest('[data-tes-act]');
  if (a) {
    const act = a.dataset.tesAct;
    if (act === 'propor') propor(true);
    else if (act === 'retirar') propor(false);
    else if (act === 'pago') marcarPago();
    else if (act === 'limpar') { _sel.clear(); desenhar(); }
    else if (act === 'exportar') exportar(_rows.filter(r => _sel.has(r.id)), 'faturas_selecionadas');
    else if (act === 'exportar-prop') exportar(_rows, 'tesouraria');
    else if (act === 'zip') descarregarZip(a);
    else if (act === 'quem') abrirQuemPropoe();
    return;
  }

  const c = e.target.closest('[data-tes-chip]');
  if (c) { _estado = c.dataset.tesChip; desenhar(); return; }

  // seleção: não abre o detalhe da fatura
  const ck = e.target.closest('[data-tes-ck]');
  if (ck) {
    const id = Number(ck.dataset.tesCk);
    if (ck.checked) _sel.add(id); else _sel.delete(id);
    desenhar();
    return;
  }
  const ckg = e.target.closest('[data-tes-ckg]');
  if (ckg) {
    const k = ckg.dataset.tesCkg;
    _rows.filter(r => (r.fornecedor || '').trim() === k && porPagar(r) && filtrar().includes(r))
      .forEach(r => { if (ckg.checked) _sel.add(r.id); else _sel.delete(r.id); });
    desenhar();
    return;
  }
  if (e.target.closest('.tes-ck')) return;

  const r = e.target.closest('tr[data-tes-id]');
  if (r) abrirFaturaPorDbId(Number(r.dataset.tesId));
});
document.addEventListener('input', e => { if (e.target.id === 'tes-q') desenhar(); });
document.addEventListener('change', e => { if (e.target.id === 'tes-cc') desenhar(); });
