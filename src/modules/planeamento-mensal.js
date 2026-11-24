// ═══════════════════════════════════════════════════════════════════
//  PLANEAMENTO MENSAL — tarefas de cada obra, mês a mês
//  • Portal (Produção → «Planeamento Mensal»): o diretor de obra monta a tabela Tarefa · Equipa · dias do mês
//    (cruz nos dias em que a tarefa se faz). Grava sozinho a cada alteração.
//  • App dos encarregados (ecrã «Planeamento mensal»): vê o plano das suas obras e marca cada tarefa como realizada.
//  Tabela planeamento_tarefas (RLS: o diretor edita as suas obras, o encarregado só lê);
//  o check passa pelo RPC fn_plan_marcar_feita, que guarda quem e quando.
// ═══════════════════════════════════════════════════════════════════
import { sb } from '../supabase.js';
import { S } from '../state.js';
import { MESES_PT, obraVisivelPara } from '../config.js';
import { showToast } from './navigation.js';

const TAB = 'planeamento_tarefas';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const DS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

// ── Datas (mês = 'AAAA-MM-01') ──
const mesDe = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
const mesAtual = () => mesDe(new Date());
const mesSomar = (m, n) => { const [y, mm] = m.split('-').map(Number); return mesDe(new Date(y, mm - 1 + n, 1)); };
const diasDoMes = m => { const [y, mm] = m.split('-').map(Number); return new Date(y, mm, 0).getDate(); };
const diaSem = (m, d) => { const [y, mm] = m.split('-').map(Number); return new Date(y, mm - 1, d).getDay(); };
const mesNome = m => { const [y, mm] = m.split('-').map(Number); return `${MESES_PT[mm - 1]} ${y}`; };
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dataDia = (m, d) => `${m.slice(0, 8)}${pad(d)}`;
const quando = iso => { const d = new Date(iso); return isNaN(d) ? '' : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const nomeUser = u => S.USERS?.[u]?.nome || u || '';
const nomeObra = id => (S.OBRAS || []).find(o => o.id === id)?.nome || id;

// «3–5, 10, 12–14»
function intervalos(dias) {
  const d = [...dias].sort((a, b) => a - b), out = [];
  for (let i = 0; i < d.length; i++) {
    let j = i; while (j + 1 < d.length && d[j + 1] === d[j] + 1) j++;
    out.push(j > i ? `${d[i]}–${d[j]}` : `${d[i]}`); i = j;
  }
  return out.join(', ');
}

// Estado de uma tarefa: feita | atraso (último dia já passou) | curso (começou) | plan
function estadoDe(t, mes) {
  if (t.feita_em) return 'feita';
  const d = [...(t.dias || [])].sort((a, b) => a - b);
  if (!d.length) return 'plan';
  const h = hoje();
  if (dataDia(mes, d[d.length - 1]) < h) return 'atraso';
  if (dataDia(mes, d[0]) <= h) return 'curso';
  return 'plan';
}
const EST = { feita: ['verde', 'Realizada'], atraso: ['verm', 'Em atraso'], curso: ['azul', 'Em curso'], plan: ['cinza', 'Planeada'] };
const pill = (cor, t) => `<span class="pm-pill ${cor}">${esc(t)}</span>`;

// ═══════════════════════════════════════════════════════════════════
//  PORTAL — página do diretor de obra
// ═══════════════════════════════════════════════════════════════════
let _obra = '';
let _mes = mesAtual();
let _rows = [];          // { k, id, ordem, tarefa, equipa, dias:[], feita_por, feita_em, obra, mes }
let _seq = 0;
let _apagarK = null, _apagarT = null;
let _pinta = null;       // arrastar o rato pelos dias: { k, on }

const u = () => S.currentUser || {};
const obrasPortal = () => (S.OBRAS || [])
  .filter(o => o.ativa !== false && (o.estado || 'em_curso') !== 'concluida' && obraVisivelPara(u(), S.OBRAS, o.id))
  .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt', { numeric: true }));
// Pode editar quem é diretor da obra (o perfil Administrador passa sempre) — o servidor decide o mesmo (fn_dir_da_obra)
function podeEditar(obraId) {
  if (u().role === 'admin') return true;
  const o = (S.OBRAS || []).find(x => x.id === obraId);
  return !!o && (o.diretor_id === u().key || (o.diretores_extra || []).includes(u().key));
}
const novaLinha = (r = {}) => ({ k: 'l' + (++_seq), id: r.id || null, ordem: r.ordem || 0, tarefa: r.tarefa || '', equipa: r.equipa || '',
  dias: (r.dias || []).map(Number), feita_por: r.feita_por || null, feita_em: r.feita_em || null, obra: r.obra_id || _obra, mes: r.mes || _mes });

async function carregarPortal() {
  _rows = [];
  if (!_obra) return;
  const { data, error } = await sb.from(TAB).select('*').eq('obra_id', _obra).eq('mes', _mes).order('ordem').order('id');
  if (error) { showToast('Não foi possível carregar o planeamento: ' + error.message); return; }
  _rows = (data || []).map(novaLinha);
}

export async function renderPlaneamentoMensal() {
  const root = $('pm-root'); if (!root) return;
  const obras = obrasPortal();
  if (!obras.some(o => o.id === _obra)) _obra = obras[0]?.id || '';
  root.innerHTML = `<div class="pm-vazio grande">A carregar…</div>`;
  await carregarPortal();
  desenharPortal();
}

function desenharPortal() {
  const root = $('pm-root'); if (!root) return;
  const obras = obrasPortal();
  const ed = podeEditar(_obra);
  const opts = obras.map(o => `<option value="${esc(o.id)}" ${o.id === _obra ? 'selected' : ''}>${esc(o.nome)}</option>`).join('');
  const head = `<div class="pm-head">
      <div><h1>Planeamento mensal</h1><p>Tarefas de cada obra ao longo do mês. Os encarregados veem o plano na app e marcam cada tarefa quando fica realizada.</p></div>
      <div class="pm-ctl">
        <label class="pm-sel"><span>Obra</span><select data-pm-obra ${obras.length ? '' : 'disabled'}>${opts || '<option>Sem obras atribuídas</option>'}</select></label>
        <div class="pm-mes"><button type="button" class="pm-ic" data-pm="mes" data-d="-1" title="Mês anterior" aria-label="Mês anterior">‹</button>
          <div><small>Mês</small><b>${esc(mesNome(_mes))}</b></div>
          <button type="button" class="pm-ic" data-pm="mes" data-d="1" title="Mês seguinte" aria-label="Mês seguinte">›</button></div>
      </div>
    </div>`;
  if (!_obra) { root.innerHTML = head + `<div class="pm-card"><div class="pm-vazio grande">Não tem obras atribuídas como diretor de obra.</div></div>`; return; }
  const n = diasDoMes(_mes), h = hoje();
  const ths = Array.from({ length: n }, (_, i) => {
    const d = i + 1, ws = diaSem(_mes, d);
    return `<th class="pm-d${ws === 0 || ws === 6 ? ' fds' : ''}${dataDia(_mes, d) === h ? ' hoje' : ''}"><small>${DS[ws]}</small>${d}</th>`;
  }).join('');
  const aviso = ed ? '' : `<div class="pm-aviso">Só o diretor desta obra pode alterar o planeamento. Está a ver em modo de consulta.</div>`;
  const copiar = ed && !_rows.length
    ? `<button type="button" class="pm-btn sec" data-pm="copiar">Copiar tarefas de ${esc(mesNome(mesSomar(_mes, -1)).toLowerCase())}</button>` : '';
  root.innerHTML = head + `<div id="pm-kpis" class="pm-kpis"></div>${aviso}
    <div class="pm-card${ed ? '' : ' so-ler'}">
      <div class="pm-scroll"><table class="pm-tab">
        <thead><tr><th class="pm-c-n">#</th><th class="pm-c-t">Tarefa</th><th class="pm-c-e">Equipa</th>${ths}<th class="pm-c-s">Estado</th>${ed ? '<th class="pm-c-x"></th>' : ''}</tr></thead>
        <tbody id="pm-tbody">${_rows.map((r, i) => linhaHTML(r, i, ed)).join('')}</tbody>
      </table>
      ${_rows.length ? '' : `<div class="pm-vazio" id="pm-vazio">Ainda não há tarefas em ${esc(mesNome(_mes).toLowerCase())}.${ed ? ' Adicione a primeira.' : ''}</div>`}</div>
      ${ed ? `<div class="pm-foot"><button type="button" class="pm-btn" data-pm="add">+ Adicionar tarefa</button>${copiar}<span class="pm-gravar" id="pm-gravar">As alterações gravam-se sozinhas.</span></div>` : ''}
    </div>`;
  kpis();
}

function linhaHTML(r, i, ed) {
  const n = diasDoMes(_mes), h = hoje();
  const dis = ed ? '' : ' disabled';
  const dias = Array.from({ length: n }, (_, j) => {
    const d = j + 1, ws = diaSem(_mes, d), on = r.dias.includes(d);
    return `<td class="pm-d${ws === 0 || ws === 6 ? ' fds' : ''}${dataDia(_mes, d) === h ? ' hoje' : ''}${on ? ' on' : ''}"><button type="button" data-pm="dia" data-dia="${d}"${dis} aria-pressed="${on}" aria-label="Dia ${d}">${on ? '×' : ''}</button></td>`;
  }).join('');
  return `<tr data-k="${r.k}">
    <td class="pm-c-n">${i + 1}</td>
    <td class="pm-c-t"><input data-pm-f="tarefa" value="${esc(r.tarefa)}" placeholder="Descreva a tarefa" maxlength="300"${dis}></td>
    <td class="pm-c-e"><input data-pm-f="equipa" value="${esc(r.equipa)}" placeholder="Equipa" maxlength="120"${dis}></td>
    ${dias}
    <td class="pm-c-s" data-pm-est>${estadoHTML(r, ed)}</td>
    ${ed ? `<td class="pm-c-x"><button type="button" class="pm-x" data-pm="del" title="Apagar tarefa" aria-label="Apagar tarefa">×</button></td>` : ''}
  </tr>`;
}

function estadoHTML(r, ed) {
  const e = estadoDe(r, r.mes);
  if (e === 'feita') return `${pill('verde', '✓ Realizada')}<small>${esc(nomeUser(r.feita_por))} · ${esc(quando(r.feita_em))}</small>${ed ? '<button type="button" class="pm-lnk" data-pm="desfazer">Desfazer</button>' : ''}`;
  return pill(...EST[e]);
}

function kpis() {
  const box = $('pm-kpis'); if (!box) return;
  const v = _rows.filter(r => r.id || r.tarefa.trim());
  const c = { feita: 0, atraso: 0, curso: 0, plan: 0 };
  v.forEach(r => { c[estadoDe(r, r.mes)]++; });
  const k = (cls, t, n, s) => `<div class="pm-kpi ${cls}"><small>${t}</small><b>${n}</b><span>${s}</span></div>`;
  box.innerHTML = k('azul', 'Tarefas', v.length, 'neste mês')
    + k('verde', 'Realizadas', c.feita, 'confirmadas pelo encarregado')
    + k('ambar', 'Por realizar', c.curso + c.plan, `${c.curso} em curso`)
    + k('verm', 'Em atraso', c.atraso, 'último dia já passou');
}

const linha = k => _rows.find(r => r.k === k);
function atualizarLinha(r) {
  const tr = document.querySelector(`#pm-tbody tr[data-k="${r.k}"]`); if (!tr) return;
  const est = tr.querySelector('[data-pm-est]'); if (est) est.innerHTML = estadoHTML(r, podeEditar(r.obra));
  kpis();
}

// ── Gravação (cada linha grava sozinha; uma de cada vez por linha) ──
function msgGravar(t, cls = '') { const el = $('pm-gravar'); if (el) { el.textContent = t; el.className = 'pm-gravar ' + cls; } }
function agendar(r, ms = 700) { clearTimeout(r._t); r._t = setTimeout(() => guardar(r), ms); }
async function guardar(r) {
  clearTimeout(r._t); r._t = null;
  if (r._a) { r._de_novo = true; return r._a; }
  const tarefa = r.tarefa.trim();
  if (!tarefa) { if (r.id) msgGravar('A tarefa precisa de uma descrição — esta alteração não foi gravada.', 'erro'); return; }
  r._a = (async () => {
    msgGravar('A gravar…');
    const dados = { tarefa, equipa: r.equipa.trim() || null, dias: [...r.dias].sort((a, b) => a - b) };
    const q = r.id
      ? sb.from(TAB).update(dados).eq('id', r.id)
      : sb.from(TAB).insert({ obra_id: r.obra, mes: r.mes, ordem: r.ordem, ...dados });
    const { data, error } = await q.select().single();
    if (error) { msgGravar('Não foi possível gravar: ' + error.message, 'erro'); showToast('Não foi possível gravar a tarefa.'); return; }
    r.id = data.id; r.feita_em = data.feita_em; r.feita_por = data.feita_por;
    msgGravar('Gravado ✓', 'ok');
  })();
  try { await r._a; } finally { r._a = null; if (r._de_novo) { r._de_novo = false; await guardar(r); } }
}
async function gravarPendentes() { await Promise.all(_rows.filter(r => r._t || r._a).map(guardar)); }

function marcarDia(r, dia, on) {
  const tem = r.dias.includes(dia);
  if (on === tem) return;
  r.dias = on ? [...r.dias, dia] : r.dias.filter(x => x !== dia);
  const b = document.querySelector(`#pm-tbody tr[data-k="${r.k}"] [data-dia="${dia}"]`);
  if (b) { b.textContent = on ? '×' : ''; b.setAttribute('aria-pressed', String(on)); b.parentElement.classList.toggle('on', on); }
}

async function mudar(fn) { await gravarPendentes(); fn(); await carregarPortal(); desenharPortal(); }

function adicionar() {
  const r = novaLinha({ ordem: (_rows.reduce((m, x) => Math.max(m, x.ordem || 0), 0) + 1) });
  _rows.push(r);
  $('pm-vazio')?.remove();
  document.querySelector('#pm-root [data-pm="copiar"]')?.remove();
  $('pm-tbody')?.insertAdjacentHTML('beforeend', linhaHTML(r, _rows.length - 1, true));
  document.querySelector(`#pm-tbody tr[data-k="${r.k}"] [data-pm-f="tarefa"]`)?.focus();
  kpis();
}

async function apagar(r) {
  if (!r.id) { _rows = _rows.filter(x => x !== r); desenharPortal(); return; }
  if (_apagarK !== r.k) {   // dois cliques seguidos (o confirm() nativo falha em alguns ecrãs)
    _apagarK = r.k; clearTimeout(_apagarT); _apagarT = setTimeout(() => { _apagarK = null; }, 4000);
    return showToast(`Clique outra vez no × para apagar «${r.tarefa.trim() || 'tarefa'}».`);
  }
  _apagarK = null; clearTimeout(r._t); r._t = null;
  const { data, error } = await sb.from(TAB).delete().eq('id', r.id).select('id');
  if (error || !data?.length) return showToast('Não foi possível apagar a tarefa.');
  _rows = _rows.filter(x => x !== r);
  desenharPortal();
  showToast('Tarefa apagada');
}

async function copiarMesAnterior() {
  const ant = mesSomar(_mes, -1);
  const { data, error } = await sb.from(TAB).select('tarefa,equipa,ordem').eq('obra_id', _obra).eq('mes', ant).order('ordem').order('id');
  if (error) return showToast('Não foi possível ler o mês anterior.');
  if (!data?.length) return showToast(`Não há tarefas em ${mesNome(ant).toLowerCase()}.`);
  const novas = data.map((t, i) => ({ obra_id: _obra, mes: _mes, ordem: i + 1, tarefa: t.tarefa, equipa: t.equipa, dias: [] }));
  const { error: e2 } = await sb.from(TAB).insert(novas);
  if (e2) return showToast('Não foi possível copiar: ' + e2.message);
  showToast(`${novas.length} tarefa${novas.length === 1 ? '' : 's'} copiada${novas.length === 1 ? '' : 's'} — marque agora os dias.`);
  await carregarPortal(); desenharPortal();
}

async function marcarFeita(id, feita) {
  const { data, error } = await sb.rpc('fn_plan_marcar_feita', { p_id: id, p_feita: feita });
  if (error) { showToast('Não foi possível atualizar a tarefa: ' + error.message); return null; }
  return data;
}

// ── Eventos da página ──
document.addEventListener('mousedown', e => {
  const b = e.target.closest?.('#pm-root [data-pm="dia"]'); if (!b || b.disabled || e.button !== 0) return;
  const r = linha(b.closest('tr')?.dataset.k); if (!r) return;
  e.preventDefault();
  const dia = Number(b.dataset.dia);
  _pinta = { k: r.k, on: !r.dias.includes(dia), ult: dia };
  marcarDia(r, dia, _pinta.on);
});
document.addEventListener('mouseover', e => {
  if (!_pinta) return;
  const b = e.target.closest?.('#pm-root [data-pm="dia"]'); if (!b) return;
  const r = linha(b.closest('tr')?.dataset.k); if (!r || r.k !== _pinta.k) return;
  // marca também os dias por onde o rato passou depressa demais (o browser salta células)
  const dia = Number(b.dataset.dia), de = Math.min(dia, _pinta.ult), ate = Math.max(dia, _pinta.ult);
  for (let d = de; d <= ate; d++) marcarDia(r, d, _pinta.on);
  _pinta.ult = dia;
});
document.addEventListener('mouseup', () => {
  if (!_pinta) return;
  const r = linha(_pinta.k); _pinta = null;
  if (r) { atualizarLinha(r); agendar(r, 300); }
});
document.addEventListener('click', e => {
  const b = e.target.closest?.('#pm-root [data-pm]'); if (!b) return;
  const a = b.dataset.pm, r = linha(b.closest('tr')?.dataset.k);
  if (a === 'dia') {   // teclado (Enter/Espaço); o rato já tratou no mousedown
    if (e.detail !== 0 || !r) return;
    marcarDia(r, Number(b.dataset.dia), !r.dias.includes(Number(b.dataset.dia))); atualizarLinha(r); agendar(r, 300);
  } else if (a === 'mes') mudar(() => { _mes = mesSomar(_mes, Number(b.dataset.d)); });
  else if (a === 'add') adicionar();
  else if (a === 'del' && r) apagar(r);
  else if (a === 'copiar') copiarMesAnterior();
  else if (a === 'desfazer' && r?.id) marcarFeita(r.id, false).then(d => { if (d) { r.feita_em = d.feita_em; r.feita_por = d.feita_por; atualizarLinha(r); } });
});
document.addEventListener('input', e => {
  const i = e.target.closest?.('#pm-root [data-pm-f]'); if (!i) return;
  const r = linha(i.closest('tr')?.dataset.k); if (!r) return;
  r[i.dataset.pmF] = i.value;
  agendar(r);
  if (i.dataset.pmF === 'tarefa') kpis();
});
document.addEventListener('change', e => {
  const s = e.target.closest?.('#pm-root [data-pm-obra]');
  if (s) { mudar(() => { _obra = s.value; }); return; }
  const i = e.target.closest?.('#pm-root [data-pm-f]'); if (!i) return;
  const r = linha(i.closest('tr')?.dataset.k); if (r) guardar(r);
});
document.addEventListener('keydown', e => {
  // Enter na tarefa/equipa: passa para a linha seguinte (ou cria uma nova)
  const i = e.target.closest?.('#pm-root [data-pm-f]'); if (!i || e.key !== 'Enter') return;
  e.preventDefault();
  const tr = i.closest('tr'), prox = tr?.nextElementSibling;
  if (prox) prox.querySelector(`[data-pm-f="${i.dataset.pmF}"]`)?.focus();
  else if (i.value.trim()) adicionar();
});
window.addEventListener('beforeunload', e => { if (_rows.some(r => r._t || r._a)) { gravarPendentes(); e.preventDefault(); } });

// ═══════════════════════════════════════════════════════════════════
//  APP DOS ENCARREGADOS — ecrã «Planeamento mensal»
// ═══════════════════════════════════════════════════════════════════
let _eMes = mesAtual();
let _eObra = '';
let _eRows = [];
let _eBusy = new Set();

const IC_EQ = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
const IC_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const IC_CIRC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>';

function encEsconderEcras() {
  document.querySelectorAll('#enc-app > [id^="enc-screen"]').forEach(el => { el.style.display = 'none'; });
}

export async function encGoPlaneamento() {
  encEsconderEcras();   // entra-se pelo início, onde não há leitores de QR ligados
  const s = $('enc-screen-planeamento'); if (!s) return;
  s.style.display = 'flex'; s.style.flexDirection = 'column';
  _eMes = mesAtual();
  await encPlanCarregar();
}

async function encPlanCarregar() {
  const b = $('e-pl-body'); if (!b) return;
  b.innerHTML = `<div class="e-pl-load"><span class="pl-logo"></span>A carregar o planeamento…</div>`;
  const { data, error } = await sb.from(TAB).select('*').eq('mes', _eMes).order('ordem').order('id');
  if (error) { b.innerHTML = `<div class="e-pl-vazio">Não foi possível carregar o planeamento.<br><small>${esc(error.message)}</small></div>`; return; }
  _eRows = data || [];
  const obras = [...new Set(_eRows.map(r => r.obra_id))].sort((a, b) => nomeObra(a).localeCompare(nomeObra(b), 'pt', { numeric: true }));
  if (!obras.includes(_eObra)) _eObra = obras[0] || '';
  encPlanDesenhar();
}

function encPlanDesenhar() {
  const b = $('e-pl-body'); if (!b) return;
  const obras = [...new Set(_eRows.map(r => r.obra_id))].sort((a, c) => nomeObra(a).localeCompare(nomeObra(c), 'pt', { numeric: true }));
  const nav = `<div class="e-pl-mes"><button type="button" data-epl="mes" data-d="-1" aria-label="Mês anterior">‹</button>
      <div><small>Planeamento de</small><b>${esc(mesNome(_eMes))}</b></div>
      <button type="button" data-epl="mes" data-d="1" aria-label="Mês seguinte">›</button></div>`;
  if (!obras.length) {
    b.innerHTML = nav + `<div class="e-pl-vazio"><b>Sem planeamento</b>Ainda não há tarefas para ${esc(mesNome(_eMes).toLowerCase())} nas suas obras.</div>`;
    return;
  }
  const chips = obras.length > 1
    ? `<div class="e-pl-chips">${obras.map(o => `<button type="button" data-epl="obra" data-obra="${esc(o)}" aria-pressed="${o === _eObra}">${esc(nomeObra(o))}</button>`).join('')}</div>`
    : `<div class="e-pl-obra">${esc(nomeObra(_eObra))}</div>`;
  const tarefas = _eRows.filter(r => r.obra_id === _eObra);
  const feitas = tarefas.filter(r => r.feita_em).length;
  const h = hoje(), n = diasDoMes(_eMes);
  const cartoes = tarefas.map(t => {
    const dias = (t.dias || []).map(Number);
    const e = estadoDe(t, _eMes);
    const hojeTem = dias.some(d => dataDia(_eMes, d) === h);
    const barra = Array.from({ length: n }, (_, i) => {
      const d = i + 1;
      return `<i class="${dias.includes(d) ? 'on' : ''}${dataDia(_eMes, d) === h ? ' hoje' : ''}"></i>`;
    }).join('');
    const ocupado = _eBusy.has(t.id);
    const acao = t.feita_em
      ? `<div class="e-pt-ok">${IC_OK}<span><b>Realizada</b>${esc(nomeUser(t.feita_por))} · ${esc(quando(t.feita_em))}</span><button type="button" data-epl="desfazer" data-id="${t.id}"${ocupado ? ' disabled' : ''}>Desfazer</button></div>`
      : `<button type="button" class="e-pt-chk" data-epl="feita" data-id="${t.id}"${ocupado ? ' disabled' : ''}>${IC_CIRC}${ocupado ? 'A gravar…' : 'Marcar como realizada'}</button>`;
    const etq = e === 'atraso' ? '<span class="e-pt-tag verm">Em atraso</span>' : (hojeTem && !t.feita_em ? '<span class="e-pt-tag azul">Hoje</span>' : '');
    return `<div class="e-pt${t.feita_em ? ' feita' : ''}">
      <div class="e-pt-top"><b>${esc(t.tarefa)}</b>${etq}</div>
      ${t.equipa ? `<div class="e-pt-eq">${IC_EQ}<span>${esc(t.equipa)}</span></div>` : ''}
      <div class="e-pt-bar" aria-hidden="true">${barra}</div>
      <div class="e-pt-dias">${dias.length ? `Dias ${esc(intervalos(dias))} de ${esc(MESES_PT[Number(_eMes.slice(5, 7)) - 1].toLowerCase())}` : 'Sem dias marcados'}</div>
      ${acao}
    </div>`;
  }).join('');
  b.innerHTML = nav + chips
    + `<div class="e-pl-resumo"><span><b>${tarefas.length}</b> tarefa${tarefas.length === 1 ? '' : 's'}</span><span><b>${feitas}</b> realizada${feitas === 1 ? '' : 's'}</span></div>`
    + cartoes;
}

async function encPlanMarcar(id, feita) {
  if (_eBusy.has(id)) return;
  _eBusy.add(id); encPlanDesenhar();
  const d = await marcarFeita(id, feita);
  _eBusy.delete(id);
  if (d) {
    const t = _eRows.find(r => r.id === id);
    if (t) { t.feita_em = d.feita_em; t.feita_por = d.feita_por; }
    showToast(feita ? 'Tarefa marcada como realizada ✓' : 'Tarefa volta a ficar por realizar');
  }
  encPlanDesenhar();
}

document.addEventListener('click', e => {
  const b = e.target.closest?.('#enc-screen-planeamento [data-epl]'); if (!b || b.disabled) return;
  const a = b.dataset.epl;
  if (a === 'mes') { _eMes = mesSomar(_eMes, Number(b.dataset.d)); encPlanCarregar(); }
  else if (a === 'obra') { _eObra = b.dataset.obra; encPlanDesenhar(); }
  else if (a === 'feita') encPlanMarcar(Number(b.dataset.id), true);
  else if (a === 'desfazer') encPlanMarcar(Number(b.dataset.id), false);
});

Object.assign(window, { renderPlaneamentoMensal, encGoPlaneamento });
