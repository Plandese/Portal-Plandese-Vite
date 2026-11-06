// ═══════════════════════════════════════════════════════════
//  NECESSIDADES DE OBRA — pedido semanal dos diretores de obra
//  Todas as quintas-feiras os diretores registam o que a obra vai precisar
//  na semana seguinte (materiais, mão de obra, equipamentos, logística…).
//  Compras vê tudo consolidado e vai marcando o estado de cada linha.
// ═══════════════════════════════════════════════════════════
import { sb } from '../supabase.js';
import { S, R } from '../state.js';
import { obraEmCurso, obraVisivelPara } from '../config.js';
import { showToast } from './navigation.js';

const CATS = {
  materiais:     { l: 'Materiais',       cor: 'azul' },
  mao_obra:      { l: 'Mão de obra',     cor: 'roxo' },
  equipamentos:  { l: 'Equipamentos',    cor: 'ambar' },
  logistica:     { l: 'Logística',       cor: 'verde' },
  subempreitada: { l: 'Subempreitadas',  cor: 'cinza' },
  outros:        { l: 'Outros',          cor: 'cinza' },
};
const URG = { normal: 'Normal', urgente: 'Urgente', critica: 'Crítica' };
const EST = {
  pendente:    { l: 'Por tratar',  cor: 'ambar' },
  em_analise:  { l: 'Em análise',  cor: 'azul' },
  em_compra:   { l: 'Em compra',   cor: 'roxo' },
  encomendado: { l: 'Encomendado', cor: 'azul' },
  entregue:    { l: 'Entregue',    cor: 'verde' },
  cancelado:   { l: 'Cancelado',   cor: 'cinza' },
};
const UNIDADES = ['un', 'm', 'm²', 'm³', 'kg', 't', 'l', 'saco', 'palete', 'rolo', 'dia', 'hora', 'pessoa'];
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

let _rows = [];
let _semana = null;      // segunda-feira (YYYY-MM-DD) da semana a que respeitam as necessidades
let _vista = 'obra';     // 'obra' | 'categoria'
let _filtro = { obra: '', cat: '', est: '', urg: '', q: '' };
let _edit = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtD = s => { if (!s) return '—'; const d = parse(s.slice(0, 10)); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const fmtDL = s => { const d = parse(s); return `${DIAS[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
const segunda = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const addDias = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const semanaPadrao = () => addDias(iso(segunda(new Date())), 7);   // por defeito, a semana seguinte
const prazoDe = sem => addDias(sem, -4);   // quinta-feira anterior à semana

const u = () => S.currentUser || {};
const gere = () => ['admin', 'compras'].includes(u().role);
const obrasPermitidas = () => (S.OBRAS || []).filter(o => obraEmCurso(o) && obraVisivelPara(u(), S.OBRAS, o.id));
const nomeObra = id => (S.OBRAS || []).find(o => o.id === id)?.nome || id;
const ehDiretorDe = id => u().role === 'admin' || obraVisivelPara(u(), S.OBRAS, id);

// ── Dados ───────────────────────────────────────────────────
async function carregar() {
  const { data, error } = await sb.from('necessidades_obra').select('*').eq('semana', _semana).order('criado_em');
  if (error) { showToast('Erro ao carregar necessidades: ' + error.message); _rows = []; return; }
  _rows = data || [];
}

export async function initNecessidades() {
  if (!_semana) _semana = semanaPadrao();
  await render(true);
}

async function render(recarregar) {
  const host = document.getElementById('nec-root');
  if (!host) return;
  if (recarregar) await carregar();
  host.innerHTML = cabecalho() + kpis() + avisoPrazo() + filtros() + (_vista === 'obra' ? vistaObra() : vistaCategoria());
}

// ── Blocos ──────────────────────────────────────────────────
function cabecalho() {
  const fim = addDias(_semana, 4);
  return `<div class="nec-head">
    <div>
      <h1>Necessidades de obra</h1>
      <p>Cada quinta-feira, os diretores de obra registam o que cada obra vai precisar na semana seguinte.</p>
    </div>
    <div class="nec-sem">
      <button class="nec-ic" onclick="necSemana(-1)" title="Semana anterior">‹</button>
      <div><small>Semana de trabalho</small><b>${fmtD(_semana)} a ${fmtD(fim)}</b></div>
      <button class="nec-ic" onclick="necSemana(1)" title="Semana seguinte">›</button>
    </div>
  </div>`;
}

function kpis() {
  const r = _rows.filter(x => x.estado !== 'cancelado');
  const urg = r.filter(x => x.urgencia !== 'normal' && !['entregue'].includes(x.estado)).length;
  const porTratar = r.filter(x => x.estado === 'pendente').length;
  const ent = r.filter(x => x.estado === 'entregue').length;
  const obrasCom = new Set(r.map(x => x.obra_id)).size;
  const obras = obrasPermitidas().length;
  const k = (cls, t, v, s) => `<div class="nec-kpi ${cls}"><small>${t}</small><b>${v}</b><span>${s}</span></div>`;
  return `<div class="nec-kpis">
    ${k('azul', 'Linhas pedidas', r.length, `em ${obrasCom} de ${obras} obras`)}
    ${k('ambar', 'Por tratar', porTratar, gere() ? 'aguardam compras' : 'aguardam resposta')}
    ${k('verm', 'Urgentes', urg, 'urgentes ou críticas')}
    ${k('verde', 'Entregues', ent, `de ${r.length} linhas`)}
  </div>`;
}

function avisoPrazo() {
  const prazo = prazoDe(_semana);
  const hoje = iso(new Date());
  const limite = new Date(parse(prazo).getTime() + 86399000);
  const passado = new Date() > limite;
  const semReg = obrasPermitidas().filter(o => !_rows.some(x => x.obra_id === o.id && x.estado !== 'cancelado'));
  let cls = 'ok', msg;
  if (hoje === prazo) { cls = 'hoje'; msg = '<b>Hoje é dia de entrega.</b> Registe até ao fim do dia tudo o que a obra precisa na próxima semana.'; }
  else if (!passado) msg = `Prazo de entrega: <b>${fmtDL(prazo)}</b>.`;
  else { cls = 'fora'; msg = `Prazo terminado em <b>${fmtDL(prazo)}</b>. Pedidos novos ficam assinalados «fora de prazo».`; }
  const lista = (!gere() || u().role === 'admin') && semReg.length
    ? `<div class="nec-sem-reg">Obras ainda sem registos: ${semReg.map(o => `<span class="nec-pill cinza">${esc(o.nome)}</span>`).join(' ')}</div>`
    : (gere() && semReg.length ? `<div class="nec-sem-reg">Ainda sem registos: ${semReg.map(o => `<span class="nec-pill cinza">${esc(o.nome)}</span>`).join(' ')}</div>` : '');
  return `<div class="nec-prazo ${cls}"><div>${msg}</div>${lista}</div>`;
}

function filtros() {
  const obras = gere() ? (S.OBRAS || []).filter(o => obraEmCurso(o)) : obrasPermitidas();
  const opt = (obj, v) => Object.entries(obj).map(([k, x]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${esc(x.l || x)}</option>`).join('');
  return `<div class="nec-bar">
    <div class="nec-tabs">
      <button class="${_vista === 'obra' ? 'on' : ''}" onclick="necVista('obra')">Por obra</button>
      <button class="${_vista === 'categoria' ? 'on' : ''}" onclick="necVista('categoria')">Por categoria</button>
    </div>
    <input class="nec-in" id="nec-q" type="search" placeholder="Pesquisar…" value="${esc(_filtro.q)}" oninput="necFiltro('q',this.value)">
    <select class="nec-in" onchange="necFiltro('obra',this.value)"><option value="">Todas as obras</option>${obras.map(o => `<option value="${esc(o.id)}" ${_filtro.obra === o.id ? 'selected' : ''}>${esc(o.nome)}</option>`).join('')}</select>
    <select class="nec-in" onchange="necFiltro('cat',this.value)"><option value="">Todas as categorias</option>${opt(CATS, _filtro.cat)}</select>
    <select class="nec-in" onchange="necFiltro('est',this.value)"><option value="">Todos os estados</option>${opt(EST, _filtro.est)}</select>
    <select class="nec-in" onchange="necFiltro('urg',this.value)"><option value="">Qualquer urgência</option>${Object.entries(URG).map(([k, l]) => `<option value="${k}" ${_filtro.urg === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    ${gere() || u().role === 'admin' ? '<button class="nec-btn sec" onclick="necExportar()">Exportar</button>' : ''}
  </div>`;
}

function filtradas() {
  const q = _filtro.q.trim().toLowerCase();
  return _rows.filter(x =>
    (!_filtro.obra || x.obra_id === _filtro.obra) && (!_filtro.cat || x.categoria === _filtro.cat) &&
    (!_filtro.est || x.estado === _filtro.est) && (!_filtro.urg || x.urgencia === _filtro.urg) &&
    (!q || `${x.descricao} ${x.observacoes || ''} ${nomeObra(x.obra_id)}`.toLowerCase().includes(q)));
}

const foraPrazo = x => new Date(x.criado_em) > new Date(parse(prazoDe(x.semana)).getTime() + 86399000);

function linha(x, mostrarObra) {
  const pode = gere() || (x.criado_por === u().key && x.estado === 'pendente') || (u().role === 'admin');
  const urg = x.urgencia !== 'normal' ? `<span class="nec-pill ${x.urgencia === 'critica' ? 'verm' : 'ambar'}">${URG[x.urgencia]}</span>` : '';
  const qtd = x.quantidade != null ? `${String(x.quantidade).replace('.', ',')} ${esc(x.unidade || '')}` : '';
  const estSel = gere()
    ? `<select class="nec-est ${EST[x.estado].cor}" onchange="necEstado('${x.id}',this.value)">${Object.entries(EST).map(([k, e]) => `<option value="${k}" ${x.estado === k ? 'selected' : ''}>${e.l}</option>`).join('')}</select>`
    : `<span class="nec-pill ${EST[x.estado].cor}">${EST[x.estado].l}</span>`;
  return `<div class="nec-lin ${x.estado === 'cancelado' ? 'canc' : ''}">
    <div class="nec-lin-main">
      <div class="nec-lin-t">
        <span class="nec-pill ${CATS[x.categoria].cor}">${CATS[x.categoria].l}</span> ${urg}
        ${foraPrazo(x) ? '<span class="nec-pill verm" title="Registado depois da quinta-feira">Fora de prazo</span>' : ''}
        <b>${esc(x.descricao)}</b>${qtd ? ` <span class="nec-qtd">${qtd}</span>` : ''}
      </div>
      <div class="nec-lin-s">
        ${mostrarObra ? `<span>${esc(nomeObra(x.obra_id))}</span>` : ''}
        ${x.data_necessaria ? `<span>Necessário a ${fmtD(x.data_necessaria)}</span>` : ''}
        ${x.local_entrega ? `<span>Entrega: ${esc(x.local_entrega)}</span>` : ''}
        <span>Pedido por ${esc(x.criado_por_nome || x.criado_por)}</span>
      </div>
      ${x.observacoes ? `<div class="nec-obs">${esc(x.observacoes)}</div>` : ''}
      ${x.resposta_compras ? `<div class="nec-resp"><b>Compras:</b> ${esc(x.resposta_compras)}</div>` : ''}
    </div>
    <div class="nec-lin-acc">
      ${estSel}
      ${gere() ? `<button class="nec-lnk" onclick="necResponder('${x.id}')">Responder</button>` : ''}
      ${pode && (gere() || x.estado === 'pendente') ? `<button class="nec-lnk" onclick="necEditar('${x.id}')">Editar</button><button class="nec-lnk verm" onclick="necApagar('${x.id}')">Apagar</button>` : ''}
    </div>
  </div>`;
}

function vistaObra() {
  const lista = filtradas();
  const obras = (gere() ? (S.OBRAS || []).filter(o => obraEmCurso(o)) : obrasPermitidas()).filter(o => !_filtro.obra || o.id === _filtro.obra);
  const temFiltro = _filtro.cat || _filtro.est || _filtro.urg || _filtro.q;
  const blocos = obras.map(o => {
    const rs = lista.filter(x => x.obra_id === o.id);
    if (!rs.length && (gere() || temFiltro)) return '';
    const urgentes = rs.filter(x => x.urgencia !== 'normal' && x.estado !== 'entregue' && x.estado !== 'cancelado').length;
    return `<section class="nec-obra">
      <header>
        <div><h2>${esc(o.nome)}</h2><small>${rs.length} ${rs.length === 1 ? 'linha' : 'linhas'}${urgentes ? ` · ${urgentes} urgente(s)` : ''}</small></div>
        ${ehDiretorDe(o.id) ? `<button class="nec-btn" onclick="necNova('${esc(o.id)}')">+ Adicionar necessidade</button>` : ''}
      </header>
      ${rs.length ? rs.map(x => linha(x, false)).join('') : '<div class="nec-vazio">Ainda sem necessidades para esta semana.</div>'}
    </section>`;
  }).join('');
  return `<div class="nec-lista">${blocos || '<div class="nec-vazio grande">Sem resultados.</div>'}</div>`;
}

function vistaCategoria() {
  const lista = filtradas();
  const blocos = Object.entries(CATS).map(([k, c]) => {
    const rs = lista.filter(x => x.categoria === k);
    if (!rs.length) return '';
    rs.sort((a, b) => (b.urgencia === 'critica') - (a.urgencia === 'critica') || (b.urgencia === 'urgente') - (a.urgencia === 'urgente'));
    return `<section class="nec-obra"><header><div><h2>${c.l}</h2><small>${rs.length} ${rs.length === 1 ? 'linha' : 'linhas'} · ${new Set(rs.map(x => x.obra_id)).size} obra(s)</small></div></header>${rs.map(x => linha(x, true)).join('')}</section>`;
  }).join('');
  return `<div class="nec-lista">${blocos || '<div class="nec-vazio grande">Sem resultados.</div>'}</div>`;
}

// ── Janela de criação / edição ──────────────────────────────
function abrirForm(x, obraId) {
  _edit = x ? x.id : null;
  const obras = obrasPermitidas();
  const v = x || { obra_id: obraId || obras[0]?.id, categoria: 'materiais', urgencia: 'normal', unidade: 'un' };
  const f = (l, h) => `<label class="nec-f"><span>${l}</span>${h}</label>`;
  const el = document.createElement('div');
  el.className = 'nec-ov'; el.id = 'nec-ov';
  el.innerHTML = `<div class="nec-modal" role="dialog">
    <div class="nec-mh"><h3>${x ? 'Editar necessidade' : 'Nova necessidade'}</h3><small>Semana de ${fmtD(_semana)} a ${fmtD(addDias(_semana, 4))}</small></div>
    <div class="nec-mb">
      ${f('Obra', `<select id="nf-obra">${(gere() ? (S.OBRAS || []).filter(o => obraEmCurso(o)) : obras).map(o => `<option value="${esc(o.id)}" ${v.obra_id === o.id ? 'selected' : ''}>${esc(o.nome)}</option>`).join('')}</select>`)}
      ${f('Categoria', `<div class="nec-chips" id="nf-cat">${Object.entries(CATS).map(([k, c]) => `<button type="button" class="${v.categoria === k ? 'on' : ''}" data-v="${k}">${c.l}</button>`).join('')}</div>`)}
      ${f('O que é preciso', `<input id="nf-desc" type="text" maxlength="200" placeholder="Ex.: Betão C25/30, 2 serventes, grua 20 t…" value="${esc(v.descricao || '')}">`)}
      <div class="nec-2">
        ${f('Quantidade', `<input id="nf-qtd" type="number" min="0" step="any" value="${v.quantidade ?? ''}">`)}
        ${f('Unidade', `<select id="nf-un">${UNIDADES.map(n => `<option ${v.unidade === n ? 'selected' : ''}>${n}</option>`).join('')}</select>`)}
      </div>
      <div class="nec-2">
        ${f('Necessário até', `<input id="nf-data" type="date" min="${_semana}" max="${addDias(_semana, 6)}" value="${v.data_necessaria || ''}">`)}
        ${f('Urgência', `<div class="nec-chips" id="nf-urg">${Object.entries(URG).map(([k, l]) => `<button type="button" class="${v.urgencia === k ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div>`)}
      </div>
      ${f('Local de entrega', `<input id="nf-local" type="text" maxlength="120" placeholder="Obra, armazém, morada…" value="${esc(v.local_entrega || '')}">`)}
      ${f('Observações', `<textarea id="nf-obs" rows="3" placeholder="Referência, marca, especificações, contacto no local…">${esc(v.observacoes || '')}</textarea>`)}
    </div>
    <div class="nec-mf"><button class="nec-btn sec" id="nf-cancel">Cancelar</button><button class="nec-btn" id="nf-ok">Guardar</button></div>
  </div>`;
  document.body.appendChild(el);
  el.querySelectorAll('.nec-chips').forEach(g => g.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    g.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on');
  }));
  el.querySelector('#nf-cancel').onclick = fechar;
  el.addEventListener('mousedown', e => { if (e.target === el) fechar(); });
  el.querySelector('#nf-ok').onclick = guardar;
  el.querySelector('#nf-desc').focus();
}
const fechar = () => { document.getElementById('nec-ov')?.remove(); _edit = null; };

async function guardar() {
  const g = id => document.getElementById(id);
  const descricao = g('nf-desc').value.trim();
  if (!descricao) { showToast('Indique o que é preciso'); g('nf-desc').focus(); return; }
  const qtd = g('nf-qtd').value;
  const rec = {
    obra_id: g('nf-obra').value,
    categoria: g('nf-cat').querySelector('.on')?.dataset.v || 'materiais',
    urgencia: g('nf-urg').querySelector('.on')?.dataset.v || 'normal',
    descricao,
    quantidade: qtd === '' ? null : Number(qtd),
    unidade: qtd === '' ? null : g('nf-un').value,
    data_necessaria: g('nf-data').value || null,
    local_entrega: g('nf-local').value.trim() || null,
    observacoes: g('nf-obs').value.trim() || null,
  };
  const btn = g('nf-ok'); btn.disabled = true;
  const q = _edit
    ? sb.from('necessidades_obra').update(rec).eq('id', _edit)
    : sb.from('necessidades_obra').insert({ ...rec, semana: _semana, criado_por: u().key, criado_por_nome: u().nome });
  const { error } = await q;
  btn.disabled = false;
  if (error) { showToast('Erro ao guardar: ' + error.message); return; }
  if (!_edit) R.emitEvent?.({ acao: `Necessidade de obra: ${descricao} · ${nomeObra(rec.obra_id)}${rec.urgencia !== 'normal' ? ' (' + URG[rec.urgencia] + ')' : ''}`, seccao: 'necessidades', obra: rec.obra_id });
  fechar(); showToast('Necessidade guardada ✓'); render(true);
}

// ── Ações ───────────────────────────────────────────────────
const porId = id => _rows.find(x => x.id === id);
async function atualizar(id, campos, msg) {
  const { error } = await sb.from('necessidades_obra').update(campos).eq('id', id);
  if (error) { showToast('Erro: ' + error.message); return false; }
  if (msg) showToast(msg);
  await render(true); return true;
}

function exportar() {
  if (!window.XLSX) { showToast('Biblioteca de exportação indisponível'); return; }
  const rows = filtradas().map(x => ({
    'Semana': fmtD(x.semana), 'Obra': nomeObra(x.obra_id), 'Categoria': CATS[x.categoria].l, 'Descrição': x.descricao,
    'Quantidade': x.quantidade ?? '', 'Unidade': x.unidade || '', 'Urgência': URG[x.urgencia], 'Necessário até': x.data_necessaria || '',
    'Local de entrega': x.local_entrega || '', 'Observações': x.observacoes || '', 'Estado': EST[x.estado].l,
    'Resposta de compras': x.resposta_compras || '', 'Pedido por': x.criado_por_nome || x.criado_por,
  }));
  const ws = XLSX.utils.json_to_sheet(rows), wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Necessidades');
  XLSX.writeFile(wb, `Necessidades_de_obra_${_semana}.xlsx`);
}

export const necessidadesHandlers = {
  necSemana: d => { _semana = addDias(_semana, 7 * d); render(true); },
  necVista: v => { _vista = v; render(false); },
  necFiltro: (k, v) => {
    _filtro[k] = v; render(false);
    if (k === 'q') { const i = document.getElementById('nec-q'); i?.focus(); i?.setSelectionRange(v.length, v.length); }
  },
  necNova: obraId => abrirForm(null, obraId),
  necEditar: id => { const x = porId(id); if (x) abrirForm(x); },
  necApagar: async id => { if (confirm('Apagar esta necessidade?')) { const { error } = await sb.from('necessidades_obra').delete().eq('id', id); if (error) showToast('Erro: ' + error.message); else { showToast('Apagada'); render(true); } } },
  necEstado: (id, estado) => atualizar(id, { estado }, 'Estado atualizado ✓'),
  necResponder: id => {
    const x = porId(id); if (!x) return;
    const t = prompt('Resposta para o diretor de obra (prazo, fornecedor, alternativa…):', x.resposta_compras || '');
    if (t !== null) atualizar(id, { resposta_compras: t.trim() || null }, 'Resposta guardada ✓');
  },
  necExportar: exportar,
};
