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

const _combDesk=()=>document.body.classList.contains('device-desktop')&&!document.body.classList.contains('enc-mode');

// Visão geral (portal de computador): filtro de obra, semana, indicadores, gráfico e registos
let _cbObra='';
let _cbOff=0;
const _CB_IC={
  fuel:'<path d="M3 22V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v17"/><path d="M3 22h12"/><path d="M15 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3"/><path d="M6 8h6"/>',
  inb:'<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>',
  eq:'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
  trend:'<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
  pin:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>'
};
const _cbI=k=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${_CB_IC[k]}</svg>`;
const _cbN=n=>Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,' ');
const _cbSemana=off=>{ const r=new Date(); r.setDate(r.getDate()+off*7); return periodRange('semana',r); };

function _combRenderKpisDesk(){
  const box=document.getElementById('comb-kpis-d');
  if(box) box.innerHTML='';
}

function _combRenderGeral(){
  const root=document.getElementById('comb-geral-d');
  if(!root) return;
  if(!_combDesk()){ root.innerHTML=''; return; }
  const obras=new Map();
  _combAllRows.forEach(r=>{ const id=r.obra_id||'__sem_obra__'; if(!obras.has(id)) obras.set(id,r.obra_nome||S.OBRAS.find(o=>o.id===r.obra_id)?.nome||'Sem obra'); });
  if(_cbObra&&!obras.has(_cbObra)) _cbObra='';
  const [de,ate]=_cbSemana(_cbOff), [de0,ate0]=_cbSemana(_cbOff-1);
  const base=_combAllRows.filter(r=>!_cbObra||(r.obra_id||'__sem_obra__')===_cbObra);
  const sem=base.filter(r=>r.data&&r.data>=de&&r.data<=ate);
  const ant=base.filter(r=>r.data&&r.data>=de0&&r.data<=ate0);
  const sai=sem.filter(isSaidaRow), litros=_sumL(sem,isSaidaRow), litrosAnt=_sumL(ant,isSaidaRow);
  const ent=_sumL(sem,isEntDepRow);
  const delta=litrosAnt?Math.round((litros-litrosAnt)/litrosAnt*100):null;
  const porEq={};
  sai.filter(r=>r.equipamento_id).forEach(r=>{ const m=porEq[r.equipamento_id]||(porEq[r.equipamento_id]={id:r.equipamento_id,nome:r.equipamento_nome||r.equipamento_id,l:0}); m.l+=parseFloat(r.litros)||0; });
  const top=Object.values(porEq).sort((a,b)=>b.l-a.l)[0];
  const topEq=top&&EQUIPAMENTOS.find(e=>e.id===top.id);
  // Gráfico por dia
  const DIAS=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
  const dias=DIAS.map((d,i)=>{ const dt=new Date(de+'T00:00:00'); dt.setDate(dt.getDate()+i); const ds=fmt(dt); return [d,_sumL(sai,r=>r.data===ds)]; });
  const mx=Math.max(1,...dias.map(d=>d[1]));
  // Por obra
  const po={};
  sai.forEach(r=>{ const id=r.obra_id||'__sem_obra__'; po[id]=(po[id]||0)+(parseFloat(r.litros)||0); });
  const poL=Object.entries(po).sort((a,b)=>b[1]-a[1]).slice(0,6), pmx=Math.max(1,...poL.map(x=>x[1]));
  const kpi=(ic,l,n,sub,att)=>`<div class="cb-kpi${att?' clk':''}"${att||''}><span class="d-ic">${_cbI(ic)}</span><div><div class="cb-l">${l}</div><div class="cb-n">${n}</div>${sub||''}</div></div>`;
  const head=(ic,t,s)=>`<div class="cb-ch"><span class="d-ic">${_cbI(ic)}</span><div><b>${t}</b><small>${s}</small></div></div>`;
  const rowsT=[...sai].sort((a,b)=>(b.data||'').localeCompare(a.data||'')||String(b.criado_em||'').localeCompare(String(a.criado_em||''))).slice(0,50);
  const dm=d=>d?d.slice(8,10)+'/'+d.slice(5,7):'—';
  const fp=d=>d.split('-').reverse().join('/');
  root.innerHTML=`<div class="cb-bar">
      <label class="cb-sel"><span>Obra</span><select id="cb-obra"><option value="">Todas</option>${[...obras.entries()].sort((a,b)=>a[1].localeCompare(b[1])).map(([id,n])=>`<option value="${_escHtml(id)}"${id===_cbObra?' selected':''}>${_escHtml(n)}</option>`).join('')}</select></label>
      <div class="cb-wk"><button type="button" data-cbnav="-1" aria-label="Semana anterior">‹</button><div><b>${_cbOff===0?'Esta semana':_cbOff===-1?'Semana anterior':_cbOff===1?'Próxima semana':'Semana'}</b><small>${fp(de)} a ${fp(ate)}</small></div><button type="button" data-cbnav="1" aria-label="Semana seguinte">›</button></div>
    </div>
    <div class="cb-kpis">
      ${kpi('fuel','Litros na semana',`${_cbN(litros)}<small> L</small>`,delta==null?'':`<span class="cb-pill ${delta>0?'warn':'ok'}">${delta>0?'▲':delta<0?'▼':'='} ${Math.abs(delta)}% face à anterior</span>`)}
      ${kpi('inb','Entradas em depósito',`${_cbN(ent)}<small> L</small>`,'<span class="cb-sub">combustível recebido</span>')}
      ${kpi('eq','Maior consumo',top?_escHtml(top.nome):'—',top?`<span class="cb-sub">${_cbN(top.l)} L${topEq?.codigo?' · '+_escHtml(topEq.codigo):''}</span>`:'',top?` data-cbeq="${_escHtml(top.id)}" title="Ver os registos deste equipamento"`:'')}
      ${kpi('file','Registos',sem.length)}
    </div>
    <div class="cb-g">
      <div class="cb-card">${head('trend','Litros por dia','Semana selecionada')}<div class="cb-chart">${dias.map(d=>`<div class="${d[1]?'':'off'}">${d[1]?_cbN(d[1]):''}<i style="height:${d[1]?Math.max(4,d[1]/mx*100):6}%"></i><span>${d[0]}</span></div>`).join('')}</div></div>
      <div class="cb-card">${head('pin','Por obra','Litros na semana')}${poL.length?poL.map(([id,l])=>`<div class="cb-ob"><div class="cb-lb"><span>${_escHtml(obras.get(id)||'Sem obra')}</span><b>${_cbN(l)} L</b></div><div class="cb-bar2"><i style="width:${l/pmx*100}%"></i></div></div>`).join(''):'<div class="cb-vz">Sem consumos nesta semana.</div>'}</div>
    </div>
    <div class="cb-tw"><table><thead><tr><th>Data</th><th>Equipamento</th><th>Obra</th><th class="r">Litros</th><th>Registado por</th></tr></thead><tbody>${rowsT.length?rowsT.map(r=>{ const eq=EQUIPAMENTOS.find(e=>e.id===r.equipamento_id); const on=r.obra_nome||S.OBRAS.find(o=>o.id===r.obra_id)?.nome||'—'; return `<tr class="clk" onclick="abrirCombFormRegisto(null,'${r.id}')"><td>${dm(r.data)}</td><td><b>${_escHtml(eq?.nome||r.equipamento_nome||'Depósito de obra')}</b>${eq?.codigo?`<span class="sub">${_escHtml(eq.codigo)}</span>`:''}</td><td><span class="cb-cod">${_escHtml(on)}</span></td><td class="r"><b>${_cbN(parseFloat(r.litros)||0)} L</b></td><td>${_escHtml(r.encarregado_nome||'—')}</td></tr>`; }).join(''):'<tr><td colspan="5" class="cb-vz">Sem registos nesta semana.</td></tr>'}</tbody></table></div>`;
}
document.addEventListener('change',e=>{
  if(e.target.id==='cb-obra'){ _cbObra=e.target.value; _combRenderGeral(); } });
document.addEventListener('click',e=>{
  const rg=e.target.closest('#mcob-tbody tr[data-cbreg]');
  if(rg&&_combDesk()&&!e.target.closest('button')){ _combAbrirRegDetalhe(rg.dataset.cbreg); return; }
  const q=e.target.closest('[data-cbeq]'); if(q){ abrirCombEquipDetalhe(q.dataset.cbeq); return; } const b=e.target.closest('[data-cbnav]'); if(b){ _cbOff+=+b.dataset.cbnav; _combRenderGeral(); } });

function _renderCombGridFiltrada(){
  _combRenderKpisDesk();
  _combRenderGeral();
  renderCombObraCards(_combAllRows);
  renderCombEquipCards(_combAllRows);
}

async function loadCombustivelAdmin(){
  const grid=document.getElementById('comb-obras-grid');
  const emptyEl=document.getElementById('comb-obras-empty');
  grid.innerHTML='<div class="pl-load"><span class="pl-logo"></span>A carregar…</div>';
  emptyEl.style.display='none';
  try{
    await _fetchCombRows();
    _renderCombGridFiltrada();
    if(!_combVistaInicial&&_combDesk()){ _combVistaInicial=true; combSwitchView('ger'); }
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

// ── Separadores: Depósitos Obra | Consumo de Equipamentos ──
let _combView='dep';
let _combVistaInicial=false;
function combSwitchView(view){
  _combView=view;
  ['ger','dep','cons'].forEach(v=>{
    const panel=document.getElementById('comb-view-'+v);
    const btn=document.getElementById('comb-tab-btn-'+v);
    if(panel) panel.style.display=v===view?'':'none';
    if(btn) btn.classList.toggle('active',v===view);
  });
}

// ── Consumo de Equipamentos: um cartão por viatura/máquina com abastecimentos ──
let _combDetEquipId=null;
const _isAbastecimento=r=>r.tipo_registo==='viatura'&&r.equipamento_id;
const _fmtL=n=>n.toFixed(1).replace('.',',')+' L';

// ── Consumo de Equipamentos: lista com pesquisa e "Lista completa" ──
let _combEquipLista=[];
let _combEquipTodos=false;
const _semAcentos=t=>String(t??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

function renderCombEquipCards(rows){
  const map={};
  rows.filter(_isAbastecimento).forEach(r=>{
    const m=map[r.equipamento_id]||(map[r.equipamento_id]={id:r.equipamento_id,nome:r.equipamento_nome||r.equipamento_id,rows:[]});
    m.rows.push(r);
  });
  _combEquipLista=Object.values(map).map(m=>{
    const eq=EQUIPAMENTOS.find(e=>e.id===m.id);
    const obras=[...new Set(m.rows.map(r=>r.obra_nome||S.OBRAS.find(o=>o.id===r.obra_id)?.nome).filter(Boolean))];
    const tipos=[...new Set(m.rows.map(r=>r.tipo_combustivel).filter(Boolean))];
    const nome=eq?.nome||m.nome;
    // Texto pesquisável: tudo o que identifica o equipamento e onde/como abasteceu
    const texto=_semAcentos([nome,eq?.matricula,eq?.marcaModelo,eq?.codigo,eq?.serie,eq?.condutor,obras.join(' '),tipos.join(' '),m.rows.map(r=>r.fornecedor).join(' ')].join(' '));
    return {...m,nome,obras,tipos,texto,litros:_sumL(m.rows,()=>true),ultimo:m.rows.reduce((d,r)=>r.data>d?r.data:d,'')};
  }).sort((a,b)=>b.litros-a.litros);
  _combBuscaMostrar();
}

function _combEquipRowHtml(m){
  const sub=[m.obras.slice(0,2).join(', ')+(m.obras.length>2?'…':''),m.tipos.join(', ')].filter(Boolean).map(_escHtml).join(' · ');
  return `<div class="card" style="padding:12px 16px;margin-bottom:8px;cursor:pointer" onclick="abrirCombEquipDetalhe('${m.id}')">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <div style="font-weight:700;color:var(--gray-900)">${_escHtml(m.nome)}</div>
        <div style="font-size:12px;color:var(--gray-500);margin-top:3px">${m.rows.length} abastecimento${m.rows.length!==1?'s':''} · último a ${fmtPT(m.ultimo)}</div>
        ${sub?`<div style="font-size:11px;color:var(--gray-400);margin-top:3px">${sub}</div>`:''}
      </div>
      <div style="background:var(--blue-50);border:1.5px solid var(--blue-200);border-radius:10px;padding:8px 14px;text-align:center;flex-shrink:0">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--blue-700);margin-bottom:3px">Consumo</div>
        <div style="font-size:18px;font-weight:700;color:var(--blue-700);line-height:1;font-variant-numeric:tabular-nums">${_fmtL(m.litros)}</div>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>
    </div>
  </div>`;
}

function _combBuscaMostrar(){
  const box=document.getElementById('comb-busca-resultados');
  const hint=document.getElementById('comb-busca-hint');
  if(!box) return;
  const termo=_semAcentos(document.getElementById('comb-busca-input')?.value||'').trim();
  // no computador a lista mostra sempre todos os equipamentos com abastecimentos
  if(!termo&&!_combEquipTodos&&!_combDesk()){ box.innerHTML=''; if(hint) hint.style.display=''; return; }
  if(hint) hint.style.display='none';
  let lista=_combEquipLista;
  if(termo){
    // Todas as palavras escritas têm de aparecer (por qualquer ordem, sem acentos)
    const palavras=termo.split(/\s+/);
    lista=lista.filter(m=>palavras.every(p=>m.texto.includes(p)));
    // Quem tem a palavra no nome aparece primeiro
    const noNome=m=>palavras.every(p=>_semAcentos(m.nome).includes(p))?0:1;
    lista=[...lista].sort((a,b)=>noNome(a)-noNome(b)||b.litros-a.litros);
  }
  box.innerHTML=lista.length
    ? (_combDesk()?`<div class="comb-eq-grid">${lista.map(_combEquipRowHtml).join('')}</div>`:lista.map(_combEquipRowHtml).join(''))
    : `<div style="text-align:center;padding:20px;color:var(--gray-400);font-size:13px">${termo?`Sem resultados para "${_escHtml(termo)}"`:'Ainda não há abastecimentos de viaturas ou máquinas registados.'}</div>`;
}

function combBuscaRender(){ _combEquipTodos=false; _combBuscaMostrar(); }
function combVerListaCompleta(){
  _combEquipTodos=true;
  const inp=document.getElementById('comb-busca-input'); if(inp) inp.value='';
  _combBuscaMostrar();
}

function abrirCombEquipDetalhe(equipId){
  _combDetEquipId=equipId;
  _renderCombEquipDetalhe();
  openModal('modal-comb-equip');
}

function _renderCombEquipDetalhe(){
  if(!_combDetEquipId) return;
  const rows=_combAllRows.filter(r=>_isAbastecimento(r)&&r.equipamento_id===_combDetEquipId);
  const eq=EQUIPAMENTOS.find(e=>e.id===_combDetEquipId);
  document.getElementById('mcoe-title').textContent=eq?.nome||rows[0]?.equipamento_nome||_combDetEquipId;
  document.getElementById('mcoe-sub').textContent=`${rows.length} abastecimento${rows.length!==1?'s':''} registado${rows.length!==1?'s':''}`;
  const total=_sumL(rows,()=>true);
  const box=(lbl,val)=>`<div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:8px;padding:10px 14px;text-align:center">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--gray-400);margin-bottom:5px">${lbl}</div>
      <div style="font-size:20px;font-weight:700;color:var(--gray-800);font-variant-numeric:tabular-nums">${val}</div></div>`;
  document.getElementById('mcoe-resumo').innerHTML=box('Consumo total',_fmtL(total))+box('Abastecimentos',rows.length)+box('Média por abastecimento',rows.length?_fmtL(total/rows.length):'—');
  document.getElementById('mcoe-tbody').innerHTML=rows.map(r=>`<tr>
      <td>${fmtPT(r.data)}</td>
      <td>${_escHtml(r.obra_nome||S.OBRAS.find(o=>o.id===r.obra_id)?.nome||'—')}</td>
      <td><span style="font-weight:700;color:#dc2626">${(parseFloat(r.litros)||0).toFixed(1)}L</span></td>
      <td><span class="badge ${r.tipo_combustivel==='Gasóleo'?'b-blue':r.tipo_combustivel==='Gasolina'?'b-orange':'b-gray'}">${_escHtml(r.tipo_combustivel||'—')}</span></td>
      <td>${_escHtml(r.fornecedor||'—')}</td>
      <td>${_escHtml(r.encarregado_nome||'—')}</td>
      <td style="color:var(--gray-500);font-size:12px">${_escHtml(r.obs||'—')}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="abrirCombFormRegisto(null,'${r.id}')">Editar</button></td>
    </tr>`).join('');
}

// ── Detalhe de um registo (gaveta, portal de computador) ──
function _combAbrirRegDetalhe(id){
  const r=_combAllRows.find(x=>String(x.id)===String(id));
  const box=document.getElementById('mcor-corpo');
  if(!r||!box) return;
  const isEnt=r.tipo_registo==='deposito'&&(r.movimento==='entrada'||!r.movimento);
  const l=parseFloat(r.litros)||0;
  const obra=r.obra_nome||S.OBRAS.find(o=>o.id===r.obra_id)?.nome||'—';
  const mov=r.tipo_registo==='deposito'?(isEnt?'Entrada em depósito':'Saída de depósito'):'Abastecimento de viatura';
  const kv=(k,v,full)=>`<div class="${full?'full':''}"><span>${k}</span><b>${v}</b></div>`;
  document.getElementById('mcor-title').textContent=r.equipamento_nome||'Depósito de obra';
  document.getElementById('mcor-sub').textContent=`${fmtPT(r.data)} · ${obra}`;
  box.innerHTML=`<div class="cbr-big ${isEnt?'in':'out'}">${isEnt?'+':'−'}${_fmtL(l)}<small>${mov}</small></div>
    <div class="cbr-kv">${kv('Data',fmtPT(r.data))}${kv('Obra',_escHtml(obra),1)}${kv('Equipamento',_escHtml(r.equipamento_nome||'Depósito de obra'),1)}${kv('Combustível',_escHtml(r.tipo_combustivel||'—'))}${kv('Fornecedor',_escHtml(r.fornecedor||'—'))}${kv('Registado por',_escHtml(r.encarregado_nome||'—'),1)}${kv('Observações',_escHtml(r.obs||'—'),1)}</div>`;
  document.getElementById('mcor-editar').onclick=()=>abrirCombFormRegisto(null,String(r.id));
  openModal('modal-comb-reg');
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
    return `<tr class="clk" data-cbreg="${r.id}">
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
  if(_combDetEquipId&&document.getElementById('modal-comb-equip').classList.contains('open')) _renderCombEquipDetalhe();
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
  const rows=_combAllRows;
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
  loadCombustivelAdmin();
  // A lista de equipamentos só é carregada ao visitar a secção Equipamentos — garantir que
  // fica disponível aqui também para o formulário de registo e para os nomes dos cartões.
  if(!EQUIPAMENTOS.length) sbLoadEquipamentos().then(()=>renderCombEquipCards(_combAllRows)).catch(()=>{});
}

export {
  combBuscaRender, combVerListaCompleta, combSwitchView, abrirCombEquipDetalhe, renderCombEquipCards,
  loadCombustivelAdmin, renderCombObraCards, exportCombustivelXLSX, _initCombustivelAdmin,
  abrirCombObraDetalhe, combAdicionarRegistoDaObra, combDetSetPeriodo, combDetNav, combDetSetEquip,
  abrirCombFormRegisto, combFormTipoChange, guardarRegistoCombustivel, apagarRegistoCombustivel
};
