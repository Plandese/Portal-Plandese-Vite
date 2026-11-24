// ═══════════════════════════════════════════════════════════════════
//  PROJETOS DA OBRA — PDFs com descrição, em dois sub-módulos: «Projetos Obra» e «Cadastros»
//  • Portal (Produção → «Projetos»): o diretor de obra carrega e gere os PDFs de cada obra.
//  • App dos encarregados (ecrã «Projetos»): lista das suas obras com PDFs; toca-se para abrir e consultar.
//  Ficheiros no bucket privado «obra-projetos» (<obra_id>/<tipo>/<ficheiro>), abertos com links assinados —
//  no telemóvel abrem no leitor de PDF do sistema. Registos em obra_projetos (RLS como o Planeamento Mensal).
// ═══════════════════════════════════════════════════════════════════
import { sb } from '../supabase.js';
import { S } from '../state.js';
import { obraVisivelPara } from '../config.js';
import { showToast } from './navigation.js';

const TAB = 'obra_projetos';
const BUCKET = 'obra-projetos';
const MAX_MB = 50;
const VALIDADE = 3600;   // segundos de validade dos links dos PDFs
const TIPOS = [['projeto', 'Projetos Obra'], ['cadastro', 'Cadastros']];
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tam = n => { n = Number(n) || 0; return n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; };
const dataPT = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '';
const seguro = nome => String(nome).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(-90) || 'ficheiro.pdf';
const semExt = nome => String(nome).replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();
const ePDF = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
const nomeUser = u => S.USERS?.[u]?.nome || u || '';
const nomeObra = id => (S.OBRAS || []).find(o => o.id === id)?.nome || id;
const ordenar = docs => docs.sort((a, b) => String(a.descricao).localeCompare(String(b.descricao), 'pt', { numeric: true, sensitivity: 'base' }));

const IC_PDF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>';
const IC_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>';
const IC_EXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
const IC_OBRA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V8l7-4.5L19 8v13"/><path d="M9 21v-5h6v5M9 11h.01M15 11h.01M9 14h.01M15 14h.01"/></svg>';
const IC_CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

// Links assinados (1 h); renovados ao abrir se estiverem quase a caducar
let _urls = {}, _urlsEm = 0;
async function assinar(docs) {
  _urls = {}; _urlsEm = Date.now();
  const paths = docs.map(d => d.path);
  for (let i = 0; i < paths.length; i += 100) {
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(paths.slice(i, i + 100), VALIDADE);
    (data || []).forEach(x => { if (x.signedUrl) _urls[x.path] = x.signedUrl; });
  }
}
const linksVelhos = () => Date.now() - _urlsEm > (VALIDADE - 300) * 1000;
async function abrirDoc(doc) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(doc.path, VALIDADE);
  if (error || !data?.signedUrl) return showToast('Não foi possível abrir o PDF.');
  window.open(data.signedUrl, '_blank', 'noopener');
}

// ═══════════════════════════════════════════════════════════════════
//  PORTAL — página do diretor de obra
// ═══════════════════════════════════════════════════════════════════
let _obra = '';
let _tipo = 'projeto';
let _docs = [];
let _pend = [];           // PDFs escolhidos à espera de descrição: { k, file, descricao }
let _seq = 0;
let _enviar = false;
let _editar = null;       // id do documento com a descrição em edição
let _apagarId = null, _apagarT = null;

const u = () => S.currentUser || {};
const obrasPortal = () => (S.OBRAS || [])
  .filter(o => o.ativa !== false && (o.estado || 'em_curso') !== 'concluida' && obraVisivelPara(u(), S.OBRAS, o.id))
  .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt', { numeric: true }));
function podeEditar(obraId) {
  if (u().role === 'admin') return true;
  const o = (S.OBRAS || []).find(x => x.id === obraId);
  return !!o && (o.diretor_id === u().key || (o.diretores_extra || []).includes(u().key));
}

async function carregarPortal() {
  _docs = [];
  if (!_obra) return;
  const { data, error } = await sb.from(TAB).select('*').eq('obra_id', _obra);
  if (error) { showToast('Não foi possível carregar os projetos: ' + error.message); return; }
  _docs = ordenar(data || []);
  await assinar(_docs);
}

export async function renderProjetosObra() {
  const root = $('po-root'); if (!root) return;
  const obras = obrasPortal();
  if (!obras.some(o => o.id === _obra)) _obra = obras[0]?.id || '';
  _pend = []; _editar = null;
  root.innerHTML = `<div class="pm-vazio grande">A carregar…</div>`;
  await carregarPortal();
  desenharPortal();
}

function desenharPortal() {
  const root = $('po-root'); if (!root) return;
  const obras = obrasPortal();
  const ed = podeEditar(_obra);
  const opts = obras.map(o => `<option value="${esc(o.id)}" ${o.id === _obra ? 'selected' : ''}>${esc(o.nome)}</option>`).join('');
  const head = `<div class="pm-head">
      <div><h1>Projetos</h1><p>PDFs de cada obra, com descrição, para os encarregados consultarem na app.</p></div>
      <div class="pm-ctl"><label class="pm-sel"><span>Obra</span><select data-po-obra ${obras.length ? '' : 'disabled'}>${opts || '<option>Sem obras atribuídas</option>'}</select></label></div>
    </div>`;
  if (!_obra) { root.innerHTML = head + `<div class="pm-card"><div class="pm-vazio grande">Não tem obras atribuídas como diretor de obra.</div></div>`; return; }
  const n = t => _docs.filter(d => d.tipo === t).length;
  const tabs = `<div class="po-tabs" role="tablist">${TIPOS.map(([t, l]) => `<button type="button" role="tab" data-po="tipo" data-tipo="${t}" aria-selected="${t === _tipo}">${l}<i>${n(t)}</i></button>`).join('')}</div>`;
  const docs = _docs.filter(d => d.tipo === _tipo);
  const nomeTipo = TIPOS.find(t => t[0] === _tipo)[1];
  const drop = ed ? `<label class="po-drop" data-po-drop tabindex="0"><input type="file" accept="application/pdf,.pdf" multiple hidden data-po-file>
      ${IC_UP}<span><b>Carregar PDFs em «${esc(nomeTipo)}»</b>Clique ou arraste para aqui · até ${MAX_MB} MB cada</span></label>` : '';
  const pend = _pend.length ? `<div class="po-pend">
      <div class="po-pend-t">Dê uma descrição a cada PDF antes de carregar</div>
      ${_pend.map(p => `<div class="po-pend-l" data-k="${p.k}"><span class="po-ic">${IC_PDF}</span>
        <label class="pm-f"><span>${esc(p.file.name)} · ${tam(p.file.size)}</span><input data-po-desc value="${esc(p.descricao)}" placeholder="Descrição (ex.: Planta do piso 1)" maxlength="200"${_enviar ? ' disabled' : ''}></label>
        <button type="button" class="pm-x" data-po="tirar" title="Tirar da lista" aria-label="Tirar da lista"${_enviar ? ' disabled' : ''}>×</button></div>`).join('')}
      <div class="po-pend-b"><button type="button" class="pm-btn sec" data-po="cancelar"${_enviar ? ' disabled' : ''}>Cancelar</button>
        <button type="button" class="pm-btn" data-po="enviar"${_enviar ? ' disabled' : ''}>${_enviar ? 'A carregar…' : `Carregar ${_pend.length} PDF${_pend.length === 1 ? '' : 's'}`}</button></div>
    </div>` : '';
  const lista = docs.length ? docs.map(d => {
    const url = _urls[d.path];
    const desc = _editar === d.id
      ? `<div class="po-edit"><input data-po-edit value="${esc(d.descricao)}" maxlength="200"><button type="button" class="pm-btn" data-po="gravar" data-id="${d.id}">Gravar</button><button type="button" class="pm-btn sec" data-po="naoedit">Cancelar</button></div>`
      : `<b>${esc(d.descricao)}</b>`;
    return `<div class="po-doc" data-id="${d.id}">
      <span class="po-ic">${IC_PDF}</span>
      <div class="po-doc-tx">${desc}<small>${esc(d.nome)} · ${tam(d.tamanho)} · ${dataPT(d.criado_em)}${d.criado_por ? ' · ' + esc(nomeUser(d.criado_por)) : ''}</small></div>
      <div class="po-doc-acc">
        <a class="pm-btn sec" data-po="abrir" data-id="${d.id}" href="${esc(url || '#')}" target="_blank" rel="noopener">Abrir</a>
        ${ed && _editar !== d.id ? `<button type="button" class="pm-lnk" data-po="editar" data-id="${d.id}">Editar descrição</button><button type="button" class="pm-lnk verm" data-po="apagar" data-id="${d.id}">Apagar</button>` : ''}
      </div>
    </div>`;
  }).join('') : `<div class="pm-vazio">Ainda não há PDFs em «${esc(nomeTipo)}» nesta obra.</div>`;
  const aviso = ed ? '' : `<div class="pm-aviso">Só o diretor desta obra pode carregar ou apagar PDFs. Está a ver em modo de consulta.</div>`;
  root.innerHTML = head + tabs + aviso + `<div class="pm-card po-card">${drop}${pend}<div class="po-lista">${lista}</div></div>`;
  if (_editar) { const i = root.querySelector('[data-po-edit]'); i?.focus(); i?.select(); }
}

function escolher(files) {
  const fs = [...files];
  const maus = fs.filter(f => !ePDF(f)), grandes = fs.filter(f => ePDF(f) && f.size > MAX_MB * 1048576);
  if (maus.length) showToast(`Só se aceitam PDFs (${maus.length} ficheiro${maus.length === 1 ? '' : 's'} ignorado${maus.length === 1 ? '' : 's'}).`);
  else if (grandes.length) showToast(`«${grandes[0].name}» tem mais de ${MAX_MB} MB.`);
  fs.filter(f => ePDF(f) && f.size <= MAX_MB * 1048576).forEach(f => _pend.push({ k: 'p' + (++_seq), file: f, descricao: semExt(f.name) }));
  desenharPortal();
  document.querySelector('#po-root [data-po-desc]')?.focus();
}

async function enviar() {
  if (_enviar || !_pend.length) return;
  const vazio = _pend.find(p => !p.descricao.trim());
  if (vazio) { showToast('Falta a descrição de «' + vazio.file.name + '».'); return; }
  _enviar = true; desenharPortal();
  const obra = _obra, tipo = _tipo;
  let ok = 0;
  for (const p of [..._pend]) {
    const path = `${obra}/${tipo}/${Date.now()}-${Math.floor(Math.random() * 1e4)}-${seguro(p.file.name)}`;
    const up = await sb.storage.from(BUCKET).upload(path, p.file, { contentType: 'application/pdf' });
    if (up.error) { showToast(`Não foi possível carregar «${p.file.name}»: ` + String(up.error.message).slice(0, 90)); continue; }
    const { error } = await sb.from(TAB).insert({ obra_id: obra, tipo, descricao: p.descricao.trim(), nome: p.file.name, path, tamanho: p.file.size });
    if (error) { await sb.storage.from(BUCKET).remove([path]); showToast('Não foi possível registar: ' + String(error.message).slice(0, 90)); continue; }
    _pend = _pend.filter(x => x !== p); ok++;
  }
  _enviar = false;
  if (ok) showToast(`${ok} PDF${ok === 1 ? '' : 's'} carregado${ok === 1 ? '' : 's'} ✓`);
  await carregarPortal(); desenharPortal();
}

async function gravarDescricao(id) {
  const i = document.querySelector('#po-root [data-po-edit]'); const t = (i?.value || '').trim();
  if (!t) return showToast('A descrição não pode ficar vazia.');
  const { data, error } = await sb.from(TAB).update({ descricao: t }).eq('id', id).select('id');
  if (error || !data?.length) return showToast('Não foi possível gravar a descrição.');
  const d = _docs.find(x => x.id === id); if (d) d.descricao = t;
  _editar = null; ordenar(_docs); desenharPortal(); showToast('Descrição gravada ✓');
}

async function apagar(id) {
  const d = _docs.find(x => x.id === id); if (!d) return;
  if (_apagarId !== id) {   // dois cliques seguidos (o confirm() nativo falha em alguns ecrãs)
    _apagarId = id; clearTimeout(_apagarT); _apagarT = setTimeout(() => { _apagarId = null; }, 4000);
    return showToast(`Clique outra vez em «Apagar» para apagar «${d.descricao}».`);
  }
  _apagarId = null;
  const { data, error } = await sb.from(TAB).delete().eq('id', id).select('id');
  if (error || !data?.length) return showToast('Não foi possível apagar (sem permissão?).');
  sb.storage.from(BUCKET).remove([d.path]).catch(() => {});
  _docs = _docs.filter(x => x.id !== id);
  desenharPortal(); showToast('PDF apagado');
}

async function mudarObra(id) {
  if (_pend.length && !confirm('Há PDFs escolhidos por carregar. Mudar de obra e descartá-los?')) { desenharPortal(); return; }
  _obra = id; _pend = []; _editar = null;
  await carregarPortal(); desenharPortal();
}

document.addEventListener('click', e => {
  const b = e.target.closest?.('#po-root [data-po]'); if (!b || b.disabled) return;
  const a = b.dataset.po, id = Number(b.dataset.id);
  if (a === 'abrir') {   // no computador pode abrir-se a janela depois de renovar o link
    const d = _docs.find(x => x.id === id);
    if (d && (linksVelhos() || !_urls[d.path])) { e.preventDefault(); abrirDoc(d); }
  } else if (a === 'tipo') { _tipo = b.dataset.tipo; _editar = null; desenharPortal(); }
  else if (a === 'tirar') { _pend = _pend.filter(p => p.k !== b.closest('[data-k]')?.dataset.k); desenharPortal(); }
  else if (a === 'cancelar') { _pend = []; desenharPortal(); }
  else if (a === 'enviar') enviar();
  else if (a === 'editar') { _editar = id; desenharPortal(); }
  else if (a === 'naoedit') { _editar = null; desenharPortal(); }
  else if (a === 'gravar') gravarDescricao(id);
  else if (a === 'apagar') apagar(id);
});
document.addEventListener('input', e => {
  const i = e.target.closest?.('#po-root [data-po-desc]'); if (!i) return;
  const p = _pend.find(x => x.k === i.closest('[data-k]')?.dataset.k); if (p) p.descricao = i.value;
});
document.addEventListener('keydown', e => {
  const i = e.target.closest?.('#po-root [data-po-edit]'); if (!i) return;
  if (e.key === 'Enter') { e.preventDefault(); gravarDescricao(Number(i.closest('[data-id]')?.dataset.id)); }
  else if (e.key === 'Escape') { _editar = null; desenharPortal(); }
});
document.addEventListener('change', e => {
  const s = e.target.closest?.('#po-root [data-po-obra]'); if (s) { mudarObra(s.value); return; }
  const f = e.target.closest?.('#po-root [data-po-file]'); if (!f) return;
  const fs = [...f.files]; f.value = ''; escolher(fs);
});
['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => {
  const z = e.target.closest?.('#po-root [data-po-drop]'); if (z) { e.preventDefault(); z.classList.add('over'); }
}));
document.addEventListener('dragleave', e => { e.target.closest?.('#po-root [data-po-drop]')?.classList.remove('over'); });
document.addEventListener('drop', e => {
  const z = e.target.closest?.('#po-root [data-po-drop]'); if (!z) return;
  e.preventDefault(); z.classList.remove('over'); escolher(e.dataTransfer?.files || []);
});

// ═══════════════════════════════════════════════════════════════════
//  APP DOS ENCARREGADOS — ecrã «Projetos»
// ═══════════════════════════════════════════════════════════════════
let _eDocs = [];
let _eObra = '';
let _eTipo = 'projeto';

const eObras = () => [...new Set(_eDocs.map(d => d.obra_id))].sort((a, b) => nomeObra(a).localeCompare(nomeObra(b), 'pt', { numeric: true }));
const contar = (obra, tipo) => _eDocs.filter(d => d.obra_id === obra && d.tipo === tipo).length;
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

export async function encGoProjetos() {
  document.querySelectorAll('#enc-app > [id^="enc-screen"]').forEach(el => { el.style.display = 'none'; });
  const s = $('enc-screen-projetos'); if (!s) return;
  s.style.display = 'flex'; s.style.flexDirection = 'column';
  _eObra = '';
  const b = $('enc-pj-obras');
  mostrarEstado('obras');
  if (b) b.innerHTML = `<div class="e-pl-load"><span class="pl-logo"></span>A carregar os projetos…</div>`;
  const { data, error } = await sb.from(TAB).select('*');
  if (error) { if (b) b.innerHTML = `<div class="e-pl-vazio">Não foi possível carregar os projetos.<br><small>${esc(error.message)}</small></div>`; return; }
  _eDocs = ordenar(data || []);
  await assinar(_eDocs);
  const obras = eObras();
  if (obras.length === 1) encProjAbrirObra(obras[0]);
  else encProjDesenharObras();
}

function mostrarEstado(est) {
  const o = $('enc-pj-obras'), d = $('enc-pj-docs');
  if (o) o.style.display = est === 'obras' ? 'block' : 'none';
  if (d) d.style.display = est === 'docs' ? 'block' : 'none';
  $('enc-screen-projetos')?.querySelector('.e-pj-scroll')?.scrollTo(0, 0);
}

function encProjDesenharObras() {
  mostrarEstado('obras');
  const b = $('enc-pj-obras'); if (!b) return;
  const obras = eObras();
  if (!obras.length) { b.innerHTML = `<div class="e-pl-vazio"><b>Sem projetos</b>Ainda não há PDFs carregados nas suas obras.</div>`; return; }
  b.innerHTML = `<div class="e-grp" style="margin-top:4px">As suas obras</div>` + obras.map(o => {
    const p = contar(o, 'projeto'), c = contar(o, 'cadastro');
    return `<button type="button" class="e-row" data-epj="obra" data-obra="${esc(o)}">
      <span class="e-row-ic">${IC_OBRA}</span>
      <span class="e-row-tx"><b>${esc(nomeObra(o))}</b><small>${plural(p, 'projeto', 'projetos')} · ${plural(c, 'cadastro', 'cadastros')}</small></span>
      <span class="e-row-chev">${IC_CHEV}</span></button>`;
  }).join('');
}

function encProjAbrirObra(obra) {
  _eObra = obra;
  if (!contar(obra, _eTipo)) _eTipo = contar(obra, 'projeto') ? 'projeto' : (contar(obra, 'cadastro') ? 'cadastro' : 'projeto');
  encProjDesenharDocs();
}

function encProjDesenharDocs() {
  mostrarEstado('docs');
  const b = $('enc-pj-docs'); if (!b) return;
  const docs = _eDocs.filter(d => d.obra_id === _eObra && d.tipo === _eTipo);
  const seg = `<div class="e-pj-seg" role="tablist">${TIPOS.map(([t, l]) => `<button type="button" role="tab" data-epj="tipo" data-tipo="${t}" aria-selected="${t === _eTipo}">${l}<i>${contar(_eObra, t)}</i></button>`).join('')}</div>`;
  const lista = docs.length ? docs.map(d => `<a class="e-row e-pj-doc" href="${esc(_urls[d.path] || '#')}" target="_blank" rel="noopener" data-epj="abrir" data-id="${d.id}">
      <span class="e-pj-pdf">PDF</span>
      <span class="e-row-tx"><b>${esc(d.descricao)}</b><small>${esc(d.nome)} · ${tam(d.tamanho)}</small></span>
      <span class="e-row-chev">${IC_EXT}</span></a>`).join('')
    : `<div class="e-pl-vazio">Ainda não há ${_eTipo === 'projeto' ? 'projetos' : 'cadastros'} nesta obra.</div>`;
  b.innerHTML = `<div class="e-pl-obra">${esc(nomeObra(_eObra))}</div>${seg}<div class="e-pj-lista">${lista}</div>
    <p class="e-pj-nota">Toque num documento para o abrir no leitor de PDF do telemóvel.</p>`;
}

// «Voltar» do cabeçalho (enc-shell.js): dos documentos volta à lista das obras (ou ao início, se só houver uma)
export function encProjVoltar() {
  if (eObras().length > 1) encProjDesenharObras();
  else window.encVoltarHome?.();
}

document.addEventListener('click', e => {
  const b = e.target.closest?.('#enc-screen-projetos [data-epj]'); if (!b) return;
  const a = b.dataset.epj;
  if (a === 'obra') encProjAbrirObra(b.dataset.obra);
  else if (a === 'tipo') { _eTipo = b.dataset.tipo; encProjDesenharDocs(); }
  else if (a === 'abrir') {
    // link caducado: renova-os (no telemóvel uma janela aberta depois de esperar pela rede é bloqueada)
    const d = _eDocs.find(x => x.id === Number(b.dataset.id));
    if (d && (linksVelhos() || !_urls[d.path])) {
      e.preventDefault();
      assinar(_eDocs).then(() => { encProjDesenharDocs(); showToast('Toque outra vez no documento para o abrir.'); });
    }
  }
});

Object.assign(window, { renderProjetosObra, encGoProjetos, encProjVoltar });
