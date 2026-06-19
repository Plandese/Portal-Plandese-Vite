// ═══════════════════════════════════════
//  PREÇOS UNITÁRIOS — Articulado editável
// ═══════════════════════════════════════
import { S } from '../state.js';
import { showToast } from './navigation.js';

let PRECOS_UNIT = [];
let _puState = { obraId: null };

// ── Persistência ──────────────────────────────────────────────────────────────
function _puLoad(){ try{ PRECOS_UNIT = JSON.parse(localStorage.getItem('prod_precos_unit')||'[]'); }catch(e){ PRECOS_UNIT=[]; } }
function _puSave(){ localStorage.setItem('prod_precos_unit', JSON.stringify(PRECOS_UNIT)); }
_puLoad();

// ══════════════════════════════════════════════════════════════════════════════
//  NAVEGAÇÃO
// ══════════════════════════════════════════════════════════════════════════════

function initPrecosUnit(){
  _puLoad();
  puGoList();
}

function puGoList(){
  _puState.obraId = null;
  _show('pu-list-view');
  _hide('pu-detail');
  _puRenderList();
}

function puOpenObra(obraId){
  _puState.obraId = obraId;
  _hide('pu-list-view');
  _show('pu-detail');
  _puRenderDetail();
  window.scrollTo({ top:0, behavior:'smooth' });
}

// ══════════════════════════════════════════════════════════════════════════════
//  LISTA DE OBRAS
// ══════════════════════════════════════════════════════════════════════════════

function _puRenderList(){
  const obras = S.OBRAS.filter(o => o.ativa !== false);
  const grid  = document.getElementById('pu-obras-grid');
  if(!grid) return;

  if(!obras.length){
    grid.innerHTML = '<div class="pu-no-obras">Sem obras ativas.</div>';
    return;
  }

  grid.innerHTML = obras.map(o => {
    const lista    = PRECOS_UNIT.find(l => l.obraId === o.id);
    const temLista = lista?.artigos?.length > 0;
    const totArt   = temLista ? lista.artigos.filter(a => !a.isCapitulo).length : 0;
    const totVal   = temLista ? lista.artigos.filter(a => !a.isCapitulo).reduce((s,a) => s+(a.precoUnit||0)*(a.quantidade||0),0) : 0;
    const dataImp  = temLista && lista.importadoEm ? new Date(lista.importadoEm).toLocaleDateString('pt-PT') : null;
    const editados = temLista ? lista.artigos.filter(a => a.editado).length : 0;

    return `<div class="pu-obra-card ${temLista?'has-lista':''}" onclick="puOpenObra('${o.id}')">
      <div class="pu-obra-card-hd">
        <div class="pu-obra-status-pill ${temLista?'ok':'empty'}">
          ${temLista
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px;height:11px"><polyline points="20 6 9 17 4 12"/></svg> Com lista`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px"><path d="M12 5v14M5 12h14"/></svg> Importar`}
        </div>
        ${editados > 0 ? `<span style="font-size:10px;background:#FEF3C7;color:#B45309;padding:2px 7px;border-radius:10px;font-weight:700">${editados} edit.</span>` : ''}
      </div>
      <div class="pu-obra-nome">${puEsc(o.nome)}</div>
      ${o.local ? `<div class="pu-obra-local"><svg viewBox="0 0 24 24" fill="currentColor" style="width:10px;height:10px"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>${puEsc(o.local)}</div>` : ''}
      <div class="pu-obra-card-ft">
        ${temLista
          ? `<div class="pu-obra-meta"><span>${totArt} artigos</span><span class="pu-obra-total">${puFmtEur(totVal)}</span></div>
             <div class="pu-obra-date">Importado em ${dataImp} · ${lista.fonte||'Excel'}</div>`
          : `<div class="pu-obra-meta empty">Nenhum mapa de preços importado</div>`}
      </div>
      <div class="pu-obra-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════════════════════
//  DETALHE DA OBRA — cabeçalho
// ══════════════════════════════════════════════════════════════════════════════

function _puRenderDetail(){
  const obraId = _puState.obraId;
  const o = S.OBRAS.find(x => x.id === obraId);
  if(!o) return;

  const lista    = PRECOS_UNIT.find(l => l.obraId === obraId);
  const temLista = lista?.artigos?.length > 0;

  document.getElementById('pu-dt-crumb').textContent = o.nome;
  document.getElementById('pu-dt-title').textContent = o.nome;

  // Botões de ação
  document.getElementById('pu-dt-actions').innerHTML = temLista
    ? `<button class="btn btn-primary" onclick="puOpenImport()">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Substituir
       </button>
       <button class="btn btn-green" onclick="puExportExcel()">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Descarregar Excel
       </button>
       <button class="btn" style="color:var(--red);background:var(--red-bg);border:1px solid #fca5a5" onclick="puLimpar()">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>Limpar
       </button>`
    : `<button class="btn btn-primary" onclick="puOpenImport()">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Importar lista de preços
       </button>`;

  // KPIs
  const kpiZone = document.getElementById('pu-dt-kpis');
  if(temLista){
    const totArt  = lista.artigos.filter(a=>!a.isCapitulo).length;
    const totVal  = lista.artigos.filter(a=>!a.isCapitulo).reduce((s,a)=>s+(a.precoUnit||0)*(a.quantidade||0),0);
    const editados= lista.artigos.filter(a=>a.editado).length;
    const dataImp = lista.importadoEm ? new Date(lista.importadoEm).toLocaleDateString('pt-PT') : '—';
    kpiZone.style.display = '';
    kpiZone.innerHTML = `
      <div class="pu-kpi"><div class="pu-kpi-lbl">Artigos</div><div class="pu-kpi-val">${totArt}</div></div>
      <div class="pu-kpi"><div class="pu-kpi-lbl">Total da proposta</div><div class="pu-kpi-val" style="color:oklch(0.55 0.13 155)">${puFmtEur(totVal)}</div></div>
      <div class="pu-kpi"><div class="pu-kpi-lbl">Importado em</div><div class="pu-kpi-val" style="font-size:15px;color:var(--gray-600)">${dataImp}</div></div>
      <div class="pu-kpi"><div class="pu-kpi-lbl">Editados</div><div class="pu-kpi-val" style="font-size:16px;color:${editados?'#B45309':'var(--gray-400)'}">${editados}</div></div>`;
  } else {
    kpiZone.style.display = 'none';
  }

  // Corpo
  const body = document.getElementById('pu-dt-body');
  if(!temLista){
    body.innerHTML = `<div class="pu-dropzone-big"
        onclick="puOpenImport()"
        ondragover="puDragOver(event)"
        ondragleave="puDragLeave(event)"
        ondrop="puHandleDrop(event)">
      <svg class="pu-dz-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
      <div class="pu-dz-title">Importar mapa de quantidades</div>
      <div class="pu-dz-sub">Arraste um ficheiro Excel ou PDF, ou clique para escolher</div>
      <div class="pu-dz-formats"><span class="pu-dz-badge">.xlsx</span><span class="pu-dz-badge">.xls</span><span class="pu-dz-badge">.pdf</span></div>
    </div>`;
    return;
  }

  _puRenderTable(lista);
}

// ══════════════════════════════════════════════════════════════════════════════
//  TABELA EDITÁVEL
// ══════════════════════════════════════════════════════════════════════════════

function _puRenderTable(lista){
  const body    = document.getElementById('pu-dt-body');
  const q       = (document.getElementById('pu-dt-q')?.value||'').toLowerCase().trim();
  const artigos = lista.artigos;

  let rowsHtml = '';
  artigos.forEach((a, idx) => {
    if(a.isCapitulo){
      const nivel = a.nivel || 0;
      rowsHtml += `<tr class="pu-cap-row nivel-${nivel}" data-idx="${idx}">
        <td class="pu-cap-cod">${puEsc(a.codigo||'')}</td>
        <td colspan="6" class="pu-cap-desc">${puEsc(a.descricao||'')}</td>
        <td></td>
      </tr>`;
      return;
    }
    if(q && !(a.codigo+' '+a.descricao+' '+(a.notas||'')).toLowerCase().includes(q)) return;

    const tot     = (a.quantidade||0)*(a.precoUnit||0);
    const pct     = a.percentTotal || 0;
    const editado = a.editado ? ' pu-row-edited' : '';
    const temNota = a.notas ? ' pu-has-nota' : '';

    rowsHtml += `<tr class="pu-artigo-row${editado}" data-idx="${idx}">
      <td class="pu-cod">${puEsc(a.codigo||'—')}</td>
      <td class="pu-desc">
        <div class="pu-desc-text" data-idx="${idx}" data-field="descricao" onclick="puEditCell(this)">${puEsc(a.descricao||'')}</div>
        ${a.notas ? `<div class="pu-nota-preview">${puEsc(a.notas)}</div>` : ''}
      </td>
      <td class="pu-un pu-editable-cell" data-idx="${idx}" data-field="unidade" onclick="puEditCell(this)">${puEsc(a.unidade||'—')}</td>
      <td class="pu-num pu-editable-cell" data-idx="${idx}" data-field="quantidade" onclick="puEditCell(this)">${a.quantidade?puFmtNum(a.quantidade):'—'}</td>
      <td class="pu-num pu-price pu-editable-cell" data-idx="${idx}" data-field="precoUnit" onclick="puEditCell(this)">${a.precoUnit?puFmtEur(a.precoUnit):'—'}</td>
      <td class="pu-num pu-total" data-idx="${idx}">${tot>0?puFmtEur(tot):'—'}</td>
      <td class="pu-num pu-pct">${pct?pct.toFixed(2)+'%':'—'}</td>
      <td class="pu-nota-cell">
        <button class="pu-nota-btn${temNota}" title="Notas" data-idx="${idx}" onclick="puToggleNota(${idx})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </td>
    </tr>
    <tr class="pu-nota-row" id="pu-nota-row-${idx}" style="display:none" data-idx="${idx}">
      <td colspan="8" class="pu-nota-td">
        <textarea class="pu-nota-textarea" data-idx="${idx}" onblur="puSaveNota(${idx},this.value)" placeholder="Escreva notas, observações ou alertas sobre este artigo…">${puEsc(a.notas||'')}</textarea>
      </td>
    </tr>`;
  });

  body.innerHTML = `
    <div class="pu-tools">
      <div class="pu-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        <input id="pu-dt-q" placeholder="Pesquisar código, descrição ou nota…" oninput="_puRefreshDetail()" value="${q}"/>
      </div>
      <div style="font-size:11.5px;color:var(--gray-500);padding:0 4px">Clique em qualquer célula para editar</div>
    </div>
    <div class="pu-table-wrap">
      <table class="pu-table" id="pu-articulado-table">
        <thead><tr>
          <th style="width:100px">Artigo</th>
          <th>Descrição</th>
          <th style="width:55px;text-align:center">Un.</th>
          <th style="width:90px;text-align:right">Qtd.</th>
          <th style="width:120px;text-align:right">P. Unitário</th>
          <th style="width:130px;text-align:right">Total</th>
          <th style="width:60px;text-align:right">%</th>
          <th style="width:36px"></th>
        </tr></thead>
        <tbody id="pu-tbody">${rowsHtml||'<tr><td colspan="8" style="text-align:center;color:var(--gray-400);padding:24px">Nenhum artigo corresponde à pesquisa.</td></tr>'}</tbody>
      </table>
    </div>`;
}

function _puRefreshDetail(){
  const lista = PRECOS_UNIT.find(l => l.obraId === _puState.obraId);
  if(lista) _puRenderTable(lista);
}

// ── Edição inline de células ──────────────────────────────────────────────────
function puEditCell(el){
  if(el.querySelector('input')||el.querySelector('textarea')) return; // já a editar
  const idx   = parseInt(el.dataset.idx);
  const field = el.dataset.field;
  const lista = PRECOS_UNIT.find(l => l.obraId === _puState.obraId);
  if(!lista) return;
  const artigo = lista.artigos[idx];
  if(!artigo) return;

  const rawVal = artigo[field];
  const isNumeric = field === 'quantidade' || field === 'precoUnit';
  const isDesc    = field === 'descricao';

  if(isDesc){
    // Textarea para descrição
    const ta = document.createElement('textarea');
    ta.className = 'pu-edit-textarea';
    ta.value = rawVal || '';
    el.innerHTML = '';
    el.appendChild(ta);
    ta.focus();
    const save = () => {
      const v = ta.value.trim();
      artigo.descricao = v;
      artigo.editado = true;
      _puSave();
      el.innerHTML = puEsc(v);
      _puUpdateKpis();
    };
    ta.addEventListener('blur', save);
    ta.addEventListener('keydown', e => { if(e.key === 'Escape'){ ta.blur(); } });
    return;
  }

  if(isNumeric){
    const input = document.createElement('input');
    input.type  = 'text'; // text para aceitar formato PT
    input.value = (rawVal||0).toString().replace('.',',');
    input.className = 'pu-edit-input';
    el.innerHTML = '';
    el.appendChild(input);
    input.focus(); input.select();

    const save = () => {
      const v = _puParseNum(input.value.replace(/\s/g,''));
      artigo[field] = v;
      artigo.editado = true;
      // Recalcular total
      const tot = (artigo.quantidade||0)*(artigo.precoUnit||0);
      artigo.total = tot;
      _puSave();
      el.textContent = v ? (field==='quantidade'?puFmtNum(v):puFmtEur(v)) : '—';
      // Actualizar célula de total
      const tr = el.closest('tr');
      const totCell = tr?.querySelector('.pu-total');
      if(totCell) totCell.textContent = tot > 0 ? puFmtEur(tot) : '—';
      // Marcar linha como editada
      tr?.classList.add('pu-row-edited');
      _puUpdateKpis();
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => {
      if(e.key === 'Enter'){ e.preventDefault(); save(); input.blur(); }
      if(e.key === 'Escape'){ input.value = (rawVal||0).toString(); input.blur(); }
    });
    return;
  }

  // Texto simples (unidade)
  const input = document.createElement('input');
  input.type  = 'text';
  input.value = rawVal || '';
  input.className = 'pu-edit-input pu-edit-un';
  el.innerHTML = '';
  el.appendChild(input);
  input.focus(); input.select();
  const save = () => {
    artigo[field] = input.value.trim();
    artigo.editado = true;
    _puSave();
    el.textContent = input.value.trim() || '—';
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', e => { if(e.key==='Enter'){ e.preventDefault(); save(); input.blur(); } });
}

// ── Notas ─────────────────────────────────────────────────────────────────────
function puToggleNota(idx){
  const row = document.getElementById('pu-nota-row-'+idx);
  if(!row) return;
  const visible = row.style.display !== 'none';
  row.style.display = visible ? 'none' : '';
  if(!visible){
    const ta = row.querySelector('textarea');
    if(ta) ta.focus();
  }
}

function puSaveNota(idx, value){
  const lista = PRECOS_UNIT.find(l => l.obraId === _puState.obraId);
  if(!lista || !lista.artigos[idx]) return;
  lista.artigos[idx].notas   = value.trim();
  lista.artigos[idx].editado = true;
  _puSave();
  // Update preview
  const tr       = document.querySelector(`tr.pu-artigo-row[data-idx="${idx}"]`);
  const preview  = tr?.querySelector('.pu-nota-preview');
  const noteBtn  = tr?.querySelector('.pu-nota-btn');
  if(value.trim()){
    if(preview){ preview.textContent = value.trim(); }
    else { tr?.querySelector('.pu-desc-text')?.insertAdjacentHTML('afterend',`<div class="pu-nota-preview">${puEsc(value.trim())}</div>`); }
    noteBtn?.classList.add('pu-has-nota');
  } else {
    preview?.remove();
    noteBtn?.classList.remove('pu-has-nota');
  }
  _puUpdateKpis();
}

function _puUpdateKpis(){
  const lista = PRECOS_UNIT.find(l => l.obraId === _puState.obraId);
  if(!lista) return;
  const totVal  = lista.artigos.filter(a=>!a.isCapitulo).reduce((s,a)=>s+(a.precoUnit||0)*(a.quantidade||0),0);
  const editados= lista.artigos.filter(a=>a.editado).length;
  const kq = document.querySelector('#pu-dt-kpis .pu-kpi:nth-child(2) .pu-kpi-val');
  if(kq) kq.textContent = puFmtEur(totVal);
  const ke = document.querySelector('#pu-dt-kpis .pu-kpi:nth-child(4) .pu-kpi-val');
  if(ke){ ke.textContent = editados; ke.style.color = editados ? '#B45309' : 'var(--gray-400)'; }
}

// ══════════════════════════════════════════════════════════════════════════════
//  IMPORTAÇÃO
// ══════════════════════════════════════════════════════════════════════════════

function puOpenImport(){
  if(!_puState.obraId){ showToast('Selecione uma obra primeiro'); return; }
  document.getElementById('pu-file-input').click();
}

function puHandleFile(e){
  const file = e.target.files?.[0]; if(!file) return;
  e.target.value = '';
  _puProcessFile(file);
}

function puHandleDrop(ev){
  ev.preventDefault();
  ev.currentTarget?.classList?.remove('drag');
  const file = ev.dataTransfer?.files?.[0]; if(!file) return;
  _puProcessFile(file);
}

function puDragOver(ev){ ev.preventDefault(); ev.currentTarget?.classList?.add('drag'); }
function puDragLeave(ev){ ev.currentTarget?.classList?.remove('drag'); }

async function _puProcessFile(file){
  const isPDF = /\.pdf$/i.test(file.name) || file.type==='application/pdf';
  showToast(isPDF ? 'A ler PDF… pode demorar alguns segundos' : 'A processar Excel…');
  try{
    const artigos = isPDF ? await _puParsePDF(file) : await _puParseExcel(file);
    if(!artigos?.length){ showToast('Nenhum artigo reconhecido no ficheiro'); return; }
    _puSaveLista(artigos, isPDF ? 'PDF' : 'Excel');
    const nArt = artigos.filter(a=>!a.isCapitulo).length;
    showToast(`${nArt} artigos importados com sucesso`);
  }catch(err){
    console.error('puProcessFile:', err);
    showToast('Erro ao processar: ' + err.message);
  }
}

function _puSaveLista(artigos, fonte){
  const obraObj  = S.OBRAS.find(o => o.id === _puState.obraId);
  const existing = PRECOS_UNIT.findIndex(l => l.obraId === _puState.obraId);
  const entry = {
    id:          existing>=0 ? PRECOS_UNIT[existing].id : ('PU'+Date.now().toString(36).toUpperCase()),
    obraId:      _puState.obraId,
    obraNome:    obraObj?.nome || _puState.obraId,
    importadoEm: new Date().toISOString(),
    fonte,
    artigos
  };
  if(existing>=0) PRECOS_UNIT[existing] = entry;
  else PRECOS_UNIT.push(entry);
  _puSave();
  _puRenderDetail();
  _puRenderList();
}

// ══════════════════════════════════════════════════════════════════════════════
//  PARSER PDF — formato Plandese LPU
// ══════════════════════════════════════════════════════════════════════════════

let _pdfjsPromise = null;
async function _getPdfjs(){
  if(window.pdfjsLib) return window.pdfjsLib;
  if(!_pdfjsPromise) _pdfjsPromise = (async()=>{
    const mod   = await import('pdfjs-dist');
    const pdfjs = mod.getDocument ? mod : (mod.default || mod);
    try{
      const W = (await import('pdfjs-dist/build/pdf.worker.min.js?worker')).default;
      pdfjs.GlobalWorkerOptions.workerPort = new W();
    }catch{
      try{ const u=(await import('pdfjs-dist/build/pdf.worker.min.js?url')).default; pdfjs.GlobalWorkerOptions.workerSrc=u; }catch{}
    }
    window.pdfjsLib = pdfjs; return pdfjs;
  })();
  return _pdfjsPromise;
}

async function _puParsePDF(file){
  const pdfjs = await _getPdfjs();
  const buf   = await file.arrayBuffer();
  const pdf   = await pdfjs.getDocument({ data: buf }).promise;

  // Extrair todos os items de texto com posição X,Y,página
  const rawItems = [];
  for(let p = 1; p <= pdf.numPages; p++){
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();
    const vp      = page.getViewport({ scale:1 });
    content.items.forEach(item => {
      const txt = item.str; // não fazer trim aqui para preservar espaços internos
      rawItems.push({
        text: txt,
        x:    Math.round(item.transform[4]),
        y:    Math.round(vp.height - item.transform[5]), // Y top-down
        page: p,
        w:    Math.round(item.width || 0)
      });
    });
  }

  // Ordenar e agrupar em linhas por (página, Y) com tolerância de 5px
  rawItems.sort((a,b) => a.page!==b.page ? a.page-b.page : a.y!==b.y ? a.y-b.y : a.x-b.x);
  const lines = [];
  let curItems = null, curPage = -1, curY = -999;
  for(const item of rawItems){
    if(!item.text.trim()) continue;
    if(item.page !== curPage || Math.abs(item.y - curY) > 5){
      curItems = []; lines.push({ page:item.page, y:item.y, items:curItems });
      curPage = item.page; curY = item.y;
    }
    curItems.push(item);
  }

  // Detectar limites de colunas e construir artigos
  const col = _puDetectColumns(lines);
  return _puBuildArticosFromLines(lines, col);
}

function _puDetectColumns(lines){
  // Procurar a linha de cabeçalho da tabela (contém "Item" e "quant")
  for(const line of lines){
    const joined = line.items.map(i=>i.text).join(' ');
    if(!/\bItem\b/i.test(joined)) continue;
    if(!/quant/i.test(joined)) continue;

    // Ordenar itens do cabeçalho da esquerda para a direita
    const sorted = [...line.items].sort((a,b) => a.x - b.x);

    // Encontrar X da coluna "quant." (ponto de referência central)
    const qtyItem = sorted.find(i => /^quant/i.test(i.text.trim()));
    if(!qtyItem) continue;
    const xQty = qtyItem.x;

    // "Un" standalone está ANTES de "quant."
    // "Un" em "Un venda" está DEPOIS de "quant."
    let xDesc=-1, xUn=-1, xPrice=-1, xTotal=-1, xPct=-1;
    for(const item of sorted){
      const t = item.text.toLowerCase().trim();
      const x = item.x;
      if(t.startsWith('descri') || t.includes('artigo')) { xDesc = x; continue; }
      // "Un" antes de quant → coluna unidade; após quant → "Un venda" (preço unitário)
      if((t === 'un' || t === 'un.') && x < xQty - 5) { xUn = x; continue; }
      if((t === 'un' || t === 'un.') && x > xQty)     { if(xPrice<0) xPrice = x; continue; }
      // "Un venda" como item único
      if(t === 'un venda') { xPrice = x; continue; }
      // "Total venda" como item único ou "Total" separado
      if(t === 'total venda') { xTotal = x; continue; }
      if(t === 'total' && x > xQty && xPrice > 0) { xTotal = x; continue; }
      // "venda" sozinho: 1ª ocorrência → parte de "Un venda"; 2ª → parte de "Total venda"
      if(t === 'venda') { if(xPrice < 0) xPrice = x; else if(xTotal < 0) xTotal = x; continue; }
      if(t.includes('%')) { xPct = x; continue; }
    }

    if(xQty > 0){
      return {
        itemEnd:  (xDesc  > 0 ? xDesc  : xQty - 280) - 2,
        descEnd:  (xUn    > 0 ? xUn    : xQty - 60)  - 2,
        unEnd:    xQty - 2,
        qtyEnd:   (xPrice > 0 ? xPrice : xQty + 60)  - 2,
        priceEnd: (xTotal > 0 ? xTotal : xQty + 130)  - 2,
        totalEnd: (xPct   > 0 ? xPct   : xQty + 200)  - 2
      };
    }
  }
  // Fallback para PDF Plandese A4 típico (595pt)
  return { itemEnd:108, descEnd:388, unEnd:428, qtyEnd:468, priceEnd:530, totalEnd:603 };
}

function _puBuildArticosFromLines(lines, col){
  const artigos = [];
  // Padrões para linhas a ignorar
  const SKIP   = /TOTAL DA PROPOSTA|Lista de preços unitários|Processo interno|Data de impressão|DOCUMENTOS DA|EMPREITADA DE|PLANDESE|^\s*Página\s+\d+|^NOTA\b|^\*CP/i;
  const HEADER = /\bItem\b.*Descri|\bDescri.*\bquant|\bUn\s+venda\b.*\bTotal/i;

  const ART_CODE = /^(\d+(?:\.\d+){2,})\.?\s*$/;   // 3+ níveis: "1.1.1" ou "4.3.1.1"
  const ART_LINE = /^(\d+(?:\.\d+){2,})\.?\s+(.+)/; // código + descrição na mesma linha
  const ROMAN    = /^([IVX]+(?:\.\d+)*\.?)\s+(.{2,})$/i;
  const SECTION  = /^(\d+(?:\.\d+){0,1})\.?\s+(.{3,})$/;

  let pendingCode = null;
  let pendingDesc = [];
  const newId = () => 'A'+Math.random().toString(36).slice(2,8);

  for(const line of lines){
    const fullText = line.items.map(i=>i.text).join(' ').replace(/\s+/g,' ').trim();
    if(!fullText) continue;
    if(SKIP.test(fullText))   continue;
    if(HEADER.test(fullText)) continue;

    // ── Classificar cada item da linha pela sua coluna (posição X) ──
    const cells = { code:[], desc:[], un:[], qty:[], price:[], total:[], pct:[] };
    for(const item of line.items){
      const t = item.text; const x = item.x;
      if     (x <= col.itemEnd)  cells.code.push(t);
      else if(x <= col.descEnd)  cells.desc.push(t);
      else if(x <= col.unEnd)    cells.un.push(t);
      else if(x <= col.qtyEnd)   cells.qty.push(t);
      else if(x <= col.priceEnd) cells.price.push(t);
      else if(x <= col.totalEnd) cells.total.push(t);
      else                       cells.pct.push(t);
    }

    // Texto limpo de cada coluna
    const unT    = cells.un.join('').replace(/[\s ]/g,'').replace(/[€%]/g,'');
    const qtyT   = cells.qty.join(' ').replace(/[€%]/g,'').trim();
    const priceT = cells.price.join(' ').replace(/€/g,'').trim();
    const totalT = cells.total.join(' ').replace(/€/g,'').trim();
    const pctT   = cells.pct.join('').replace(/[\s ]/g,'');
    const codeT  = cells.code.join(' ').trim();
    const descT  = cells.desc.join(' ').trim();

    // É uma linha de dados se tiver unidade + quantidade + preço
    const isData = !!(unT && qtyT && priceT);

    if(isData){
      const finalCode = (codeT || pendingCode || '').replace(/\.$/,'').trim();
      const allDesc   = [...pendingDesc];
      if(descT) allDesc.push(descT);

      artigos.push({
        id:           newId(),
        codigo:       finalCode,
        descricao:    allDesc.join(' ').replace(/\s+/g,' ').trim(),
        unidade:      unT,
        quantidade:   _puParseNum(qtyT),
        precoUnit:    _puParseNum(priceT),
        total:        _puParseNum(totalT),
        percentTotal: _puParsePct(pctT),
        isCapitulo:   false,
        nivel:        3,
        notas:        '',
        editado:      false
      });
      pendingCode = null;
      pendingDesc = [];

    } else {
      // Linha não-dados: capítulo, secção ou continuação de descrição
      const lineText = [codeT, descT].join(' ').trim() || fullText;

      // Capítulo romano
      const rm = lineText.match(ROMAN);
      if(rm){
        if(pendingCode){ pendingCode=null; pendingDesc=[]; }
        artigos.push({ id:newId(), codigo:rm[1].trim(), descricao:rm[2].trim(), isCapitulo:true, nivel:0, unidade:'', quantidade:0, precoUnit:0, total:0, percentTotal:0, notas:'', editado:false });
        continue;
      }

      // Código de artigo 3+ níveis (sozinho ou com início de descrição)
      const ac1 = (codeT||lineText).match(ART_CODE);
      if(ac1){
        pendingCode = ac1[1];
        pendingDesc = descT ? [descT] : [];
        continue;
      }
      const ac2 = lineText.match(ART_LINE);
      if(ac2){
        pendingCode = ac2[1];
        pendingDesc = [ac2[2]];
        continue;
      }

      // Secção numérica (1-2 níveis)
      const sc = lineText.match(SECTION);
      if(sc && !pendingCode){
        artigos.push({ id:newId(), codigo:sc[1].trim(), descricao:sc[2].trim(), isCapitulo:true, nivel:1, unidade:'', quantidade:0, precoUnit:0, total:0, percentTotal:0, notas:'', editado:false });
        continue;
      }

      // Continuação de descrição de artigo em curso
      if(pendingCode !== null && lineText.length > 2){
        pendingDesc.push(descT || lineText);
      }
    }
  }

  return artigos;
}

function _puParsePct(v){
  if(!v) return 0;
  return parseFloat(String(v).replace('%','').replace(',','.')) || 0;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PARSER EXCEL
// ══════════════════════════════════════════════════════════════════════════════

function _puParseExcel(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => {
      try{
        const wb   = XLSX.read(ev.target.result, { type:'binary', cellDates:true });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
        resolve(_puParseExcelRows(rows));
      }catch(e){ reject(e); }
    };
    reader.onerror = reject;
    reader.readAsBinaryString(file);
  });
}

function _puParseExcelRows(rows){
  if(!rows.length) return [];
  const newId = () => 'A'+Math.random().toString(36).slice(2,8);

  // Detectar cabeçalho
  let hIdx = -1;
  for(let i=0; i<Math.min(rows.length,10); i++){
    const r = rows[i].map(c=>_puNorm(String(c)));
    if(r.some(h=>h.includes('descri')||h.includes('artigo')||h==='un'||h==='unidade')){
      hIdx=i; break;
    }
  }

  const artigos = [];
  if(hIdx>=0){
    const hdr   = rows[hIdx].map(c=>_puNorm(String(c)));
    const iCod  = _findCol(hdr,['codigo','item','cod','ref','artigo','n.','num','n°']);
    const iDesc = _findCol(hdr,['descri','designa','trabalho','especif','artigo']);
    const iUn   = _findCol(hdr,['unidade','un','und']);
    const iQtd  = _findCol(hdr,['quant','qtd','qt']);
    const iPu   = _findCol(hdr,['preco unit','p.unit','p.u.','pu','un venda','unitario']);
    const iTot  = _findCol(hdr,['total','montante']);
    const iPct  = _findCol(hdr,['%','pct','percent']);

    for(let i=hIdx+1; i<rows.length; i++){
      const row = rows[i];
      if(!row||row.every(c=>c===''||c===null)) continue;
      const cod  = String(iCod >=0?row[iCod] ??'':row[0]??'').trim();
      const desc = String(iDesc>=0?row[iDesc]??'':row[1]??'').trim();
      if(!desc&&!cod) continue;
      const un   = String(iUn  >=0?row[iUn] ??'':row[2]??'').trim();
      const qtd  = _toNum(iQtd>=0?row[iQtd]:row[3]);
      const pu   = _toNum(iPu >=0?row[iPu] :row[4]);
      const tot  = _toNum(iTot>=0?row[iTot]:row[5]) || qtd*pu;
      const pct  = _toNum(iPct>=0?row[iPct]:row[6]);
      const isCap= (!qtd&&!pu)||_isChapterCode(cod);
      artigos.push({ id:newId(), codigo:cod, descricao:desc, unidade:un, quantidade:qtd, precoUnit:pu, total:isCap?0:(tot||qtd*pu), percentTotal:pct, isCapitulo:isCap, nivel:isCap?0:3, notas:'', editado:false });
    }
  } else {
    for(let i=0; i<rows.length; i++){
      const row=rows[i];
      if(!row||row.every(c=>c===''||c===null)) continue;
      const cod=String(row[0]??'').trim(), desc=String(row[1]??row[0]??'').trim();
      if(!desc) continue;
      const un=String(row[2]??'').trim(), qtd=_toNum(row[3]), pu=_toNum(row[4]);
      const tot=_toNum(row[5])||qtd*pu, pct=_toNum(row[6]);
      const isCap=(!qtd&&!pu)||_isChapterCode(cod);
      artigos.push({ id:'A'+Math.random().toString(36).slice(2,8), codigo:cod, descricao:desc, unidade:un, quantidade:qtd, precoUnit:pu, total:isCap?0:tot, percentTotal:pct, isCapitulo:isCap, nivel:isCap?0:3, notas:'', editado:false });
    }
  }
  return artigos;
}

// ══════════════════════════════════════════════════════════════════════════════
//  EXPORTAR EXCEL
// ══════════════════════════════════════════════════════════════════════════════

function puExportExcel(){
  const lista = PRECOS_UNIT.find(l => l.obraId === _puState.obraId);
  if(!lista?.artigos?.length){ showToast('Sem dados para exportar'); return; }
  const o = S.OBRAS.find(x=>x.id===_puState.obraId);
  const nome = o?.nome || lista.obraNome || 'Obra';

  const data = [['Artigo','Descrição','Unidade','Quantidade','Preço Unitário','Total','% Total','Notas']];
  lista.artigos.forEach(a => {
    if(a.isCapitulo) data.push([a.codigo||'', a.descricao||'','','','','','','']);
    else data.push([
      a.codigo||'', a.descricao||'', a.unidade||'',
      a.quantidade||0, a.precoUnit||0,
      (a.quantidade||0)*(a.precoUnit||0),
      a.percentTotal||0,
      a.notas||''
    ]);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:12},{wch:65},{wch:8},{wch:12},{wch:14},{wch:16},{wch:8},{wch:40}];
  XLSX.utils.book_append_sheet(wb, ws, 'Preços Unitários');
  XLSX.writeFile(wb, `LPU_${nome.replace(/[^a-zA-Z0-9]/g,'_')}.xlsx`);
  showToast('Ficheiro exportado');
}

// ══════════════════════════════════════════════════════════════════════════════
//  LIMPAR
// ══════════════════════════════════════════════════════════════════════════════

function puLimpar(){
  if(!_puState.obraId) return;
  if(!confirm('Eliminar a lista de preços e todas as edições desta obra?')) return;
  PRECOS_UNIT = PRECOS_UNIT.filter(l => l.obraId !== _puState.obraId);
  _puSave();
  _puRenderDetail();
  _puRenderList();
  showToast('Lista eliminada');
}

// ══════════════════════════════════════════════════════════════════════════════
//  UTILITÁRIOS
// ══════════════════════════════════════════════════════════════════════════════

function _puNorm(s){ return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim(); }

function _findCol(hdr, keys){
  for(const k of keys){ const i=hdr.findIndex(h=>h.includes(k)); if(i>=0) return i; }
  return -1;
}

// Número PT: "3 350,00" ou "8,11" (espaço como milhar, vírgula como decimal)
function _puParseNum(v){
  if(v===''||v===null||v===undefined) return 0;
  const s = String(v).replace(/[€%\s ]/g,'').replace(/\.(?=\d{3})/g,'').replace(',','.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function _puParseEur(v){ return _puParseNum(String(v).replace(/€/g,'')); }

function _toNum(v){
  if(v===''||v===null||v===undefined) return 0;
  const n = parseFloat(String(v).replace(/[€\s ]/g,'').replace(/\.(?=\d{3})/g,'').replace(',','.'));
  return isNaN(n)?0:n;
}

function _isChapterCode(cod){
  if(!cod) return false;
  return /^[IVXLCDMivxlcdm]+$/i.test(cod)||/^[A-Z]{1,3}$/.test(cod)||/^\d+\.$/.test(cod)||/^CAP/i.test(cod);
}

function _show(id){ const el=document.getElementById(id); if(el) el.style.display=''; }
function _hide(id){ const el=document.getElementById(id); if(el) el.style.display='none'; }

function puFmtEur(v){ return new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR',minimumFractionDigits:2}).format(v||0); }
function puFmtNum(v){ if(!v) return '—'; return new Intl.NumberFormat('pt-PT',{minimumFractionDigits:2,maximumFractionDigits:4}).format(v); }
function puEsc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

export {
  PRECOS_UNIT,
  initPrecosUnit, puGoList, puOpenObra,
  puOpenImport, puHandleFile, puHandleDrop, puDragOver, puDragLeave,
  puExportExcel, puLimpar,
  puEditCell, puToggleNota, puSaveNota, _puRefreshDetail,
  _puLoad, _puSave
};
