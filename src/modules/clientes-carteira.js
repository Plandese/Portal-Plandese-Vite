// ═══════════════════════════════════════════════════════════════════
//  CLIENTES — Balanço de faturação e Carteira de encomendas
//  Páginas RESTRITAS ao perfil administrador: o acesso é recusado na interface
//  (permissions.js) e no servidor (RLS das tabelas carteira_encomendas / carteira_faturacao).
//  O «mês» do balanço é o mês de trabalho faturado; a data de emissão costuma cair no mês seguinte.
// ═══════════════════════════════════════════════════════════════════
import { sb } from '../supabase.js';

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const eur = v => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const dmy = iso => { const d = new Date(iso + 'T12:00:00'); return isNaN(d) ? '' : d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }); };
const num = v => Number(v) || 0;

let _enc = [];
let _fat = [];
let _abertos = new Set();   // meses expandidos no balanço

async function carregar() {
  const [e, f] = await Promise.all([
    sb.from('carteira_encomendas').select('*').order('ano').order('cc'),
    sb.from('carteira_faturacao').select('*').order('data_emissao').order('id'),
  ]);
  if (e.error) throw e.error;
  if (f.error) throw f.error;
  _enc = e.data || [];
  _fat = f.data || [];
}

// CC → nome da empreitada / cliente (só as que estão na carteira)
function nomesCC() {
  const m = {};
  _enc.forEach(r => { if (r.cc) m[r.cc] = { obra: r.empreitada, cliente: r.cliente }; });
  return m;
}

function erroHTML(err) {
  return `<div class="cc-vazio">Não foi possível carregar os dados${err?.message ? ' (' + esc(err.message) + ')' : ''}.</div>`;
}

// ───────────────────────── Balanço de faturação ─────────────────────────
export async function renderBalancoFat() {
  const el = document.getElementById('balfat-body');
  if (!el) return;
  el.innerHTML = '<div class="cc-vazio">A carregar…</div>';
  try { await carregar(); } catch (err) { el.innerHTML = erroHTML(err); return; }
  if (!_fat.length) { el.innerHTML = '<div class="cc-vazio">Sem faturação registada.</div>'; return; }

  const nomes = nomesCC();
  const nomeCC = cc => nomes[cc]?.obra || '';
  const totS = _fat.reduce((s, r) => s + num(r.montante_sem_iva), 0);
  const totC = _fat.reduce((s, r) => s + num(r.montante_com_iva), 0);
  const porMes = new Map();
  _fat.forEach(r => { (porMes.get(r.mes) || porMes.set(r.mes, []).get(r.mes)).push(r); });
  const meses = [...porMes.keys()].sort((a, b) => a - b);
  const somaMes = m => porMes.get(m).reduce((s, r) => s + num(r.montante_sem_iva), 0);
  const maxMes = Math.max(...meses.map(somaMes));
  const ano = _fat[0].ano;

  // por centro de custo
  const porCC = new Map();
  _fat.forEach(r => { const o = porCC.get(r.cc) || { s: 0, c: 0, n: 0 }; o.s += num(r.montante_sem_iva); o.c += num(r.montante_com_iva); o.n++; porCC.set(r.cc, o); });
  const ccs = [...porCC.entries()].sort((a, b) => b[1].s - a[1].s);

  const kpis = `
    <div class="cc-kpis">
      <div class="cc-kpi"><span>Faturado ${ano} (s/ IVA)</span><b>${eur(totS)}</b></div>
      <div class="cc-kpi"><span>Faturado ${ano} (c/ IVA)</span><b>${eur(totC)}</b></div>
      <div class="cc-kpi"><span>Média mensal (s/ IVA)</span><b>${eur(totS / meses.length)}</b></div>
      <div class="cc-kpi"><span>Faturas emitidas</span><b>${_fat.length}</b></div>
    </div>`;

  const linhasMes = meses.map(m => {
    const rows = porMes.get(m);
    const s = somaMes(m), c = rows.reduce((x, r) => x + num(r.montante_com_iva), 0);
    const aberto = _abertos.has(m);
    const det = aberto ? `
      <tr class="cc-det"><td colspan="5"><table class="cc-sub">
        <thead><tr><th>CC</th><th>Empreitada</th><th class="r">Montante s/ IVA</th><th class="r">Montante c/ IVA</th><th>Data de emissão</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${esc(r.cc)}</td><td>${esc(nomeCC(r.cc)) || '<span class="cc-mute">—</span>'}</td><td class="r">${eur(r.montante_sem_iva)}</td><td class="r">${eur(r.montante_com_iva)}</td><td>${dmy(r.data_emissao)}</td></tr>`).join('')}</tbody>
      </table></td></tr>` : '';
    return `<tr class="cc-mes${aberto ? ' open' : ''}" data-m="${m}">
        <td><span class="cc-chev">›</span> <b>${MESES[m - 1]}</b></td>
        <td class="r">${rows.length}</td>
        <td class="cc-barra"><i style="width:${Math.max(2, Math.round(s / maxMes * 100))}%"></i></td>
        <td class="r"><b>${eur(s)}</b></td>
        <td class="r">${eur(c)}</td>
      </tr>${det}`;
  }).join('');

  const tabMes = `
    <div class="card cc-card">
      <div class="cc-tit">Faturação por mês <span class="cc-mute">· clique num mês para ver as faturas</span></div>
      <table class="cc-tab">
        <thead><tr><th>Mês</th><th class="r">Faturas</th><th></th><th class="r">Montante s/ IVA</th><th class="r">Montante c/ IVA</th></tr></thead>
        <tbody>${linhasMes}</tbody>
        <tfoot><tr><td colspan="3"><b>Total</b></td><td class="r"><b>${eur(totS)}</b></td><td class="r"><b>${eur(totC)}</b></td></tr></tfoot>
      </table>
    </div>`;

  const tabCC = `
    <div class="card cc-card">
      <div class="cc-tit">Por centro de custo</div>
      <table class="cc-tab">
        <thead><tr><th>CC</th><th>Empreitada</th><th class="r">Faturas</th><th class="r">Montante s/ IVA</th><th class="r">Montante c/ IVA</th></tr></thead>
        <tbody>${ccs.map(([cc, o]) => `<tr><td>${esc(cc)}</td><td>${esc(nomeCC(cc)) || '<span class="cc-mute">—</span>'}</td><td class="r">${o.n}</td><td class="r">${eur(o.s)}</td><td class="r">${eur(o.c)}</td></tr>`).join('')}</tbody>
      </table>
    </div>`;

  el.innerHTML = kpis + tabMes + tabCC;
  el.querySelectorAll('tr.cc-mes').forEach(tr => tr.addEventListener('click', () => {
    const m = Number(tr.dataset.m);
    _abertos.has(m) ? _abertos.delete(m) : _abertos.add(m);
    renderBalancoFat();
  }));
}

// ───────────────────────── Carteira de encomendas ─────────────────────────
export async function renderCarteira() {
  const el = document.getElementById('carteira-body');
  if (!el) return;
  el.innerHTML = '<div class="cc-vazio">A carregar…</div>';
  try { await carregar(); } catch (err) { el.innerHTML = erroHTML(err); return; }
  if (!_enc.length) { el.innerHTML = '<div class="cc-vazio">Sem encomendas em carteira.</div>'; return; }

  const tot = _enc.reduce((s, r) => s + num(r.valor_sem_iva), 0);
  const prazoMax = Math.max(...(_enc.map(r => num(r.prazo_meses))));
  const maior = _enc.reduce((a, b) => num(b.valor_sem_iva) > num(a.valor_sem_iva) ? b : a);

  const kpis = `
    <div class="cc-kpis">
      <div class="cc-kpi"><span>Carteira total (s/ IVA)</span><b>${eur(tot)}</b></div>
      <div class="cc-kpi"><span>Empreitadas em carteira</span><b>${_enc.length}</b></div>
      <div class="cc-kpi"><span>Maior empreitada</span><b>${esc(maior.empreitada)}</b><em>${eur(maior.valor_sem_iva)}</em></div>
      <div class="cc-kpi"><span>Prazo mais longo</span><b>${String(prazoMax).replace('.', ',')} meses</b></div>
    </div>`;

  const linhas = _enc.map(r => `<tr>
      <td>${r.ano}</td>
      <td>${esc(r.cc) || '<span class="cc-mute">—</span>'}</td>
      <td><b>${esc(r.empreitada)}</b></td>
      <td>${esc(r.cliente)}</td>
      <td class="r"><b>${eur(r.valor_sem_iva)}</b></td>
      <td class="r">${r.prazo_meses == null ? '—' : String(Number(r.prazo_meses)).replace('.', ',')}</td>
    </tr>`).join('');

  el.innerHTML = kpis + `
    <div class="card cc-card">
      <table class="cc-tab">
        <thead><tr><th>Ano</th><th>CC</th><th>Empreitada</th><th>Cliente</th><th class="r">Valor (s/ IVA)</th><th class="r">Prazo (meses)</th></tr></thead>
        <tbody>${linhas}</tbody>
        <tfoot><tr><td colspan="4"><b>Total</b></td><td class="r"><b>${eur(tot)}</b></td><td></td></tr></tfoot>
      </table>
    </div>
    <div class="cc-nota">Valor por faturar de cada empreitada (sem IVA), conforme o mapa da carteira de encomendas.</div>`;
}
