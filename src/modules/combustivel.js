// ═══════════════════════════════════════
//  COMBUSTÍVEL — Vista admin
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S } from '../state.js';
import { fmt, fmtPT } from '../utils/helpers.js';
import { showToast, openModal, closeModal } from './navigation.js';
import { EQUIPAMENTOS, sbLoadEquipamentos } from './equipamentos.js';

const _escHtml = s => String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const MESES=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// Entrada no depósito: tipo_registo='deposito' com movimento='entrada' (ou sem movimento)
const isEntDepRow=r=>r.tipo_registo==='deposito'&&(r.movimento==='entrada'||!r.movimento);
// Saída: saída de depósito OU abastecimento directo de viatura
const isSaidaRow=r=>(r.tipo_registo==='deposito'&&r.movimento==='saida')||r.tipo_registo==='viatura';
const _sumL=(arr,filterFn)=>arr.filter(filterFn).reduce((s,r)=>s+(parseFloat(r.litros)||0),0);

function periodRange(tipo,anchor){
  const ref=anchor||new Date();
  const refStr=fmt(ref);
  if(tipo==='dia') return [refStr,refStr];
  if(tipo==='semana'){
    const dow=ref.getDay()||7; // 1=Seg … 7=Dom
    const seg=new Date(ref); seg.setDate(ref.getDate()-dow+1);
    const dom=new Date(seg); dom.setDate(seg.getDate()+6);
    return [fmt(seg),fmt(dom)];
  }
  if(tipo==='mes'){
    const ini=refStr.slice(0,7)+'-01';
    const fim=new Date(ref.getFullYear(),ref.getMonth()+1,0);
    return [ini,fmt(fim)];
  }
  return [null,null]; // tudo
}

// ════════════════════════════════════════════════
//  COMBUSTÍVEL — ADMIN
// ════════════════════════════════════════════════
let _combAllRows=[];
let _combDetObraId=null;
let _combDetPeriodo='tudo';
let _combDetAnchor=new Date();
let _combDetEquip='';

async function _fetchCombRows(){
  const {data,error}=await sb.from('registos_combustivel').select('*').order('data',{ascending:false}).order('criado_em',{ascending:false});
  if(error) throw error;
  _combAllRows=data||[];
}

function _comFiltrosAtuais(){
  return {
    ini:document.getElementById('comb-f-ini').value,
    fim:document.getElementById('comb-f-fim').value,
    equip:document.getElementById('comb-f-equip').value,
    obraFilt:document.getElementById('comb-f-obra')?.value||''
  };
}

function _renderCombGridFiltrada(){
  const {ini,fim,equip,obraFilt}=_comFiltrosAtuais();
  let filtered=_combAllRows;
  if(ini) filtered=filtered.filter(r=>r.data&&r.data>=ini);
  if(fim) filtered=filtered.filter(r=>r.data&&r.data<=fim);
  if(equip) filtered=filtered.filter(r=>r.equipamento_id===equip);
  if(obraFilt) filtered=filtered.filter(r=>r.obra_id===obraFilt);
  renderCombObraCards(filtered);
}

async function loadCombustivelAdmin(){
  const grid=document.getElementById('comb-obras-grid');
  const emptyEl=document.getElementById('comb-obras-empty');
  grid.innerHTML='<div class="pl-load"><span class="pl-logo"></span>A carregar…</div>';
  emptyEl.style.display='none';
  try{
    await _fetchCombRows();
    _renderCombGridFiltrada();
  }catch(e){
    grid.innerHTML=`<div style="text-align:center;padding:24px;color:#b91c1c">Erro: ${e.message}</div>`;
  }
}

// ── Cartões de obra (stock apenas quando há depósito) ──
function renderCombObraCards(rows){
  const grid=document.getElementById('comb-obras-grid');
  const emptyEl=document.getElementById('comb-obras-empty');
  if(!grid) return;
  // Agrupar por obra
  const map={};
  rows.forEach(r=>{
    const id=r.obra_id||'__sem_obra__';
    const nome=r.obra_nome||S.OBRAS.find(o=>o.id===r.obra_id)?.nome||(r.obra_id?r.obra_id:'Sem obra');
    if(!map[id]) map[id]={id,nome,rows:[]};
    map[id].rows.push(r);
  });
  const obras=Object.values(map).sort((a,b)=>a.nome.localeCompare(b.nome));
  if(!obras.length){grid.innerHTML='';emptyEl.style.display='';return;}
  emptyEl.style.display='none';

  grid.innerHTML=obras.map(ob=>{
    const hasDep=ob.rows.some(r=>r.tipo_registo==='deposito');
    const nReg=ob.rows.length;
    const tipos=[...new Set(ob.rows.map(r=>r.tipo_combustivel).filter(Boolean))].join(', ')||'—';

    let box;
    if(hasDep){
      const ent=_sumL(ob.rows,isEntDepRow);
      const sai=_sumL(ob.rows,isSaidaRow);
      const stock=ent-sai;
      const stockColor=stock>=0?'var(--blue-700)':'#b91c1c';
      const stockBg=stock>=0?'var(--blue-50)':'#fef2f2';
      const stockBorder=stock>=0?'var(--blue-200)':'#fecaca';
      box=`<div style="background:${stockBg};border:1.5px solid ${stockBorder};border-radius:10px;padding:10px 16px;text-align:center;flex-shrink:0">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:${stockColor};margin-bottom:4px">Stock</div>
        <div style="font-size:22px;font-weight:700;color:${stockColor};line-height:1;font-variant-numeric:tabular-nums">${(stock>=0?'+':'')+stock.toFixed(1)}L</div>
      </div>`;
    }else{
      const consumo=_sumL(ob.rows,isSaidaRow);
      box=`<div style="background:var(--gray-50);border:1.5px dashed var(--gray-200);border-radius:10px;padding:10px 16px;text-align:center;flex-shrink:0">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--gray-400);margin-bottom:4px">Sem depósito</div>
        <div style="font-size:15px;font-weight:700;color:var(--gray-600);line-height:1">${consumo.toFixed(1)}L</div>
      </div>`;
    }

    return `<div class="card" style="padding:18px 20px;cursor:pointer" onclick="abrirCombObraDetalhe('${ob.id}')" onmouseover="this.style.boxShadow='0 4px 14px rgba(0,0,0,.08)'" onmouseout="this.style.boxShadow=''">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div style="min-width:0">
          <div style="font-size:14px;font-weight:700;color:var(--gray-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_escHtml(ob.nome)}</div>
          <div style="font-size:11px;color:var(--gray-400);margin-top:3px">${nReg} registo${nReg!==1?'s':''} · ${_escHtml(tipos)}</div>
        </div>
        ${box}
      </div>
    </div>`;
  }).join('');
}

// ── Detalhe da obra (modal): todos os registos + análise por dia/semana/mês ──
function abrirCombObraDetalhe(obraId){
  _combDetObraId=obraId;
  _combDetPeriodo='tudo';
  _combDetAnchor=new Date();
  _combDetEquip='';
  _renderCombDetalheHeader();
  openModal('modal-comb-obra');
  _renderCombDetalhe();
}

function combAdicionarRegistoDaObra(){
  abrirCombFormRegisto(_combDetObraId);
}

function _renderCombDetalheHeader(){
  const rows=_combAllRows.filter(r=>(r.obra_id||'__sem_obra__')===_combDetObraId);
  const nome=rows[0]?.obra_nome||S.OBRAS.find(o=>o.id===_combDetObraId)?.nome||(_combDetObraId==='__sem_obra__'?'Sem obra':_combDetObraId);
  document.getElementById('mcob-title').textContent=nome;

  const hasDep=rows.some(r=>r.tipo_registo==='deposito');
  document.getElementById('mcob-sub').textContent=`${rows.length} registo${rows.length!==1?'s':''} no total${hasDep?'':' · sem depósito associado'}`;

  const stockBox=document.getElementById('mcob-stock-box');
  if(hasDep){
    const ent=_sumL(rows,isEntDepRow);
    const sai=_sumL(rows,isSaidaRow);
    const stock=ent-sai;
    const stockColor=stock>=0?'var(--blue-700)':'#b91c1c';
    const stockBg=stock>=0?'var(--blue-50)':'#fef2f2';
    const stockBorder=stock>=0?'var(--blue-200)':'#fecaca';
    stockBox.innerHTML=`<div style="background:${stockBg};border:1.5px solid ${stockBorder};border-radius:10px;padding:10px 16px;text-align:center">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:${stockColor};margin-bottom:3px">Stock Real Acumulado</div>
      <div style="font-size:22px;font-weight:700;color:${stockColor};line-height:1;font-variant-numeric:tabular-nums">${(stock>=0?'+':'')+stock.toFixed(1)}L</div>
    </div>`;
  }else{
    stockBox.innerHTML='';
  }

  // Filtro de equipamento (opções específicas dos registos desta obra)
  const equipSel=document.getElementById('mcob-equip-filter');
  const equipMap=new Map();
  rows.forEach(r=>{ if(r.equipamento_id) equipMap.set(r.equipamento_id, r.equipamento_nome||r.equipamento_id); });
  const prevVal=_combDetEquip;
  equipSel.innerHTML='<option value="">Todas as viaturas/equip.</option>'+
    [...equipMap.entries()].map(([id,nome])=>`<option value="${id}">${_escHtml(nome)}</option>`).join('');
  _combDetEquip=equipMap.has(prevVal)?prevVal:'';
  equipSel.value=_combDetEquip;
}

function combDetSetPeriodo(tipo){
  _combDetPeriodo=tipo;
  _combDetAnchor=new Date();
  _renderCombDetalhe();
}

function combDetNav(delta){
  if(_combDetPeriodo==='dia') _combDetAnchor.setDate(_combDetAnchor.getDate()+delta);
  else if(_combDetPeriodo==='semana') _combDetAnchor.setDate(_combDetAnchor.getDate()+delta*7);
  else if(_combDetPeriodo==='mes') _combDetAnchor.setMonth(_combDetAnchor.getMonth()+delta);
  else return;
  _combDetAnchor=new Date(_combDetAnchor);
  _renderCombDetalhe();
}

function combDetSetEquip(equipId){
  _combDetEquip=equipId||'';
  _renderCombDetalhe();
}

function _renderCombDetalhe(){
  if(!_combDetObraId) return;

  document.querySelectorAll('#mcob-periodo-tabs .mcob-p-btn').forEach(btn=>{
    const active=btn.dataset.p===_combDetPeriodo;
    btn.style.background=active?'var(--white)':'transparent';
    btn.style.color=active?'var(--gray-800)':'var(--gray-500)';
    btn.style.boxShadow=active?'0 1px 3px rgba(0,0,0,.1)':'none';
  });

  const [de,ate]=periodRange(_combDetPeriodo,_combDetAnchor);
  const navEl=document.getElementById('mcob-nav');
  if(_combDetPeriodo==='tudo'){
    navEl.style.visibility='hidden';
  }else{
    navEl.style.visibility='visible';
    const label=document.getElementById('mcob-nav-label');
    if(_combDetPeriodo==='dia') label.textContent=fmtPT(de);
    else if(_combDetPeriodo==='semana') label.textContent=`${fmtPT(de)} a ${fmtPT(ate)}`;
    else label.textContent=`${MESES[_combDetAnchor.getMonth()]} ${_combDetAnchor.getFullYear()}`;
  }

  let rows=_combAllRows.filter(r=>(r.obra_id||'__sem_obra__')===_combDetObraId);
  if(_combDetEquip) rows=rows.filter(r=>r.equipamento_id===_combDetEquip);
  const periodRows=de?rows.filter(r=>r.data&&r.data>=de&&r.data<=ate):rows;

  const hasDep=rows.some(r=>r.tipo_registo==='deposito');
  const ent=_sumL(periodRows,isEntDepRow);
  const sai=_sumL(periodRows,isSaidaRow);

  const resumo=document.getElementById('mcob-resumo');
  resumo.innerHTML=(hasDep?`<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;text-align:center">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#86efac;margin-bottom:5px">↓ Entradas</div>
      <div style="font-size:20px;font-weight:700;color:#16a34a;font-variant-numeric:tabular-nums">${ent.toFixed(1)}L</div>
    </div>`:'<div></div>')+
    `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;text-align:center">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#fca5a5;margin-bottom:5px">↑ Saídas</div>
      <div style="font-size:20px;font-weight:700;color:#dc2626;font-variant-numeric:tabular-nums">${sai.toFixed(1)}L</div>
    </div>`;

  const tbody=document.getElementById('mcob-tbody');
  const emptyEl=document.getElementById('mcob-empty');
  if(!periodRows.length){
    tbody.innerHTML='';
    emptyEl.style.display='';
    return;
  }
  emptyEl.style.display='none';
  tbody.innerHTML=periodRows.map(r=>{
    const isEnt=r.movimento==='entrada'||(!r.movimento&&r.tipo_registo!=='viatura');
    const litrosVal=parseFloat(r.litros)||0;
    const litrosFormatado=r.litros!=null
      ?(isEnt
        ?`<span style="font-weight:700;color:#16a34a">+${litrosVal.toFixed(1)}L</span>`
        :`<span style="font-weight:700;color:#dc2626">−${litrosVal.toFixed(1)}L</span>`)
      :'—';
    const movBadge=r.tipo_registo==='deposito'
      ?(isEnt
        ?`<span class="badge b-green" style="font-size:11px">↓ Entrada</span>`
        :`<span class="badge b-red" style="font-size:11px">↑ Saída</span>`)
      :`<span class="badge b-gray" style="font-size:11px">Viatura</span>`;
    return `<tr>
      <td>${fmtPT(r.data)}</td>
      <td style="font-weight:600">${r.equipamento_nome||'—'}</td>
      <td>${movBadge}</td>
      <td>${litrosFormatado}</td>
      <td><span class="badge ${r.tipo_combustivel==='Gasóleo'?'b-blue':r.tipo_combustivel==='Gasolina'?'b-orange':'b-gray'}">${r.tipo_combustivel||'—'}</span></td>
      <td>${r.fornecedor||'—'}</td>
      <td>${r.encarregado_nome||'—'}</td>
      <td style="color:var(--gray-500);font-size:12px">${r.obs||'—'}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="abrirCombFormRegisto(null,'${r.id}')">Editar</button></td>
    </tr>`;
  }).join('');
}

// ── Criar / Editar / Apagar registo ──────────────
function combFormTipoChange(){
  const tipo=document.getElementById('mcf-tipo-registo').value;
  document.getElementById('mcf-movimento-field').style.display=tipo==='deposito'?'':'none';
  document.getElementById('mcf-equip-field').style.display=tipo==='viatura'?'':'none';
  document.getElementById('mcf-fornecedor-field').style.display=tipo==='viatura'?'':'none';
}

function _combFillFormObraSelect(selectedId){
  const sel=document.getElementById('mcf-obra');
  sel.innerHTML='<option value="">— Sem obra —</option>';
  S.OBRAS.filter(o=>o.ativa).forEach(o=>{const op=document.createElement('option');op.value=o.id;op.textContent=o.nome;sel.appendChild(op);});
  if(selectedId&&[...sel.options].some(o=>o.value===selectedId)) sel.value=selectedId;
}

function _combFillFormEquipSelect(selectedId){
  const sel=document.getElementById('mcf-equip');
  sel.innerHTML='<option value="">— Selecione —</option>';
  EQUIPAMENTOS.forEach(eq=>{const op=document.createElement('option');op.value=eq.id;op.textContent=eq.nome;sel.appendChild(op);});
  if(selectedId&&[...sel.options].some(o=>o.value===selectedId)) sel.value=selectedId;
}

async function abrirCombFormRegisto(obraIdPreset,registoId){
  if(!EQUIPAMENTOS.length){ try{ await sbLoadEquipamentos(); }catch(e){} }
  const r=registoId?_combAllRows.find(x=>String(x.id)===String(registoId)):null;

  _combFillFormObraSelect(r?(r.obra_id||''):(obraIdPreset||''));
  _combFillFormEquipSelect(r?(r.equipamento_id||''):'');

  document.getElementById('mcf-title').textContent=r?'Editar registo':'Novo registo';
  document.getElementById('mcf-id').value=r?r.id:'';
  document.getElementById('mcf-tipo-registo').value=r?r.tipo_registo:'deposito';
  document.getElementById('mcf-data').value=r?r.data:fmt(new Date());
  document.getElementById('mcf-litros').value=r?r.litros:'';
  document.getElementById('mcf-movimento').value=r?(r.movimento||'entrada'):'entrada';
  document.getElementById('mcf-tipo-comb').value=r?(r.tipo_combustivel||'Gasóleo'):'Gasóleo';
  document.getElementById('mcf-fornecedor').value=r?(r.fornecedor||''):'';
  document.getElementById('mcf-encarregado').value=r?(r.encarregado_nome||''):(S.currentUser?.nome||'');
  document.getElementById('mcf-obs').value=r?(r.obs||''):'';
  document.getElementById('mcf-del-btn').style.display=r?'':'none';
  combFormTipoChange();
  openModal('modal-comb-form');
}

async function _combAtualizarAposAlteracao(){
  await _fetchCombRows();
  _renderCombGridFiltrada();
  if(_combDetObraId&&document.getElementById('modal-comb-obra').classList.contains('open')){
    _renderCombDetalheHeader();
    _renderCombDetalhe();
  }
}

async function guardarRegistoCombustivel(){
  const id=document.getElementById('mcf-id').value;
  const tipoRegisto=document.getElementById('mcf-tipo-registo').value;
  const data=document.getElementById('mcf-data').value;
  const obraEl=document.getElementById('mcf-obra');
  const obraId=obraEl.value||null;
  const obraNome=obraId?(obraEl.options[obraEl.selectedIndex]?.text||''):null;
  const litros=parseFloat(document.getElementById('mcf-litros').value);
  const tipoComb=document.getElementById('mcf-tipo-comb').value;
  const encarregado=document.getElementById('mcf-encarregado').value.trim()||null;
  const obs=document.getElementById('mcf-obs').value.trim()||null;

  if(!data){showToast('Selecione a data');return;}
  if(!litros||litros<=0){showToast('Indique a quantidade de litros');return;}

  let payload;
  if(tipoRegisto==='deposito'){
    if(!obraId){showToast('Selecione a obra do depósito');return;}
    payload={
      data,equipamento_id:null,equipamento_nome:'Depósito de Obra',
      obra_id:obraId,obra_nome:obraNome,litros,tipo_combustivel:tipoComb,
      tipo_registo:'deposito',movimento:document.getElementById('mcf-movimento').value,
      fornecedor:null,encarregado_nome:encarregado,obs
    };
  }else{
    const equipEl=document.getElementById('mcf-equip');
    const equipId=equipEl.value||null;
    if(!equipId){showToast('Selecione a viatura/equipamento');return;}
    payload={
      data,equipamento_id:equipId,equipamento_nome:equipEl.options[equipEl.selectedIndex]?.text||'',
      obra_id:obraId,obra_nome:obraNome,litros,tipo_combustivel:tipoComb,
      tipo_registo:'viatura',movimento:'saida',
      fornecedor:document.getElementById('mcf-fornecedor').value.trim()||null,
      encarregado_nome:encarregado,obs
    };
  }

  try{
    if(id){
      const {error}=await sb.from('registos_combustivel').update(payload).eq('id',id);
      if(error) throw error;
      showToast('Registo atualizado ✓');
    }else{
      const {error}=await sb.from('registos_combustivel').insert(payload);
      if(error) throw error;
      showToast('Registo criado ✓');
    }
    closeModal('modal-comb-form');
    await _combAtualizarAposAlteracao();
  }catch(e){
    showToast('Erro ao guardar: '+(e.message||e));
  }
}

async function apagarRegistoCombustivel(){
  const id=document.getElementById('mcf-id').value;
  if(!id) return;
  if(!confirm('Apagar este registo de combustível?')) return;
  try{
    const {error}=await sb.from('registos_combustivel').delete().eq('id',id);
    if(error) throw error;
    showToast('Registo apagado');
    closeModal('modal-comb-form');
    await _combAtualizarAposAlteracao();
  }catch(e){
    showToast('Erro ao apagar: '+(e.message||e));
  }
}

function exportCombustivelXLSX(){
  const {ini,fim,equip,obraFilt}=_comFiltrosAtuais();
  let rows=_combAllRows;
  if(ini) rows=rows.filter(r=>r.data&&r.data>=ini);
  if(fim) rows=rows.filter(r=>r.data&&r.data<=fim);
  if(equip) rows=rows.filter(r=>r.equipamento_id===equip);
  if(obraFilt) rows=rows.filter(r=>r.obra_id===obraFilt);
  if(!rows.length){showToast('Sem dados para exportar');return;}

  const aoa=rows.map(r=>{
    const obraNome=r.obra_nome||S.OBRAS.find(o=>o.id===r.obra_id)?.nome||'—';
    const isEnt=r.movimento==='entrada'||(!r.movimento&&r.tipo_registo!=='viatura');
    const litrosVal=parseFloat(r.litros)||0;
    const mov=r.tipo_registo==='deposito'?(isEnt?'Entrada':'Saída'):'Viatura';
    return [fmtPT(r.data),r.equipamento_nome||'—',obraNome,mov,(isEnt?'+':'−')+litrosVal.toFixed(1)+'L',r.tipo_combustivel||'—',r.fornecedor||'—',r.encarregado_nome||'—',r.obs||'—'];
  });
  const ws=XLSX.utils.aoa_to_sheet([['Data','Viatura/Máquina','Obra','Movimento','Litros','Tipo','Fornecedor','Encarregado','Obs'],...aoa]);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Combustível');
  XLSX.writeFile(wb,`combustivel_${fmt(new Date())}.xlsx`);
}

function _initCombustivelAdmin(){
  // Preencher datas padrão: ano corrente
  const hoje=fmt(new Date());
  const ini=hoje.slice(0,4)+'-01-01';
  document.getElementById('comb-f-ini').value=ini;
  document.getElementById('comb-f-fim').value=hoje;
  // Preencher select de equipamentos
  const sel=document.getElementById('comb-f-equip');
  sel.innerHTML='<option value="">Todos</option>';
  EQUIPAMENTOS.forEach(eq=>{const op=document.createElement('option');op.value=eq.id;op.textContent=eq.nome;sel.appendChild(op);});
  // Preencher select de obras
  const selObra=document.getElementById('comb-f-obra');
  if(selObra){
    const atual=selObra.value;
    selObra.innerHTML='<option value="">Todas as obras</option>';
    S.OBRAS.filter(o=>o.ativa).forEach(o=>{const op=document.createElement('option');op.value=o.id;op.textContent=o.nome;selObra.appendChild(op);});
    // Manter a obra escolhida ao voltar à secção
    if([...selObra.options].some(o=>o.value===atual)) selObra.value=atual;
  }
  // Cálculo automático: qualquer alteração aos filtros atualiza logo os cartões
  ['comb-f-ini','comb-f-fim','comb-f-equip','comb-f-obra'].forEach(id=>{
    const el=document.getElementById(id);
    if(el && !el.dataset.autoLoad){ el.dataset.autoLoad='1'; el.addEventListener('change',()=>loadCombustivelAdmin()); }
  });
  loadCombustivelAdmin();

  // A lista de equipamentos só é carregada ao visitar essa secção — garantir que
  // fica disponível aqui também para o filtro e para o formulário de registo.
  if(!EQUIPAMENTOS.length){
    sbLoadEquipamentos().then(()=>{
      const atual=sel.value;
      sel.innerHTML='<option value="">Todos</option>';
      EQUIPAMENTOS.forEach(eq=>{const op=document.createElement('option');op.value=eq.id;op.textContent=eq.nome;sel.appendChild(op);});
      if([...sel.options].some(o=>o.value===atual)) sel.value=atual;
    }).catch(()=>{});
  }
}

export {
  loadCombustivelAdmin, renderCombObraCards, exportCombustivelXLSX, _initCombustivelAdmin,
  abrirCombObraDetalhe, combAdicionarRegistoDaObra, combDetSetPeriodo, combDetNav, combDetSetEquip,
  abrirCombFormRegisto, combFormTipoChange, guardarRegistoCombustivel, apagarRegistoCombustivel
};
