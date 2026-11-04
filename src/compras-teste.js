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
import { scoreGuia, scoreFatura, decidir, conferir, alertas, atribuir, mesmoForn, TOLERANCIA } from './modules/ct-motor.js';

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
let _pedidos = [], _cotacoes = [], _encomendas = [], _obras = [], _fornecedores = [], _guias = [], _faturas = [];

const PAPEIS = { admin: 'Administrador', diretor_obra: 'Diretor de obra', encarregado: 'Encarregado', compras: 'Compras' };
const PODE = {
  pedir: ['admin', 'diretor_obra', 'encarregado'],
  comprar: ['admin', 'compras'],
};
const pode = a => PODE[a].includes(_papel);

const ESTADO_PEDIDO = { pedido: ['Pedido', 'info'], cotacao: ['Em cotação', 'warn'], encomendado: ['Encomendado', 'ok'], parcial: ['Receção parcial', 'warn'], entregue: ['Entregue', 'ok'], faturado: ['Faturado', 'ok'] };
const ESTADO_NE = { emitida: ['Emitida', 'info'], parcial: ['Receção parcial', 'warn'], completa: ['Completa', 'ok'], faturada: ['Faturada', 'ok'] };
const pill = (map, k) => { const [t, c] = map[k] || [k, '']; return `<span class="dd-pill ${c}">${esc(t)}</span>`; };
// Concluídos (faturados / ligados) ficam ocultos; «Mostrar concluídos» volta a mostrá-los
const _conc = {};
try { Object.assign(_conc, JSON.parse(localStorage.getItem('ct_conc') || '{}')); } catch (e) { /* sem armazenamento */ }
function concluidos(tab, lista, ehConcluido, rotulo = 'concluídos') {
  const n = lista.filter(ehConcluido).length;
  const vis = _conc[tab] ? lista : lista.filter(x => !ehConcluido(x));
  const barra = n ? `<label class="ct-inl ct-chk ct-conc"><input type="checkbox" data-conc="${tab}"${_conc[tab] ? ' checked' : ''}> Mostrar ${rotulo} (${n})</label>` : '';
  return { vis, barra, n };
}
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
const refTxt = l => (l.art_ref || l.ref_forn) ? `<br><small class="mut">${[l.art_ref, l.ref_forn ? 'ref. fornecedor ' + l.ref_forn : ''].filter(Boolean).map(esc).join(' · ')}</small>` : '';
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
  const [p, c, e, o, f, g, ft] = await Promise.all([
    sb.from('ct_pedidos').select('*').order('id', { ascending: false }),
    sb.from('ct_cotacoes').select('*').order('id'),
    sb.from('ct_encomendas').select('*').order('id', { ascending: false }),
    sb.from('obras').select('id,nome,local,ativa,estado').order('nome'),
    sb.from('fornecedores').select('id,nome,nif,email,email_compras,ativo').order('nome'),
    sb.from('ct_guias').select('*').order('id', { ascending: false }),
    sb.from('ct_faturas').select('*').order('id', { ascending: false }),
  ]);
  for (const r of [p, c, e, g, ft]) if (r.error) throw r.error;
  _guias = g.data || []; _faturas = ft.data || [];
  _pedidos = p.data || []; _cotacoes = c.data || []; _encomendas = e.data || [];
  _obras = (o.data || []).filter(x => x.ativa !== false && (x.estado || 'em_curso') === 'em_curso');
  _fornecedores = (f.data || []).filter(x => x.ativo !== false);
}
async function recarregar() { await carregar(); desenhar(); }

// ═══════════════════ Ecrãs ═══════════════════
function desenhar() {
  const v = (tab, l, conc) => _conc[tab] ? l.length : l.filter(x => !conc(x)).length;   // o que está oculto não conta
  const n = { pedidos: v('pedidos', _pedidos, p => p.estado === 'faturado'), cotacoes: _pedidos.filter(p => p.estado === 'pedido' || p.estado === 'cotacao').length, encomendas: v('encomendas', _encomendas, e => e.estado === 'faturada'), guias: v('guias', _guias, g => g.estado === 'casada'), faturas: v('faturas', _faturas, f => f.estado === 'casada'), conferencia: _encomendas.length };
  $('ct-chips').innerHTML = [['pedidos', '1 · Pedidos'], ['cotacoes', '2 · Cotações'], ['encomendas', '3 · Encomendas'], ['guias', '4 · Guias'], ['faturas', '5 · Faturas'], ['conferencia', '6 · Conferência']]
    .map(([k, l]) => `<button type="button" class="d-chip-f${_tab === k ? ' on' : ''}" data-tab="${k}">${l}<b>${n[k]}</b></button>`).join('');
  $('ct-corpo').innerHTML = ({ pedidos: htmlPedidos, cotacoes: htmlCotacoes, encomendas: htmlEncomendas, guias: htmlGuias, faturas: htmlFaturas, conferencia: htmlConferencia })[_tab]();
}

function htmlPedidos() {
  const cc = concluidos('pedidos', _pedidos, p => p.estado === 'faturado', 'faturados');
  const acoes = `<div class="ct-acoes">${pode('pedir') ? '<button type="button" class="btn" data-act="novo-pedido">+ Novo pedido de compra</button>' : '<span class="mut">Como «' + esc(PAPEIS[_papel]) + '» não pode criar pedidos.</span>'}<span style="flex:1"></span>${cc.barra}</div>`;
  const linhas = cc.vis.map(p => `<tr class="clk" data-act="ver-pedido" data-id="${p.id}">
      <td><b>${esc(p.numero)}</b><br><small class="mut">${dataPT(p.criado_em)}</small></td>
      <td>${esc(p.titulo)}<br><small class="mut">${esc(p.obra_nome || 'Sem obra')}</small></td>
      <td>${(p.linhas || []).length}</td>
      <td>${p.urgencia && p.urgencia !== 'Normal' ? `<span class="dd-pill ${URG[p.urgencia] || ''}">${esc(p.urgencia)}</span>` : '<span class="mut">Normal</span>'}</td>
      <td>${p.data_necessaria ? dataPT(p.data_necessaria) : '<span class="mut">—</span>'}</td>
      <td>${esc(PAPEIS[p.pedido_por] || p.pedido_por || '—')}</td>
      <td>${pill(ESTADO_PEDIDO, p.estado)}</td></tr>`).join('');
  return acoes + `<div class="card ct-card">${cc.vis.length ? `<div class="tbl-wrap"><table class="cmp-t"><thead><tr><th>Nº</th><th>Pedido / Obra</th><th>Artigos</th><th>Urgência</th><th>Necessário até</th><th>Pedido por</th><th>Estado</th></tr></thead><tbody>${linhas}</tbody></table></div>` : _pedidos.length ? '<div class="d-empty">Todos os pedidos estão faturados. Use «Mostrar faturados» para os ver.</div>' : '<div class="d-empty">Ainda não há pedidos de compra. O diretor de obra (ou o encarregado) começa aqui o circuito.</div>'}</div>`;
}

function htmlCotacoes() {
  const todos = _pedidos.filter(p => p.estado === 'pedido' || p.estado === 'cotacao' || _cotacoes.some(c => c.pedido_id === p.id));
  const cc = concluidos('cotacoes', todos, p => p.estado === 'faturado', 'faturados'), lista = cc.vis;
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
  return (cc.barra ? `<div class="ct-acoes"><span style="flex:1"></span>${cc.barra}</div>` : '') + `<div class="card ct-card">${lista.length ? `<div class="tbl-wrap"><table class="cmp-t"><thead><tr><th>Nº</th><th>Pedido / Obra</th><th>Cotações</th><th>Nota de encomenda</th><th>Estado</th></tr></thead><tbody>${linhas}</tbody></table></div>` : '<div class="d-empty">Não há pedidos para cotar.</div>'}</div>`;
}

function htmlEncomendas() {
  const cc = concluidos('encomendas', _encomendas, e => e.estado === 'faturada', 'faturadas');
  const linhas = cc.vis.map(e => `<tr class="clk" data-act="ver-ne" data-id="${e.id}">
      <td><b>${esc(e.numero)}</b><br><small class="mut">${dataPT(e.emitida_em)}</small></td>
      <td>${esc(e.fornecedor)}<br><small class="mut">${esc(e.nif || '')}</small></td>
      <td>${esc(e.obra_nome || '—')}</td>
      <td>${(e.linhas || []).length}</td>
      <td class="r"><b>${eur(e.total)}</b></td>
      <td>${pill(ESTADO_NE, e.estado)}</td></tr>`).join('');
  return (cc.barra ? `<div class="ct-acoes"><span style="flex:1"></span>${cc.barra}</div>` : '') + `<div class="card ct-card">${cc.vis.length ? `<div class="tbl-wrap"><table class="cmp-t"><thead><tr><th>Nº</th><th>Fornecedor</th><th>Obra</th><th>Artigos</th><th class="r">Total (s/ IVA)</th><th>Estado</th></tr></thead><tbody>${linhas}</tbody></table></div>` : _encomendas.length ? '<div class="d-empty">Todas as notas de encomenda estão faturadas. Use «Mostrar faturadas» para as ver.</div>' : '<div class="d-empty">Ainda não há notas de encomenda. Elas nascem ao adjudicar uma cotação.</div>'}</div>`;
}

// ═══════════════════ Novo pedido ═══════════════════
let _np = null;
function abrirNovoPedido(ed) {
  _np = { linhas: ed ? (ed.linhas || []).map(l => ({ ...l, qtd: String(l.qtd).replace('.', ',') })) : [], id: ed?.id || null };
  const el = modal(`<div class="modal-title">${ed ? 'Editar pedido ' + esc(ed.numero) : 'Novo pedido de compra'}</div>
    <div class="modal-sub">${ed ? 'Altere os dados, as quantidades ou os materiais.' : 'Feito por «' + esc(PAPEIS[_papel]) + '». Escolha a obra e os materiais.'}</div>
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
    <div class="modal-footer"><button type="button" class="btn btn-secondary" data-act="fechar">Cancelar</button><button type="button" class="btn btn-primary" data-act="np-guardar">${ed ? 'Guardar alterações' : 'Criar pedido'}</button></div>`, 820);
  el.id = 'modal-np';
  if (ed) {
    $('np-obra').value = ed.obra_id || ''; $('np-titulo').value = ed.titulo || ''; $('np-urg').value = ed.urgencia || 'Normal';
    $('np-data').value = ed.data_necessaria || ''; $('np-notas').value = ed.notas || '';
  }
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
  box.innerHTML = _np.linhas.length ? `<table class="cmp-t ct-lt"><thead><tr><th>Artigo</th><th style="width:110px">Quantidade</th><th style="width:60px">Un</th><th style="width:40px"></th></tr></thead><tbody>${_np.linhas.map((l, i) => `<tr><td>${esc(l.desc)}${refTxt(l)}</td><td><input class="ct-n" type="text" inputmode="decimal" value="${esc(l.qtd)}" data-nq="${i}"></td><td>${esc(l.un)}</td><td><button type="button" class="ct-x" data-act="np-rem" data-i="${i}" title="Remover">×</button></td></tr>`).join('')}</tbody></table>` : '<div class="mut" style="padding:10px 2px">Ainda sem materiais.</div>';
}
async function guardarPedido() {
  const obraId = $('np-obra').value, obra = _obras.find(o => o.id === obraId);
  if (!obra) return toast('Escolha a obra.');
  if (!_np.linhas.length) return toast('Adicione pelo menos um material.');
  const linhas = _np.linhas.map(l => ({ ...l, qtd: num(l.qtd) || 0 }));
  if (linhas.some(l => l.qtd <= 0)) return toast('Indique a quantidade de todos os materiais.');
  const titulo = $('np-titulo').value.trim() || `${linhas[0].desc}${linhas.length > 1 ? ` e mais ${linhas.length - 1}` : ''}`;
  const dados = { obra_id: obra.id, obra_nome: obra.nome, titulo, urgencia: $('np-urg').value, data_necessaria: $('np-data').value || null, notas: $('np-notas').value.trim() || null, linhas };
  const b = document.querySelector('[data-act="np-guardar"]');
  if (_np.id) {   // edição
    const ped = _pedidos.find(x => x.id === _np.id);
    const chave = ls => JSON.stringify((ls || []).map(l => [l.desc, Number(l.qtd), l.un]));
    const mudou = chave(ped.linhas) !== chave(linhas);
    const comPrecos = _cotacoes.filter(c => c.pedido_id === ped.id && c.respondido_em).length;
    if (mudou && comPrecos && !await confirmar('Alterou os artigos ou as quantidades: os preços já registados nas cotações deste pedido serão apagados (os fornecedores ficam). Continuar?', 'Continuar')) return;
    b.disabled = true;
    const { error } = await sb.from('ct_pedidos').update(dados).eq('id', ped.id);
    if (error) { b.disabled = false; return toast('Não foi possível guardar: ' + String(error.message).slice(0, 140)); }
    if (mudou) await sb.from('ct_cotacoes').update({ precos: [], total: null, respondido_em: null }).eq('pedido_id', ped.id);
    fechar($('modal-np'));
    toast(`Pedido ${ped.numero} atualizado ✓`);
    return recarregar();
  }
  b.disabled = true;
  const { data, error } = await sb.from('ct_pedidos').insert({ ...dados, pedido_por: _papel, criado_por: _user }).select('numero').single();
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
    <table class="cmp-t ct-lt" style="margin-top:12px"><thead><tr><th>Artigo</th><th class="r">Quantidade</th><th>Un</th></tr></thead><tbody>${(p.linhas || []).map(l => `<tr><td>${esc(l.desc)}${refTxt(l)}</td><td class="r">${qtdTxt(l.qtd)}</td><td>${esc(l.un)}</td></tr>`).join('')}</tbody></table>
    ${cs.length ? `<div class="ct-sec">Cotações</div>${cs.map(c => `<div class="ct-linha"><span>${esc(c.fornecedor)}</span><span>${c.respondido_em ? eur(c.total) : '<span class="mut">à espera de preços</span>'}${c.escolhida ? ' <span class="dd-pill ok">Adjudicada</span>' : ''}</span></div>`).join('')}` : ''}
    ${ne ? `<div class="ct-sec">Nota de encomenda</div><div class="ct-linha"><span><b>${esc(ne.numero)}</b> · ${esc(ne.fornecedor)}</span><span>${eur(ne.total)}</span></div>` : ''}
    <div class="modal-footer"><button type="button" class="btn btn-secondary ct-perigo-o" data-act="apagar-pedido" data-id="${p.id}">Apagar pedido</button><span style="flex:1"></span><button type="button" class="btn btn-secondary" data-act="fechar">Fechar</button>${(pode('pedir') || pode('comprar')) ? (ne ? '<button type="button" class="btn btn-secondary" disabled title="Já tem nota de encomenda: apague-a para poder editar o pedido">Editar</button>' : `<button type="button" class="btn btn-secondary" data-act="editar-pedido" data-id="${p.id}">Editar</button>`) : ''}${pode('comprar') ? `<button type="button" class="btn btn-primary" data-act="cotar" data-id="${p.id}">${ne ? 'Ver cotações' : 'Cotar'}</button>` : ''}</div>`, 720);
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
  const minLinha = ls.map((_, i) => { const v = _cm.cots.map(c => num(c.pu[i])).filter(x => x != null); return v.length ? Math.min(...v) : null; });
  const melhor = completos.length ? completos.reduce((a, b) => res[a].total <= res[b].total ? a : b) : -1;
  el.querySelector('.ct-modal').innerHTML = `<div class="modal-title">Cotações · ${esc(p.numero)}</div>
    <div class="modal-sub">${esc(p.titulo)} · ${esc(p.obra_nome || 'Sem obra')} · ${pill(ESTADO_PEDIDO, p.estado)}</div>
    ${ne ? `<div class="ct-ok">Adjudicado: nota de encomenda <b>${esc(ne.numero)}</b> a ${esc(ne.fornecedor)} (${eur(ne.total)}).</div>` : ''}
    <div class="ct-sec">1 · Fornecedores a consultar</div>
    <div class="ct-forn">${_cm.cots.map((c, k) => `<span class="ct-chipf">${esc(c.fornecedor)}${c.enviado_em ? ' <i title="Pedido enviado">✉</i>' : ''}${ne ? '' : `<button type="button" data-act="cot-rem" data-k="${k}" title="Remover">×</button>`}</span>`).join('') || '<span class="mut">Ainda não escolheu fornecedores.</span>'}</div>
    ${ne ? '' : `<div class="ct-add"><input id="cf-q" type="text" placeholder="Procurar fornecedor (nome ou NIF) ou escrever um novo…" autocomplete="off" list="cf-lista"><datalist id="cf-lista">${sug.slice(0, 400).map(f => `<option value="${esc(f.nome)}">${esc(f.nif || '')}</option>`).join('')}</datalist><button type="button" class="btn btn-secondary btn-sm" data-act="cot-add">Adicionar</button>
      <button type="button" class="btn btn-secondary btn-sm" data-act="cot-enviar"${_cm.cots.length ? '' : ' disabled'}>✉ Pedir cotação por email</button>
      <button type="button" class="btn btn-secondary btn-sm" data-act="cot-sug"${_cm.cots.length ? '' : ' disabled'} title="Preenche os preços em branco com os da última fatura de cada fornecedor">Sugerir preços das últimas faturas</button></div>`}
    ${_cm.cots.length ? `<div class="ct-sec">2 · Preços recebidos (por unidade, sem IVA)</div>
    <div class="tbl-wrap"><table class="cmp-t ct-grid" style="width:max(100%,${340 + _cm.cots.length * 190}px)"><thead><tr><th>Artigo</th><th class="r">Qtd</th>${_cm.cots.map((c, k) => `<th class="ct-col${k === melhor ? ' best' : ''}">${esc(c.fornecedor)}${k === melhor ? '<br><small>mais barata</small>' : (melhor >= 0 && res[k].falta === 0 && res[melhor].total > 0 ? `<br><small class="mut">+${Math.round((res[k].total / res[melhor].total - 1) * 1000) / 10} % que a mais barata</small>` : '')}</th>`).join('')}</tr></thead>
    <tbody>${ls.map((l, i) => `<tr><td>${esc(l.desc)}<br><small class="mut">${esc(l.un)}</small></td><td class="r">${qtdTxt(l.qtd)}</td>${_cm.cots.map((c, k) => { const pu = num(c.pu[i]); return `<td class="ct-col${k === melhor ? ' best' : ''}${pu != null && pu === minLinha[i] && _cm.cots.length > 1 ? ' ct-min' : ''}"><input class="ct-n" type="text" inputmode="decimal" placeholder="0,00" value="${esc(c.pu[i])}" data-cp="${k}:${i}"${ne ? ' disabled' : ''}><div class="ct-sub" id="ct-s-${k}-${i}">${pu != null ? eur(pu * l.qtd) : ''}</div></td>`; }).join('')}</tr>`).join('')}
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
function cotarSugerir() {
  const ls = _cm.pedido.linhas || []; let n = 0, sem = [];
  _cm.cots.forEach(c => {
    const fa = _faturas.filter(f => mesmoForn({ nif: f.nif, fornecedor: f.fornecedor }, { nif: c.nif, fornecedor: c.fornecedor }) >= 0.9).sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
    if (!fa.length) { sem.push(c.fornecedor); return; }
    ls.forEach((l, i) => {
      if (num(c.pu[i]) != null) return;
      for (const f of fa) {
        const ass = atribuir(f.linhas, [l]);
        const k = ass.findIndex((x, q) => x === 0 && f.linhas[q].pu != null);
        if (k >= 0) { c.pu[i] = String(f.linhas[k].pu).replace('.', ','); n++; return; }
      }
    });
  });
  cotarDesenhar();
  toast(n ? `${n} preço${n !== 1 ? 's' : ''} sugerido${n !== 1 ? 's' : ''} a partir das últimas faturas — confira e carregue em «Guardar preços».` : 'Não há faturas deste fornecedor com preços para estes artigos.');
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
  const linhas = itens.map(({ l, pu }) => ({ desc: l.desc, art_ref: l.art_ref || null, ref_forn: l.ref_forn || null, desc_forn: l.desc_forn || null, un: l.un, qtd: l.qtd, pu, total: Math.round(pu * l.qtd * 100) / 100 }));
  const total = Math.round(linhas.reduce((s, x) => s + x.total, 0) * 100) / 100;
  const { data, error } = await sb.from('ct_encomendas').insert({
    pedido_id: p.id, cotacao_id: c.id, fornecedor_id: c.fornecedor_id, fornecedor: c.fornecedor, nif: c.nif,
    obra_id: p.obra_id, obra_nome: p.obra_nome, linhas, total, criado_por: _user,
  }).select('*').single();
  if (error) return toast('Não foi possível emitir a nota de encomenda: ' + String(error.message).slice(0, 140));
  await sb.from('ct_cotacoes').update({ escolhida: false }).eq('pedido_id', p.id);
  await sb.from('ct_cotacoes').update({ escolhida: true }).eq('id', c.id);
  await sb.from('ct_pedidos').update({ estado: 'encomendado' }).eq('id', p.id);
  await sincronizar(true);
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
    <table class="cmp-t ct-lt" style="margin-top:12px"><thead><tr><th>Artigo</th><th class="r">Qtd</th><th>Un</th><th class="r">Preço un.</th><th class="r">Total</th></tr></thead><tbody>${(e.linhas || []).map(l => `<tr><td>${esc(l.desc)}${refTxt(l)}</td><td class="r">${qtdTxt(l.qtd)}</td><td>${esc(l.un)}</td><td class="r">${eur(l.pu)}</td><td class="r">${eur(l.total)}</td></tr>`).join('')}
    <tr class="ct-tot"><td colspan="4"><b>Total (sem IVA)</b></td><td class="r"><b>${eur(e.total)}</b></td></tr></tbody></table>
    <div class="ct-add" style="margin-top:12px"><label class="ct-inl">Data da encomenda<input id="ne-data" type="date" value="${esc(String(e.emitida_em || '').slice(0, 10))}"></label>
      <button type="button" class="btn btn-secondary btn-sm" data-act="ne-data" data-id="${e.id}">Guardar data</button>
      <span class="mut">Serve para a ligação das guias (nos testes, use a data real da encomenda).</span></div>
    <div class="modal-footer"><button type="button" class="btn btn-secondary ct-perigo-o" data-act="apagar-ne" data-id="${e.id}">Apagar</button><span style="flex:1"></span><button type="button" class="btn btn-secondary" data-act="ver-conf" data-id="${e.id}">Conferência</button><button type="button" class="btn btn-secondary" data-act="imprimir-ne" data-id="${e.id}">Imprimir / PDF</button><button type="button" class="btn btn-primary" data-act="fechar">Fechar</button></div>`, 820);
}
async function guardarDataNE(id) {
  const e = _encomendas.find(x => String(x.id) === String(id)), d = $('ne-data').value;
  if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return toast('Escolha uma data válida.');
  const { error } = await sb.from('ct_encomendas').update({ emitida_em: d + 'T12:00:00Z' }).eq('id', e.id);
  if (error) return toast('Não foi possível guardar: ' + String(error.message).slice(0, 120));
  // volta a avaliar o que ainda não foi decidido à mão
  await sb.from('ct_guias').update({ estado: 'por_casar', encomenda_id: null }).eq('estado', 'sugerida').eq('sync_manual', false);
  await sb.from('ct_faturas').update({ estado: 'por_casar', encomenda_id: null }).eq('estado', 'sugerida').eq('sync_manual', false);
  document.querySelectorAll('.modal-bg.open').forEach(m => m.remove());
  await sincronizar(true);
  toast('Data da encomenda guardada ✓');
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

// ═══════════════════ Guias e faturas (carregar, ler com IA, ver) ═══════════════════
const BUCKET = 'guias-remessa';
const NIF_PLANDESE = '514913827';
const ESTADO_DOC = { por_casar: ['Por ligar', ''], sugerida: ['Sugerida', 'info'], casada: ['Ligada', 'ok'], divergente: ['Divergente', 'bad'] };
const neNum = id => _encomendas.find(e => e.id === id)?.numero || null;
const docNE = d => !d.encomenda_id ? '<span class="mut">—</span>' : `<span class="dd-pill ${d.estado === 'sugerida' ? 'info' : 'ok'}" title="${esc(d.sync_motivo || '')}">${d.estado === 'sugerida' ? 'Sugerida · ' : ''}${esc(neNum(d.encomenda_id) || '—')}${d.sync_score != null ? ' · ' + d.sync_score + ' %' : ''}</span>`;
const semLeitura = d => !d.numero && !(d.linhas || []).length;

let _pdfjs = null;
async function pdfjs() {
  if (_pdfjs) return _pdfjs;
  const mod = await import('pdfjs-dist');
  const lib = mod.getDocument ? mod : (mod.default || mod);
  try { const W = (await import('pdfjs-dist/build/pdf.worker.min.js?worker')).default; lib.GlobalWorkerOptions.workerPort = new W(); }
  catch (e) { try { lib.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.js?url')).default; } catch (e2) { /* sem worker */ } }
  return (_pdfjs = lib);
}
const canvasParaJpeg = (cv, q = 0.72) => new Promise(r => cv.toBlob(r, 'image/jpeg', q));
const ePdf = f => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);
async function paginasDe(file) {   // cada página (ou a imagem) em JPEG
  if (ePdf(file)) {
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const out = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const pg = await doc.getPage(n), vp = pg.getViewport({ scale: 1.6 });
      const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      out.push(await canvasParaJpeg(cv));
    }
    return out;
  }
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1700 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return [await canvasParaJpeg(cv)];
}
const paraBase64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
async function enviarFotos(blobs, prefixo) {
  const base = `${_user}/${prefixo}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const paths = [];
  for (let k = 0; k < blobs.length; k++) {
    const path = `${base}-p${k + 1}.jpg`;
    const up = await sb.storage.from(BUCKET).upload(path, blobs[k], { contentType: 'image/jpeg' });
    if (up.error) throw up.error;
    paths.push(path);
  }
  return paths;
}
async function urlsFotos(paths) {
  if (!paths?.length) return [];
  const { data } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
  return (data || []).map(x => x.signedUrl).filter(Boolean);
}
async function erroFuncao(error, data) {
  let msg = data?.error || error?.message || 'sem resposta';
  try { const j = await error?.context?.json?.(); if (j?.error) msg = j.error; } catch (e) { /* sem detalhe */ }
  return msg;
}

// ── Guias ──
let _obraGuia = '';
try { _obraGuia = localStorage.getItem('ct_obra_guia') || ''; } catch (e) { /* sem armazenamento */ }
let _pdfCadaPagina = true;
function htmlGuias() {
  const cc = concluidos('guias', _guias, g => g.estado === 'casada', 'ligadas');
  const linhas = cc.vis.map(g => `<tr class="clk" data-act="ver-guia" data-id="${g.id}">
      <td><b>${esc(g.numero || (semLeitura(g) ? 'Sem leitura' : '—'))}</b><br><small class="mut">${dataPT(g.criado_em)} · ${esc(PAPEIS[g.enviado_por] || g.enviado_por || '')}</small></td>
      <td>${esc(g.fornecedor || '—')}<br><small class="mut">${esc(g.nif || '')}</small></td>
      <td>${g.data ? dataPT(g.data) : '<span class="mut">—</span>'}</td>
      <td>${esc(g.obra_nome || '—')}</td>
      <td>${(g.linhas || []).length}</td>
      <td>${docNE(g)}</td>
      <td><span class="dd-pill ${ESTADO_DOC[g.estado]?.[1] || ''}">${esc(ESTADO_DOC[g.estado]?.[0] || g.estado)}</span></td></tr>`).join('');
  return `<div class="ct-acoes">
      <button type="button" class="btn" data-act="guias-carregar">Carregar guias</button>
      <input type="file" id="ct-gfiles" accept="image/*,application/pdf" multiple hidden>
      <label class="ct-inl">Obra<select id="ct-gobra"><option value="">— sem obra —</option>${_obras.map(o => `<option value="${esc(o.id)}"${o.id === _obraGuia ? ' selected' : ''}>${esc(o.nome)}</option>`).join('')}</select></label>
      <label class="ct-inl ct-chk"><input type="checkbox" id="ct-gpag"${_pdfCadaPagina ? ' checked' : ''}> PDF: cada página é uma guia</label>
      <span style="flex:1"></span>${cc.barra}
      <button type="button" class="btn btn-secondary btn-sm" data-act="guias-importar" title="Copia para aqui as guias já lidas na página «Guias de Remessa (teste)»">Importar guias do teste anterior</button>
    </div>
    <div class="card ct-card">${cc.vis.length ? `<div class="tbl-wrap"><table class="cmp-t"><thead><tr><th>Guia</th><th>Fornecedor</th><th>Data</th><th>Obra</th><th>Artigos</th><th>Nota de encomenda</th><th>Estado</th></tr></thead><tbody>${linhas}</tbody></table></div>` : _guias.length ? '<div class="d-empty">Todas as guias já estão ligadas. Use «Mostrar ligadas» para as ver.</div>' : '<div class="d-empty">Ainda não há guias. O encarregado ou o diretor de obra envia a foto ou o PDF da guia quando o material chega à obra.</div>'}</div>`;
}
async function lerGuiaIA(id, blobs) {
  const { data, error } = await sb.functions.invoke('ler-guia', { body: { paginas: await Promise.all(blobs.map(async b => ({ base64: await paraBase64(b), mediaType: 'image/jpeg' }))) } });
  const dl = data?.guia;
  if (error || !dl) throw new Error(await erroFuncao(error, data));
  const nif = String(dl.nif ?? '').replace(/\D/g, '').slice(-9);
  const upd = {
    linhas: (dl.linhas ?? []).map(l => ({ desc: l.descricao ?? '', ref_forn: l.ref_fornecedor ?? '', qtd: Number(l.qtd) || 0, un: l.un ?? '' })),
    confianca: Number(dl.confianca) || null, avisos: Array.isArray(dl.avisos) ? dl.avisos.filter(Boolean) : [],
  };
  if (dl.fornecedor) upd.fornecedor = String(dl.fornecedor);
  if (nif.length === 9 && nif !== NIF_PLANDESE) upd.nif = nif;
  if (dl.numero) upd.numero = String(dl.numero);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(dl.data ?? ''))) upd.data = dl.data;
  const { error: eu } = await sb.from('ct_guias').update(upd).eq('id', id);
  if (eu) throw eu;
}
async function carregarGuias(files) {
  const obra = _obras.find(o => o.id === $('ct-gobra').value) || null;
  _obraGuia = obra?.id || ''; try { localStorage.setItem('ct_obra_guia', _obraGuia); } catch (e) { /* sem armazenamento */ }
  _pdfCadaPagina = $('ct-gpag').checked;
  const grupos = [];
  try {
    for (const f of files) {
      toast(`A preparar ${f.name}…`);
      const pgs = await paginasDe(f);
      if (ePdf(f) && !_pdfCadaPagina) grupos.push(pgs); else pgs.forEach(b => grupos.push([b]));
    }
  } catch (err) { return toast('Não foi possível preparar os ficheiros: ' + String(err.message || err).slice(0, 140)); }
  let ok = 0, falhas = 0;
  for (let i = 0; i < grupos.length; i++) {
    toast(`A carregar e ler a guia ${i + 1} de ${grupos.length}…`);
    try {
      const paths = await enviarFotos(grupos[i], 'ctg');
      const ins = await sb.from('ct_guias').insert({
        obra_id: obra?.id || null, obra_nome: obra?.nome || null, foto_path: paths[0], fotos: paths, paginas: paths.length,
        enviado_por: _papel, criado_por: _user,
      }).select('id').single();
      if (ins.error) throw ins.error;
      try { await lerGuiaIA(ins.data.id, grupos[i]); ok++; } catch (e) { falhas++; console.warn('Leitura da guia:', e); }
    } catch (err) { falhas++; console.warn('Guia', i + 1, err); }
  }
  toast(`${grupos.length} guia${grupos.length !== 1 ? 's' : ''} carregada${grupos.length !== 1 ? 's' : ''}, ${ok} lida${ok !== 1 ? 's' : ''}${falhas ? ` (${falhas} com problema: abra a guia e use «Reler com IA»)` : ''} ✓`);
  await sincronizar(true);
}
async function verGuia(id) {
  const g = _guias.find(x => String(x.id) === String(id)); if (!g) return;
  const el = modal('<div class="d-empty">A abrir…</div>', 1000); el.id = 'modal-guia';
  const urls = await urlsFotos(g.fotos?.length ? g.fotos : [g.foto_path].filter(Boolean));
  el.querySelector('.ct-modal').innerHTML = `<div class="modal-title">Guia ${esc(g.numero || '(sem número)')}</div>
    <div class="modal-sub">Enviada por ${esc(PAPEIS[g.enviado_por] || g.enviado_por || '—')} em ${dataPT(g.criado_em)} · <span class="dd-pill ${ESTADO_DOC[g.estado]?.[1] || ''}">${esc(ESTADO_DOC[g.estado]?.[0] || g.estado)}</span> ${g.encomenda_id ? docNE(g) : ''}</div>
    ${(g.avisos || []).length ? `<div class="ct-nota">⚠ ${(g.avisos || []).map(esc).join(' · ')}</div>` : ''}
    ${htmlLigacao('g', g)}
    <div class="ct-docgrid">
      <div class="ct-fotos">${urls.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Guia"></a>`).join('') || '<div class="mut">Sem fotografia.</div>'}</div>
      <div>
        <div class="ct-form" style="margin-top:0">
          <label>Fornecedor<input id="gv-forn" type="text" value="${esc(g.fornecedor || '')}"></label>
          <div class="ct-2"><label>Nº da guia<input id="gv-num" type="text" value="${esc(g.numero || '')}"></label><label>Data<input id="gv-data" type="date" value="${esc(g.data || '')}"></label></div>
          <div class="ct-2"><label>NIF<input id="gv-nif" type="text" value="${esc(g.nif || '')}"></label>
          <label>Obra<select id="gv-obra"><option value="">— sem obra —</option>${_obras.map(o => `<option value="${esc(o.id)}"${o.id === g.obra_id ? ' selected' : ''}>${esc(o.nome)}</option>`).join('')}</select></label></div>
        </div>
        <div class="ct-sec">Materiais lidos</div>
        ${(g.linhas || []).length ? `<table class="cmp-t ct-lt"><thead><tr><th>Artigo</th><th class="r">Qtd</th><th>Un</th></tr></thead><tbody>${g.linhas.map(l => `<tr><td>${esc(l.desc)}${l.ref_forn ? `<br><small class="mut">${esc(l.ref_forn)}</small>` : ''}</td><td class="r">${qtdTxt(l.qtd)}</td><td>${esc(l.un)}</td></tr>`).join('')}</tbody></table>` : '<div class="mut">Sem materiais lidos. Use «Reler com IA».</div>'}
      </div>
    </div>
    <div class="modal-footer"><button type="button" class="btn btn-secondary ct-perigo-o" data-act="apagar-guia" data-id="${g.id}">Apagar</button><span style="flex:1"></span>
      <button type="button" class="btn btn-secondary" data-act="anexar" data-t="g" data-id="${g.id}">${(g.fotos || []).length ? 'Substituir ficheiro' : 'Anexar ficheiro'}</button>
      <button type="button" class="btn btn-secondary" data-act="reler-guia" data-id="${g.id}">Reler com IA</button>
      <button type="button" class="btn btn-secondary" data-act="guardar-guia" data-id="${g.id}">Guardar dados</button>
      <button type="button" class="btn btn-primary" data-act="fechar">Fechar</button></div>`;
}
async function guardarGuia(id) {
  const obra = _obras.find(o => o.id === $('gv-obra').value) || null;
  const { error } = await sb.from('ct_guias').update({
    fornecedor: $('gv-forn').value.trim() || null, numero: $('gv-num').value.trim() || null, data: $('gv-data').value || null,
    nif: $('gv-nif').value.replace(/\D/g, '').slice(-9) || null, obra_id: obra?.id || null, obra_nome: obra?.nome || null,
  }).eq('id', id);
  if (error) return toast('Não foi possível guardar: ' + String(error.message).slice(0, 120));
  toast('Dados da guia guardados ✓');
  await recarregar(); topo()?.remove();
}
async function relerGuia(id) {
  const g = _guias.find(x => String(x.id) === String(id)); if (!g) return;
  toast('A ler a guia com IA…');
  try {
    const blobs = [];
    for (const p of (g.fotos?.length ? g.fotos : [g.foto_path])) { const { data, error } = await sb.storage.from(BUCKET).download(p); if (error) throw error; blobs.push(data); }
    await lerGuiaIA(g.id, blobs);
    toast('Guia lida ✓');
  } catch (e) { return toast('Não foi possível ler a guia: ' + String(e.message || e).slice(0, 140)); }
  await recarregar(); topo()?.remove(); verGuia(id);
}
async function apagarGuia(id) {
  if (!await confirmar('Apagar esta guia?', 'Apagar', true)) return;
  const { data, error } = await sb.from('ct_guias').delete().eq('id', id).select('id');
  if (error || !data?.length) return toast('Não foi possível apagar: ' + String(error?.message || 'sem permissão').slice(0, 120));
  document.querySelectorAll('.modal-bg.open').forEach(m => m.remove());
  toast('Guia apagada'); await recarregar();
}
async function importarGuias() {
  const { data: gt, error } = await sb.from('gt_guias').select('id,numero,fornecedor,nif,data,obra_nome,linhas,confianca,avisos,foto_path,fotos,paginas,criado_em');
  if (error) return toast('Não foi possível ler as guias do teste anterior: ' + String(error.message).slice(0, 120));
  const { data: ja } = await sb.from('ct_guias').select('origem_gt_id').not('origem_gt_id', 'is', null);
  const feitas = new Set((ja || []).map(x => x.origem_gt_id));
  const novas = (gt || []).filter(g => !feitas.has(g.id));
  if (!novas.length) return toast('Não há guias novas para importar.');
  if (!await confirmar(`Copiar ${novas.length} guia${novas.length !== 1 ? 's' : ''} já lida${novas.length !== 1 ? 's' : ''} do teste anterior? Ficam por ligar às notas de encomenda; as originais não são alteradas.`, 'Importar')) return;
  let n = 0;
  for (let i = 0; i < novas.length; i += 40) {
    const lote = novas.slice(i, i + 40).map(g => ({
      numero: g.numero, fornecedor: g.fornecedor, nif: g.nif, data: g.data, obra_nome: g.obra_nome, linhas: g.linhas || [], confianca: g.confianca,
      avisos: g.avisos || [], foto_path: g.foto_path, fotos: g.fotos || [], paginas: g.paginas || 1, origem_gt_id: g.id, criado_por: _user, criado_em: g.criado_em,
    }));
    const { error: ei } = await sb.from('ct_guias').insert(lote);
    if (ei) return toast('Importação interrompida: ' + String(ei.message).slice(0, 120));
    n += lote.length;
  }
  toast(`${n} guias importadas ✓`); await sincronizar(true);
}

// ── Faturas ──
function htmlFaturas() {
  const cc = concluidos('faturas', _faturas, f => f.estado === 'casada', 'ligadas');
  const linhas = cc.vis.map(f => `<tr class="clk" data-act="ver-fatura" data-id="${f.id}">
      <td><b>${esc(f.numero || (semLeitura(f) ? 'Sem leitura' : '—'))}</b><br><small class="mut">${dataPT(f.criado_em)}</small></td>
      <td>${esc(f.fornecedor || '—')}<br><small class="mut">${esc(f.nif || '')}</small></td>
      <td>${f.data ? dataPT(f.data) : '<span class="mut">—</span>'}</td>
      <td>${esc(f.centro_custo || '—')}</td>
      <td class="r"><b>${f.total != null ? eur(f.total) : '—'}</b><br><small class="mut">${f.base != null ? 'base ' + eur(f.base) : ''}</small></td>
      <td>${(f.guias_ref || []).length ? esc((f.guias_ref || []).join(', ')) : '<span class="mut">—</span>'}</td>
      <td>${docNE(f)}</td>
      <td><span class="dd-pill ${ESTADO_DOC[f.estado]?.[1] || ''}">${esc(ESTADO_DOC[f.estado]?.[0] || f.estado)}</span></td></tr>`).join('');
  return `<div class="ct-acoes"><button type="button" class="btn" data-act="faturas-carregar">Carregar faturas</button><input type="file" id="ct-ffiles" accept="image/*,application/pdf" multiple hidden>
      <span class="mut">Cada ficheiro é uma fatura (PDF ou fotografia). O portal lê-a com IA.</span><span style="flex:1"></span>${cc.barra}</div>
    <div class="card ct-card">${cc.vis.length ? `<div class="tbl-wrap"><table class="cmp-t"><thead><tr><th>Fatura</th><th>Fornecedor</th><th>Data</th><th>Centro de custo</th><th class="r">Total</th><th>Guias citadas</th><th>Nota de encomenda</th><th>Estado</th></tr></thead><tbody>${linhas}</tbody></table></div>` : _faturas.length ? '<div class="d-empty">Todas as faturas já estão ligadas. Use «Mostrar ligadas» para as ver.</div>' : '<div class="d-empty">Ainda não há faturas. Carregue a fatura do fornecedor depois de as guias estarem registadas.</div>'}</div>`;
}
async function carregarFaturas(files) {
  let ok = 0, falhas = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    toast(`A ler a fatura ${i + 1} de ${files.length} (${f.name})…`);
    try {
      const pgs = await paginasDe(f);
      const mediaType = ePdf(f) ? 'application/pdf' : /\.png$/i.test(f.name) ? 'image/png' : 'image/jpeg';
      const { data, error } = await sb.functions.invoke('ler-fatura', { body: { base64: await paraBase64(f), mediaType, obras: _obras.map(o => ({ nome: o.nome, local: o.local || '' })) } });
      const c = data?.fatura;
      if (error || !c) throw new Error(await erroFuncao(error, data));
      const n2 = v => (v == null || v === '' || isNaN(Number(v))) ? null : Math.round(Number(v) * 100) / 100;
      const nif = String(c.nif || '').replace(/\D/g, '').slice(-9);
      const normNum = String(c.numero || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (normNum && _faturas.some(x => x.numero_norm === normNum && (!nif || !x.nif || x.nif === nif))) { falhas++; toast(`A fatura ${c.numero} já existe.`); await new Promise(r => setTimeout(r, 1800)); continue; }
      const paths = await enviarFotos(pgs, 'ctf');
      const { error: ei } = await sb.from('ct_faturas').insert({
        numero: c.numero || null, fornecedor: c.fornecedor || null, nif: nif.length === 9 && nif !== NIF_PLANDESE ? nif : null,
        data: /^\d{4}-\d{2}-\d{2}$/.test(String(c.data || '')) ? c.data : null, data_vencimento: /^\d{4}-\d{2}-\d{2}$/.test(String(c.data_vencimento || '')) ? c.data_vencimento : null,
        base: n2(c.base), iva: n2(c.iva), total: n2(c.total), centro_custo: c.centro_custo || null,
        linhas: (c.linhas || []).map(l => ({ desc: l.descricao ?? '', ref_forn: l.ref_fornecedor ?? '', qtd: Number(l.qtd) || 0, un: l.un ?? '', pu: n2(l.preco_unit), total: n2(l.total_linha) })),
        guias_ref: Array.isArray(c.guias_ref) ? c.guias_ref.filter(Boolean) : [], confianca: Number(c.confianca) || null,
        avisos: Array.isArray(c.avisos) ? c.avisos.filter(Boolean) : [], fotos: paths, ficheiro: f.name, criado_por: _user,
      });
      if (ei) throw ei;
      ok++;
    } catch (err) { falhas++; console.warn('Fatura', f.name, err); toast(`Fatura ${f.name}: ${String(err.message || err).slice(0, 140)}`); await new Promise(r => setTimeout(r, 1800)); }
  }
  toast(`${ok} de ${files.length} faturas carregadas e lidas${falhas ? ` (${falhas} com problema)` : ''} ✓`);
  await sincronizar(true);
}
async function verFatura(id) {
  const f = _faturas.find(x => String(x.id) === String(id)); if (!f) return;
  const el = modal('<div class="d-empty">A abrir…</div>', 1000); el.id = 'modal-fatura';
  const urls = await urlsFotos(f.fotos);
  el.querySelector('.ct-modal').innerHTML = `<div class="modal-title">Fatura ${esc(f.numero || '(sem número)')}</div>
    <div class="modal-sub">${esc(f.fornecedor || '—')}${f.nif ? ' · NIF ' + esc(f.nif) : ''} · ${f.data ? dataPT(f.data) : 'sem data'} · <span class="dd-pill ${ESTADO_DOC[f.estado]?.[1] || ''}">${esc(ESTADO_DOC[f.estado]?.[0] || f.estado)}</span> ${f.encomenda_id ? docNE(f) : ''}</div>
    ${(f.avisos || []).length ? `<div class="ct-nota">⚠ ${(f.avisos || []).map(esc).join(' · ')}</div>` : ''}
    ${htmlLigacao('f', f)}
    <div class="ct-docgrid">
      <div class="ct-fotos">${urls.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Fatura"></a>`).join('') || '<div class="mut">Sem imagem.</div>'}</div>
      <div>
        <div class="ct-linha"><span>Base</span><b>${f.base != null ? eur(f.base) : '—'}</b></div><div class="ct-linha"><span>IVA</span><b>${f.iva != null ? eur(f.iva) : '—'}</b></div><div class="ct-linha"><span>Total</span><b>${f.total != null ? eur(f.total) : '—'}</b></div>
        <div class="ct-linha"><span>Centro de custo</span><span>${esc(f.centro_custo || '—')}</span></div>
        ${(f.guias_ref || []).length ? `<div class="ct-linha"><span>Guias citadas</span><span>${esc(f.guias_ref.join(', '))}</span></div>` : ''}
        <div class="ct-sec">Artigos faturados</div>
        ${(f.linhas || []).length ? `<table class="cmp-t ct-lt"><thead><tr><th>Artigo</th><th class="r">Qtd</th><th>Un</th><th class="r">Preço un.</th><th class="r">Total</th></tr></thead><tbody>${f.linhas.map(l => `<tr><td>${esc(l.desc)}${l.ref_forn ? `<br><small class="mut">${esc(l.ref_forn)}</small>` : ''}</td><td class="r">${qtdTxt(l.qtd)}</td><td>${esc(l.un)}</td><td class="r">${l.pu != null ? eur(l.pu) : '—'}</td><td class="r">${l.total != null ? eur(l.total) : '—'}</td></tr>`).join('')}</tbody></table>` : '<div class="mut">A fatura não tem artigos lidos.</div>'}
      </div>
    </div>
    <div class="modal-footer"><button type="button" class="btn btn-secondary ct-perigo-o" data-act="apagar-fatura" data-id="${f.id}">Apagar</button><span style="flex:1"></span><button type="button" class="btn btn-secondary" data-act="anexar" data-t="f" data-id="${f.id}">${(f.fotos || []).length ? 'Substituir ficheiro' : 'Anexar ficheiro'}</button><button type="button" class="btn btn-primary" data-act="fechar">Fechar</button></div>`;
}
function anexarFicheiro(t, id) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*,application/pdf'; inp.multiple = true;
  inp.onchange = async () => {
    const fs = [...inp.files]; if (!fs.length) return;
    try {
      toast('A anexar…');
      const blobs = []; for (const f of fs) blobs.push(...await paginasDe(f));
      const paths = await enviarFotos(blobs, t === 'g' ? 'ctg' : 'ctf');
      const upd = t === 'g' ? { fotos: paths, foto_path: paths[0], paginas: paths.length } : { fotos: paths };
      const { error } = await sb.from(tabelaDe(t)).update(upd).eq('id', id);
      if (error) throw error;
      toast('Ficheiro anexado ✓');
      await recarregar(); document.querySelectorAll('.modal-bg.open').forEach(m => m.remove()); (t === 'g' ? verGuia : verFatura)(id);
    } catch (err) { toast('Não foi possível anexar: ' + String(err.message || err).slice(0, 140)); }
  };
  inp.click();
}
async function apagarFatura(id) {
  if (!await confirmar('Apagar esta fatura?', 'Apagar', true)) return;
  const { data, error } = await sb.from('ct_faturas').delete().eq('id', id).select('id');
  if (error || !data?.length) return toast('Não foi possível apagar: ' + String(error?.message || 'sem permissão').slice(0, 120));
  document.querySelectorAll('.modal-bg.open').forEach(m => m.remove());
  toast('Fatura apagada'); await recarregar();
}

// ═══════════════════ Sincronização e conferência ═══════════════════
const tabelaDe = t => (t === 'g' ? 'ct_guias' : 'ct_faturas');
const listaDe = t => (t === 'g' ? _guias : _faturas);
const ligadasG = (neId, ignorar) => _guias.filter(g => g.encomenda_id === neId && g.id !== ignorar && (g.estado === 'casada' || g.estado === 'divergente'));
const pedidoEstadoDe = { emitida: 'encomendado', parcial: 'parcial', completa: 'entregue', faturada: 'faturado' };

let _sincronizando = false;
async function sincronizar(silencioso) {
  if (_sincronizando) return;
  _sincronizando = true;
  try {
    await carregar();
    let nG = 0, nF = 0, sug = 0;
    const mudou = (d, x) => d.estado !== x.estado || d.encomenda_id !== x.neId || d.sync_score !== x.score || d.sync_motivo !== x.motivo;
    for (const [t, lista] of [['g', _guias], ['f', _faturas]]) {
      const pend = lista.filter(d => !d.sync_manual && (d.estado === 'por_casar' || d.estado === 'sugerida')).reverse();   // mais antigos primeiro
      for (const d of pend) {
        const cands = _encomendas.map(ne => ({ neId: ne.id, ...(t === 'g' ? scoreGuia(d, ne, ligadasG(ne.id, d.id)) : scoreFatura(d, ne, ligadasG(ne.id))) }));
        const x = decidir(cands);
        if (!mudou(d, x)) continue;
        const { error } = await sb.from(tabelaDe(t)).update({ encomenda_id: x.neId, estado: x.estado, sync_score: x.score, sync_motivo: x.motivo }).eq('id', d.id);
        if (error) { toast('Não foi possível sincronizar: ' + String(error.message).slice(0, 120)); continue; }
        Object.assign(d, { encomenda_id: x.neId, estado: x.estado, sync_score: x.score, sync_motivo: x.motivo });
        if (x.estado === 'casada') { if (t === 'g') nG++; else nF++; } else if (x.estado === 'sugerida') sug++;
      }
    }
    await atualizarEstados();
    await carregar();
    desenhar();
    if (!silencioso || nG || nF || sug) toast(nG || nF || sug ? `Sincronizado: ${nG} guia${nG !== 1 ? 's' : ''} e ${nF} fatura${nF !== 1 ? 's' : ''} ligadas${sug ? `, ${sug} sugestão(ões) para confirmar` : ''} ✓` : 'Nada de novo para ligar.');
  } finally { _sincronizando = false; }
}
// Estado das encomendas/pedidos e marca de divergência nos documentos ligados, a partir da conferência
async function atualizarEstados() {
  for (const ne of _encomendas) {
    const c = conferir(ne, _guias, _faturas);
    if (c.estado !== ne.estado) { await sb.from('ct_encomendas').update({ estado: c.estado }).eq('id', ne.id); ne.estado = c.estado; }
    const p = _pedidos.find(x => x.id === ne.pedido_id), alvo = pedidoEstadoDe[c.estado];
    if (p && alvo && p.estado !== alvo && ['encomendado', 'parcial', 'entregue', 'faturado'].includes(p.estado)) { await sb.from('ct_pedidos').update({ estado: alvo }).eq('id', p.id); p.estado = alvo; }
    for (const [t, docs] of [['g', _guias], ['f', _faturas]]) {
      for (const d of docs.filter(x => x.encomenda_id === ne.id && (x.estado === 'casada' || x.estado === 'divergente'))) {
        const novo = (c.docFlags[t + d.id] || []).length ? 'divergente' : 'casada';
        if (d.estado !== novo) { await sb.from(tabelaDe(t)).update({ estado: novo }).eq('id', d.id); d.estado = novo; }
      }
    }
  }
}
async function ligarDoc(t, id) {
  const neId = Number($('lig-ne').value);
  if (!neId) return toast('Escolha a nota de encomenda.');
  const d = listaDe(t).find(x => String(x.id) === String(id)), ne = _encomendas.find(e => e.id === neId);
  if (!d || !ne) return;
  const sc = t === 'g' ? scoreGuia(d, ne, ligadasG(neId, d.id)) : scoreFatura(d, ne, ligadasG(neId));
  const { error } = await sb.from(tabelaDe(t)).update({ encomenda_id: neId, estado: 'casada', sync_manual: true, sync_score: sc.score, sync_motivo: 'Ligada à mão' + (sc.motivo ? ` (${sc.motivo})` : '') }).eq('id', d.id);
  if (error) return toast('Não foi possível ligar: ' + String(error.message).slice(0, 120));
  document.querySelectorAll('.modal-bg.open').forEach(m => m.remove());
  await sincronizar(true);
  toast(`Ligada à nota de encomenda ${ne.numero} ✓`);
}
async function desligarDoc(t, id) {
  const { error } = await sb.from(tabelaDe(t)).update({ encomenda_id: null, estado: 'por_casar', sync_manual: true, sync_score: null, sync_motivo: 'Desligada à mão' }).eq('id', id);
  if (error) return toast('Não foi possível desfazer: ' + String(error.message).slice(0, 120));
  document.querySelectorAll('.modal-bg.open').forEach(m => m.remove());
  await sincronizar(true);
  toast('Ligação desfeita');
}
async function autoDoc(t, id) {
  const { error } = await sb.from(tabelaDe(t)).update({ sync_manual: false }).eq('id', id);
  if (error) return toast('Não foi possível: ' + String(error.message).slice(0, 120));
  document.querySelectorAll('.modal-bg.open').forEach(m => m.remove());
  await sincronizar(false);
}
function htmlLigacao(t, d) {
  const ne = d.encomenda_id ? _encomendas.find(e => e.id === d.encomenda_id) : null;
  const flags = ne && (d.estado === 'casada' || d.estado === 'divergente') ? (conferir(ne, _guias, _faturas).docFlags[t + d.id] || []) : [];
  const opts = _encomendas.map(e => `<option value="${e.id}"${e.id === d.encomenda_id ? ' selected' : ''}>${esc(e.numero)} · ${esc(e.fornecedor)} · ${esc(e.obra_nome || '')}</option>`).join('');
  return `<div class="ct-sec" style="margin-top:14px">Nota de encomenda</div>
    ${ne ? `<div class="ct-nota">${d.estado === 'sugerida' ? 'Sugestão do portal' : 'Ligada'}: <b>${esc(ne.numero)}</b>${d.sync_score != null ? ` (${d.sync_score} %)` : ''}${d.sync_motivo ? ` — ${esc(d.sync_motivo)}` : ''}${d.sync_manual ? ' · feito à mão' : ''}</div>` : (d.sync_motivo ? `<div class="ct-nota">${esc(d.sync_motivo)}</div>` : '')}
    ${flags.length ? `<div class="ct-flags">${flags.map(x => `<span class="dd-pill bad">${esc(x)}</span>`).join(' ')}</div>` : ''}
    <div class="ct-add" style="margin-top:10px"><select id="lig-ne" class="ct-sel"><option value="">— escolher a encomenda —</option>${opts}</select>
      <button type="button" class="btn btn-primary btn-sm" data-act="ligar-doc" data-t="${t}" data-id="${d.id}">${d.estado === 'sugerida' ? 'Confirmar' : 'Ligar'}</button>
      ${d.encomenda_id && d.estado !== 'sugerida' ? `<button type="button" class="btn btn-secondary btn-sm" data-act="desligar-doc" data-t="${t}" data-id="${d.id}">Desfazer</button>` : ''}
      ${d.sync_manual ? `<button type="button" class="btn btn-secondary btn-sm" data-act="auto-doc" data-t="${t}" data-id="${d.id}">Deixar o portal decidir</button>` : ''}</div>`;
}

const barra = (p, cls = '') => `<div class="ct-prog"><div class="ct-bar ${cls}"><i style="width:${Math.round(Math.min(1, p) * 100)}%"></i></div><b>${Math.round(p * 100)} %</b></div>`;
const alertasNE = (ne, c) => alertas(ne, c, _cotacoes.find(x => x.id === ne.cotacao_id)?.prazo_dias);
function htmlConferencia() {
  const gPor = _guias.filter(g => g.estado === 'por_casar').length, fPor = _faturas.filter(f => f.estado === 'por_casar').length;
  const sug = _guias.filter(g => g.estado === 'sugerida').length + _faturas.filter(f => f.estado === 'sugerida').length;
  const nAl = _encomendas.reduce((s, ne) => s + alertasNE(ne, conferir(ne, _guias, _faturas)).length, 0);
  const resumo = `<div class="ct-resumo">
      <div><b>${gPor}</b><span>guia${gPor !== 1 ? 's' : ''} por ligar</span></div><div><b>${fPor}</b><span>fatura${fPor !== 1 ? 's' : ''} por ligar</span></div>
      <div class="${sug ? 'warn' : ''}"><b>${sug}</b><span>sugest${sug !== 1 ? 'ões' : 'ão'} a confirmar</span></div>
      <div class="${nAl ? 'bad' : ''}"><b>${nAl}</b><span>alerta${nAl !== 1 ? 's' : ''} de prazo</span></div>
      <button type="button" class="btn btn-secondary btn-sm" data-act="sync">Sincronizar agora</button></div>`;
  const linhas = _encomendas.map(ne => {
    const c = conferir(ne, _guias, _faturas);
    return `<tr class="clk" data-act="ver-conf" data-id="${ne.id}">
      <td><b>${esc(ne.numero)}</b><br><small class="mut">${dataPT(ne.emitida_em)}</small></td>
      <td>${esc(ne.fornecedor)}<br><small class="mut">${esc(ne.obra_nome || '')}</small></td>
      <td class="r"><b>${eur(ne.total)}</b></td>
      <td>${barra(c.recPct)}<small class="mut">${c.guias.length} guia${c.guias.length !== 1 ? 's' : ''}</small></td>
      <td>${barra(c.fatPct, 'f')}<small class="mut">${c.faturas.length} fatura${c.faturas.length !== 1 ? 's' : ''}</small></td>
      <td>${c.divergencias ? `<span class="dd-pill bad">${c.divergencias} divergência${c.divergencias !== 1 ? 's' : ''}</span>` : (c.guias.length || c.faturas.length ? '<span class="dd-pill ok">Sem divergências</span>' : '<span class="mut">—</span>')}${alertasNE(ne, c).map(a => `<br><span class="dd-pill ${a.cls}">${esc(a.txt)}</span>`).join('')}</td>
      <td>${pill(ESTADO_NE, ne.estado)}</td></tr>`;
  }).join('');
  return resumo + `<div class="card ct-card">${_encomendas.length ? `<div class="tbl-wrap"><table class="cmp-t"><thead><tr><th>Nota de encomenda</th><th>Fornecedor / Obra</th><th class="r">Total</th><th>Recebido</th><th>Faturado</th><th>Conferência</th><th>Estado</th></tr></thead><tbody>${linhas}</tbody></table></div>` : '<div class="d-empty">Sem notas de encomenda para conferir.</div>'}</div>`;
}
function exportarConf(id) {
  const ne = _encomendas.find(x => String(x.id) === String(id)); if (!ne) return;
  const c = conferir(ne, _guias, _faturas);
  const n = v => String(Number(v) || 0).replace('.', ','), q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const linhas = [['Artigo', 'Un', 'Encomendado', 'Recebido', 'Faturado', 'Preço adjudicado', 'Preço faturado', 'Alertas'].map(q).join(';')];
  c.linhas.forEach(l => linhas.push([q(l.desc), q(l.un), n(l.qtd), n(l.rec), n(l.fat), n(l.pu), l.puFat != null ? n(l.puFat) : '', q(l.flags.join(' | '))].join(';')));
  linhas.push('', ['Guias ligadas', ...c.guias.map(g => g.numero || '—')].map(q).join(';'), ['Faturas ligadas', ...c.faturas.map(f => f.numero || '—')].map(q).join(';'));
  const blob = new Blob(['\ufeff' + `${q(ne.numero + ' · ' + ne.fornecedor + ' · ' + (ne.obra_nome || ''))}\r\n` + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `conferencia-${ne.numero}.csv`; document.body.appendChild(a); a.click(); a.remove();
}
function imprimirConf(id) {
  const ne = _encomendas.find(x => String(x.id) === String(id)); if (!ne) return;
  const c = conferir(ne, _guias, _faturas);
  const w = window.open('', '_blank'); if (!w) return toast('O navegador bloqueou a janela de impressão.');
  w.document.write(`<!DOCTYPE html><html lang="pt"><head><meta charset="utf-8"><title>Conferência ${esc(ne.numero)}</title><style>
    body{font-family:system-ui,Arial,sans-serif;color:#1b2130;margin:30px}h1{font-size:20px;margin:0 0 4px}.m{color:#5d6678;font-size:12.5px}
    table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}th{text-align:left;border-bottom:2px solid #173f9f;padding:7px 5px;font-size:10.5px;text-transform:uppercase}
    td{border-bottom:1px solid #dde2ea;padding:7px 5px}.r{text-align:right}.bad{color:#b42318;font-weight:700}.ok{color:#067647}
  </style></head><body><h1>Conferência · ${esc(ne.numero)}</h1><div class="m">${esc(ne.fornecedor)} · ${esc(ne.obra_nome || '—')} · total adjudicado ${eur(ne.total)} · recebido ${Math.round(c.recPct * 100)} % · faturado ${Math.round(c.fatPct * 100)} % · ${c.divergencias} divergência(s)</div>
  <table><thead><tr><th>Artigo</th><th class="r">Encom.</th><th class="r">Recebido</th><th class="r">Faturado</th><th class="r">Preço adj.</th><th class="r">Preço fat.</th><th>Alertas</th></tr></thead><tbody>
  ${c.linhas.map(l => `<tr><td>${esc(l.desc)}</td><td class="r">${qtdTxt(l.qtd)}</td><td class="r">${qtdTxt(l.rec)}</td><td class="r">${qtdTxt(l.fat)}</td><td class="r">${eur(l.pu)}</td><td class="r">${l.puFat != null ? eur(l.puFat) : '—'}</td><td class="${l.flags.length ? 'bad' : 'ok'}">${l.flags.length ? esc(l.flags.join(' · ')) : 'OK'}</td></tr>`).join('')}</tbody></table>
  <p class="m">Guias: ${esc(c.guias.map(g => g.numero || '—').join(', ') || 'nenhuma')}<br>Faturas: ${esc(c.faturas.map(f => f.numero || '—').join(', ') || 'nenhuma')}</p></body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}
function verConferencia(id) {
  const ne = _encomendas.find(x => String(x.id) === String(id)); if (!ne) return;
  const c = conferir(ne, _guias, _faturas);
  const cel = (v, q) => v ? `<span class="ct-q ${v > q * (1 + TOLERANCIA) ? 'bad' : v >= q * (1 - TOLERANCIA) ? 'ok' : 'warn'}">${qtdTxt(v)}</span>` : '<span class="mut">0</span>';
  const doc = (d, t) => `<div class="ct-linha clk" data-act="${t === 'g' ? 'ver-guia' : 'ver-fatura'}" data-id="${d.id}"><span><b>${esc(d.numero || '—')}</b> <small class="mut">${dataPT(d.data)}</small></span><span>${d.estado === 'divergente' ? '<span class="dd-pill bad">Divergente</span>' : '<span class="dd-pill ok">Ligada</span>'}</span></div>`;
  modal(`<div class="modal-title">Conferência · ${esc(ne.numero)}</div>
    <div class="modal-sub">${esc(ne.fornecedor)} · ${esc(ne.obra_nome || '—')} · ${pill(ESTADO_NE, ne.estado)}</div>
    ${alertasNE(ne, c).map(a => `<div class="ct-nota"><span class="dd-pill ${a.cls}">${esc(a.txt)}</span></div>`).join('')}
    <div class="ct-resumo" style="margin-top:12px"><div><b>${Math.round(c.recPct * 100)} %</b><span>recebido</span></div><div><b>${Math.round(c.fatPct * 100)} %</b><span>faturado</span></div><div class="${c.divergencias ? 'bad' : ''}"><b>${c.divergencias}</b><span>divergência${c.divergencias !== 1 ? 's' : ''}</span></div></div>
    <table class="cmp-t ct-lt ct-conf-t"><thead><tr><th>Artigo</th><th class="r">Encomendado</th><th class="r">Recebido</th><th class="r">Faturado</th><th class="r">Preço adj.</th><th class="r">Preço fat.</th></tr></thead>
    <tbody>${c.linhas.map(l => `<tr><td>${esc(l.desc)}<br><small class="mut">${esc(l.un)}</small>${l.flags.length ? `<div class="ct-flags">${l.flags.map(x => `<span class="dd-pill bad">${esc(x)}</span>`).join(' ')}</div>` : ''}</td>
      <td class="r">${qtdTxt(l.qtd)}</td><td class="r">${cel(l.rec, l.qtd)}</td><td class="r">${cel(l.fat, l.qtd)}</td><td class="r">${eur(l.pu)}</td>
      <td class="r">${l.puFat != null ? `<span class="ct-q ${Math.abs(l.puFat - l.pu) / (l.pu || 1) > TOLERANCIA ? 'bad' : 'ok'}">${eur(l.puFat)}</span>` : '<span class="mut">—</span>'}</td></tr>`).join('')}</tbody></table>
    ${c.foraG.length || c.foraF.length ? `<div class="ct-sec">Fora da encomenda</div>${[...c.foraG.map(x => `Guia ${x.guia.numero || ''}: ${x.linha.desc} (${qtdTxt(x.linha.qtd)})`), ...c.foraF.map(x => `Fatura ${x.fatura.numero || ''}: ${x.linha.desc} (${qtdTxt(x.linha.qtd)})`)].map(t => `<div class="ct-linha"><span>${esc(t)}</span></div>`).join('')}` : ''}
    <div class="ct-sec">Guias ligadas</div>${c.guias.length ? c.guias.map(g => doc(g, 'g')).join('') : '<div class="mut">Nenhuma guia ligada.</div>'}
    <div class="ct-sec">Faturas ligadas</div>${c.faturas.length ? c.faturas.map(f => doc(f, 'f')).join('') : '<div class="mut">Nenhuma fatura ligada.</div>'}
    <div class="modal-footer"><button type="button" class="btn btn-secondary" data-act="sync">Sincronizar</button><span style="flex:1"></span><button type="button" class="btn btn-secondary" data-act="exp-conf" data-id="${ne.id}">Exportar Excel</button><button type="button" class="btn btn-secondary" data-act="imp-conf" data-id="${ne.id}">Imprimir / PDF</button><button type="button" class="btn btn-primary" data-act="fechar">Fechar</button></div>`, 980);
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
    case 'editar-pedido': { const ped = _pedidos.find(x => String(x.id) === String(id)); if (ped) { document.querySelectorAll('.modal-bg.open').forEach(m => m.remove()); abrirNovoPedido(ped); } break; }
    case 'np-add': { const i = catalogo().find(x => x.ref === a.dataset.ref); if (i) { const ex = _np.linhas.find(l => l.art_ref === i.ref); if (ex) ex.qtd = String((num(ex.qtd) || 0) + 1).replace('.', ','); else _np.linhas.push({ art_ref: i.ref, desc: i.desc, un: i.un, qtd: '1' }); npLinhas(); } break; }
    case 'np-livre': { const d = $('np-ld').value.trim(); if (!d) break; _np.linhas.push({ art_ref: null, desc: d, un: $('np-lu').value.trim() || 'un', qtd: '1' }); $('np-ld').value = ''; $('np-lu').value = ''; npLinhas(); break; }
    case 'np-rem': _np.linhas.splice(+a.dataset.i, 1); npLinhas(); break;
    case 'np-guardar': guardarPedido(); break;
    case 'cotar': abrirCotar(id); break;
    case 'cot-add': cotarAdicionar(); break;
    case 'cot-rem': cotarRemover(+a.dataset.k); break;
    case 'cot-enviar': cotarEnviar(); break;
    case 'cot-sug': cotarSugerir(); break;
    case 'cot-guardar': cotarGuardar(); break;
    case 'adjudicar': adjudicar(+a.dataset.k); break;
    case 'ver-ne': verNE(id); break;
    case 'imprimir-ne': imprimirNE(id); break;
    case 'apagar-ne': apagarNE(id); break;
    case 'ne-data': guardarDataNE(id); break;
    case 'guias-carregar': $('ct-gfiles').click(); break;
    case 'guias-importar': importarGuias(); break;
    case 'ver-guia': verGuia(id); break;
    case 'guardar-guia': guardarGuia(id); break;
    case 'reler-guia': relerGuia(id); break;
    case 'apagar-guia': apagarGuia(id); break;
    case 'anexar': anexarFicheiro(a.dataset.t, id); break;
    case 'faturas-carregar': $('ct-ffiles').click(); break;
    case 'ver-fatura': verFatura(id); break;
    case 'apagar-fatura': apagarFatura(id); break;
    case 'sync': sincronizar(false); break;
    case 'ver-conf': verConferencia(id); break;
    case 'exp-conf': exportarConf(id); break;
    case 'imp-conf': imprimirConf(id); break;
    case 'ligar-doc': ligarDoc(a.dataset.t, id); break;
    case 'desligar-doc': desligarDoc(a.dataset.t, id); break;
    case 'auto-doc': autoDoc(a.dataset.t, id); break;
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
document.addEventListener('change', e => {
  if (e.target.dataset.conc) { _conc[e.target.dataset.conc] = e.target.checked; try { localStorage.setItem('ct_conc', JSON.stringify(_conc)); } catch (x) { /* sem armazenamento */ } desenhar(); return; }
  if (e.target.id === 'ct-gfiles' || e.target.id === 'ct-ffiles') {
    const fs = [...e.target.files]; const g = e.target.id === 'ct-gfiles'; e.target.value = '';
    if (fs.length) (g ? carregarGuias : carregarFaturas)(fs);
  }
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
