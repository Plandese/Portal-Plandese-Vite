// ═══════════════════════════════════════════════════════════════════
//  COMPRAS · TESTE — página separada do portal (compras-teste.html)
//  Circuito: pedido → cotações → nota de encomenda → guia → fatura.
//  Trabalha só com as tabelas de teste ct_* (RLS: só administrador). O portal não é lido nem alterado.
//  A sessão é a do portal (mesmo Supabase Auth): se já entrou no portal, não pede nada.
// ═══════════════════════════════════════════════════════════════════
import './styles/mobile-shell.css';   // só para as variáveis (--m-brand, máscara do logótipo…)
import './styles/guias-teste.css';
import './styles/compras-teste.css';
import { sb } from './supabase.js';
import { sincronizarCatalogoArtigos } from './modules/artigos-catalogo.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = n => (Number(n) || 0).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
const num = s => { const v = parseFloat(String(s ?? '').replace(',', '.')); return Number.isFinite(v) ? v : null; };
const qtdTxt = n => (Number(n) || 0).toLocaleString('pt-PT', { maximumFractionDigits: 3 });
const dataPT = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—';
const hojeISO = () => new Date().toISOString().slice(0, 10);
const authEmail = u => `${u}@portal.plandese.local`;
const toast = m => { const p = $('gt-prog'); p.hidden = false; p.textContent = m; clearTimeout(toast._t); toast._t = setTimeout(() => { p.hidden = true; }, 6000); };

let _user = null;
let _papel = 'admin';
let _tab = 'pedidos';
let _pedidos = [], _cotacoes = [], _encomendas = [], _obras = [], _fornecedores = [];

const PAPEIS = { admin: 'Administrador', diretor_obra: 'Diretor de obra', encarregado: 'Encarregado', compras: 'Compras' };
const PODE = {
  pedir: ['admin', 'diretor_obra', 'encarregado'],
  comprar: ['admin', 'compras'],
};
const pode = a => PODE[a].includes(_papel);

const ESTADO_PEDIDO = { pedido: ['Pedido', 'info'], cotacao: ['Em cotação', 'warn'], encomendado: ['Encomendado', 'ok'], parcial: ['Receção parcial', 'warn'], entregue: ['Entregue', 'ok'], faturado: ['Faturado', 'ok'] };
const ESTADO_NE = { emitida: ['Emitida', 'info'], parcial: ['Receção parcial', 'warn'], completa: ['Completa', 'ok'], faturada: ['Faturada', 'ok'] };
const pill = (map, k) => { const [t, c] = map[k] || [k, '']; return `<span class="dd-pill ${c}">${esc(t)}</span>`; };
const URG = { Normal: '', Urgente: 'warn', 'Muito Urgente': 'bad' };

// ── Catálogo de materiais (mesmo do portal) ──
let _catalogo = null;
function catalogo() {
  if (_catalogo && _catalogo.src === window.ARTIGOS_CATALOGO) return _catalogo.itens;
  const itens = [];
  Object.values(window.ARTIGOS_CATALOGO || {}).forEach(g => (g.items || []).forEach(i => itens.push({ ref: i[0], desc: i[1], un: i[2] || 'un', grupo: g.label })));
  _catalogo = { src: window.ARTIGOS_CATALOGO, itens };
  return itens;
}
const semAc = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ── Diálogos ──
function modal(html, largura = 760) {
  const el = document.createElement('div');
  el.className = 'modal-bg open';
  el.innerHTML = `<div class="modal ct-modal" style="width:min(${largura}px,96vw);max-height:92vh;overflow-y:auto">${html}</div>`;
  el.addEventListener('mousedown', e => { if (e.target === el) el.dataset.fora = '1'; else delete el.dataset.fora; });
  el.addEventListener('click', e => { if (e.target === el && el.dataset.fora) fechar(el); });
  document.body.appendChild(el);
  return el;
}
const fechar = el => { (el.closest?.('.modal-bg') || el).remove(); };
const topo = () => [...document.querySelectorAll('.modal-bg.open')].pop();
function confirmar(msg, okTxt = 'Confirmar', perigo = false) {
  return new Promise(res => {
    const el = modal(`<div class="ct-conf">${esc(msg)}</div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-n>Cancelar</button><button type="button" class="btn btn-primary${perigo ? ' ct-perigo' : ''}" data-s>${esc(okTxt)}</button></div>`, 420);
    el.style.zIndex = 3000;
    el.addEventListener('click', e => {
      if (e.target.closest('[data-n]')) { el.remove(); res(false); }
      else if (e.target.closest('[data-s]')) { el.remove(); res(true); }
    });
  });
}

// ── Dados ──
async function carregar() {
  const [p, c, e, o, f] = await Promise.all([
    sb.from('ct_pedidos').select('*').order('id', { ascending: false }),
    sb.from('ct_cotacoes').select('*').order('id'),
    sb.from('ct_encomendas').select('*').order('id', { ascending: false }),
    sb.from('obras').select('id,nome,ativa,estado').order('nome'),
    sb.from('fornecedores').select('id,nome,nif,email,email_compras,ativo').order('nome'),
  ]);
  for (const r of [p, c, e]) if (r.error) throw r.error;
  _pedidos = p.data || []; _cotacoes = c.data || []; _encomendas = e.data || [];
  _obras = (o.data || []).filter(x => x.ativa !== false && (x.estado || 'em_curso') === 'em_curso');
  _fornecedores = (f.data || []).filter(x => x.ativo !== false);
}
async function recarregar() { await carregar(); desenhar(); }

// ═══════════════════ Ecrãs ═══════════════════
function desenhar() {
  const n = { pedidos: _pedidos.length, cotacoes: _pedidos.filter(p => p.estado === 'pedido' || p.estado === 'cotacao').length, encomendas: _encomendas.length };
  $('ct-chips').innerHTML = [['pedidos', '1 · Pedidos'], ['cotacoes', '2 · Cotações'], ['encomendas', '3 · Encomendas']]
    .map(([k, l]) => `<button type="button" class="d-chip-f${_tab === k ? ' on' : ''}" data-tab="${k}">${l}<b>${n[k]}</b></button>`).join('');
  $('ct-corpo').innerHTML = _tab === 'pedidos' ? htmlPedidos() : _tab === 'cotacoes' ? htmlCotacoes() : htmlEncomendas();
}

function htmlPedidos() {
  const acoes = `<div class="ct-acoes">${pode('pedir') ? '<button type="button" class="btn" data-act="novo-pedido">+ Novo pedido de compra</button>' : '<span class="mut">Como «' + esc(PAPEIS[_papel]) + '» não pode criar pedidos.</span>'}</div>`;
  const linhas = _pedidos.map(p => `<tr class="clk" data-act="ver-pedido" data-id="${p.id}">
      <td><b>${esc(p.numero)}</b><br><small class="mut">${dataPT(p.criado_em)}</small></td>
      <td>${esc(p.titulo)}<br><small class="mut">${esc(p.obra_nome || 'Sem obra')}</small></td>
      <td>${(p.linhas || []).length}</td>
      <td>${p.urgencia && p.urgencia !== 'Normal' ? `<span class="dd-pill ${URG[p.urgencia] || ''}">${esc(p.urgencia)}</span>` : '<span class="mut">Normal</span>'}</td>
      <td>${p.data_necessaria ? dataPT(p.data_necessaria) : '<span class="mut">—</span>'}</td>
      <td>${esc(PAPEIS[p.pedido_por] || p.pedido_por || '—')}</td>
      <td>${pill(ESTADO_PEDIDO, p.estado)}</td></tr>`).join('');
  return acoes + `<div class="card ct-card">${_pedidos.length ? `<div class="tbl-wrap"><table class="cmp-t"><thead><tr><th>Nº</th><th>Pedido / Obra</th><th>Artigos</th><th>Urgência</th><th>Necessário até</th><th>Pedido por</th><th>Estado</th></tr></thead><tbody>${linhas}</tbody></table></div>` : '<div class="d-empty">Ainda não há pedidos de compra. O diretor de obra (ou o encarregado) começa aqui o circuito.</div>'}</div>`;
}

function htmlCotacoes() {
  const lista = _pedidos.filter(p => p.estado === 'pedido' || p.estado === 'cotacao' || _cotacoes.some(c => c.pedido_id === p.id));
  const linhas = lista.map(p => {
    const cs = _cotacoes.filter(c => c.pedido_id === p.id);
    const resp = cs.filter(c => c.respondido_em).length;
    const ne = _encomendas.find(e => e.pedido_id === p.id);
    return `<tr class="clk" data-act="cotar" data-id="${p.id}">
      <td><b>${esc(p.numero)}</b></td><td>${esc(p.titulo)}<br><small class="mut">${esc(p.obra_nome || 'Sem obra')}</small></td>
      <td>${cs.length ? `${cs.length} fornecedor${cs.length !== 1 ? 'es' : ''} · ${resp} com preços` : '<span class="mut">Sem pedidos de cotação</span>'}</td>
      <td>${ne ? `<span class="dd-pill ok">${esc(ne.numero)}</span> <small class="mut">${esc(ne.fornecedor)}</small>` : '<span class="mut">—</span>'}</td>
      <td>${pill(ESTADO_PEDIDO, p.estado)}</td></tr>`;
  }).join('');
  return `<div class="card ct-card">${lista.length ? `<div class="tbl-wrap"><table class="cmp-t"><thead><tr><th>Nº</th><th>Pedido / Obra</th><th>Cotações</th><th>Nota de encomenda</th><th>Estado</th></tr></thead><tbody>${linhas}</tbody></table></div>` : '<div class="d-empty">Não há pedidos para cotar.</div>'}</div>`;
}

function htmlEncomendas() {
  const linhas = _encomendas.map(e => `<tr class="clk" data-act="ver-ne" data-id="${e.id}">
      <td><b>${esc(e.numero)}</b><br><small class="mut">${dataPT(e.emitida_em)}</small></td>
      <td>${esc(e.fornecedor)}<br><small class="mut">${esc(e.nif || '')}</small></td>
      <td>${esc(e.obra_nome || '—')}</td>
      <td>${(e.linhas || []).length}</td>
      <td class="r"><b>${eur(e.total)}</b></td>
      <td>${pill(ESTADO_NE, e.estado)}</td></tr>`).join('');
  return `<div class="card ct-card">${_encomendas.length ? `<div class="tbl-wrap"><table class="cmp-t"><thead><tr><th>Nº</th><th>Fornecedor</th><th>Obra</th><th>Artigos</th><th class="r">Total (s/ IVA)</th><th>Estado</th></tr></thead><tbody>${linhas}</tbody></table></div>` : '<div class="d-empty">Ainda não há notas de encomenda. Elas nascem ao adjudicar uma cotação.</div>'}</div>`;
}

// ═══════════════════ Novo pedido ═══════════════════
let _np = null;
function abrirNovoPedido() {
  _np = { linhas: [] };
  const el = modal(`<div class="modal-title">Novo pedido de compra</div>
    <div class="modal-sub">Feito por «${esc(PAPEIS[_papel])}». Escolha a obra e os materiais.</div>
    <div class="ct-form">
      <label>Obra<select id="np-obra"><option value="">— Escolha a obra —</option>${_obras.map(o => `<option value="${esc(o.id)}">${esc(o.nome)}</option>`).join('')}</select></label>
      <label>Título<input id="np-titulo" type="text" placeholder="Ex.: Tubagem e acessórios para rede de águas"></label>
      <div class="ct-2"><label>Urgência<select id="np-urg"><option>Normal</option><option>Urgente</option><option>Muito Urgente</option></select></label>
      <label>Necessário até<input id="np-data" type="date"></label></div>
      <label>Notas<textarea id="np-notas" rows="2" placeholder="Local de entrega, observações…"></textarea></label>
    </div>
    <div class="ct-sec">Materiais</div>
    <input id="np-q" class="ct-busca" type="text" placeholder="Pesquisar no catálogo de materiais (código ou nome)…" autocomplete="off">
    <div id="np-res" class="ct-res"></div>
    <div class="ct-livre"><input id="np-ld" type="text" placeholder="Ou escreva um artigo que não está no catálogo"><input id="np-lu" type="text" placeholder="un" style="width:70px"><button type="button" class="btn btn-secondary btn-sm" data-act="np-livre">Adicionar</button></div>
    <div id="np-linhas"></div>
    <div class="modal-footer"><button type="button" class="btn btn-secondary" data-act="fechar">Cancelar</button><button type="button" class="btn btn-primary" data-act="np-guardar">Criar pedido</button></div>`, 820);
  el.id = 'modal-np';
  npLinhas();
}
function npResultados() {
  const termo = semAc($('np-q').value).trim();
  const box = $('np-res');
  if (termo.length < 2) { box.innerHTML = ''; return; }
  const ts = termo.split(/\s+/);
  const r = catalogo().filter(i => { const t = semAc(i.ref + ' ' + i.desc); return ts.every(x => t.includes(x)); }).slice(0, 40);
  box.innerHTML = r.length ? r.map(i => `<div class="ct-it" data-act="np-add" data-ref="${esc(i.ref)}"><span><b>${esc(i.desc)}</b><br><small class="mut">${esc(i.grupo)} · ${esc(i.ref)}</small></span><em>${esc(i.un)}</em></div>`).join('') : '<div class="d-empty" style="padding:12px">Nenhum artigo encontrado.</div>';
}
function npLinhas() {
  const box = $('np-linhas'); if (!box) return;
  box.innerHTML = _np.linhas.length ? `<table class="cmp-t ct-lt"><thead><tr><th>Artigo</th><th style="width:110px">Quantidade</th><th style="width:60px">Un</th><th style="width:40px"></th></tr></thead><tbody>${_np.linhas.map((l, i) => `<tr><td>${esc(l.desc)}${l.art_ref ? `<br><small class="mut">${esc(l.art_ref)}</small>` : ''}</td><td><input class="ct-n" type="text" inputmode="decimal" value="${esc(l.qtd)}" data-nq="${i}"></td><td>${esc(l.un)}</td><td><button type="button" class="ct-x" data-act="np-rem" data-i="${i}" title="Remover">×</button></td></tr>`).join('')}</tbody></table>` : '<div class="mut" style="padding:10px 2px">Ainda sem materiais.</div>';
}
async function guardarPedido() {
  const obraId = $('np-obra').value, obra = _obras.find(o => o.id === obraId);
  if (!obra) return toast('Escolha a obra.');
  if (!_np.linhas.length) return toast('Adicione pelo menos um material.');
  const linhas = _np.linhas.map(l => ({ ...l, qtd: num(l.qtd) || 0 }));
  if (linhas.some(l => l.qtd <= 0)) return toast('Indique a quantidade de todos os materiais.');
  const titulo = $('np-titulo').value.trim() || `${linhas[0].desc}${linhas.length > 1 ? ` e mais ${linhas.length - 1}` : ''}`;
  const b = document.querySelector('[data-act="np-guardar"]'); b.disabled = true;
  const { data, error } = await sb.from('ct_pedidos').insert({
    obra_id: obra.id, obra_nome: obra.nome, titulo, urgencia: $('np-urg').value, data_necessaria: $('np-data').value || null,
    notas: $('np-notas').value.trim() || null, linhas, pedido_por: _papel, criado_por: _user,
  }).select('numero').single();
  if (error) { b.disabled = false; return toast('Não foi possível criar o pedido: ' + String(error.message).slice(0, 140)); }
  fechar($('modal-np'));
  toast(`Pedido ${data.numero} criado ✓`);
  await recarregar();
}

// ═══════════════════ Ver pedido ═══════════════════
function verPedido(id) {
  const p = _pedidos.find(x => String(x.id) === String(id)); if (!p) return;
  const cs = _cotacoes.filter(c => c.pedido_id === p.id);
  const ne = _encomendas.find(e => e.pedido_id === p.id);
  modal(`<div class="modal-title">${esc(p.numero)} · ${esc(p.titulo)}</div>
    <div class="modal-sub">${esc(p.obra_nome || 'Sem obra')} · pedido por ${esc(PAPEIS[p.pedido_por] || p.pedido_por || '—')} em ${dataPT(p.criado_em)} · ${pill(ESTADO_PEDIDO, p.estado)}</div>
    ${p.notas ? `<div class="ct-nota">${esc(p.notas)}</div>` : ''}
    <table class="cmp-t ct-lt" style="margin-top:12px"><thead><tr><th>Artigo</th><th class="r">Quantidade</th><th>Un</th></tr></thead><tbody>${(p.linhas || []).map(l => `<tr><td>${esc(l.desc)}${l.art_ref ? `<br><small class="mut">${esc(l.art_ref)}</small>` : ''}</td><td class="r">${qtdTxt(l.qtd)}</td><td>${esc(l.un)}</td></tr>`).join('')}</tbody></table>
    ${cs.length ? `<div class="ct-sec">Cotações</div>${cs.map(c => `<div class="ct-linha"><span>${esc(c.fornecedor)}</span><span>${c.respondido_em ? eur(c.total) : '<span class="mut">à espera de preços</span>'}${c.escolhida ? ' <span class="dd-pill ok">Adjudicada</span>' : ''}</span></div>`).join('')}` : ''}
    ${ne ? `<div class="ct-sec">Nota de encomenda</div><div class="ct-linha"><span><b>${esc(ne.numero)}</b> · ${esc(ne.fornecedor)}</span><span>${eur(ne.total)}</span></div>` : ''}
    <div class="modal-footer"><button type="button" class="btn btn-secondary ct-perigo-o" data-act="apagar-pedido" data-id="${p.id}">Apagar pedido</button><span style="flex:1"></span><button type="button" class="btn btn-secondary" data-act="fechar">Fechar</button>${pode('comprar') ? `<button type="button" class="btn btn-primary" data-act="cotar" data-id="${p.id}">${ne ? 'Ver cotações' : 'Cotar'}</button>` : ''}</div>`, 720);
}
async function apagarPedido(id) {
  const p = _pedidos.find(x => String(x.id) === String(id)); if (!p) return;
  if (!await confirmar(`Apagar o pedido ${p.numero} e as suas cotações? As notas de encomenda já emitidas ficam, sem o pedido.`, 'Apagar', true)) return;
  const { data, error } = await sb.from('ct_pedidos').delete().eq('id', p.id).select('id');
  if (error || !data?.length) return toast('Não foi possível apagar: ' + String(error?.message || 'sem permissão').slice(0, 120));
  document.querySelectorAll('.modal-bg.open').forEach(m => m.remove());
  toast('Pedido apagado');
  await recarregar();
}

// ═══════════════════ Cotações ═══════════════════
let _cm = null;   // { pedido, cots:[{...c, pu:[texto por linha]}] }
async function abrirCotar(id) {
  const p = _pedidos.find(x => String(x.id) === String(id)); if (!p) return;
  document.querySelectorAll('.modal-bg.open').forEach(m => m.remove());
  _cm = { pedido: p };
  cotarCarregarMem();
  const el = modal('', 1100); el.id = 'modal-cot';
  cotarDesenhar();
}
function cotarCarregarMem() {
  _cm.cots = _cotacoes.filter(c => c.pedido_id === _cm.pedido.id).map(c => ({
    ...c, pu: (_cm.pedido.linhas || []).map((_, i) => { const x = (c.precos || []).find(q => q.linha === i); return x && x.pu != null ? String(x.pu).replace('.', ',') : ''; }),
    prazo: c.prazo_dias ?? '', cond: c.condicoes || '',
  }));
}
function totalCot(c) {
  const ls = _cm.pedido.linhas || [];
  let t = 0, falta = 0;
  ls.forEach((l, i) => { const pu = num(c.pu[i]); if (pu == null) falta++; else t += pu * l.qtd; });
  return { total: t, falta };
}
function cotarDesenhar() {
  const el = $('modal-cot'); if (!el) return;
  const p = _cm.pedido, ls = p.linhas || [];
  const ne = _encomendas.find(e => e.pedido_id === p.id);
  const sug = _fornecedores.filter(f => !_cm.cots.some(c => c.fornecedor_id === f.id));
  const res = _cm.cots.map(c => totalCot(c));
  const completos = res.map((r, i) => (r.falta === 0 && r.total > 0) ? i : -1).filter(i => i >= 0);
  const melhor = completos.length ? completos.reduce((a, b) => res[a].total <= res[b].total ? a : b) : -1;
  el.querySelector('.ct-modal').innerHTML = `<div class="modal-title">Cotações · ${esc(p.numero)}</div>
    <div class="modal-sub">${esc(p.titulo)} · ${esc(p.obra_nome || 'Sem obra')} · ${pill(ESTADO_PEDIDO, p.estado)}</div>
    ${ne ? `<div class="ct-ok">Adjudicado: nota de encomenda <b>${esc(ne.numero)}</b> a ${esc(ne.fornecedor)} (${eur(ne.total)}).</div>` : ''}
    <div class="ct-sec">1 · Fornecedores a consultar</div>
    <div class="ct-forn">${_cm.cots.map((c, k) => `<span class="ct-chipf">${esc(c.fornecedor)}${c.enviado_em ? ' <i title="Pedido enviado">✉</i>' : ''}${ne ? '' : `<button type="button" data-act="cot-rem" data-k="${k}" title="Remover">×</button>`}</span>`).join('') || '<span class="mut">Ainda não escolheu fornecedores.</span>'}</div>
    ${ne ? '' : `<div class="ct-add"><input id="cf-q" type="text" placeholder="Procurar fornecedor (nome ou NIF) ou escrever um novo…" autocomplete="off" list="cf-lista"><datalist id="cf-lista">${sug.slice(0, 400).map(f => `<option value="${esc(f.nome)}">${esc(f.nif || '')}</option>`).join('')}</datalist><button type="button" class="btn btn-secondary btn-sm" data-act="cot-add">Adicionar</button>
      <button type="button" class="btn btn-secondary btn-sm" data-act="cot-enviar"${_cm.cots.length ? '' : ' disabled'}>✉ Pedir cotação por email</button></div>`}
    ${_cm.cots.length ? `<div class="ct-sec">2 · Preços recebidos (por unidade, sem IVA)</div>
    <div class="tbl-wrap"><table class="cmp-t ct-grid"><thead><tr><th>Artigo</th><th class="r">Qtd</th>${_cm.cots.map((c, k) => `<th class="ct-col${k === melhor ? ' best' : ''}">${esc(c.fornecedor)}${k === melhor ? '<br><small>mais barata</small>' : ''}</th>`).join('')}</tr></thead>
    <tbody>${ls.map((l, i) => `<tr><td>${esc(l.desc)}<br><small class="mut">${esc(l.un)}</small></td><td class="r">${qtdTxt(l.qtd)}</td>${_cm.cots.map((c, k) => { const pu = num(c.pu[i]); return `<td class="ct-col${k === melhor ? ' best' : ''}"><input class="ct-n" type="text" inputmode="decimal" placeholder="0,00" value="${esc(c.pu[i])}" data-cp="${k}:${i}"${ne ? ' disabled' : ''}><div class="ct-sub" id="ct-s-${k}-${i}">${pu != null ? eur(pu * l.qtd) : ''}</div></td>`; }).join('')}</tr>`).join('')}
    <tr class="ct-tot"><td colspan="2"><b>Total</b></td>${_cm.cots.map((c, k) => `<td class="ct-col${k === melhor ? ' best' : ''}"><b id="ct-t-${k}">${res[k].falta === ls.length ? '—' : eur(res[k].total)}</b>${res[k].falta && res[k].falta < ls.length ? `<br><small class="mut">faltam ${res[k].falta} preço${res[k].falta > 1 ? 's' : ''}</small>` : ''}</td>`).join('')}</tr>
    <tr><td colspan="2" class="mut">Prazo de entrega (dias)</td>${_cm.cots.map((c, k) => `<td class="ct-col"><input class="ct-n" type="text" inputmode="numeric" value="${esc(c.prazo)}" data-cz="${k}"${ne ? ' disabled' : ''}></td>`).join('')}</tr>
    <tr><td colspan="2" class="mut">Condições</td>${_cm.cots.map((c, k) => `<td class="ct-col"><input class="ct-t" type="text" value="${esc(c.cond)}" placeholder="Pagamento, validade…" data-cc="${k}"${ne ? ' disabled' : ''}></td>`).join('')}</tr>
    ${ne ? '' : `<tr><td colspan="2"></td>${_cm.cots.map((c, k) => `<td class="ct-col"><button type="button" class="btn btn-primary btn-sm" data-act="adjudicar" data-k="${k}"${res[k].falta === ls.length ? ' disabled' : ''}>Adjudicar</button></td>`).join('')}</tr>`}
    </tbody></table></div>` : ''}
    <div class="modal-footer"><button type="button" class="btn btn-secondary" data-act="fechar">Fechar</button>${_cm.cots.length && !ne ? '<button type="button" class="btn btn-primary" data-act="cot-guardar">Guardar preços</button>' : ''}</div>`;
}
function cotarPintarTotais() {
  const ls = _cm.pedido.linhas || [];
  _cm.cots.forEach((c, k) => {
    ls.forEach((l, i) => { const pu = num(c.pu[i]), s = $(`ct-s-${k}-${i}`); if (s) s.textContent = pu != null ? eur(pu * l.qtd) : ''; });
    const r = totalCot(c), t = $(`ct-t-${k}`); if (t) t.textContent = r.falta === ls.length ? '—' : eur(r.total);
  });
}
async function cotarAdicionar() {
  const q = $('cf-q').value.trim(); if (!q) return;
  const f = _fornecedores.find(x => semAc(x.nome) === semAc(q)) || null;
  if (_cm.cots.some(c => semAc(c.fornecedor) === semAc(f ? f.nome : q))) return toast('Esse fornecedor já está na lista.');
  const { error } = await sb.from('ct_cotacoes').insert({
    pedido_id: _cm.pedido.id, fornecedor_id: f?.id || null, fornecedor: f ? f.nome : q, nif: f?.nif || null,
    email: f ? (f.email_compras || f.email || null) : null, criado_por: _user,
  });
  if (error) return toast('Não foi possível adicionar: ' + String(error.message).slice(0, 120));
  await cotarRecarregar();
}
async function cotarRecarregar() {
  const id = _cm.pedido.id;
  const { data } = await sb.from('ct_cotacoes').select('*').eq('pedido_id', id).order('id');
  _cotacoes = _cotacoes.filter(c => c.pedido_id !== id).concat(data || []);
  cotarCarregarMem(); cotarDesenhar();
}
async function cotarRemover(k) {
  const c = _cm.cots[k]; if (!c) return;
  const { error } = await sb.from('ct_cotacoes').delete().eq('id', c.id);
  if (error) return toast('Não foi possível remover: ' + String(error.message).slice(0, 120));
  await cotarRecarregar();
}
async function cotarGuardar(silencioso) {
  const ls = _cm.pedido.linhas || [];
  for (const c of _cm.cots) {
    const precos = ls.map((l, i) => { const pu = num(c.pu[i]); return { linha: i, pu, total: pu != null ? Math.round(pu * l.qtd * 100) / 100 : null, disponivel: pu != null }; });
    const r = totalCot(c);
    const tem = precos.some(x => x.pu != null);
    const { error } = await sb.from('ct_cotacoes').update({
      precos, total: tem ? Math.round(r.total * 100) / 100 : null, prazo_dias: num(c.prazo) != null ? Math.round(num(c.prazo)) : null,
      condicoes: c.cond.trim() || null, respondido_em: tem ? (c.respondido_em || new Date().toISOString()) : null,
    }).eq('id', c.id);
    if (error) { toast('Não foi possível guardar: ' + String(error.message).slice(0, 120)); return false; }
  }
  const { data } = await sb.from('ct_cotacoes').select('*').eq('pedido_id', _cm.pedido.id).order('id');
  _cotacoes = _cotacoes.filter(c => c.pedido_id !== _cm.pedido.id).concat(data || []);
  if (!silencioso) toast('Preços guardados ✓');
  cotarCarregarMem(); cotarDesenhar();
  return true;
}
async function cotarEnviar() {
  const p = _cm.pedido, ls = p.linhas || [];
  const corpo = `Bom dia,\n\nSolicitamos cotação para o seguinte material (${p.numero}):\n\n` +
    ls.map(l => `- ${l.desc} — ${qtdTxt(l.qtd)} ${l.un}${l.art_ref ? ` (ref. ${l.art_ref})` : ''}`).join('\n') +
    `\n\nObra: ${p.obra_nome || '—'}${p.data_necessaria ? `\nNecessário até: ${dataPT(p.data_necessaria)}` : ''}\n\nAgradecemos preço por unidade (sem IVA), prazo de entrega e condições de pagamento.\n\nCom os melhores cumprimentos,\nPlandese`;
  const assunto = `Pedido de cotação ${p.numero} — ${p.obra_nome || ''}`.trim();
  const mails = _cm.cots.map(c => (c.email || '').trim()).filter(Boolean);
  const url = `mailto:${mails.join(',')}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo).slice(0, 1900)}`;
  const a = document.createElement('a'); a.href = url; document.body.appendChild(a); a.click(); a.remove();
  if (!await confirmar('Já enviou o pedido de cotação? Fica marcado como enviado e o pedido passa a «Em cotação».', 'Sim, enviei')) return;
  const agora = new Date().toISOString();
  await sb.from('ct_cotacoes').update({ enviado_em: agora }).eq('pedido_id', p.id).is('enviado_em', null);
  await sb.from('ct_pedidos').update({ estado: 'cotacao' }).eq('id', p.id).eq('estado', 'pedido');
  await carregar(); _cm.pedido = _pedidos.find(x => x.id === p.id) || p;
  cotarCarregarMem(); cotarDesenhar(); desenhar();
  toast('Pedido de cotação marcado como enviado ✓');
}
async function adjudicar(k) {
  const c = _cm.cots[k], p = _cm.pedido, ls = p.linhas || [];
  if (!await cotarGuardar(true)) return;
  const pr = totalCot(c);
  const itens = ls.map((l, i) => ({ l, pu: num(c.pu[i]) })).filter(x => x.pu != null && x.pu >= 0);
  if (!itens.length) return toast('Indique os preços deste fornecedor primeiro.');
  const msg = `Adjudicar a ${c.fornecedor} e emitir a nota de encomenda?\n${itens.length} de ${ls.length} artigos · ${eur(pr.total)} (sem IVA).${pr.falta ? ` Os ${pr.falta} artigos sem preço ficam de fora.` : ''}`;
  if (!await confirmar(msg, 'Emitir nota de encomenda')) return;
  const linhas = itens.map(({ l, pu }) => ({ desc: l.desc, art_ref: l.art_ref || null, un: l.un, qtd: l.qtd, pu, total: Math.round(pu * l.qtd * 100) / 100 }));
  const total = Math.round(linhas.reduce((s, x) => s + x.total, 0) * 100) / 100;
  const { data, error } = await sb.from('ct_encomendas').insert({
    pedido_id: p.id, cotacao_id: c.id, fornecedor_id: c.fornecedor_id, fornecedor: c.fornecedor, nif: c.nif,
    obra_id: p.obra_id, obra_nome: p.obra_nome, linhas, total, criado_por: _user,
  }).select('*').single();
  if (error) return toast('Não foi possível emitir a nota de encomenda: ' + String(error.message).slice(0, 140));
  await sb.from('ct_cotacoes').update({ escolhida: false }).eq('pedido_id', p.id);
  await sb.from('ct_cotacoes').update({ escolhida: true }).eq('id', c.id);
  await sb.from('ct_pedidos').update({ estado: 'encomendado' }).eq('id', p.id);
  await carregar();
  document.querySelectorAll('.modal-bg.open').forEach(m => m.remove());
  _tab = 'encomendas'; desenhar();
  toast(`Nota de encomenda ${data.numero} emitida ✓`);
  verNE(data.id);
}

// ═══════════════════ Notas de encomenda ═══════════════════
function verNE(id) {
  const e = _encomendas.find(x => String(x.id) === String(id)); if (!e) return;
  modal(`<div class="modal-title">Nota de encomenda ${esc(e.numero)}</div>
    <div class="modal-sub">${esc(e.fornecedor)}${e.nif ? ' · NIF ' + esc(e.nif) : ''} · ${esc(e.obra_nome || '—')} · emitida em ${dataPT(e.emitida_em)} · ${pill(ESTADO_NE, e.estado)}</div>
    <table class="cmp-t ct-lt" style="margin-top:12px"><thead><tr><th>Artigo</th><th class="r">Qtd</th><th>Un</th><th class="r">Preço un.</th><th class="r">Total</th></tr></thead><tbody>${(e.linhas || []).map(l => `<tr><td>${esc(l.desc)}${l.art_ref ? `<br><small class="mut">${esc(l.art_ref)}</small>` : ''}</td><td class="r">${qtdTxt(l.qtd)}</td><td>${esc(l.un)}</td><td class="r">${eur(l.pu)}</td><td class="r">${eur(l.total)}</td></tr>`).join('')}
    <tr class="ct-tot"><td colspan="4"><b>Total (sem IVA)</b></td><td class="r"><b>${eur(e.total)}</b></td></tr></tbody></table>
    <div class="modal-footer"><button type="button" class="btn btn-secondary ct-perigo-o" data-act="apagar-ne" data-id="${e.id}">Apagar</button><span style="flex:1"></span><button type="button" class="btn btn-secondary" data-act="imprimir-ne" data-id="${e.id}">Imprimir / PDF</button><button type="button" class="btn btn-primary" data-act="fechar">Fechar</button></div>`, 820);
}
function imprimirNE(id) {
  const e = _encomendas.find(x => String(x.id) === String(id)); if (!e) return;
  const w = window.open('', '_blank'); if (!w) return toast('O navegador bloqueou a janela de impressão.');
  w.document.write(`<!DOCTYPE html><html lang="pt"><head><meta charset="utf-8"><title>${esc(e.numero)}</title><style>
    body{font-family:system-ui,Arial,sans-serif;color:#1b2130;margin:36px}h1{font-size:22px;margin:0 0 4px}.m{color:#5d6678;font-size:13px}
    table{width:100%;border-collapse:collapse;margin-top:18px;font-size:13px}th{text-align:left;border-bottom:2px solid #173f9f;padding:8px 6px;font-size:11px;text-transform:uppercase}
    td{border-bottom:1px solid #dde2ea;padding:8px 6px}.r{text-align:right}.t td{font-weight:700;border-bottom:0}.hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #173f9f;padding-bottom:12px;margin-bottom:18px}
  </style></head><body><div class="hd"><div><h1>Nota de encomenda ${esc(e.numero)}</h1><div class="m">Emitida em ${dataPT(e.emitida_em)}</div></div><div style="text-align:right"><b>PLANDESE, S.A.</b><div class="m">NIF 514 913 827</div></div></div>
  <div><b>Fornecedor:</b> ${esc(e.fornecedor)}${e.nif ? ' · NIF ' + esc(e.nif) : ''}</div><div><b>Obra / local de entrega:</b> ${esc(e.obra_nome || '—')}</div>
  <table><thead><tr><th>Artigo</th><th class="r">Qtd</th><th>Un</th><th class="r">Preço un.</th><th class="r">Total</th></tr></thead><tbody>
  ${(e.linhas || []).map(l => `<tr><td>${esc(l.desc)}${l.art_ref ? `<div class="m">${esc(l.art_ref)}</div>` : ''}</td><td class="r">${qtdTxt(l.qtd)}</td><td>${esc(l.un)}</td><td class="r">${eur(l.pu)}</td><td class="r">${eur(l.total)}</td></tr>`).join('')}
  <tr class="t"><td colspan="4" class="r">Total (sem IVA)</td><td class="r">${eur(e.total)}</td></tr></tbody></table>
  <p class="m" style="margin-top:28px">Indique o n.º ${esc(e.numero)} na guia de remessa e na fatura.</p></body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}
async function apagarNE(id) {
  const e = _encomendas.find(x => String(x.id) === String(id)); if (!e) return;
  if (!await confirmar(`Apagar a nota de encomenda ${e.numero}? O pedido volta ao estado «Em cotação».`, 'Apagar', true)) return;
  const { data, error } = await sb.from('ct_encomendas').delete().eq('id', e.id).select('id');
  if (error || !data?.length) return toast('Não foi possível apagar: ' + String(error?.message || 'sem permissão').slice(0, 120));
  if (e.pedido_id) { await sb.from('ct_cotacoes').update({ escolhida: false }).eq('pedido_id', e.pedido_id); await sb.from('ct_pedidos').update({ estado: 'cotacao' }).eq('id', e.pedido_id); }
  document.querySelectorAll('.modal-bg.open').forEach(m => m.remove());
  toast('Nota de encomenda apagada');
  await recarregar();
}

// ═══════════════════ Eventos ═══════════════════
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab]'); if (t) { _tab = t.dataset.tab; desenhar(); return; }
  const a = e.target.closest('[data-act]'); if (!a) return;
  if (e.target.closest('button') && a.tagName !== 'BUTTON' && a !== e.target.closest('button')) return;   // botões dentro de linhas clicáveis
  const id = a.dataset.id;
  switch (a.dataset.act) {
    case 'fechar': { const m = topo(); if (m) m.remove(); break; }
    case 'novo-pedido': abrirNovoPedido(); break;
    case 'ver-pedido': verPedido(id); break;
    case 'apagar-pedido': apagarPedido(id); break;
    case 'np-add': { const i = catalogo().find(x => x.ref === a.dataset.ref); if (i) { const ex = _np.linhas.find(l => l.art_ref === i.ref); if (ex) ex.qtd = String((num(ex.qtd) || 0) + 1).replace('.', ','); else _np.linhas.push({ art_ref: i.ref, desc: i.desc, un: i.un, qtd: '1' }); npLinhas(); } break; }
    case 'np-livre': { const d = $('np-ld').value.trim(); if (!d) break; _np.linhas.push({ art_ref: null, desc: d, un: $('np-lu').value.trim() || 'un', qtd: '1' }); $('np-ld').value = ''; $('np-lu').value = ''; npLinhas(); break; }
    case 'np-rem': _np.linhas.splice(+a.dataset.i, 1); npLinhas(); break;
    case 'np-guardar': guardarPedido(); break;
    case 'cotar': abrirCotar(id); break;
    case 'cot-add': cotarAdicionar(); break;
    case 'cot-rem': cotarRemover(+a.dataset.k); break;
    case 'cot-enviar': cotarEnviar(); break;
    case 'cot-guardar': cotarGuardar(); break;
    case 'adjudicar': adjudicar(+a.dataset.k); break;
    case 'ver-ne': verNE(id); break;
    case 'imprimir-ne': imprimirNE(id); break;
    case 'apagar-ne': apagarNE(id); break;
  }
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'np-q') npResultados();
  else if (el.dataset.nq != null) { _np.linhas[+el.dataset.nq].qtd = el.value; }
  else if (el.dataset.cp) { const [k, i] = el.dataset.cp.split(':').map(Number); _cm.cots[k].pu[i] = el.value; cotarPintarTotais(); }
  else if (el.dataset.cz != null) _cm.cots[+el.dataset.cz].prazo = el.value;
  else if (el.dataset.cc != null) _cm.cots[+el.dataset.cc].cond = el.value;
});
$('ct-papel').addEventListener('change', e => { _papel = e.target.value; try { localStorage.setItem('ct_papel', _papel); } catch (x) { /* sem armazenamento */ } desenhar(); });

// ═══════════════════ Arranque (sessão partilhada com o portal) ═══════════════════
async function arrancar() {
  const { data } = await sb.auth.getSession();
  if (!data?.session) { $('gt-login').hidden = false; $('gt-app').hidden = true; return; }
  _user = (data.session.user.email || '').split('@')[0];
  const { data: papel } = await sb.rpc('fn_my_role');
  if (papel !== 'admin') { $('gt-login').hidden = true; $('gt-app').hidden = true; $('gt-semacesso').hidden = false; return; }
  $('gt-user').textContent = _user;
  $('gt-login').hidden = true; $('gt-app').hidden = false;
  try { _papel = localStorage.getItem('ct_papel') || 'admin'; } catch (x) { _papel = 'admin'; }
  if (!PAPEIS[_papel]) _papel = 'admin';
  $('ct-papel').value = _papel;
  try { sincronizarCatalogoArtigos(); } catch (x) { /* usa a cópia de arranque */ }
  try { await carregar(); desenhar(); }
  catch (err) { $('ct-corpo').innerHTML = `<div class="d-empty">Não foi possível carregar: ${esc(err.message || err)}</div>`; }
}
$('gt-login-form').addEventListener('submit', async e => {
  e.preventDefault();
  $('gt-login-erro').hidden = true;
  const u = $('gt-u').value.trim().toLowerCase(), p = $('gt-p').value;
  if (!u || !p) return;
  const { error } = await sb.auth.signInWithPassword({ email: authEmail(u), password: p });
  if (error) { $('gt-login-erro').hidden = false; return; }
  arrancar();
});
$('gt-sair').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

arrancar();
