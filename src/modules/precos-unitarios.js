// ═══════════════════════════════════════
//  PREÇOS UNITÁRIOS — Lista por obra
// ═══════════════════════════════════════
import { S } from '../state.js';
import { showToast } from './navigation.js';

let PRECOS_UNIT = [];
let _puObraId   = null;
let _puFileInput = null;

// ── Persistência ─────────────────────────────────────────────────────────────
function _puLoad(){ try{ PRECOS_UNIT = JSON.parse(localStorage.getItem('prod_precos_unit')||'[]'); }catch(e){ PRECOS_UNIT=[]; } }
function _puSave(){ localStorage.setItem('prod_precos_unit', JSON.stringify(PRECOS_UNIT)); }
_puLoad();

// ── Init ──────────────────────────────────────────────────────────────────────
function initPrecosUnit(){
  _puLoad();
  _puFileInput = document.getElementById('pu-file-input');
  renderPrecosUnit();
}

// ── Render principal ──────────────────────────────────────────────────────────
function renderPrecosUnit(){
  const obras = S.OBRAS.filter(o => o.ativa !== false);

  // Preenche selector de obra
  const sel = document.getElementById('pu-obra-sel');
  if(!sel) return;
  const prev = sel.value || _puObraId || (obras[0]?.id || '');
  sel.innerHTML = '<option value="">— Selecionar obra —</option>' +
    obras.map(o => `<option value="${o.id}">${puEsc(o.nome)}</option>`).join('');
  sel.value = obras.find(o => o.id === prev) ? prev : (obras[0]?.id || '');
  _puObraId = sel.value;

  _puRenderTable();
}

function puSelObra(obraId){
  _puObraId = obraId;
  _puRenderTable();
}

function _puRenderTable(){
  const container = document.getElementById('pu-table-container');
  const emptyEl   = document.getElementById('pu-empty');
  const actionsEl = document.getElementById('pu-actions');
  if(!container) return;

  if(!_puObraId){
    container.innerHTML = '';
    if(emptyEl) emptyEl.style.display = 'block';
    if(actionsEl) actionsEl.style.display = 'none';
    return;
  }

  const lista = PRECOS_UNIT.find(l => l.obraId === _puObraId);

  if(!lista || !lista.artigos || lista.artigos.length === 0){
    container.innerHTML = '';
    if(emptyEl){ emptyEl.style.display = 'block'; emptyEl.querySelector('.pu-empty-msg').textContent = 'Nenhuma lista de preços importada para esta obra.'; }
    if(actionsEl) actionsEl.style.display = 'none';
    return;
  }

  if(emptyEl) emptyEl.style.display = 'none';
  if(actionsEl) actionsEl.style.display = 'flex';

  // Sumários
  const totArtigos = lista.artigos.filter(a => !a.isCapitulo).length;
  const totGeral   = lista.artigos.filter(a => !a.isCapitulo).reduce((s,a) => s + (a.total||0), 0);
  document.getElementById('pu-k-artigos').textContent = totArtigos;
  document.getElementById('pu-k-total').textContent   = puFmtEur(totGeral);
  document.getElementById('pu-k-import').textContent  = lista.importadoEm ? new Date(lista.importadoEm).toLocaleDateString('pt-PT') : '—';

  // Pesquisa
  const q = (document.getElementById('pu-q')?.value || '').toLowerCase().trim();

  let rows = '';
  let capAtual = '';
  lista.artigos.forEach(a => {
    if(a.isCapitulo){
      capAtual = a.descricao;
      rows += `<tr class="pu-cap-row"><td colspan="6">${puEsc(a.codigo ? a.codigo+' — ' : '')}${puEsc(a.descricao)}</td></tr>`;
      return;
    }
    if(q){
      const hay = (a.codigo+' '+a.descricao+' '+capAtual).toLowerCase();
      if(!hay.includes(q)) return;
    }
    const total = (a.quantidade||0) * (a.precoUnit||0);
    rows += `<tr>
      <td class="pu-cod">${puEsc(a.codigo||'—')}</td>
      <td class="pu-desc">${puEsc(a.descricao||'—')}</td>
      <td class="pu-un">${puEsc(a.unidade||'—')}</td>
      <td class="pu-num">${puFmtNum(a.quantidade)}</td>
      <td class="pu-num pu-price">${puFmtEur(a.precoUnit)}</td>
      <td class="pu-num pu-total">${puFmtEur(total)}</td>
    </tr>`;
  });

  container.innerHTML = `<div class="pu-table-wrap">
    <table class="pu-table">
      <thead><tr>
        <th style="width:100px">Código</th>
        <th>Descrição</th>
        <th style="width:60px;text-align:center">Un.</th>
        <th style="width:90px;text-align:right">Qtd.</th>
        <th style="width:120px;text-align:right">P. Unit.</th>
        <th style="width:130px;text-align:right">Total</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:var(--gray-400);padding:24px">Nenhum artigo corresponde à pesquisa.</td></tr>'}</tbody>
    </table>
  </div>`;
}

// ── Importar Excel ────────────────────────────────────────────────────────────
function puOpenImport(){
  if(!_puObraId){ showToast('Selecione uma obra primeiro'); return; }
  document.getElementById('pu-file-input').click();
}

function puHandleFile(e){
  const file = e.target.files?.[0]; if(!file) return;
  e.target.value = '';
  _puParseExcel(file);
}

function puHandleDrop(ev){
  ev.preventDefault();
  document.getElementById('pu-empty').classList.remove('drag');
  if(!_puObraId){ showToast('Selecione uma obra primeiro'); return; }
  const file = ev.dataTransfer?.files?.[0]; if(!file) return;
  _puParseExcel(file);
}

function puDragOver(ev){ ev.preventDefault(); if(_puObraId) document.getElementById('pu-empty').classList.add('drag'); }
function puDragLeave(){ document.getElementById('pu-empty')?.classList.remove('drag'); }

function _puParseExcel(file){
  const reader = new FileReader();
  reader.onload = function(ev){
    try{
      const wb   = XLSX.read(ev.target.result, { type:'binary', cellDates:true });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
      if(rows.length < 2){ showToast('Ficheiro sem dados'); return; }

      // Tentar detectar linha de cabeçalho (primeiras 8 linhas)
      let headerIdx = -1;
      for(let i = 0; i < Math.min(rows.length, 8); i++){
        const r = rows[i].map(c => String(c).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim());
        if(r.some(h => h.includes('descri') || h.includes('artigo') || h === 'un' || h === 'unidade')){
          headerIdx = i; break;
        }
      }

      const artigos = [];

      if(headerIdx >= 0){
        // Modo com cabeçalho detectado
        const hdr = rows[headerIdx].map(c => String(c).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim());
        const iCod  = _findCol(hdr, ['codigo','cod','ref','artigo','n.','num','capitulo','cap']);
        const iDesc = _findCol(hdr, ['descri','designa','designacao','nome','artigo','trabalho']);
        const iUn   = _findCol(hdr, ['unidade','un','und','unit']);
        const iQtd  = _findCol(hdr, ['quant','qtd','qt']);
        const iPu   = _findCol(hdr, ['preco unit','p.unit','p.u.','pu','unit.price','unitario']);
        const iTot  = _findCol(hdr, ['total','montante','importe','valor']);

        for(let i = headerIdx + 1; i < rows.length; i++){
          const row = rows[i];
          if(row.every(c => c === '' || c === null)) continue;
          const desc = String(row[iDesc] ?? '').trim();
          const cod  = iCod >= 0 ? String(row[iCod] ?? '').trim() : '';
          if(!desc && !cod) continue;

          const pu  = iUn  >= 0 ? String(row[iUn] ?? '').trim() : '';
          const qtd = _toNum(iQtd >= 0 ? row[iQtd] : null);
          const precoUnit = _toNum(iPu  >= 0 ? row[iPu] : null);
          const total     = iTot >= 0 ? _toNum(row[iTot]) : qtd * precoUnit;

          // Detectar capítulo: linha sem quantidade e sem preço
          const isCapitulo = (!qtd && !precoUnit) || _isChapterCode(cod);
          artigos.push({ codigo: cod, descricao: desc, unidade: pu, quantidade: qtd, precoUnit, total: isCapitulo ? 0 : (total || qtd * precoUnit), isCapitulo });
        }
      } else {
        // Sem cabeçalho — tentar leitura posicional / auto-detect
        // Heurística: percorrer linhas e tentar identificar capítulos e artigos
        for(let i = 0; i < rows.length; i++){
          const row = rows[i];
          if(row.every(c => c === '' || c === null)) continue;
          // Encontrar primeira célula não vazia
          const firstVal = String(row.find(c => c !== '') ?? '').trim();
          if(!firstVal) continue;
          const cod  = String(row[0]||'').trim();
          const desc = String(row[1]||row[0]||'').trim();
          const un   = String(row[2]||'').trim();
          const qtd  = _toNum(row[3]);
          const pu   = _toNum(row[4]);
          const tot  = _toNum(row[5]) || qtd * pu;
          const isCapitulo = (!qtd && !pu) || _isChapterCode(cod);
          artigos.push({ codigo: cod, descricao: desc, unidade: un, quantidade: qtd, precoUnit: pu, total: isCapitulo ? 0 : tot, isCapitulo });
        }
      }

      if(artigos.length === 0){ showToast('Nenhum artigo reconhecido'); return; }

      // Guardar
      const obraObj = S.OBRAS.find(o => o.id === _puObraId);
      const existing = PRECOS_UNIT.findIndex(l => l.obraId === _puObraId);
      const entry = {
        id:          existing >= 0 ? PRECOS_UNIT[existing].id : ('PU' + Date.now().toString(36).toUpperCase()),
        obraId:      _puObraId,
        obraNome:    obraObj?.nome || _puObraId,
        importadoEm: new Date().toISOString(),
        artigos
      };
      if(existing >= 0) PRECOS_UNIT[existing] = entry;
      else PRECOS_UNIT.push(entry);
      _puSave();
      _puRenderTable();
      showToast(`${artigos.filter(a=>!a.isCapitulo).length} artigos importados com sucesso`);
    }catch(err){
      console.error('puParseExcel:', err);
      showToast('Erro ao processar o ficheiro: ' + err.message);
    }
  };
  reader.readAsBinaryString(file);
}

function _findCol(hdr, keys){
  for(const k of keys){
    const i = hdr.findIndex(h => h.includes(k));
    if(i >= 0) return i;
  }
  return -1;
}

function _toNum(v){
  if(v === '' || v === null || v === undefined) return 0;
  const n = parseFloat(String(v).replace(/[€\s ]/g,'').replace(',','.'));
  return isNaN(n) ? 0 : n;
}

function _isChapterCode(cod){
  // Capítulo se só tem algarismos romanos/letras maiúsculas ou termina em "." sem subnível
  if(!cod) return false;
  return /^[IVXLCDMivxlcdm]+$/.test(cod) || /^[A-Z]{1,3}$/.test(cod) || /^\d+\.$/.test(cod);
}

// ── Exportar Excel ────────────────────────────────────────────────────────────
function puExportExcel(){
  if(!_puObraId){ showToast('Selecione uma obra'); return; }
  const lista = PRECOS_UNIT.find(l => l.obraId === _puObraId);
  if(!lista || !lista.artigos?.length){ showToast('Sem dados para exportar'); return; }

  const obraObj = S.OBRAS.find(o => o.id === _puObraId);
  const obraNome = obraObj?.nome || lista.obraNome || 'Obra';

  const wsData = [['Código','Descrição','Unidade','Quantidade','Preço Unitário','Total']];
  lista.artigos.forEach(a => {
    if(a.isCapitulo){
      wsData.push([a.codigo || '', a.descricao || '', '', '', '', '']);
    } else {
      wsData.push([
        a.codigo    || '',
        a.descricao || '',
        a.unidade   || '',
        a.quantidade || 0,
        a.precoUnit  || 0,
        (a.quantidade||0) * (a.precoUnit||0)
      ]);
    }
  });

  const wb  = XLSX.utils.book_new();
  const ws  = XLSX.utils.aoa_to_sheet(wsData);

  // Larguras de coluna
  ws['!cols'] = [{wch:14},{wch:60},{wch:10},{wch:12},{wch:16},{wch:16}];

  // Formato moeda e número nas colunas E, F (índices 4,5)
  const range = XLSX.utils.decode_range(ws['!ref']||'A1');
  for(let R = 1; R <= range.e.r; R++){
    ['E','F'].forEach(col => {
      const addr = col + (R+1);
      if(ws[addr] && typeof ws[addr].v === 'number'){
        ws[addr].z = '#,##0.00\\ "€"';
      }
    });
    const dAddr = 'D' + (R+1);
    if(ws[dAddr] && typeof ws[dAddr].v === 'number') ws[dAddr].z = '#,##0.00';
  }

  XLSX.utils.book_append_sheet(wb, ws, 'Preços Unitários');
  XLSX.writeFile(wb, `Precos_Unitarios_${obraNome.replace(/[^a-zA-Z0-9]/g,'_')}.xlsx`);
  showToast('Ficheiro exportado');
}

// ── Limpar lista ──────────────────────────────────────────────────────────────
function puLimpar(){
  if(!_puObraId){ showToast('Selecione uma obra'); return; }
  const lista = PRECOS_UNIT.find(l => l.obraId === _puObraId);
  if(!lista){ showToast('Sem dados para limpar'); return; }
  if(!confirm('Eliminar a lista de preços desta obra?')) return;
  PRECOS_UNIT = PRECOS_UNIT.filter(l => l.obraId !== _puObraId);
  _puSave();
  _puRenderTable();
  showToast('Lista eliminada');
}

// ── Utilitários ───────────────────────────────────────────────────────────────
function puFmtEur(v){
  return new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR',minimumFractionDigits:2}).format(v||0);
}
function puFmtNum(v){
  if(!v) return '—';
  return new Intl.NumberFormat('pt-PT',{minimumFractionDigits:2,maximumFractionDigits:4}).format(v);
}
function puEsc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function puRefreshTable(){ _puRenderTable(); }

export {
  PRECOS_UNIT,
  initPrecosUnit, renderPrecosUnit, puSelObra, puRefreshTable,
  puOpenImport, puHandleFile, puHandleDrop, puDragOver, puDragLeave,
  puExportExcel, puLimpar,
  _puLoad, _puSave
};
