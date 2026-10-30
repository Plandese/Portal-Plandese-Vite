// ═══════════════════════════════════════════════════════════════════
//  GUIAS DE REMESSA (escritório) — as guias fotografadas pelos encarregados chegam aqui já em PDF
//  (pasta «Guias» da Dropbox). Quem trata das faturas abre o PDF e casa cada guia com a fatura do fornecedor.
//  Uma fatura pode ter várias guias. O casamento é manual: o encarregado só fotografa.
// ═══════════════════════════════════════════════════════════════════
import { S } from '../state.js';
import { sb } from '../supabase.js';
import { fmtPT } from '../utils/helpers.js';
import { dropboxDownload } from './dropbox.js';

let _rows = [];            // guias_remessa
let _fat = new Map();      // id → fatura (só as já casadas)
let _tab = 'por_casar';    // por_casar | casadas | todas
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
    .select('id,numero,fornecedor,obra_nome,paginas,pdf_path,fotos,foto_path,criado_por,criado_em,fatura_id,casada_em')
    .order('criado_em', { ascending: false }).limit(1000);
  if (error) throw error;
  _rows = data || [];
  const ids = [...new Set(_rows.map(g => g.fatura_id).filter(Boolean))];
  _fat = new Map();
  if (ids.length) {
    const { data: fs } = await sb.from('faturas').select('id,numero,fornecedor,total,data').in('id', ids);
    (fs || []).forEach(f => _fat.set(f.id, f));
  }
}

function filtrar() {
  const q = _q.trim().toLowerCase();
  return _rows.filter(g => {
    if (_tab === 'por_casar' && casada(g)) return false;
    if (_tab === 'casadas' && !casada(g)) return false;
    if (q) {
      const f = _fat.get(g.fatura_id);
      const txt = `${g.numero || ''} ${g.obra_nome || ''} ${nomeDe(g.criado_por)} ${f?.numero || ''} ${f?.fornecedor || ''}`.toLowerCase();
      if (!txt.includes(q)) return false;
    }
    return true;
  });
}

function desenhar() {
  const chips = document.getElementById('gre-chips');
  if (chips) {
    const por = _rows.filter(g => !casada(g)), cas = _rows.filter(casada);
    chips.innerHTML = [['por_casar', 'Por casar', por], ['casadas', 'Casadas', cas], ['todas', 'Todas', _rows]]
      .map(([k, l, a]) => `<button type="button" class="d-chip-f${_tab === k ? ' on' : ''}" data-gre-tab="${k}">${l}<b>${a.length}</b></button>`).join('');
  }
  const box = document.getElementById('gre-mapa'); if (!box) return;
  const lista = filtrar();
  if (!lista.length) { box.innerHTML = '<div class="d-empty" style="border:0">Sem guias para mostrar.</div>'; return; }
  box.innerHTML = `<div class="tbl-wrap"><table class="cmp-t">
    <thead><tr><th>Enviada em</th><th>Enviada por</th><th>Obra</th><th>Págs.</th><th>Nº da guia</th><th>Fatura</th><th></th></tr></thead>
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
        <td>${esc(dataHora(g.criado_em))}</td>
        <td>${esc(nomeDe(g.criado_por))}</td>
        <td>${g.obra_nome ? esc(g.obra_nome) : '<span class="mut">—</span>'}</td>
        <td>${g.paginas || 1}</td>
        <td>${g.numero ? '<b>' + esc(g.numero) + '</b>' : '<span class="mut">—</span>'}</td>
        <td>${fat}</td>
        <td style="white-space:nowrap;display:flex;gap:6px;justify-content:flex-end">${pdf}${acao}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

// ── Fotografias ──────────────────────────────────────────────────
async function verFotos(id) {
  const g = _rows.find(x => x.id === id); if (!g) return;
  const caminhos = (Array.isArray(g.fotos) && g.fotos.length ? g.fotos : [g.foto_path]).filter(Boolean);
  document.getElementById('modal-gre-fotos')?.remove();
  const el = document.createElement('div');
  el.className = 'modal-bg open'; el.id = 'modal-gre-fotos'; el.dataset.guia = id;
  el.innerHTML = `<div class="modal" style="width:min(760px,96vw);max-height:94vh;display:flex;flex-direction:column">
    <div class="modal-title">Guia${g.numero ? ' ' + esc(g.numero) : ''}</div>
    <div class="modal-sub">Enviada por ${esc(nomeDe(g.criado_por))} em ${esc(dataHora(g.criado_em))}${g.obra_nome ? ' · ' + esc(g.obra_nome) : ''}</div>
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
    .select('id,numero,fornecedor,data,total,status')
    .order('data', { ascending: false, nullsFirst: false }).limit(1500);
  if (error) throw error;
  _faturas = data || [];
  return _faturas;
}

function desenharFaturas(modal, guiaId) {
  const q = modal.querySelector('#gre-fq').value.trim().toLowerCase();
  const l = (_faturas || []).filter(f => !q || `${f.fornecedor || ''} ${f.numero || ''}`.toLowerCase().includes(q)).slice(0, 60);
  modal.querySelector('#gre-flista').innerHTML = l.length
    ? l.map(f => `<button type="button" class="gre-f" data-gre-esc="${f.id}" style="display:flex;justify-content:space-between;gap:12px;width:100%;padding:10px 12px;border:0;border-bottom:1px solid #eef1f6;background:#fff;font-family:inherit;text-align:left;cursor:pointer">
        <span><b style="font-size:13px">${esc(f.fornecedor || 'Sem fornecedor')}</b><br><small style="color:#6a7284">${esc(f.numero || '—')} · ${f.data ? esc(fmtPT(f.data)) : 'sem data'}</small></span>
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
  const { error } = await sb.from('guias_remessa').update(upd).eq('id', guiaId);
  if (error) { toast('Não foi possível casar: ' + (error.message || error)); return; }
  modal?.remove();
  toast('Guia casada com a fatura ✓');
  await carregar(); desenhar();
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
    const t = e.target.closest('[data-gre-tab],[data-gre-pdf],[data-gre-gerar],[data-gre-casar],[data-gre-desf],[data-gre-ver]');
    if (!t) return;
    if (t.dataset.greTab) { _tab = t.dataset.greTab; desenhar(); }
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
  const fm = document.getElementById('modal-gre-fotos');
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
