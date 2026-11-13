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
let _obras = [];
let _abertos = new Set();   // meses expandidos no balanço

// Obras do portal: o nome começa pelo código «O0NN»; o CC é 93000 + NN (os 2 últimos dígitos são o nº da obra)
const codObra = nome => (/^O(\d{3})\b/.exec(nome || '') || [])[1] || '';
function obraDoCC(cc) {
  const m = /^\d{5,}(\d{2})$/.exec(String(cc || '').trim());
  if (!m) return null;
  return _obras.find(o => codObra(o.nome) === '0' + m[1]) || null;
}
const nomeObra = o => String(o.nome).replace(/^O\d{3}\s*-\s*/, '');

async function carregar() {
  const [e, f, o] = await Promise.all([
    sb.from('carteira_encomendas').select('*').order('ano').order('cc'),
    sb.from('carteira_faturacao').select('*').order('data_emissao').order('id'),
    sb.from('obras').select('id,nome,ativa'),
  ]);
  if (e.error) throw e.error;
  if (f.error) throw f.error;
  _enc = e.data || [];
  _fat = f.data || [];
  _obras = o.data || [];
}

// CC → nome da empreitada / cliente (só as que estão na carteira)
function nomesCC() {
  const m = {};
  _enc.forEach(r => { if (r.cc) m[r.cc] = { obra: r.empreitada, cliente: r.cliente }; });
  return new Proxy(m, { get: (t, cc) => { const o = typeof cc === 'string' ? obraDoCC(cc) : null; return o ? { obra: nomeObra(o) } : t[cc]; } });
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
  const barra = '<div class="cc-barra-top"><button type="button" class="cc-btn" id="cc-add">+ Adicionar faturação</button></div>';
  if (!_fat.length) {
    el.innerHTML = barra + '<div class="cc-vazio">Sem faturação registada.</div>';
    el.querySelector('#cc-add').onclick = () => abrirFormFat();
    return;
  }

  const nomes = nomesCC();
  const nomeCC = cc => nomes[cc]?.obra || '';
  const anoAtual = Math.max(..._fat.map(r => r.ano));
  const fatAno = _fat.filter(r => r.ano === anoAtual);
  const totS = fatAno.reduce((s, r) => s + num(r.montante_sem_iva), 0);
  const totC = fatAno.reduce((s, r) => s + num(r.montante_com_iva), 0);
  const porMes = new Map();
  fatAno.forEach(r => { (porMes.get(r.mes) || porMes.set(r.mes, []).get(r.mes)).push(r); });
  const meses = [...porMes.keys()].sort((a, b) => a - b);
  const somaMes = m => porMes.get(m).reduce((s, r) => s + num(r.montante_sem_iva), 0);
  const maxMes = Math.max(...meses.map(somaMes));
  const ano = anoAtual;

  // por centro de custo
  const porCC = new Map();
  fatAno.forEach(r => { const o = porCC.get(r.cc) || { s: 0, c: 0, n: 0 }; o.s += num(r.montante_sem_iva); o.c += num(r.montante_com_iva); o.n++; porCC.set(r.cc, o); });
  const ccs = [...porCC.entries()].sort((a, b) => b[1].s - a[1].s);

  const kpis = `
    <div class="cc-kpis">
      <div class="cc-kpi"><span>Faturado ${ano} (s/ IVA)</span><b>${eur(totS)}</b></div>
      <div class="cc-kpi"><span>Faturado ${ano} (c/ IVA)</span><b>${eur(totC)}</b></div>
      <div class="cc-kpi"><span>Média mensal (s/ IVA)</span><b>${eur(totS / meses.length)}</b></div>
      <div class="cc-kpi"><span>Faturas emitidas</span><b>${fatAno.length}</b></div>
    </div>`;

  const linhasMes = meses.map(m => {
    const rows = porMes.get(m);
    const s = somaMes(m), c = rows.reduce((x, r) => x + num(r.montante_com_iva), 0);
    const aberto = _abertos.has(m);
    const det = aberto ? `
      <tr class="cc-det"><td colspan="5"><table class="cc-sub">
        <thead><tr><th>CC</th><th>Empreitada</th><th class="r">Montante s/ IVA</th><th class="r">Montante c/ IVA</th><th>Data de emissão</th><th></th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${esc(r.cc)}</td><td>${esc(nomeCC(r.cc)) || '<span class="cc-mute">—</span>'}</td><td class="r">${eur(r.montante_sem_iva)}</td><td class="r">${eur(r.montante_com_iva)}</td><td>${dmy(r.data_emissao)}</td><td class="r"><button type="button" class="cc-del" data-del="${r.id}" title="Apagar fatura">Apagar</button></td></tr>`).join('')}</tbody>
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

  el.innerHTML = barra + kpis + tabMes + tabCC;
  el.querySelector('#cc-add').onclick = () => abrirFormFat();
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); apagarFat(Number(b.dataset.del)); }));
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


// ───────────────────────── Adicionar / apagar faturação ─────────────────────────
async function apagarFat(id) {
  const r = _fat.find(x => x.id === id);
  if (!r || !confirm(`Apagar a fatura de ${eur(r.montante_sem_iva)} (CC ${r.cc}, ${dmy(r.data_emissao)})? Não pode ser desfeito.`)) return;
  const { error } = await sb.from('carteira_faturacao').delete().eq('id', id);
  if (error) { alert('Não foi possível apagar: ' + error.message); return; }
  renderBalancoFat();
}

function abrirFormFat() {
  document.getElementById('cc-modal')?.remove();
  const hoje = new Date();
  const iso = d => d.toISOString().slice(0, 10);
  const mesDef = hoje.getMonth() === 0 ? 12 : hoje.getMonth();   // mês de trabalho: normalmente o anterior à emissão
  const obrasCC = _obras.filter(o => codObra(o.nome))
    .sort((a, b) => codObra(b.nome).localeCompare(codObra(a.nome)));
  const dl = obrasCC.map(o => `<option value="93000${codObra(o.nome).slice(1)}" label="${esc(nomeObra(o))}"></option>`).join('')
    + ['SEM CC', 'VENDAP', 'AMBIAGUA'].map(v => `<option value="${v}"></option>`).join('');
  const w = document.createElement('div');
  w.id = 'cc-modal'; w.className = 'cc-ov';
  w.innerHTML = `
    <div class="cc-fol" role="dialog" aria-label="Adicionar faturação">
      <div class="cc-fol-h"><b>Adicionar faturação</b><span>Fatura emitida a um cliente</span></div>
      <div class="cc-fol-b">
        <label class="cc-f"><span>Centro de custo</span>
          <input id="ccf-cc" list="ccf-dl" autocomplete="off" placeholder="ex.: 9300065"/>
          <datalist id="ccf-dl">${dl}</datalist>
          <small id="ccf-obra" class="cc-f-dica">Os 2 últimos dígitos são o nº da obra.</small></label>
        <label class="cc-f"><span>Mês de trabalho</span>
          <select id="ccf-mes">${MESES.map((m, i) => `<option value="${i + 1}"${i + 1 === mesDef ? ' selected' : ''}>${m}</option>`).join('')}</select></label>
        <div class="cc-f2">
          <label class="cc-f"><span>Montante s/ IVA (€)</span><input id="ccf-s" inputmode="decimal" placeholder="0,00"/></label>
          <label class="cc-f"><span>Montante c/ IVA (€)</span><input id="ccf-c" inputmode="decimal" placeholder="igual ao s/ IVA"/></label>
        </div>
        <div class="cc-iva"><span>IVA:</span><button type="button" data-iva="0">Sem IVA</button><button type="button" data-iva="6">6%</button><button type="button" data-iva="23">23%</button></div>
        <label class="cc-f"><span>Data de emissão</span><input id="ccf-d" type="date" value="${iso(hoje)}"/></label>
        <div id="ccf-err" class="cc-erro" hidden></div>
      </div>
      <div class="cc-fol-f"><button type="button" class="cc-btn cc-btn-sec" id="ccf-x">Cancelar</button><button type="button" class="cc-btn" id="ccf-ok">Guardar</button></div>
    </div>`;
  document.body.appendChild(w);
  const $ = id => w.querySelector('#' + id);
  const fechar = () => w.remove();
  const valor = t => { const n = parseFloat(String(t).replace(/\s/g, '').replace(/\./g, '').replace(',', '.')); return isNaN(n) ? null : Math.round(n * 100) / 100; };
  const dica = () => {
    const cc = $('ccf-cc').value.trim(), o = obraDoCC(cc);
    $('ccf-obra').textContent = o ? 'Obra: ' + o.nome : (/^\d{7}$/.test(cc) ? 'Não há nenhuma obra no portal com este número.' : 'Os 2 últimos dígitos são o nº da obra.');
    $('ccf-obra').classList.toggle('ok', !!o);
  };
  $('ccf-cc').addEventListener('input', dica);
  w.querySelectorAll('[data-iva]').forEach(b => b.addEventListener('click', () => {
    const s = valor($('ccf-s').value); if (s == null) return;
    $('ccf-c').value = (Math.round(s * (1 + Number(b.dataset.iva) / 100) * 100) / 100).toFixed(2).replace('.', ',');
  }));
  w.addEventListener('mousedown', e => { if (e.target === w) fechar(); });
  $('ccf-x').onclick = fechar;
  $('ccf-ok').onclick = async () => {
    const cc = $('ccf-cc').value.trim(), s = valor($('ccf-s').value), d = $('ccf-d').value, mes = Number($('ccf-mes').value);
    const c = $('ccf-c').value.trim() === '' ? s : valor($('ccf-c').value);
    const err = !cc ? 'Indica o centro de custo.' : s == null || s <= 0 ? 'Indica o montante sem IVA.' : c == null ? 'Montante com IVA inválido.' : !d ? 'Indica a data de emissão.' : '';
    if (err) { $('ccf-err').textContent = err; $('ccf-err').hidden = false; return; }
    const dt = new Date(d + 'T12:00:00');
    const ano = mes > dt.getMonth() + 1 ? dt.getFullYear() - 1 : dt.getFullYear();
    $('ccf-ok').disabled = true;
    const { error } = await sb.from('carteira_faturacao').insert({ ano, mes, cc, montante_sem_iva: s, montante_com_iva: c, data_emissao: d });
    if (error) { $('ccf-err').textContent = 'Não foi possível guardar: ' + error.message; $('ccf-err').hidden = false; $('ccf-ok').disabled = false; return; }
    fechar();
    _abertos.add(mes);
    renderBalancoFat();
  };
  $('ccf-cc').focus();
}
