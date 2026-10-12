// ═══════════════════════════════════════════════════════════════════
//  TESOURARIA — mapa das faturas aprovadas (já com centro de custo), organizado por centro de custo
//  Colunas: Centro de custo · Fornecedor · Fatura · Valor com IVA · Vencimento · Estado
//  Propostas de pagamento: quem pode (administrador + lista em app_config) seleciona faturas e propõe-nas;
//  as propostas ficam a amarelo. Só o administrador marca como paga (em lote).
// ═══════════════════════════════════════════════════════════════════
import { S } from '../state.js';
import { sb } from '../supabase.js';
import { fmtPT } from '../utils/helpers.js';
import { abrirFaturaPorDbId } from './faturas.js';

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
    .select('id,fornecedor,nif,numero,total,data,data_pag,status,centro_custo,proposta_por,proposta_em,pago_por,pago_em')
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
      + (_podePropor || ehAdmin() ? '<button type="button" class="btn btn-secondary btn-sm" data-tes-act="exportar-prop">Exportar propostas</button>' : '');
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

  // agrupa por centro de custo (ordem alfabética; "sem centro de custo" no fim)
  const grupos = new Map();
  lista.forEach(r => { const k = r.centro_custo || ''; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(r); });
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
        <td class="tes-cc">${k ? esc(k) : '<span class="mut">Sem centro de custo</span>'}</td>
        <td>${esc(r.fornecedor || '—')}</td>
        <td><b>${esc(r.numero || '—')}</b></td>
        <td class="r"><b>${eur(r.total)}</b></td>
        <td class="${vencida ? 'tes-venc' : ''}">${r.data_pag ? fmtPT(r.data_pag) : '<span class="mut">—</span>'}${vencida ? ' <small>vencida</small>' : ''}</td>
        <td>${estado}</td>
      </tr>`;
    }).join('');
    const ckG = podeSel ? `<td class="tes-ck">${elegiveis.length ? `<input type="checkbox" data-tes-ckg="${esc(k)}"${todas ? ' checked' : ''} aria-label="Selecionar todas as faturas deste centro de custo"/>` : ''}</td>` : '';
    return `<tbody class="tes-grp"><tr class="tes-gh">${ckG}<td colspan="3">${k ? esc(k) : 'Sem centro de custo'} <small>${rs.length} fatura${rs.length === 1 ? '' : 's'}</small></td><td class="r"><b>${eur(sub)}</b></td><td colspan="2"></td></tr>${linhas}</tbody>`;
  }).join('');

  const colsAntes = podeSel ? 4 : 3;
  box.innerHTML = `<div class="tbl-wrap"><table class="cmp-t tes-t">
    <thead><tr>${podeSel ? '<th class="tes-ck"></th>' : ''}<th>Centro de custo</th><th>Fornecedor</th><th>Fatura</th><th class="r">Valor com IVA</th><th>Vencimento</th><th>Estado</th></tr></thead>
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

function exportar(linhas, nome) {
  const X = window.XLSX;
  if (!X) { toast('Exportação indisponível'); return; }
  if (!linhas.length) { toast('Sem propostas para exportar'); return; }
  const dados = linhas
    .slice().sort((a, b) => (a.centro_custo || '').localeCompare(b.centro_custo || '', 'pt') || (a.data_pag || '').localeCompare(b.data_pag || ''))
    .map(r => ({
      'Centro de custo': r.centro_custo || '', 'Fornecedor': r.fornecedor || '', 'NIF': r.nif || '', 'Fatura': r.numero || '',
      'Data': r.data || '', 'Vencimento': r.data_pag || '', 'Total (€)': Number(r.total) || 0,
      'Proposta por': nomeDe(r.proposta_por), 'Proposta em': r.proposta_em ? new Date(r.proposta_em).toLocaleDateString('pt-PT') : '',
    }));
  dados.push({ 'Centro de custo': 'TOTAL', 'Total (€)': Math.round(dados.reduce((s, d) => s + d['Total (€)'], 0) * 100) / 100 });
  const ws = X.utils.json_to_sheet(dados);
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Propostas');
  X.writeFile(wb, `${nome}_${hoje()}.xlsx`);
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
    else if (act === 'exportar-prop') exportar(_rows.filter(proposta), 'propostas_pagamento');
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
    _rows.filter(r => (r.centro_custo || '') === k && porPagar(r) && filtrar().includes(r))
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
