// ═══════════════════════════════════════
//  COLABORADORES — FICHA (validades + documentos na Dropbox)
//  Clicar num colaborador abre uma gaveta com os dados da folha «Validades_Colaboradores»
//  (identificação, FA, EPI, admissão, e-mail…) e os documentos da pasta dele na Dropbox,
//  com uma caixa de upload que arruma o ficheiro na pasta certa.
// ═══════════════════════════════════════
import { S } from '../state.js';
import { sb } from '../supabase.js';
import { imprimirFolhaEPI } from './epi-folha.js';
import { dropboxListAll, dropboxDownload, dropboxUploadTeam, dropboxMoveTeam } from './dropbox.js';

const BASE = '/David Mósca/09_Documentação_OBRA/00_PRODUÇÃO/Colaboradores';
const ID_TIPOS = { CC: 'Cartão de Cidadão', R: 'Título de residência', P: 'Passaporte' };
// tipos de documento do upload → prefixo do nome do ficheiro e campo de data associado
const DOC_TIPOS = {
  ID:  { nome: 'Identificação (CC / residência / passaporte)', data: 'id_validade', rotulo: 'Validade do documento' },
  FA:  { nome: 'Ficha de aptidão (FA)', pref: 'FA_', data: 'fa_data', rotulo: 'Data do exame' },
  EPI: { nome: 'EPI (entrega)', pref: 'EPI_', data: 'epi_data', rotulo: 'Data de entrega' },
  OUT: { nome: 'Outro documento', data: null },
};
const ID_PREF = { CC: 'CC_', R: 'Residência_', P: 'Passaporte_' };

const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const toast = m => (typeof window.showToast === 'function' ? window.showToast(m) : alert(m));

// ───────── dados ─────────
let _fichas = new Map();     // numero → linha de colaboradores_ficha
let _nasc = new Map();       // numero → data de nascimento (colaboradores)
let _carregado = false, _semAcesso = false, _pendente = null;

export function colabFichasCarregadas(){ return _carregado; }

export function carregarFichas(forcar = false){
  if(_carregado && !forcar) return Promise.resolve();
  if(_pendente) return _pendente;
  _pendente = (async () => {
    const [f, c] = await Promise.all([
      sb.from('colaboradores_ficha').select('*'),
      sb.from('colaboradores').select('numero,data_nascimento'),
    ]);
    if(f.error){ _semAcesso = true; console.warn('Ficha de colaboradores:', f.error); }
    else{ _semAcesso = false; _fichas = new Map((f.data || []).map(r => [r.numero, r])); }
    _nasc = new Map((c.data || []).map(r => [r.numero, r.data_nascimento]));
    _carregado = true;
  })().finally(() => { _pendente = null; });
  return _pendente;
}

// ───────── validades (mesmas regras da folha Excel) ─────────
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hojeIso = () => iso(new Date());
function addMeses(s, m){            // como o EDATE do Excel
  const [y, mo, d] = s.split('-').map(Number);
  const alvo = new Date(y, mo - 1 + m, 1);
  const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  alvo.setDate(Math.min(d, ultimo));
  return iso(alvo);
}
const fmtData = s => s ? s.split('-').reverse().join('/') : '—';
function estadoAte(ate){            // ate = data limite (ISO) ou null
  if(!ate) return { c: 'bad', t: 'Sem data', rank: 3 };
  const h = hojeIso();
  if(ate < h) return { c: 'bad', t: 'Caducado', rank: 3 };
  if(ate <= (() => { const d = new Date(); d.setDate(d.getDate() + 15); return iso(d); })()) return { c: 'warn', t: 'A caducar', rank: 2 };
  return { c: 'ok', t: 'Válido', rank: 1 };
}
// FA: 12 meses se o colaborador tinha 50 anos ou mais na data do exame, senão 24
function validadeFA(f, nasc){
  if(!f?.fa_data || f.fa_data > hojeIso()) return { ate: null, nota: f?.fa_data ? 'Data do exame no futuro' : '' };
  const idade50 = nasc && f.fa_data >= addMeses(nasc, 600);
  return { ate: addMeses(f.fa_data, idade50 ? 12 : 24), nota: nasc ? '' : 'Sem data de nascimento — assumido 24 meses' };
}
function validadeEPI(f){
  if(!f?.epi_data || f.epi_data > hojeIso()) return { ate: null, nota: f?.epi_data ? 'Data de entrega no futuro' : '' };
  return { ate: addMeses(f.epi_data, 12), nota: '' };
}
function estados(n){
  const f = _fichas.get(n), nasc = _nasc.get(n);
  const fa = validadeFA(f, nasc), epi = validadeEPI(f);
  return {
    id: { ...estadoAte(f?.id_validade || null), ate: f?.id_validade || null },
    fa: { ...estadoAte(fa.ate), ate: fa.ate, nota: fa.nota },
    epi: { ...estadoAte(epi.ate), ate: epi.ate, nota: epi.nota },
  };
}
// Etiqueta resumo para a lista: pior estado das 3 validades
export function colabValPill(n){
  if(!_carregado || _semAcesso) return '';
  if(!_fichas.has(n)) return '<span class="dd-pill mute" title="Sem ficha">Sem ficha</span>';
  const e = estados(n);
  const pior = [['Identificação', e.id], ['FA', e.fa], ['EPI', e.epi]].filter(([, x]) => x.rank > 1)
    .sort((a, b) => b[1].rank - a[1].rank);
  if(!pior.length) return '<span class="dd-pill ok" title="Identificação, FA e EPI válidas">Validades em dia</span>';
  const t = pior.map(([k, x]) => `${k}: ${x.t.toLowerCase()}`).join(' · ');
  return `<span class="dd-pill ${pior[0][1].c}" title="${esc(t)}">${esc(pior[0][0])} ${esc(pior[0][1].t.toLowerCase())}${pior.length > 1 ? ` +${pior.length - 1}` : ''}</span>`;
}

// ───────── nomes e pastas ─────────
const _colab = n => S.COLABORADORES.find(c => c.n === n);
function nomeCurto(c, f){
  if(f?.pasta){ const m = f.pasta.split('/').pop().replace(/^\d+\.\s*/, '').replace(/\s*\(.*\)\s*$/, '').trim(); if(m) return m; }
  const p = (c?.nome || '').split(/\s+/).filter(Boolean);
  return p.length > 2 ? p[0] + ' ' + p[p.length - 1] : p.join(' ');
}
function pastaDe(n){
  const f = _fichas.get(n), c = _colab(n);
  if(f?.pasta) return f.pasta;
  const nome = nomeCurto(c, null);
  if(!c?.ativo) return `0_Inativos/${nome}`;
  return c.esc ? `2_Escritório/${n}. ${nome}` : `${n}. ${nome}`;
}
const caminho = rel => `${BASE}/${rel}`;
const nomeSeguro = s => String(s).replace(/[\\/:*?"<>|]/g, '_').trim();

// ───────── gaveta ─────────
let _n = null, _editar = false, _docs = [], _docsErro = '', _docsCarregando = false, _enviando = false;

function _drawer(){
  let dr = document.getElementById('colab-drawer');
  if(!dr){
    document.body.insertAdjacentHTML('beforeend', '<div class="d-scrim" id="colab-scrim"></div><aside class="d-drawer cf-drawer" id="colab-drawer" aria-hidden="true"></aside>');
    dr = document.getElementById('colab-drawer');
    document.getElementById('colab-scrim').addEventListener('click', fecharFichaColab);
    document.addEventListener('keydown', e => { if(e.key === 'Escape') fecharFichaColab(); });
  }
  return dr;
}
export function fecharFichaColab(){
  document.getElementById('colab-drawer')?.classList.remove('open');
  document.getElementById('colab-scrim')?.classList.remove('open');
  _n = null; _editar = false;
}

export async function abrirFichaColab(n){
  const c = _colab(n); if(!c) return;
  _n = n; _editar = false; _docs = []; _docsErro = ''; _enviando = false;
  _drawer();
  _render();
  requestAnimationFrame(() => {
    document.getElementById('colab-drawer')?.classList.add('open');
    document.getElementById('colab-scrim')?.classList.add('open');
  });
  if(!_carregado){ await carregarFichas(); if(_n !== n) return; _render(); }
  _carregarDocs();
}

const pill = (t, c) => `<span class="dd-pill ${c}">${esc(t)}</span>`;
function _linhaVal(titulo, sub, e){
  return `<div class="dd-row"><div class="dd-tx"><b>${esc(titulo)}</b><small>${esc(sub)}</small>${e.nota ? `<small class="dd-warn">${esc(e.nota)}</small>` : ''}</div><div class="dd-pills">${pill(e.t, e.c)}</div></div>`;
}
const _info = (k, v) => `<div class="dd-row"><div class="dd-tx"><small>${esc(k)}</small><b>${v ? esc(v) : '<span style="color:#9aa3b5;font-weight:500">—</span>'}</b></div></div>`;

function _campo(id, rotulo, valor, tipo = 'text', extra = ''){
  return `<div class="cf-f"><label for="${id}">${esc(rotulo)}</label><input id="${id}" type="${tipo}" value="${esc(valor || '')}" ${extra}/></div>`;
}

const _btnEPI = `<button type="button" class="cf-epi-btn" onclick="fichaImprimirEPI()">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
  Imprimir folha de distribuição de EPI</button>`;

// Folha de distribuição de EPI preenchida com nome, nº interno, função e a data de hoje
export function fichaImprimirEPI(){
  const c = _colab(_n); if(!c) return;
  imprimirFolhaEPI({ nome: c.nome, numero: c.n, funcao: c.func });
}

function _render(){
  const dr = document.getElementById('colab-drawer'); if(!dr || _n == null) return;
  const c = _colab(_n); if(!c) return;
  const f = _fichas.get(_n) || {}, nasc = _nasc.get(_n) || '';
  const e = estados(_n);
  const idTxt = f.id_tipo ? `${ID_TIPOS[f.id_tipo] || f.id_tipo}${f.id_numero ? ' · ' + f.id_numero : ''}` : '';
  let corpo;
  if(_semAcesso){
    corpo = '<div class="dd-vazio">Não tem permissão para ver os dados pessoais e as validades deste colaborador (capítulo Recursos Humanos).</div>' + _btnEPI;
  } else if(!_carregado){
    corpo = '<div class="dd-vazio">A carregar…</div>';
  } else if(_editar){
    corpo = `
      <h4 style="margin-top:0">Editar dados</h4>
      <div class="cf-grid">
        ${_campo('cf-nasc', 'Data de nascimento', nasc, 'date')}
        ${_campo('cf-nac', 'Nacionalidade', f.nacionalidade)}
        <div class="cf-f"><label for="cf-idt">Tipo de identificação</label><select id="cf-idt"><option value="">—</option>${Object.entries(ID_TIPOS).map(([k, v]) => `<option value="${k}"${f.id_tipo === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
        ${_campo('cf-idn', 'Número do documento', f.id_numero)}
        ${_campo('cf-idv', 'Validade da identificação', f.id_validade, 'date')}
        ${_campo('cf-adm', 'Admissão', f.admissao, 'date')}
        ${_campo('cf-fa', 'FA · data do exame', f.fa_data, 'date')}
        ${_campo('cf-epi', 'EPI · data de entrega', f.epi_data, 'date')}
      </div>
      ${_campo('cf-mail', 'E-mail', f.email, 'email')}`;
  } else {
    corpo = `
      <h4 style="margin-top:0">Validades</h4>
      ${_linhaVal('Identificação', f.id_validade ? `Válida até ${fmtData(f.id_validade)}` : 'Sem data de validade', e.id)}
      ${_linhaVal('Ficha de aptidão (FA)', f.fa_data ? `Exame a ${fmtData(f.fa_data)}${e.fa.ate ? ` · válida até ${fmtData(e.fa.ate)}` : ''}` : 'Sem data de exame', e.fa)}
      ${_linhaVal('EPI', f.epi_data ? `Entregue a ${fmtData(f.epi_data)}${e.epi.ate ? ` · renovar até ${fmtData(e.epi.ate)}` : ''}` : 'Sem data de entrega', e.epi)}
      ${_btnEPI}
      <h4>Dados</h4>
      ${_info('Data de nascimento', fmtData(nasc) === '—' ? '' : fmtData(nasc))}
      ${_info('Nacionalidade', f.nacionalidade)}
      ${_info('Identificação', idTxt)}
      ${_info('Função', c.func)}
      ${_info('Admissão', f.admissao ? fmtData(f.admissao) : '')}
      ${_info('E-mail', f.email)}`;
  }
  const docs = _semAcesso ? '' : _htmlDocs(f);
  dr.setAttribute('aria-hidden', 'false');
  dr.innerHTML = `
    <div class="dd-h">
      <button class="dd-x" onclick="fecharFichaColab()" aria-label="Fechar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <small>Colaborador Nº ${c.n}</small>
      <h2>${esc(c.nome)}</h2>
      <p>${esc(c.func || '')}${c.func ? ' · ' : ''}${c.ativo ? 'Ativo' : 'Inativo'}</p>
    </div>
    <div class="dd-b">${corpo}${_editar ? '' : docs}</div>
    <div class="dd-f">${_editar
      ? '<button class="btn btn-secondary" onclick="fichaCancelar()">Cancelar</button><button class="btn btn-primary" onclick="fichaGuardar()">Guardar</button>'
      : `<button class="btn btn-secondary" onclick="fecharFichaColab();editColab(${c.n})">Nome e função</button>${_semAcesso ? '' : '<button class="btn btn-primary" onclick="fichaEditar()">Editar dados</button>'}`}</div>`;
}

function _htmlDocs(f){
  const pasta = f.pasta || pastaDe(_n);
  let lista;
  if(_docsCarregando) lista = '<div class="dd-vazio">A ler a pasta da Dropbox…</div>';
  else if(_docsErro) lista = `<div class="dd-vazio" style="color:#b3261e">${esc(_docsErro)}</div>`;
  else if(!_docs.length) lista = '<div class="dd-vazio">Ainda não há documentos nesta pasta.</div>';
  else lista = _docs.map((d, i) => `<div class="dd-row cf-doc${d.caducado ? ' cad' : ''}" onclick="fichaAbrirDoc(${i})" role="button" tabindex="0">
      <span class="cf-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg></span>
      <div class="dd-tx"><b>${esc(d.nome)}</b><small>${d.caducado ? 'Caducados · ' : ''}${d.tamanho ? Math.max(1, Math.round(d.tamanho / 1024)) + ' KB' : ''}${d.data ? ' · ' + fmtData(d.data.slice(0, 10)) : ''}</small></div>
      ${d.caducado ? pill('Caducado', 'mute') : ''}
    </div>`).join('');
  const opts = Object.entries(DOC_TIPOS).map(([k, v]) => `<option value="${k}">${esc(v.nome)}</option>`).join('');
  return `
    <h4>Documentos na Dropbox</h4>
    <div class="cf-pasta" title="${esc(pasta)}">📁 ${esc(pasta)}</div>
    <div id="cf-docs">${lista}</div>
    <h4>Enviar documento</h4>
    <div class="cf-up">
      <div class="cf-f"><label for="cf-tipo">Tipo de documento</label><select id="cf-tipo" onchange="fichaTipoChange()">${opts}</select></div>
      <div class="cf-f" id="cf-data-wrap" style="display:none"><label for="cf-data" id="cf-data-l"></label><input id="cf-data" type="date"/></div>
      <label class="cf-drop" id="cf-drop" for="cf-file">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
        <span id="cf-file-txt">Escolher ficheiro ou largar aqui</span>
        <input id="cf-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.heic" onchange="fichaFicheiroEscolhido()"/>
      </label>
      <label class="cf-chk" id="cf-arq-wrap" style="display:none"><input type="checkbox" id="cf-arq" checked/>Mover o documento anterior deste tipo para «Caducados»</label>
      <button class="btn btn-primary cf-send" id="cf-send" onclick="fichaEnviar()"${_enviando ? ' disabled' : ''}>${_enviando ? 'A enviar…' : 'Enviar para a Dropbox'}</button>
    </div>`;
}

// ───────── documentos da Dropbox ─────────
async function _carregarDocs(){
  const n = _n; if(n == null || _semAcesso) return;
  _docsCarregando = true; _docsErro = ''; _atualizaDocs();
  const rel = (_fichas.get(n)?.pasta) || pastaDe(n);
  try{
    const todos = await dropboxListAll(caminho(rel), false);
    const out = todos.filter(x => x['.tag'] === 'file').map(x => ({ nome: x.name, path: x.path_lower || x.path_display, tamanho: x.size, data: x.client_modified, caducado: false }));
    const cad = todos.find(x => x['.tag'] === 'folder' && /^caducados$/i.test(x.name));
    if(cad){
      try{
        (await dropboxListAll(cad.path_lower || cad.path_display, false)).filter(x => x['.tag'] === 'file')
          .forEach(x => out.push({ nome: x.name, path: x.path_lower || x.path_display, tamanho: x.size, data: x.client_modified, caducado: true }));
      } catch{}
    }
    out.sort((a, b) => (a.caducado - b.caducado) || a.nome.localeCompare(b.nome, 'pt'));
    if(_n === n) _docs = out;
  } catch(e){
    const m = String(e.message || e);
    // pasta que ainda não existe = colaborador sem documentos
    if(_n === n) { _docs = []; _docsErro = /not_found/.test(m) ? '' : 'Não foi possível ler a pasta: ' + m.slice(0, 200); }
  }
  _docsCarregando = false;
  if(_n === n) _atualizaDocs();
}
function _atualizaDocs(){
  // refaz só a lista, para não perder o que o utilizador já escolheu no formulário de envio
  const alvo = document.getElementById('cf-docs'); if(!alvo){ _render(); return; }
  const tmp = document.createElement('div'); tmp.innerHTML = _htmlDocs(_fichas.get(_n) || {});
  const novo = tmp.querySelector('#cf-docs'); if(novo) alvo.innerHTML = novo.innerHTML;
}

export async function fichaAbrirDoc(i){
  const d = _docs[i]; if(!d) return;
  // abre já o separador (tem de ser no clique); se o navegador o bloquear, usa o visualizador dentro do portal
  const jan = window.open('', '_blank');
  if(jan) jan.document.write('<title>' + esc(d.nome) + '</title><p style="font:16px sans-serif;padding:24px">A abrir ' + esc(d.nome) + '…</p>');
  try{
    toast('A abrir o documento…');
    const blob = await dropboxDownload(d.path);
    const ext = (d.nome.split('.').pop() || '').toLowerCase();
    const tipo = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }[ext];
    const url = URL.createObjectURL(tipo ? new Blob([blob], { type: tipo }) : blob);
    setTimeout(() => URL.revokeObjectURL(url), 600000);
    if(!tipo){                                   // Word, Excel…: só se descarrega
      jan?.close();
      const a = document.createElement('a'); a.href = url; a.download = d.nome; document.body.appendChild(a); a.click(); a.remove();
    } else if(jan){
      jan.location.href = url;
    } else {
      _visualizador(d.nome, url, tipo.startsWith('image/'));
    }
  } catch(e){
    jan?.close();
    toast('Não foi possível abrir: ' + (e.message || e));
  }
}

function _visualizador(nome, url, imagem){
  document.getElementById('cf-viewer')?.remove();
  const v = document.createElement('div');
  v.id = 'cf-viewer';
  v.innerHTML = `<div class="cf-v-h"><b>${esc(nome)}</b>
    <a class="btn btn-secondary btn-sm" href="${url}" target="_blank" rel="noopener">Abrir em separador</a>
    <a class="btn btn-secondary btn-sm" href="${url}" download="${esc(nome)}">Descarregar</a>
    <button class="btn btn-primary btn-sm" id="cf-v-x">Fechar</button></div>
    ${imagem ? `<div class="cf-v-img"><img src="${url}" alt=""/></div>` : `<iframe src="${url}" title="${esc(nome)}"></iframe>`}`;
  document.body.appendChild(v);
  const fechar = () => { v.remove(); document.removeEventListener('keydown', esc_); };
  const esc_ = e => { if(e.key === 'Escape'){ e.stopPropagation(); fechar(); } };
  document.addEventListener('keydown', esc_);
  v.querySelector('#cf-v-x').onclick = fechar;
}

// ───────── editar dados ─────────
export function fichaEditar(){ _editar = true; _render(); }
export function fichaCancelar(){ _editar = false; _render(); }

async function _gravaFicha(n, campos){
  const atual = _fichas.get(n) || {};
  const linha = { ...atual, ...campos, numero: n, atualizado_em: new Date().toISOString() };
  const { error } = await sb.from('colaboradores_ficha').upsert(linha, { onConflict: 'numero' });
  if(error) throw error;
  _fichas.set(n, linha);
}

export async function fichaGuardar(){
  const n = _n; if(n == null) return;
  const v = id => (document.getElementById(id)?.value || '').trim() || null;
  const nasc = v('cf-nasc');
  try{
    await _gravaFicha(n, {
      nacionalidade: v('cf-nac'), id_tipo: v('cf-idt'), id_numero: v('cf-idn'), id_validade: v('cf-idv'),
      admissao: v('cf-adm'), fa_data: v('cf-fa'), epi_data: v('cf-epi'), email: v('cf-mail'),
    });
    const r = await sb.from('colaboradores').update({ data_nascimento: nasc }).eq('numero', n);
    if(r.error) throw r.error;
    _nasc.set(n, nasc);
    _editar = false; _render(); _carregarDocs();
    window.renderColabs?.();
    toast('Dados guardados');
  } catch(e){
    toast('Não foi possível guardar: ' + (e.message || e));
  }
}

// ───────── upload ─────────
export function fichaTipoChange(){
  const t = DOC_TIPOS[document.getElementById('cf-tipo')?.value];
  const wrap = document.getElementById('cf-data-wrap'), arq = document.getElementById('cf-arq-wrap');
  if(!t) return;
  if(wrap){
    wrap.style.display = t.data ? '' : 'none';
    document.getElementById('cf-data-l').textContent = t.rotulo || '';
    const inp = document.getElementById('cf-data');
    if(inp) inp.value = (t.data === 'fa_data' || t.data === 'epi_data') ? hojeIso() : '';
  }
  if(arq) arq.style.display = document.getElementById('cf-tipo').value === 'OUT' ? 'none' : '';
}
export function fichaFicheiroEscolhido(){
  const fi = document.getElementById('cf-file')?.files?.[0];
  const t = document.getElementById('cf-file-txt'); if(t) t.textContent = fi ? fi.name : 'Escolher ficheiro ou largar aqui';
  document.getElementById('cf-drop')?.classList.toggle('on', !!fi);
}

export async function fichaEnviar(){
  const n = _n; if(n == null || _enviando) return;
  const c = _colab(n), f = _fichas.get(n) || {};
  const tipo = document.getElementById('cf-tipo')?.value, cfg = DOC_TIPOS[tipo];
  const fi = document.getElementById('cf-file')?.files?.[0];
  const data = document.getElementById('cf-data')?.value || '';
  if(!fi){ toast('Escolha primeiro o ficheiro.'); return; }
  if(cfg.data && !data){ toast(`Indique: ${cfg.rotulo.toLowerCase()}.`); return; }
  if(fi.size > 25 * 1024 * 1024){ toast('O ficheiro excede 25 MB.'); return; }

  const ext = fi.name.includes('.') ? fi.name.slice(fi.name.lastIndexOf('.')) : '';
  const curto = nomeCurto(c, f);
  let pref = cfg.pref || '';
  if(tipo === 'ID') pref = ID_PREF[f.id_tipo] || 'CC_';
  const nome = tipo === 'OUT' ? nomeSeguro(fi.name) : nomeSeguro(`${pref}${curto}${ext}`);
  const rel = f.pasta || pastaDe(n);
  const destino = `${caminho(rel)}/${nome}`;
  const arquivar = tipo !== 'OUT' && document.getElementById('cf-arq')?.checked;

  _enviando = true; _atualizaDocs();
  const btn = document.getElementById('cf-send'); if(btn){ btn.disabled = true; btn.textContent = 'A enviar…'; }
  try{
    // 1. documentos anteriores do mesmo tipo (antes de enviar, para não apanhar o novo)
    const antigos = arquivar ? _docs.filter(d => !d.caducado && d.nome.toLowerCase().startsWith(pref.toLowerCase())) : [];
    // 2. envia o novo (a Dropbox acrescenta um sufixo se o nome já existir)
    const final = await dropboxUploadTeam(fi, destino);
    // 3. arruma os anteriores em «Caducados»
    for(const d of antigos){
      if(d.path === String(final).toLowerCase()) continue;
      try{ await dropboxMoveTeam(d.path, `${caminho(rel)}/Caducados/${d.nome}`); }
      catch(e){ console.warn('Não consegui mover para Caducados:', d.nome, e); toast('Enviado, mas não consegui arquivar «' + d.nome + '»'); }
    }
    // 4. guarda a pasta e a data associada
    const campos = {};
    if(!f.pasta) campos.pasta = rel;
    if(cfg.data) campos[cfg.data] = data;
    if(Object.keys(campos).length){
      try{ await _gravaFicha(n, campos); } catch(e){ toast('Enviado, mas não consegui atualizar a data: ' + (e.message || e)); }
    }
    toast('Documento enviado para a pasta do colaborador');
    window.renderColabs?.();
  } catch(e){
    toast('Falha no envio: ' + (e.message || e));
  }
  _enviando = false;
  _render();
  _carregarDocs();
}

// largar ficheiros na caixa
document.addEventListener('dragover', e => { const d = e.target.closest?.('#cf-drop'); if(d){ e.preventDefault(); d.classList.add('over'); } });
document.addEventListener('dragleave', e => { e.target.closest?.('#cf-drop')?.classList.remove('over'); });
document.addEventListener('drop', e => {
  const d = e.target.closest?.('#cf-drop'); if(!d) return;
  e.preventDefault(); d.classList.remove('over');
  const inp = document.getElementById('cf-file');
  if(inp && e.dataTransfer?.files?.length){ inp.files = e.dataTransfer.files; fichaFicheiroEscolhido(); }
});
