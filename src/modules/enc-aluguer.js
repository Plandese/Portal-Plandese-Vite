// ═══════════════════════════════════════
//  ALUGUER MOA — Encarregado e Admin MOA
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S, R } from '../state.js';
import { fmt, fmtPT, calcH, fmtH, getMonday, isWeekend, isNonWorkday } from '../utils/helpers.js';
import { podeAprovarObra, aprovCelulaHTML } from './ponto.js';
import { showToast } from './navigation.js';
import { abrirResumoMOA } from './resumo-colab.js';
import { obraEmCurso, obraVisivelPara, MESES_PT } from '../config.js';

// ── MOA — Estado ──────────────────────
let encAlugEmpresaId='', encAlugEmpresaNome='', encAlugObraId='', encAlugData='', encAlugHoraIni='08:00', encAlugHoraFim='17:00';
export let encAlugTrabalhadores = [];
export let EMPRESAS_MOA = [];
export let COLABORADORES_MOA = {};
let moaCurrentMonday = null;

// ── MOA — Estado ──────────────────────

// Lista de empresas cedentes — carregada do Supabase

// Colaboradores por empresa MOA — { empresa_moa_id: [{id, nome, funcao}] }

// ═══════════════════════════════════════
//  EMPRESAS MOA — CRUD
// ═══════════════════════════════════════
function _saveEmpresasMOALocal(){
  try{ localStorage.setItem('empresas_moa_local', JSON.stringify(EMPRESAS_MOA)); }catch(e){}
}
function _loadEmpresasMOALocal(){
  try{ return JSON.parse(localStorage.getItem('empresas_moa_local')||'[]'); }catch(e){ return []; }
}

async function loadEmpresasMOA(){
  try{
    const {data,error}=await sb.from('empresas_moa').select('*').order('nome');
    if(error) throw error;
    EMPRESAS_MOA=(data||[]).map(e=>({id:e.id,nome:e.nome,nif:e.nif||'',contacto:e.contacto||'',ativa:e.ativa!==false}));
    // sincronizar local com o que veio do Supabase
    _saveEmpresasMOALocal();
  }catch(e){
    // tabela ainda não existe — usar localStorage como fallback
    console.warn('empresas_moa Supabase indisponível, a usar localStorage:',e.message);
    EMPRESAS_MOA=_loadEmpresasMOALocal();
  }
}

async function loadColaboradoresMOA(){
  try{
    const {data,error}=await sb.from('colaboradores_moa').select('*').eq('ativo',true).order('nome');
    if(error) throw error;
    COLABORADORES_MOA={};
    (data||[]).forEach(c=>{
      if(!COLABORADORES_MOA[c.empresa_moa_id]) COLABORADORES_MOA[c.empresa_moa_id]=[];
      COLABORADORES_MOA[c.empresa_moa_id].push({id:c.id,nome:c.nome,funcao:c.funcao||'',foto_path:c.foto_path||null});
    });
  }catch(e){
    console.warn('colaboradores_moa Supabase indisponível:',e.message);
    COLABORADORES_MOA={};
  }
}

async function removeColabMOA(id, empId){
  if(!confirm('Remover este colaborador?')) return;
  try{
    const {error}=await sb.from('colaboradores_moa').delete().eq('id',id);
    if(error) throw error;
  }catch(e){
    showToast('Erro ao remover: '+(e.message||e));
    return;
  }
  // Atualizar estado local
  if(COLABORADORES_MOA[empId]) COLABORADORES_MOA[empId]=COLABORADORES_MOA[empId].filter(c=>c.id!==id);
  // Re-renderizar painel
  const panel=document.getElementById(`colabs-panel-${empId}`);
  if(panel) _renderColabsPanelMOA(empId, panel);
  showToast('Colaborador removido');
}

const _moaDesk=()=>document.body.classList.contains('device-desktop')&&!document.body.classList.contains('enc-mode');

// Gaveta com os dados e os colaboradores de uma empresa (portal de computador)
function _moaAbrirEmpresa(id){
  const emp=EMPRESAS_MOA.find(e=>e.id===id);
  const modal=document.getElementById('modal-moa-det');
  if(!emp||!modal) return;
  document.getElementById('mmd-title').textContent=emp.nome;
  document.getElementById('mmd-sub').textContent=[emp.nif&&('NIF '+emp.nif),emp.contacto].filter(Boolean).join(' · ')||'Empresa cedente de mão de obra aluguer';
  document.getElementById('mmd-editar').onclick=()=>editEmpresaMOA(id);
  const tg=document.getElementById('mmd-toggle');
  tg.textContent=emp.ativa?'Desativar':'Ativar';
  tg.onclick=async()=>{ await toggleEmpresaMOA(id); modal.classList.remove('open'); };
  const panel=modal.querySelector('.mmd-panel');
  panel.id=`colabs-panel-${id}`;
  _renderColabsPanelMOA(id,panel);
  modal.classList.add('open');
}
document.addEventListener('click',e=>{
  const r=e.target.closest('#empresas-moa-list [data-moa]');
  if(r&&_moaDesk()) _moaAbrirEmpresa(r.dataset.moa);
});

function renderEmpresasMOA(){
  const cont=document.getElementById('empresas-moa-list');
  if(!cont) return;
  moaFechoInit();
  cont.innerHTML='';
  if(!EMPRESAS_MOA.length){
    cont.innerHTML='<div class="card" style="text-align:center;color:var(--gray-400);padding:32px">Nenhuma empresa criada. Clique em "Nova empresa".</div>';
    return;
  }
  if(_moaDesk()){
    const esc=t=>String(t??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    cont.innerHTML=`<div class="moa-l">${EMPRESAS_MOA.map(emp=>{
      const n=(COLABORADORES_MOA[emp.id]||[]).length;
      const sub=[emp.nif&&('NIF '+esc(emp.nif)),emp.contacto&&esc(emp.contacto)].filter(Boolean).join(' · ');
      return `<div class="moa-r${emp.ativa?'':' off'}" data-moa="${emp.id}">
        <span class="moa-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V8l7-4.5L19 8v13"/><path d="M9 21v-5h6v5M9 11h.01M15 11h.01M9 14h.01M15 14h.01"/></svg></span>
        <div class="moa-t"><b>${esc(emp.nome)}</b><small>${sub||'Sem dados de contacto'}</small></div>
        <span class="moa-n">${n} colaborador${n!==1?'es':''}</span>
        <span class="moa-p ${emp.ativa?'ok':'off'}">${emp.ativa?'Ativa':'Inativa'}</span>
        <svg class="moa-ch" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`; }).join('')}</div>`;
    return;
  }
  EMPRESAS_MOA.forEach(emp=>{
    const wrap=document.createElement('div');
    wrap.style.cssText='margin-bottom:18px';
    // Card principal da empresa
    const card=document.createElement('div');
    card.className='card';
    card.style.cssText='padding:12px 16px;border-radius:var(--radius-lg) var(--radius-lg) 0 0;border-bottom:none;margin-bottom:0';
    card.innerHTML=`
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="display:flex;align-items:center;gap:10px;flex:1">
          <div style="width:10px;height:10px;border-radius:50%;background:${emp.ativa?'var(--green)':'var(--gray-300)'};flex-shrink:0;margin-top:3px"></div>
          <div>
            <div style="font-weight:600;font-size:14px">${emp.nome}</div>
            ${emp.nif?`<div style="font-size:12px;color:var(--gray-400);margin-top:2px">NIF: ${emp.nif}</div>`:''}
            ${emp.contacto?`<div style="font-size:12px;color:var(--gray-400);margin-top:1px">${emp.contacto}</div>`:''}
          </div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button class="btn btn-secondary btn-sm" onclick="editEmpresaMOA('${emp.id}')">Editar</button>
          <button class="btn btn-sm" style="background:${emp.ativa?'var(--yellow-bg)':'var(--green-bg)'};color:${emp.ativa?'var(--yellow)':'var(--green)'};border:1px solid ${emp.ativa?'#FDE68A':'var(--green-light)'}" onclick="toggleEmpresaMOA('${emp.id}')">${emp.ativa?'Desativar':'Ativar'}</button>
        </div>
      </div>`;
    wrap.appendChild(card);
    // Painel de colaboradores
    const panel=document.createElement('div');
    panel.id=`colabs-panel-${emp.id}`;
    panel.style.cssText='background:var(--gray-50);border:1px solid var(--gray-200);border-top:none;border-radius:0 0 var(--radius-lg) var(--radius-lg);padding:10px 14px 12px';
    _renderColabsPanelMOA(emp.id, panel);
    wrap.appendChild(panel);
    cont.appendChild(wrap);
  });
}

function _renderColabsPanelMOA(empId, panel){
  const colabs=(COLABORADORES_MOA[empId]||[]);
  let html=`<div style="font-size:11px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Colaboradores (${colabs.length})</div>`;
  if(colabs.length){
    html+=`<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:10px">`;
    colabs.forEach(c=>{
      html+=`<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:white;border:1px solid var(--gray-200);border-radius:6px">
        ${_moaAvatarHTML(c,28)}
        <span style="font-size:13px;font-weight:600;color:var(--gray-900);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.nome}</span>
        ${c.funcao?`<span style="font-size:11px;color:#7c3aed;font-weight:500;white-space:nowrap">${c.funcao}</span>`:''}
        <button onclick="removeColabMOA('${c.id}','${empId}')" title="Remover" style="padding:2px 7px;background:#fee2e2;border:none;border-radius:5px;color:#b91c1c;font-size:11px;font-weight:700;cursor:pointer;flex-shrink:0">✕</button>
      </div>`;
    });
    html+=`</div>`;
  } else {
    html+=`<div style="font-size:12px;color:var(--gray-400);padding:4px 0 8px">Sem colaboradores. Adicione abaixo.</div>`;
  }
  html+=`<button onclick="moaTrabAbrir(false,'${empId}')" class="btn btn-primary btn-sm" style="font-size:12px">+ Registar trabalhador</button>`;
  panel.innerHTML=html;
  _moaCarregarFotos(panel);
}

function editEmpresaMOA(id){
  const emp=EMPRESAS_MOA.find(e=>e.id===id);
  if(!emp) return;
  document.getElementById('memoa-title').textContent='Editar Empresa MOA';
  document.getElementById('memoa-id').value=id;
  document.getElementById('memoa-nome').value=emp.nome;
  document.getElementById('memoa-nif').value=emp.nif||'';
  document.getElementById('memoa-contacto').value=emp.contacto||'';
  document.getElementById('modal-empresa-moa').classList.add('open');
}

async function saveEmpresaMOA(){
  const nome=document.getElementById('memoa-nome').value.trim();
  if(!nome){alert('Nome da empresa obrigatório.');return;}
  const id=document.getElementById('memoa-id').value||('empmoa_'+Date.now());
  const nif=document.getElementById('memoa-nif').value.trim();
  const contacto=document.getElementById('memoa-contacto').value.trim();
  const rec={id,nome,nif:nif||null,contacto:contacto||null,ativa:true};
  // Atualizar array local primeiro
  const idx=EMPRESAS_MOA.findIndex(e=>e.id===id);
  if(idx>=0) EMPRESAS_MOA[idx]={...EMPRESAS_MOA[idx],...rec};
  else EMPRESAS_MOA.push(rec);
  // Guardar sempre em localStorage (funciona mesmo sem tabela Supabase)
  _saveEmpresasMOALocal();
  // Tentar guardar no Supabase (silencioso se tabela não existir)
  try{
    await sb.from('empresas_moa').upsert(rec,{onConflict:'id'});
  }catch(e){
    console.warn('Supabase empresas_moa indisponível, guardado localmente:',e.message);
  }
  closeModal('modal-empresa-moa');
  renderEmpresasMOA();
  flashAlert('empresamoa-alert');
}

async function toggleEmpresaMOA(id){
  const emp=EMPRESAS_MOA.find(e=>e.id===id);
  if(!emp) return;
  emp.ativa=!emp.ativa;
  _saveEmpresasMOALocal();
  try{
    await sb.from('empresas_moa').update({ativa:emp.ativa}).eq('id',id);
  }catch(e){ console.warn(e); }
  renderEmpresasMOA();
}

// Fluxo do encarregado — espelho do da MO Plandese (enc-ponto.js), com estado e
// registos independentes: todas as consultas/gravações são filtradas pelo
// encarregado_id de quem está autenticado, por isso nunca se misturam dados
// entre encarregados.
let _alugAnterior={data:null,colabIds:[]}; // equipa do último registo deste encarregado nesta obra/empresa

async function encAlugPassarTrabalhadores(){
  const empresaId=document.getElementById('enc-alug-empresa').value;
  const empresaNome=document.getElementById('enc-alug-empresa').options[document.getElementById('enc-alug-empresa').selectedIndex]?.text||'';
  const data=document.getElementById('enc-alug-data').value;
  const obraId=document.getElementById('enc-alug-obra').value;
  const ini=document.getElementById('enc-alug-hora-ini').value;
  const fim=document.getElementById('enc-alug-hora-fim').value;
  if(!empresaId){showToast('Selecione a empresa cedente');return;}
  if(!data){showToast('Selecione a data do registo');return;}
  if(!obraId){showToast('Selecione uma obra');return;}
  if(!ini||!fim){showToast('Indique as horas de início e fim');return;}
  encAlugEmpresaId=empresaId; encAlugEmpresaNome=empresaNome;
  encAlugObraId=obraId; encAlugData=data;
  encAlugHoraIni=ini; encAlugHoraFim=fim;
  // Lista sempre vazia à partida (como na MO Plandese): os trabalhadores são
  // adicionados um a um ou pela sugestão verde da equipa anterior.
  encAlugTrabalhadores=[];
  _alugAnterior={data:null,colabIds:[]};
  _alugResetBtnSubmeter();
  const obraNome=S.OBRAS.find(o=>o.id===obraId)?.nome||'—';
  const [y,m,d]=data.split('-');
  document.getElementById('enc-alug-resumo-empresa').textContent=empresaNome;
  document.getElementById('enc-alug-resumo-info').textContent=`${obraNome}  ·  ${d}/${m}/${y}  ·  ${ini} – ${fim}`;
  document.getElementById('enc-alug-screen-a').style.display='none';
  const screenB=document.getElementById('enc-alug-screen-b');
  screenB.style.display='flex'; screenB.style.flexDirection='column';
  buildAlugList();
  await Promise.all([_alugMostrarExistentes(), carregarEquipaAnteriorAlug()]);
}

function encAlugVoltarA(){
  document.getElementById('enc-alug-screen-a').style.display='block';
  const screenB=document.getElementById('enc-alug-screen-b');
  screenB.style.display='none';
}

// Consulta base: só os registos deste encarregado
function _alugQueryMeus(cols){
  const encId=S.currentUser?.key||null;
  const q=sb.from('registos_ponto_moa').select(cols);
  return encId!=null ? q.eq('encarregado_id',encId) : q.is('encarregado_id',null);
}

async function _alugMostrarExistentes(){
  const box=document.getElementById('enc-alug-existentes-box');
  if(!box) return;
  box.style.display='none';
  try{
    const {data:regs}=await _alugQueryMeus('trabalhador_nome')
      .eq('data',encAlugData).eq('obra_id',encAlugObraId).eq('empresa_moa_id',encAlugEmpresaId);
    if(!regs?.length) return;
    const nomes=[...new Set(regs.map(r=>(r.trabalhador_nome||'').split(' ')[0]).filter(Boolean))];
    document.getElementById('enc-alug-existentes-txt').textContent=
      `Já ${nomes.length===1?'está':'estão'} registado${nomes.length===1?'':'s'} hoje nesta obra: ${nomes.join(', ')}. Para editar as horas de alguém, adiciona-o novamente à lista abaixo.`;
    box.style.display='flex';
  }catch(e){}
}

// Equipa dos últimos 7 dias deste encarregado (mesma obra e empresa), a verde — cada trabalhador aparece uma só vez
async function carregarEquipaAnteriorAlug(){
  const box=document.getElementById('alug-ontem-box');
  if(!box) return;
  try{
    const lim=new Date(encAlugData+'T12:00:00'); lim.setDate(lim.getDate()-7);
    const {data:regs}=await _alugQueryMeus('colab_moa_id, data')
      .lt('data',encAlugData).gte('data',fmt(lim)).eq('obra_id',encAlugObraId).eq('empresa_moa_id',encAlugEmpresaId)
      .not('colab_moa_id','is',null).order('data',{ascending:false}).limit(500);
    if(!regs?.length){ _alugAnterior={data:null,colabIds:[]}; _alugDesenharAnterior(); return; }
    _alugAnterior={data:regs[0].data,colabIds:[...new Set(regs.map(r=>r.colab_moa_id))]};
  }catch(e){ _alugAnterior={data:null,colabIds:[]}; }
  _alugDesenharAnterior();
}

// Trabalhadores sugeridos: ainda não estão na lista e, se o mesmo nome estiver registado mais do que uma vez, só um aparece
function _alugSugeridos(){
  const jaNaLista=new Set(encAlugTrabalhadores.map(t=>t.colabId));
  const nomes=new Set(encAlugTrabalhadores.map(t=>_alugNomeKey(t.nome)));
  return (COLABORADORES_MOA[encAlugEmpresaId]||[]).filter(c=>{
    if(!_alugAnterior.colabIds.includes(c.id)||jaNaLista.has(c.id)) return false;
    const k=_alugNomeKey(c.nome); if(nomes.has(k)) return false;
    nomes.add(k); return true;
  });
}
const _alugNomeKey=n=>String(n||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();

function _alugDesenharAnterior(){
  const box=document.getElementById('alug-ontem-box');
  if(!box) return;
  const disp=_alugSugeridos();
  if(!_alugAnterior.data||!disp.length){ box.style.display='none'; return; }
  document.getElementById('alug-ontem-label').textContent='Equipa dos últimos 7 dias';
  const lista=document.getElementById('alug-ontem-lista'); lista.innerHTML='';
  disp.forEach(c=>{
    const chip=document.createElement('button');
    chip.style.cssText='padding:6px 12px;background:var(--green-bg);color:var(--green);border:1.5px solid var(--green-light);border-radius:20px;font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer';
    chip.textContent=`+ ${c.nome.split(' ')[0]}`;
    chip.onclick=()=>{ encAlugTrabalhadores.push(_novoTrab(c)); buildAlugList(); };
    lista.appendChild(chip);
  });
  box.style.display='block';
}

function adicionarTodosAnteriorAlug(){
  const disp=_alugSugeridos();
  if(!disp.length){showToast('Todos já adicionados');return;}
  disp.forEach(c=>encAlugTrabalhadores.push(_novoTrab(c)));
  buildAlugList();
  showToast(`${disp.length} trabalhadores adicionados ✓`);
}

function _novoTrab(c){
  return {id:Date.now()+Math.random(),colabId:c.id,nome:c.nome,funcao:c.funcao||'',foto_path:c.foto_path||null,entrada:encAlugHoraIni,saida:encAlugHoraFim,status:'P'};
}

// Seletor com os trabalhadores registados da empresa que ainda não estão na lista do dia
function _fillEncTrabSel(){
  const sel=document.getElementById('enc-alug-sel-trab');
  if(!sel) return;
  const naLista=new Set(encAlugTrabalhadores.map(t=>t.colabId));
  const disp=(COLABORADORES_MOA[encAlugEmpresaId]||[]).filter(c=>!naLista.has(c.id));
  sel.innerHTML=`<option value="">${disp.length?'— Selecionar —':'Todos os registados já estão na lista'}</option>`+
    disp.map(c=>`<option value="${c.id}">${c.nome}${c.funcao?' ('+c.funcao+')':''}</option>`).join('');
}

function encAlugAddTrabalhador(){
  const sel=document.getElementById('enc-alug-sel-trab');
  const c=(COLABORADORES_MOA[encAlugEmpresaId]||[]).find(x=>x.id===sel?.value);
  if(!c){showToast('Selecione um trabalhador');return;}
  encAlugTrabalhadores.push(_novoTrab(c));
  buildAlugList();
  showToast('Trabalhador adicionado ✓');
}

function _alugHorasHTML(h){
  return (h.n>0?`<span class="mob-horas-n">${fmtH(h.n)}</span>`:'')+(h.e>0?` +<span class="mob-horas-e">${fmtH(h.e)}E</span>`:'')+(h.t===0?'<span style="color:var(--gray-300)">—</span>':'');
}
function _alugEstado(t,h){
  if(h.t>0) return {cls:'completo',badge:'<span class="badge b-green">✓</span>'};
  if(t.entrada) return {cls:'parcial',badge:'<span class="badge b-blue">Em curso</span>'};
  return {cls:'',badge:''};
}

function buildAlugList(){
  const cont=document.getElementById('enc-alug-list'); cont.innerHTML='';
  if(!encAlugTrabalhadores.length){
    cont.innerHTML='<div style="text-align:center;padding:32px 16px;color:var(--gray-400);font-size:14px">Adicione trabalhadores acima para iniciar o registo.</div>';
    encAlugUpdateStats([]);_fillEncTrabSel();_alugDesenharAnterior();return;
  }
  const dateObj=new Date(encAlugData+'T12:00:00');
  encAlugTrabalhadores.forEach(t=>{
    const h=calcH(t.entrada,t.saida,dateObj);
    const st=_alugEstado(t,h);
    const card=document.createElement('div');
    card.className=`mob-colab-card ${st.cls}`; card.id='ea-'+t.id;
    card.innerHTML=`
      <div class="mob-colab-top">
        ${_moaAvatarHTML(t,36)}
        <div class="mob-colab-info"><div class="mob-colab-name">${t.nome}</div><div class="mob-colab-func">${t.funcao||''}</div></div>
        <div class="mob-colab-status">${st.badge}</div>
      </div>
      <div class="mob-colab-times">
        <div class="mob-time-block"><div class="mob-time-lbl">Entrada</div>
          <input type="time" class="mob-time-inp ${t.entrada?'filled':''}" value="${t.entrada||''}" onchange="encAlugSetHora(${t.id},'entrada',this.value)"/></div>
        <div class="mob-time-block"><div class="mob-time-lbl">Saída</div>
          <input type="time" class="mob-time-inp ${t.saida?'filled':''}" value="${t.saida||''}" onchange="encAlugSetHora(${t.id},'saida',this.value)"/></div>
        <div class="mob-time-block"><div class="mob-time-lbl">Horas</div>
          <div class="mob-horas-box" id="alug-horas-${t.id}">${_alugHorasHTML(h)}</div></div>
      </div>
      <div class="mob-colab-bottom">
        <div style="flex:1"></div>
        <button class="mob-rem-btn" onclick="encAlugRemover(${t.id})">×</button>
      </div>`;
    cont.appendChild(card);
  });
  encAlugUpdateStats(encAlugTrabalhadores);
  _fillEncTrabSel();
  _alugDesenharAnterior();
  _moaCarregarFotos(cont);
}

function encAlugSetHora(id,campo,val){
  const t=encAlugTrabalhadores.find(x=>x.id===id);
  if(!t)return;
  t[campo]=val;
  const h=calcH(t.entrada,t.saida,new Date(encAlugData+'T12:00:00'));
  const hEl=document.getElementById(`alug-horas-${id}`);
  if(hEl) hEl.innerHTML=_alugHorasHTML(h);
  const card=document.getElementById('ea-'+id);
  if(card){
    const st=_alugEstado(t,h);
    card.className=`mob-colab-card ${st.cls}`;
    const s=card.querySelector('.mob-colab-status'); if(s) s.innerHTML=st.badge;
    card.querySelectorAll('.mob-time-inp').forEach((inp,i)=>inp.classList.toggle('filled',!!(i===0?t.entrada:t.saida)));
  }
  encAlugUpdateStats(encAlugTrabalhadores);
}

async function encAlugRemover(id){
  const t=encAlugTrabalhadores.find(x=>x.id===id);
  encAlugTrabalhadores=encAlugTrabalhadores.filter(x=>x.id!==id);
  buildAlugList();
  // Como na MO Plandese: remover da lista apaga também o registo já gravado deste encarregado
  if(t?.colabId){
    try{
      const encId=S.currentUser?.key||null;
      let dq=sb.from('registos_ponto_moa').delete().eq('data',encAlugData).eq('obra_id',encAlugObraId).eq('colab_moa_id',t.colabId);
      dq=encId!=null?dq.eq('encarregado_id',encId):dq.is('encarregado_id',null);
      await dq;
    }catch(e){}
  }
}

function encAlugUpdateStats(lista){
  const dateObj=new Date(encAlugData+'T12:00:00');
  let tn=0,te=0,tt=0,pres=0;
  lista.forEach(t=>{const h=calcH(t.entrada,t.saida,dateObj);tn+=h.n;te+=h.e;tt+=h.t;if(h.t>0)pres++;});
  document.getElementById('alug-st-p').textContent=pres;
  document.getElementById('alug-st-n').textContent=fmtH(tn)||'0h';
  document.getElementById('alug-st-e').textContent=fmtH(te)||'0h';
  document.getElementById('alug-st-t').textContent=fmtH(tt)||'0h';
}

const _ALUG_BTN_HTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><polyline points="20 6 9 17 4 12"/></svg> Submeter registo';
function _alugResetBtnSubmeter(){
  const btn=document.querySelector('#enc-alug-screen-b .mob-save-btn');
  if(btn){ btn.disabled=false; btn.innerHTML=_ALUG_BTN_HTML; }
}
// Um pedido que nunca responde (rede instável) não pode deixar o botão preso em "A guardar…"
const _alugComTempo=(p,ms=25000)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('O servidor demorou demasiado a responder. Verifique a ligação e tente de novo.')),ms))]);

async function encAlugSubmeter(){
  if(!encAlugTrabalhadores.length){showToast('Adicione pelo menos um trabalhador');return;}
  const btn=document.querySelector('#enc-alug-screen-b .mob-save-btn');
  if(btn&&btn.disabled) return;
  if(btn){btn.disabled=true;btn.textContent='A guardar…';}
  const encId=S.currentUser?.key||null;
  try{
    // Registos já gravados deste encarregado neste dia/obra → atualizar em vez de duplicar
    const {data:exist,error:e0}=await _alugComTempo(_alugQueryMeus('id, colab_moa_id')
      .eq('data',encAlugData).eq('obra_id',encAlugObraId).not('colab_moa_id','is',null));
    if(e0) throw e0;
    const idPorColab={}; (exist||[]).forEach(r=>{idPorColab[r.colab_moa_id]=r.id;});
    const agora=new Date().toISOString();
    const novos=[], edits=[];
    encAlugTrabalhadores.forEach(t=>{
      const base={
        data:encAlugData, empresa_moa_id:encAlugEmpresaId, empresa_moa_nome:encAlugEmpresaNome,
        trabalhador_nome:t.nome, trabalhador_funcao:t.funcao||null, colab_moa_id:t.colabId||null,
        obra_id:encAlugObraId, entrada:t.entrada||null, saida:t.saida||null,
        encarregado_id:encId, encarregado_nome:S.currentUser?.nome||'',
      };
      const idEx=t.colabId?idPorColab[t.colabId]:null;
      if(idEx) edits.push({id:idEx,row:{entrada:base.entrada,saida:base.saida,editado_por:S.currentUser?.nome||S.currentUser?.key||'—',editado_em:agora}});
      else novos.push({...base,criado_em:agora});
    });
    if(novos.length){ const {error}=await _alugComTempo(sb.from('registos_ponto_moa').insert(novos)); if(error) throw error; }
    const res=await _alugComTempo(Promise.all(edits.map(e=>sb.from('registos_ponto_moa').update(e.row).eq('id',e.id))));
    const eErr=res.find(r=>r.error); if(eErr) throw eErr.error;
    showToast('Registo submetido com sucesso! ✓');
    try{ localStorage.setItem(`enc_done_aluguer_${fmt(new Date())}`,'1'); }catch(e){}
    R.emitEvent?.({acao:'MO Aluguer submetida · '+(S.currentUser?.nome||'Encarregado')+' ('+encAlugTrabalhadores.length+' trab.)',seccao:'historico',obra:encAlugObraId});
    setTimeout(()=>{ encVoltarHome(); _alugResetBtnSubmeter(); },1500);
  }catch(e){
    showToast('⚠️ Não foi possível submeter: '+(e.message||e));
    _alugResetBtnSubmeter();
  }
}

// ═══════════════════════════════════════
//  REGISTO DE TRABALHADOR MOA (encarregado / diretor de obra)
//  Nome, empresa e função obrigatórios; fotografia da cara opcional.
// ═══════════════════════════════════════
const MOA_FOTOS_BUCKET='moa-fotos';
// Funções propostas no registo (as já usadas noutros trabalhadores juntam-se à lista)
const FUNCOES_MOA=['Servente','Pedreiro','Carpinteiro','Cofrador','Armador de ferro','Calceteiro',
  'Canalizador','Ajudante Canalizador','Eletricista','Serralheiro','Pintor',
  'Condutor Manobrador','Motorista','Encarregado'];
const _fotoUrlCache={}; // foto_path → {url, exp}
let _mmtFotoBlob=null, _mmtDoEnc=false; // _mmtDoEnc: false | true (ecrã B) | 'a' (ecrã A)

// Avatar: inicial por omissão; a foto (bucket privado) é trocada depois por _moaCarregarFotos
function _moaAvatarHTML(c,size){
  const ini=(c.nome||'?').charAt(0).toUpperCase();
  return `<div ${c.foto_path?`data-foto="${c.foto_path}"`:''} style="width:${size}px;height:${size}px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#a855f7);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:${Math.round(size*.36)}px;flex-shrink:0;overflow:hidden;background-size:cover;background-position:center">${ini}</div>`;
}

async function _moaCarregarFotos(root){
  const els=[...root.querySelectorAll('[data-foto]')];
  if(!els.length) return;
  const now=Date.now();
  const falta=[...new Set(els.map(e=>e.dataset.foto))].filter(p=>!(_fotoUrlCache[p]?.exp>now));
  if(falta.length){
    try{
      const {data,error}=await sb.storage.from(MOA_FOTOS_BUCKET).createSignedUrls(falta,3600);
      if(error) throw error;
      (data||[]).forEach(d=>{ if(d.signedUrl) _fotoUrlCache[d.path]={url:d.signedUrl,exp:now+3500*1000}; });
    }catch(e){ console.warn('fotos MOA:',e.message||e); return; }
  }
  els.forEach(el=>{
    const u=_fotoUrlCache[el.dataset.foto]?.url;
    if(u){ el.style.backgroundImage=`url("${u}")`; el.textContent=''; }
  });
}

// Reduz a fotografia (telemóveis tiram 3–12 MB) para um JPEG quadrado de 480px
function _moaComprimirFoto(file){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>{
      const lado=Math.min(img.width,img.height), T=480;
      const cv=document.createElement('canvas'); cv.width=T; cv.height=T;
      cv.getContext('2d').drawImage(img,(img.width-lado)/2,(img.height-lado)/2,lado,lado,0,0,T,T);
      URL.revokeObjectURL(img.src);
      cv.toBlob(b=>b?resolve(b):reject(new Error('falha ao processar a fotografia')),'image/jpeg',0.82);
    };
    img.onerror=()=>reject(new Error('ficheiro de imagem inválido'));
    img.src=URL.createObjectURL(file);
  });
}

function _mmtFillEmpresas(selId){
  const sel=document.getElementById('mmt-empresa');
  sel.innerHTML='<option value="">— Selecione a empresa —</option>'+
    EMPRESAS_MOA.filter(e=>e.ativa!==false).map(e=>`<option value="${e.id}">${e.nome}</option>`).join('')+
    '<option value="__nova">+ Nova empresa…</option>';
  sel.value=selId||'';
  moaTrabEmpresaChange();
}

// doEnc=true → aberto no ecrã B do encarregado: empresa pré-selecionada e o
// trabalhador entra logo na lista do dia.
// doEnc='a' → aberto no ecrã A: usa a empresa já escolhida e, no fim, deixa-a selecionada.
function moaTrabAbrir(doEnc, empId){
  _mmtDoEnc=doEnc==='a'?'a':!!doEnc;
  if(doEnc==='a') empId=document.getElementById('enc-alug-empresa')?.value||'';
  _mmtFotoBlob=null;
  ['mmt-nome','mmt-funcao-outra','mmt-empresa-nova'].forEach(id=>{document.getElementById(id).value='';});
  _mmtFillFuncoes();
  document.getElementById('mmt-foto').value='';
  moaTrabFotoRemover();
  _mmtFillEmpresas(doEnc===true?encAlugEmpresaId:(empId||''));
  const btn=document.getElementById('mmt-guardar'); btn.disabled=false; btn.textContent='Registar';
  document.getElementById('modal-moa-trab').classList.add('open');
  setTimeout(()=>document.getElementById('mmt-nome').focus(),50);
}

function _mmtFillFuncoes(){
  const usadas=Object.values(COLABORADORES_MOA).flat().map(c=>c.funcao).filter(Boolean);
  const lista=[...new Set([...FUNCOES_MOA,...usadas])].sort((a,b)=>a.localeCompare(b));
  document.getElementById('mmt-funcao').innerHTML='<option value="">— Selecione a função —</option>'+
    lista.map(f=>`<option value="${f}">${f}</option>`).join('')+'<option value="__outra">Outra…</option>';
  moaTrabFuncaoChange();
}

function moaTrabFuncaoChange(){
  document.getElementById('mmt-funcao-outra-wrap').style.display=document.getElementById('mmt-funcao').value==='__outra'?'block':'none';
}

function moaTrabEmpresaChange(){
  const nova=document.getElementById('mmt-empresa').value==='__nova';
  document.getElementById('mmt-empresa-nova-wrap').style.display=nova?'block':'none';
}

async function moaTrabFotoChange(inp){
  const f=inp.files?.[0]; if(!f) return;
  try{
    _mmtFotoBlob=await _moaComprimirFoto(f);
    const prev=document.getElementById('mmt-foto-prev');
    prev.style.border='none';
    prev.innerHTML=`<img src="${URL.createObjectURL(_mmtFotoBlob)}" style="width:100%;height:100%;object-fit:cover"/>`;
    document.getElementById('mmt-foto-rem').style.display='inline-flex';
  }catch(e){ showToast('Erro na fotografia: '+e.message); }
}

function moaTrabFotoRemover(){
  _mmtFotoBlob=null;
  document.getElementById('mmt-foto').value='';
  const prev=document.getElementById('mmt-foto-prev');
  prev.style.border='1.5px dashed var(--gray-300)';
  prev.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
  document.getElementById('mmt-foto-rem').style.display='none';
}

const _norm=s=>(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim().toLowerCase();

async function moaTrabGuardar(){
  const nome=document.getElementById('mmt-nome').value.replace(/\s+/g,' ').trim();
  const fSel=document.getElementById('mmt-funcao').value;
  const funcao=(fSel==='__outra'?document.getElementById('mmt-funcao-outra').value:fSel).replace(/\s+/g,' ').trim();
  let empId=document.getElementById('mmt-empresa').value;
  const empNova=document.getElementById('mmt-empresa-nova').value.replace(/\s+/g,' ').trim();
  if(!nome){showToast('Indique o nome do trabalhador');return;}
  if(!empId||(empId==='__nova'&&!empNova)){showToast('Indique a empresa cedente');return;}
  if(!funcao){showToast('Indique a função');return;}

  const btn=document.getElementById('mmt-guardar'); btn.disabled=true; btn.textContent='A registar…';
  let fotoPath=null;
  try{
    // Empresa nova (se já existir uma com o mesmo nome, usa essa)
    if(empId==='__nova'){
      const exist=EMPRESAS_MOA.find(e=>_norm(e.nome)===_norm(empNova));
      if(exist) empId=exist.id;
      else{
        const rec={id:'empmoa_'+Date.now(),nome:empNova,nif:null,contacto:null,ativa:true};
        const {error}=await sb.from('empresas_moa').insert(rec);
        if(error) throw error;
        EMPRESAS_MOA.push(rec); EMPRESAS_MOA.sort((a,b)=>a.nome.localeCompare(b.nome));
        _saveEmpresasMOALocal();
      }
    }
    // Evitar duplicados: mesmo nome na mesma empresa
    const dup=(COLABORADORES_MOA[empId]||[]).find(c=>_norm(c.nome)===_norm(nome));
    if(dup){
      showToast(`${dup.nome} já está registado nesta empresa`);
      btn.disabled=false; btn.textContent='Registar';
      return;
    }
    const id='cmoa_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
    if(_mmtFotoBlob){
      fotoPath=`${empId}/${id}.jpg`;
      const {error}=await sb.storage.from(MOA_FOTOS_BUCKET).upload(fotoPath,_mmtFotoBlob,{contentType:'image/jpeg'});
      if(error) throw error;
    }
    const rec={id,empresa_moa_id:empId,nome,funcao,ativo:true,foto_path:fotoPath,registado_por:S.currentUser?.key||null};
    const {error}=await sb.from('colaboradores_moa').insert(rec);
    if(error) throw error;

    const c={id,nome,funcao,foto_path:fotoPath};
    if(!COLABORADORES_MOA[empId]) COLABORADORES_MOA[empId]=[];
    COLABORADORES_MOA[empId].push(c);
    COLABORADORES_MOA[empId].sort((a,b)=>a.nome.localeCompare(b.nome));
    closeModal('modal-moa-trab');
    showToast(`✓ ${nome} registado`);
    _moaRefreshEmpresaSelects();
    const panel=document.getElementById(`colabs-panel-${empId}`);
    if(panel) _renderColabsPanelMOA(empId,panel); if((!panel||_moaDesk())&&document.getElementById('empresas-moa-list')) renderEmpresasMOA();
    // No ecrã do encarregado, o trabalhador entra logo no registo do dia (se for da empresa em curso)
    if(_mmtDoEnc==='a'){
      // Ecrã A: deixar a empresa do trabalhador escolhida — ao continuar, ele já vem na lista
      const es=document.getElementById('enc-alug-empresa'); if(es) es.value=empId;
      showToast(`✓ ${nome} registado — ao continuar já aparece na lista`);
    } else if(_mmtDoEnc){
      if(empId===encAlugEmpresaId){ encAlugTrabalhadores.push(_novoTrab(c)); buildAlugList(); }
      else showToast(`${nome} registado noutra empresa — não entra neste registo`);
    }
  }catch(e){
    if(fotoPath) sb.storage.from(MOA_FOTOS_BUCKET).remove([fotoPath]).catch(()=>{});
    showToast('Erro ao registar: '+(e.message||e));
    btn.disabled=false; btn.textContent='Registar';
  }
}

// Empresa criada no modal → atualizar os seletores de empresa abertos
function _moaRefreshEmpresaSelects(){
  [['enc-alug-empresa','— Selecione a empresa —'],['moa-f-empresa','Todas']].forEach(([id,vazio])=>{
    const sel=document.getElementById(id); if(!sel) return;
    const v=sel.value;
    sel.innerHTML=`<option value="">${vazio}</option>`+EMPRESAS_MOA.filter(e=>e.ativa!==false).map(e=>`<option value="${e.id}">${e.nome}</option>`).join('');
    sel.value=v;
  });
}

// ── MOA Admin — filtros e listagem ─────

async function applyMOAFilter(){
  const dataVal=document.getElementById('moa-f-semana').value;
  if(!dataVal){showToast('Selecione uma data para pesquisar');return;}
  moaCurrentMonday=new Date(dataVal+'T12:00:00'); // data de referência (a semana é calculada em loadMOAWeek)
  await loadMOAWeek();
}

function navMOASemana(dir){
  if(!moaCurrentMonday)return;
  moaCurrentMonday=new Date(moaCurrentMonday);
  moaCurrentMonday.setDate(moaCurrentMonday.getDate()+dir*7);
  document.getElementById('moa-f-semana').value=fmt(moaCurrentMonday);
  loadMOAWeek();
}

// Vista semanal igual à da MO Plandese: obra → trabalhador × dias (2ª a sábado),
// totais de horas, edição por célula e aprovação diária pelo diretor de obra.
let _moaCache=null;     // {rows, obraMap, dupByDay, days, dStrs, dayNames, semLabel, aprov}
let _moaDiaSel=null;    // dia selecionado na vista de lista (telemóvel)
let _moaCellIndex={};
let _moaTrabIndex={};  // obra__trabalhador → dados do trabalhador (resumo mensal)   // cellKey → [registos]
const _moaAprovKey=(obraId,ds)=>`${obraId}|${ds}`;
const _MOA_DAY_NAMES=['2ª Feira','3ª Feira','4ª Feira','5ª Feira','6ª Feira','Sábado','Domingo'];

async function loadMOAWeek(){
  if(!moaCurrentMonday)return;
  const monday=getMonday(moaCurrentMonday);
  const days=[]; for(let i=0;i<7;i++){const d=new Date(monday);d.setDate(d.getDate()+i);days.push(d);}
  const dStrs=days.map(fmt);
  const empresaFil=document.getElementById('moa-f-empresa').value;
  const obraFil=document.getElementById('moa-f-obra').value;
  document.getElementById('moa-week-nav').style.display='flex';
  const res=document.getElementById('moa-resultado');
  res.innerHTML='<div class="pl-load"><span class="pl-logo"></span>A carregar…</div>';
  let rows, aprovRows;
  try{
    let q=sb.from('registos_ponto_moa').select('*').gte('data',dStrs[0]).lte('data',dStrs[6]);
    if(empresaFil) q=q.eq('empresa_moa_id',empresaFil);
    if(obraFil) q=q.eq('obra_id',obraFil);
    const [r1,r2]=await Promise.all([q, sb.from('aprovacoes_ponto_moa').select('*').in('data',dStrs)]);
    if(r1.error) throw r1.error;
    rows=(r1.data||[]).filter(r=>obraVisivelPara(S.currentUser,S.OBRAS,r.obra_id)); aprovRows=r2.data||[];
  }catch(e){
    res.innerHTML=`<div class="card" style="text-align:center;color:var(--red);padding:32px;font-size:13px">⚠️ Erro ao carregar dados: ${e.message}</div>`;
    _moaCache=null; return;
  }
  // Domingo só aparece se houver registos nesse dia (como na MO Plandese, a semana é 2ª–sábado)
  const nDias=rows.some(r=>r.data===dStrs[6])?7:6;
  const semLabel=`${fmtPT(dStrs[0])} a ${fmtPT(dStrs[nDias-1])}`;
  document.getElementById('moa-week-title').textContent=`Semana ${semLabel}`;
  if(!rows.length){
    document.getElementById('moa-week-sub').textContent='—';
    res.innerHTML='<div class="card" style="text-align:center;color:var(--gray-400);padding:32px;font-size:13px">Sem registos para esta semana.</div>';
    _moaCache=null; return;
  }
  // obra → trabalhador → dia → [registos]. O trabalhador é identificado pelo registo
  // (colab_moa_id); registos antigos só têm o nome → chave empresa+nome.
  const obraMap={}, dupByDay={};
  rows.forEach(r=>{
    const oId=r.obra_id||'_sem';
    const tKey=r.colab_moa_id||`${r.empresa_moa_id||''}::${(r.trabalhador_nome||'').trim().toLowerCase()}`;
    if(!obraMap[oId]) obraMap[oId]={};
    if(!obraMap[oId][tKey]) obraMap[oId][tKey]={nome:r.trabalhador_nome||'—',funcao:r.trabalhador_funcao||'',empresa:r.empresa_moa_nome||'',colabId:r.colab_moa_id||null,cells:Array.from({length:nDias},()=>[])};
    const di=dStrs.indexOf(r.data);
    if(di>=0&&di<nDias) obraMap[oId][tKey].cells[di].push(r);
    if(!dupByDay[r.data]) dupByDay[r.data]={};
    dupByDay[r.data][tKey]=(dupByDay[r.data][tKey]||0)+1;
  });
  const aprov={}; aprovRows.forEach(a=>{aprov[_moaAprovKey(a.obra_id,a.data)]=a;});
  const todayStr=fmt(new Date());
  const ds6=dStrs.slice(0,nDias);
  if(!_moaDiaSel||!ds6.includes(_moaDiaSel)) _moaDiaSel=ds6.includes(todayStr)?todayStr:ds6[0];
  _moaCache={rows,obraMap,dupByDay,days:days.slice(0,nDias),dStrs:ds6,dayNames:_MOA_DAY_NAMES.slice(0,nDias),semLabel,aprov};
  _moaDraw();
}

function moaAbrirResumo(key){
  const t=_moaTrabIndex[key]; if(!t||!_moaCache) return;
  const emp=t.cells.flat()[0]?.empresa_moa_id||null;
  abrirResumoMOA({colabId:t.colabId,empresaId:emp,nome:t.nome,funcao:t.funcao,empresa:t.empresa},_moaCache.dStrs[0]);
}

function moaSelectDia(ds){ if(_moaCache?.dStrs.includes(ds)){ _moaDiaSel=ds; _moaDraw(); } }

function _moaFotoDe(t){
  if(!t.colabId) return null;
  for(const lst of Object.values(COLABORADORES_MOA)){ const c=lst.find(x=>x.id===t.colabId); if(c) return c.foto_path||null; }
  return null;
}

function _moaAprovDiaHTML(obraId,ds,temReg){
  if(obraId==='_sem') return '<span style="color:var(--gray-300);font-size:11px">—</span>';
  return aprovCelulaHTML({
    a:_moaCache?.aprov?.[_moaAprovKey(obraId,ds)], pode:podeAprovarObra(obraId), temRegistos:temReg,
    onAprovar:`aprovarDiaMOA('${obraId}','${ds}')`, onRetirar:`retirarAprovacaoMOA('${obraId}','${ds}')`,
  });
}

function _moaResumoHTML(obraId){
  if(obraId==='_sem') return '';
  const {obraMap,dStrs,aprov}=_moaCache;
  const dias=dStrs.filter((ds,i)=>Object.values(obraMap[obraId]).some(t=>t.cells[i].length));
  const n=dias.filter(ds=>aprov[_moaAprovKey(obraId,ds)]).length;
  const o=S.OBRAS.find(o=>o.id===obraId);
  const diretores=[o?.diretor_id, ...(o?.diretores_extra||[])].filter(Boolean);
  const nomeDir=diretores.length?diretores.map(d=>S.USERS?.[d]?.nome||d).join(', '):'sem diretor atribuído';
  return `<span class="badge ${n===dias.length?'b-green':'b-yellow'}" title="Diretor de obra: ${nomeDir}">${n}/${dias.length} dias aprovados · ${nomeDir}</span>`;
}

// Soma de horas de uma célula (vários registos no mesmo dia são somados)
function _moaCellH(regs,dateObj){
  const h={n:0,e:0,t:0};
  regs.forEach(r=>{const hh=calcH(r.entrada?.slice(0,5)||'',r.saida?.slice(0,5)||'',dateObj);h.n+=hh.n;h.e+=hh.e;h.t+=hh.t;});
  return h;
}

function _moaSortedTrabs(obraData){
  return Object.keys(obraData).sort((a,b)=>obraData[a].nome.localeCompare(obraData[b].nome));
}

function _moaDraw(){
  if(!_moaCache) return;
  const {obraMap,dupByDay,days,dStrs,dayNames,aprov}=_moaCache;
  const res=document.getElementById('moa-resultado'); if(!res) return;
  _moaCellIndex={}; _moaTrabIndex={}; _moaClosePopover();

  let nDias=0,nAprov=0;
  Object.keys(obraMap).filter(id=>id!=='_sem').forEach(id=>dStrs.forEach((ds,i)=>{
    if(!Object.values(obraMap[id]).some(t=>t.cells[i].length)) return;
    nDias++; if(aprov[_moaAprovKey(id,ds)]) nAprov++;
  }));
  document.getElementById('moa-week-sub').textContent=nDias?`${nAprov}/${nDias} dias de obra aprovados pelo diretor de obra`:'—';

  res.innerHTML='';
  if(document.body.classList.contains('device-mobile')){ _moaDrawMobile(res); _moaCarregarFotos(res); return; }

  // Portal em computador: tabela na linguagem da shell (igual à MO Plandese)
  if(document.body.classList.contains('device-desktop') && !document.body.classList.contains('enc-mode')){ _moaDrawDesktop(res); _moaCarregarFotos(res); return; }

  Object.keys(obraMap).sort().forEach(obraId=>{
    const obraNome=S.OBRAS.find(o=>o.id===obraId)?.nome||'(sem obra)';
    const obraData=obraMap[obraId];
    const hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;margin:18px 0 6px;flex-wrap:wrap;gap:8px';
    hdr.innerHTML=`<div style="display:flex;align-items:center;gap:10px">
      <div style="width:10px;height:10px;border-radius:50%;background:#7c3aed"></div>
      <span style="font-size:14px;font-weight:600;color:var(--gray-800)">Obra: ${obraNome}</span>
    </div>${_moaResumoHTML(obraId)}`;
    res.appendChild(hdr);

    let thead=`<thead><tr style="background:var(--blue-800)">
      <th style="color:white;background:var(--blue-800);min-width:180px">Nome</th>
      <th style="color:white;background:var(--blue-800);min-width:110px">Empresa</th>
      <th style="color:white;background:var(--blue-800);min-width:90px">Função</th>`;
    days.forEach((d,i)=>{
      const bg=isNonWorkday(d)?'#C2410C':'var(--blue-600)';
      thead+=`<th style="color:white;background:${bg};text-align:center;border-left:2px solid rgba(255,255,255,.2)">
        <div style="font-size:12px;font-weight:700">${dayNames[i]}</div>
        <div style="font-size:10px;font-weight:400;opacity:.8">${fmtPT(dStrs[i])}</div></th>`;
    });
    thead+=`<th style="color:white;background:#1e3a2f;text-align:center;border-left:2px solid rgba(255,255,255,.2)">H.Nor.</th>
      <th style="color:white;background:#1e3a2f;text-align:center">H.Ext.</th>
      <th style="color:white;background:#1e3a2f;text-align:center">Total</th></tr>`;
    if(obraId!=='_sem'){
      thead+=`<tr style="background:var(--gray-50)"><th colspan="3" style="background:var(--gray-50);font-size:11px;font-weight:600;color:var(--gray-600)">Aprovação diária</th>`;
      dStrs.forEach((ds,i)=>{
        const temReg=Object.values(obraData).some(t=>t.cells[i].length);
        thead+=`<th style="background:var(--gray-50);text-align:center;padding:6px 4px;border-left:1px solid var(--gray-100)">${_moaAprovDiaHTML(obraId,ds,temReg)}</th>`;
      });
      thead+=`<th colspan="3" style="background:var(--gray-50)"></th></tr>`;
    }
    thead+='</thead>';

    let tbody='<tbody>', totN=0,totE=0,totT=0, rowNum=1;
    _moaSortedTrabs(obraData).forEach(tKey=>{
      const t=obraData[tKey];
      _moaTrabIndex[`${obraId}__${tKey}`]=t;
      let rN=0,rE=0,rT=0, dayCells='';
      t.cells.forEach((regs,i)=>{
        const cellKey=`${obraId}__${tKey}__${i}`;
        _moaCellIndex[cellKey]=regs;
        const base='text-align:center;border-left:1px solid var(--gray-100);border-right:1px solid var(--gray-100)';
        if(!regs.length){ dayCells+=`<td style="${base};color:var(--gray-200);font-size:11px">—</td>`; return; }
        const h=_moaCellH(regs,days[i]); rN+=h.n; rE+=h.e; rT+=h.t;
        const warn=(dupByDay[dStrs[i]]?.[tKey]||0)>=2?`<span title="Vários registos neste dia — verificar" style="color:var(--orange,#ea580c);font-weight:800;margin-left:3px">⚠</span>`:'';
        dayCells+=`<td class="hp-cell moa-edit-btn" onclick="moaEditCell(event,'${cellKey}')" title="Clique para editar" style="font-family:'DM Mono',monospace;font-size:11px;font-weight:600;${base}">${h.t>0?fmtH(h.t):'<span style="color:var(--gray-300)">0h</span>'}${warn}</td>`;
      });
      totN+=rN; totE+=rE; totT+=rT;
      const tv={nome:t.nome,foto_path:_moaFotoDe(t)};
      tbody+=`<tr style="${rowNum%2===0?'background:var(--gray-50)':''}">
        <td style="font-weight:500;font-size:13px;white-space:nowrap;cursor:pointer" title="Ver resumo mensal" onclick="moaAbrirResumo('${obraId}__${tKey}')"><div style="display:flex;align-items:center;gap:8px">${_moaAvatarHTML(tv,24)}<span>${t.nome}</span></div></td>
        <td style="font-size:11px;color:var(--gray-500);white-space:nowrap">${t.empresa}</td>
        <td style="font-size:11px;color:var(--gray-500)">${t.funcao||'—'}</td>
        ${dayCells}
        <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--green);font-weight:700;text-align:center;border-left:2px solid var(--gray-200)">${fmtH(rN)}</td>
        <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--orange);font-weight:700;text-align:center">${fmtH(rE)}</td>
        <td style="font-family:'DM Mono',monospace;font-size:13px;font-weight:700;text-align:center;color:var(--blue-600)">${fmtH(rT)}</td>
      </tr>`;
      rowNum++;
    });
    tbody+=`<tr style="background:var(--gray-100);border-top:2px solid var(--gray-300)">
      <td colspan="3" style="font-weight:700;font-size:12px;padding:9px 12px;color:var(--gray-700)">TOTAL DA OBRA</td>
      ${dStrs.map(()=>'<td style="border-left:1px solid var(--gray-200)"></td>').join('')}
      <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--green);font-weight:700;text-align:center;border-left:2px solid var(--gray-300)">${fmtH(totN)}</td>
      <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--orange);font-weight:700;text-align:center">${fmtH(totE)}</td>
      <td style="font-family:'DM Mono',monospace;font-size:13px;font-weight:700;text-align:center;color:var(--blue-600)">${fmtH(totT)}</td>
    </tr></tbody>`;

    const wrap=document.createElement('div');
    wrap.className='card'; wrap.style.cssText='padding:0;overflow:hidden;margin-bottom:4px';
    wrap.innerHTML=`<div class="tbl-wrap"><table>${thead}${tbody}</table></div>`;
    res.appendChild(wrap);
  });
  _moaCarregarFotos(res);
}


// Vista de computador (shell): mesma tabela da MO Plandese — pastilhas por dia, totais e aprovação diária
function _moaDrawDesktop(res){
  const {obraMap,dupByDay,days,dStrs,aprov}=_moaCache;
  const esc=t=>String(t==null?'':t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const curtos=['Seg','Ter','Qua','Qui','Sex','Sáb'], todayStr=fmt(new Date());
  let grandN=0,grandE=0,grandT=0; const pessoas=new Set();
  res.insertAdjacentHTML('beforeend',`<div class="hp-legend"><span><i class="hpc ok">8h</i> Dia normal</span><span><i class="hpc ex"><em>+2h</em></i> Horas extra</span><span class="hp-leg-n">Clique numa célula para editar · clique no nome para o resumo do mês</span></div>`);
  Object.keys(obraMap).sort().forEach(obraId=>{
    const obraNome=S.OBRAS.find(o=>o.id===obraId)?.nome||'(sem obra)';
    const m=obraNome.match(/^(O\d+)\s*[-–]\s*(.+)$/), cod=m?m[1]:'', nome=m?m[2]:obraNome;
    const obraData=obraMap[obraId];
    let thead=`<thead><tr><th class="hp-who">Trabalhador</th>`;
    days.forEach((d,i)=>{ const we=isNonWorkday(d), hoje=dStrs[i]===todayStr;
      thead+=`<th class="hp-d${we?' we':''}${hoje?' today':''}">${curtos[i]}<small>${fmtPT(dStrs[i]).slice(0,5)}</small></th>`; });
    thead+=`<th class="hp-tt">Normais</th><th class="hp-tt">Extra</th><th class="hp-tt">Total</th></tr>`;
    if(obraId!=='_sem'){
      thead+=`<tr class="hp-ap"><th class="hp-who">Aprovação diária</th>`;
      dStrs.forEach((ds,i)=>{ const temReg=Object.values(obraData).some(t=>t.cells[i].length); thead+=`<th class="hp-d">${_moaAprovDiaHTML(obraId,ds,temReg)}</th>`; });
      thead+=`<th colspan="3"></th></tr>`;
    }
    thead+='</thead>';
    let totN=0,totE=0,totT=0; const totDia=days.map(()=>0);
    let tbody='<tbody>';
    const chaves=_moaSortedTrabs(obraData);
    chaves.forEach(tKey=>{
      const t=obraData[tKey]; pessoas.add(tKey);
      _moaTrabIndex[`${obraId}__${tKey}`]=t;
      let rN=0,rE=0,rT=0,tds='';
      t.cells.forEach((regs,i)=>{
        const cellKey=`${obraId}__${tKey}__${i}`; _moaCellIndex[cellKey]=regs;
        let pil='<span class="hpc no">—</span>';
        if(regs.length){
          const h=_moaCellH(regs,days[i]); rN+=h.n; rE+=h.e; rT+=h.t; totDia[i]+=h.t;
          if(h.t>0) pil=h.e>0?`<span class="hpc ex">${h.n>0?fmtH(h.n):''}<em>${h.n>0?'+':''}${fmtH(h.e)}${h.n>0?'':' extra'}</em></span>`:`<span class="hpc ok">${fmtH(h.t)}</span>`;
          else pil='<span class="hpc no">0h</span>';
        }
        const warn=(dupByDay[dStrs[i]]?.[tKey]||0)>=2?`<span class="hp-warn" title="Vários registos neste dia — verificar">⚠</span>`:'';
        tds+=`<td class="hp-cell moa-edit-btn${dStrs[i]===todayStr?' today':''}" onclick="moaEditCell(event,'${cellKey}')" title="Clique para editar">${pil}${warn}</td>`;
      });
      totN+=rN; totE+=rE; totT+=rT;
      tbody+=`<tr><td class="hp-who"><div class="d-pp">${_moaAvatarHTML({nome:t.nome,foto_path:_moaFotoDe(t)},36)}<div><b onclick="moaAbrirResumo('${obraId}__${tKey}')" title="Ver resumo mensal">${esc(t.nome)}</b><small>${esc([t.funcao,t.empresa].filter(Boolean).join(' · ')||'—')}</small></div></div></td>${tds}
        <td class="hp-tt n">${rN?fmtH(rN):'—'}</td><td class="hp-tt e${rE?'':' z'}">${rE?'+'+fmtH(rE):'—'}</td><td class="hp-tt t">${rT?fmtH(rT):'—'}</td></tr>`;
    });
    grandN+=totN; grandE+=totE; grandT+=totT;
    tbody+=`<tr class="hp-tot"><td class="hp-who">Total da obra</td>${totDia.map(v=>`<td>${v?fmtH(v):'—'}</td>`).join('')}<td class="hp-tt n">${fmtH(totN)}</td><td class="hp-tt e">${totE?'+'+fmtH(totE):'—'}</td><td class="hp-tt t">${fmtH(totT)}</td></tr></tbody>`;
    res.insertAdjacentHTML('beforeend',`<section class="hp-obra"><div class="hp-obra-h"><div class="hp-obra-t">${cod?`<span class="cod">${esc(cod)}</span>`:''}<b>${esc(nome)}</b><small>${chaves.length} ${chaves.length===1?'trabalhador':'trabalhadores'}</small></div>${_moaResumoHTML(obraId)}</div><div class="tbl-wrap hp-wrap"><table class="hp-t">${thead}${tbody}</table></div></section>`);
  });
  res.insertAdjacentHTML('beforeend',`<div class="hp-sum"><div><small>Trabalhadores</small><b>${pessoas.size}</b></div><div><small>Horas normais</small><b>${fmtH(grandN)}</b></div><div><small>Horas extra</small><b class="e">${grandE?fmtH(grandE):'—'}</b></div><div><small>Total da semana</small><b class="t">${fmtH(grandT)}</b></div></div>`);
}

// Telemóvel: seletor de dia + lista de trabalhadores desse dia (como na MO Plandese)
function _moaDrawMobile(res){
  const {obraMap,dupByDay,days,dStrs,dayNames}=_moaCache;
  const di=dStrs.indexOf(_moaDiaSel), todayStr=fmt(new Date());
  const sel=document.createElement('div');
  sel.style.cssText='display:flex;gap:6px;overflow-x:auto;padding:2px 2px 6px;margin-bottom:14px;-webkit-overflow-scrolling:touch';
  dStrs.forEach((ds,i)=>{
    const active=ds===_moaDiaSel, isToday=ds===todayStr;
    const btn=document.createElement('button'); btn.type='button'; btn.onclick=()=>moaSelectDia(ds);
    btn.style.cssText=`flex:0 0 auto;min-width:52px;padding:7px 4px 8px;border-radius:12px;border:1.5px solid ${active?'var(--blue-500)':'var(--gray-200)'};background:${active?'var(--blue-500)':'var(--white)'};color:${active?'#fff':'var(--gray-700)'};font-family:var(--font);cursor:pointer;text-align:center`;
    btn.innerHTML=`<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.02em;opacity:${active?'.9':'.6'}">${dayNames[i].replace(' Feira','')}</div>
      <div style="font-size:15px;font-weight:700;margin-top:2px;line-height:1">${ds.slice(8,10)}</div>
      ${isToday?`<div style="width:4px;height:4px;border-radius:50%;margin:4px auto 0;background:${active?'#fff':'var(--blue-500)'}"></div>`:''}`;
    sel.appendChild(btn);
  });
  res.appendChild(sel);
  let any=false;
  Object.keys(obraMap).sort().forEach(obraId=>{
    const obraData=obraMap[obraId];
    const keys=_moaSortedTrabs(obraData).filter(k=>obraData[k].cells[di].length);
    if(!keys.length) return;
    any=true;
    const obraNome=S.OBRAS.find(o=>o.id===obraId)?.nome||'(sem obra)';
    const hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;gap:10px;margin:16px 0 8px;flex-wrap:wrap';
    hdr.innerHTML=`<div style="width:8px;height:8px;border-radius:50%;background:#7c3aed;flex-shrink:0"></div>
      <span style="font-size:13px;font-weight:600;color:var(--gray-800)">Obra: ${obraNome}</span>
      ${obraId!=='_sem'?`<div style="margin-left:auto">${_moaAprovDiaHTML(obraId,_moaDiaSel,true)}</div>`:''}`;
    res.appendChild(hdr);
    const list=document.createElement('div'); list.className='card'; list.style.cssText='padding:0;overflow:hidden;margin-bottom:4px';
    keys.forEach((tKey,idx)=>{
      const t=obraData[tKey], regs=t.cells[di];
      const cellKey=`${obraId}__${tKey}__${di}`; _moaCellIndex[cellKey]=regs;
      const h=_moaCellH(regs,days[di]);
      const dup=(dupByDay[_moaDiaSel]?.[tKey]||0)>=2;
      const row=document.createElement('div');
      row.className='hp-cell moa-edit-btn';
      row.setAttribute('onclick',`moaEditCell(event,'${cellKey}')`);
      row.style.cssText=`display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;cursor:pointer;${idx>0?'border-top:1px solid var(--gray-100)':''}`;
      row.innerHTML=`<div style="display:flex;align-items:center;gap:10px;min-width:0">${_moaAvatarHTML({nome:t.nome,foto_path:_moaFotoDe(t)},32)}
          <div style="min-width:0">
            <div style="font-size:13.5px;font-weight:600;color:var(--gray-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.nome}${dup?' <span style="color:var(--orange,#ea580c);font-weight:800">⚠</span>':''}</div>
            <div style="font-size:11px;color:var(--gray-500);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${[t.funcao,t.empresa].filter(Boolean).join(' · ')}</div>
          </div></div>
        <div style="flex-shrink:0;text-align:right">
          <div style="font-family:'DM Mono',monospace;font-size:14px;font-weight:700;color:var(--blue-600)">${fmtH(h.t)||'0h'}</div>
          ${h.e>0?`<div style="font-size:10px;color:var(--orange);font-weight:600;margin-top:1px">+${fmtH(h.e)} extra</div>`:''}
        </div>`;
      list.appendChild(row);
    });
    res.appendChild(list);
  });
  if(!any) res.insertAdjacentHTML('beforeend','<div class="card" style="text-align:center;color:var(--gray-400);padding:32px;font-size:13px">Sem registos para este dia.</div>');
}

// Clique numa célula: edita o registo (se houver vários no dia, escolhe-se no popover)
function moaEditCell(evt,cellKey){
  const regs=_moaCellIndex[cellKey]; if(!regs?.length) return;
  const r0=regs[0];
  if(_moaCache?.aprov?.[_moaAprovKey(r0.obra_id,r0.data)]){
    showToast('Dia aprovado pelo diretor de obra — retire a aprovação para editar'); return;
  }
  evt.stopPropagation();
  _moaCurrent={id:r0.id,row:r0,regs};
  _moaRenderPopover(evt.currentTarget);
}

function moaPickReg(idx){
  if(!_moaCurrent?.regs) return;
  const r=_moaCurrent.regs[idx]; if(!r) return;
  _moaCurrent.id=r.id; _moaCurrent.row=r;
  _moaRenderPopover(_moaCurrent._anchor);
}

async function aprovarDiaMOA(obraId,ds){
  if(!podeAprovarObra(obraId)) return;
  const obraNome=S.OBRAS.find(o=>o.id===obraId)?.nome||obraId;
  try{
    const {error}=await sb.from('aprovacoes_ponto_moa').insert({obra_id:obraId,data:ds,aprovado_por:S.currentUser.key});
    if(error&&error.code!=='23505') throw error;
    showToast(`${fmtPT(ds)} aprovado ✓`);
    R.emitEvent?.({acao:`Folha de ponto MO Aluguer aprovada: ${obraNome} · ${fmtPT(ds)}`,seccao:'historico',obra:obraId});
    await loadMOAWeek();
  }catch(e){ showToast('Erro ao aprovar: '+(e.message||e)); }
}

async function retirarAprovacaoMOA(obraId,ds){
  if(!podeAprovarObra(obraId)) return;
  const obraNome=S.OBRAS.find(o=>o.id===obraId)?.nome||obraId;
  if(!confirm(`Retirar a aprovação da MO Aluguer na obra "${obraNome}" no dia ${fmtPT(ds)}? Os registos desse dia voltam a poder ser alterados.`)) return;
  try{
    const {data,error}=await sb.from('aprovacoes_ponto_moa').delete().eq('obra_id',obraId).eq('data',ds).select('obra_id');
    if(error) throw error;
    if(!data?.length) throw new Error('sem permissão ou aprovação já retirada');
    showToast('Aprovação retirada');
    R.emitEvent?.({acao:`Aprovação da MO Aluguer retirada: ${obraNome} · ${fmtPT(ds)}`,seccao:'historico',obra:obraId});
    await loadMOAWeek();
  }catch(e){ showToast('Erro ao retirar aprovação: '+(e.message||e)); }
}

function renderMOAResultado(){ _moaDraw(); }

function exportMOAExcel(){showToast('Exportação Excel MOA em breve!');}

// ── MOA Admin — Folha de fecho mensal (dia 1 ao último dia do mês) ──────────
let _moaFecho=null; // dados do mês carregado, usados pelo Excel
const _fEsc=t=>String(t??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const _fNum=h=>Math.round(h*100)/100;
const _fFmt=h=>h?(_fNum(h)+'').replace('.',','):'';

// Preço/hora por categoria (legenda do Excel do subempreiteiro); editável no ecrã e guardado neste browser
const _TAXAS_BASE={servente:9,pedreiro:10,manobrador:12.5};
let _moaTaxas={};
try{ _moaTaxas=JSON.parse(localStorage.getItem('moa_fecho_taxas')||'{}')||{}; }catch(e){ _moaTaxas={}; }
const _fCat=f=>String(f||'Sem categoria').trim().toUpperCase();
const _fTaxa=f=>{ const k=String(f||'').trim().toLowerCase(); return k in _moaTaxas?_moaTaxas[k]:(_TAXAS_BASE[k]??0); };
const _fEur=v=>(Math.round(v*100)/100).toLocaleString('pt-PT',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
const _fObraNome=id=>id==='_sem'?'Sem obra':(S.OBRAS.find(o=>String(o.id)===String(id))?.nome||String(id));

// Linhas de fecho (trabalhador × obra, com valor) e total por obra de uma empresa
function _fFechoEmpresa(E){
  const linhas=E.lin.map(l=>({...l,valor:l.h*_fTaxa(l.funcao)}))
    .sort((a,b)=>_fObraNome(a.obraId).localeCompare(_fObraNome(b.obraId),'pt')||a.nome.localeCompare(b.nome,'pt'));
  const obras=new Map();
  linhas.forEach(l=>{ const o=obras.get(l.obraId)||{nome:_fObraNome(l.obraId),valor:0,h:0}; o.valor+=l.valor; o.h+=l.h; obras.set(l.obraId,o); });
  const resumo=[...obras.values()].sort((a,b)=>a.nome.localeCompare(b.nome,'pt'));
  return {linhas,resumo,totH:linhas.reduce((x,l)=>x+l.h,0),totV:linhas.reduce((x,l)=>x+l.valor,0)};
}

function moaFechoTaxa(fn,v){
  const n=parseFloat(String(v).replace(',','.'));
  _moaTaxas[fn]=isNaN(n)||n<0?0:n;
  try{ localStorage.setItem('moa_fecho_taxas',JSON.stringify(_moaTaxas)); }catch(e){}
  _moaFechoDesenhar();
}

function moaFechoInit(){
  const inp=document.getElementById('moa-fecho-mes');
  if(!inp) return;
  if(!inp.value){ const h=new Date(); inp.value=`${h.getFullYear()}-${String(h.getMonth()+1).padStart(2,'0')}`; }
  const sel=document.getElementById('moa-fecho-emp');
  if(sel){ const v=sel.value; sel.innerHTML='<option value="">Todas as empresas</option>'+EMPRESAS_MOA.map(e=>`<option value="${_fEsc(e.id)}">${_fEsc(e.nome)}</option>`).join(''); sel.value=v; }
}

async function moaFechoCarregar(){
  const inp=document.getElementById('moa-fecho-mes'), res=document.getElementById('moa-fecho-res');
  if(!inp||!res) return;
  if(!inp.value){ showToast('Escolha o mês'); return; }
  const [ano,mes]=inp.value.split('-').map(Number);
  const nDias=new Date(ano,mes,0).getDate();
  const p2=n=>String(n).padStart(2,'0');
  const dIni=`${ano}-${p2(mes)}-01`, dFim=`${ano}-${p2(mes)}-${p2(nDias)}`;
  const empFil=document.getElementById('moa-fecho-emp')?.value||'';
  res.innerHTML='<div class="pl-load"><span class="pl-logo"></span>A carregar…</div>';
  _moaFecho=null;
  try{
    // Paginado: o Supabase devolve no máximo 1000 linhas por pedido
    const rows=[];
    for(let from=0;;from+=1000){
      let q=sb.from('registos_ponto_moa').select('*').gte('data',dIni).lte('data',dFim).order('data').range(from,from+999);
      if(empFil) q=q.eq('empresa_moa_id',empFil);
      const {data,error}=await q;
      if(error) throw error;
      rows.push(...(data||[]));
      if(!data||data.length<1000) break;
    }
    const {data:aprs}=await sb.from('aprovacoes_ponto_moa').select('obra_id,data').gte('data',dIni).lte('data',dFim);
    const aprSet=new Set((aprs||[]).map(a=>`${a.obra_id}|${a.data}`));
    const porAprovar=new Set(rows.filter(r=>!aprSet.has(`${r.obra_id||'_sem'}|${r.data}`)).map(r=>`${r.obra_id||'_sem'}|${r.data}`)).size;

    // empresa → trabalhador → dia → horas. Registos repetidos (mesma entrada/saída,
    // lançados por encarregados diferentes) contam uma só vez.
    const emps=new Map(), vistos=new Set();
    rows.forEach(r=>{
      const dia=+r.data.slice(8,10);
      const ent=(r.entrada||'').slice(0,5), sai=(r.saida||'').slice(0,5);
      const tKey=r.colab_moa_id||`${(r.trabalhador_nome||'').trim().toLowerCase()}`;
      const eKey=r.empresa_moa_id||r.empresa_moa_nome||'_sem';
      const dk=`${eKey}|${tKey}|${r.data}|${ent}|${sai}`;
      if(vistos.has(dk)) return; vistos.add(dk);
      if(!emps.has(eKey)) emps.set(eKey,{nome:r.empresa_moa_nome||'Sem empresa',trab:new Map(),lin:new Map()});
      const E=emps.get(eKey);
      if(!E.trab.has(tKey)) E.trab.set(tKey,{nome:r.trabalhador_nome||'—',funcao:r.trabalhador_funcao||'',dias:Array(nDias+1).fill(0),n:0,e:0});
      const T=E.trab.get(tKey);
      const h=calcH(ent,sai,new Date(r.data+'T12:00:00'));
      T.dias[dia]+=h.t; T.n+=h.n; T.e+=h.e;
      const oId=r.obra_id||'_sem', lKey=`${tKey}|${oId}`;
      if(!E.lin.has(lKey)) E.lin.set(lKey,{nome:T.nome,funcao:T.funcao,obraId:oId,h:0});
      E.lin.get(lKey).h+=h.t;
    });
    const empresas=[...emps.values()].sort((a,b)=>a.nome.localeCompare(b.nome,'pt')).map(E=>({
      nome:E.nome, trab:[...E.trab.values()].sort((a,b)=>a.nome.localeCompare(b.nome,'pt')), lin:[...E.lin.values()]
    }));
    _moaFecho={ano,mes,nDias,empresas,porAprovar};
    _moaFechoDesenhar();
  }catch(e){
    res.innerHTML=`<div class="card" style="text-align:center;color:var(--red);padding:24px;font-size:13px">⚠️ Erro ao carregar: ${_fEsc(e.message||e)}</div>`;
  }
}

function _moaFechoDesenhar(){
  const res=document.getElementById('moa-fecho-res'), F=_moaFecho;
  if(!res||!F) return;
  if(!F.empresas.length){ res.innerHTML='<div class="card" style="text-align:center;color:var(--gray-400);padding:24px;font-size:13px">Sem registos de mão de obra aluguer neste mês.</div>'; return; }
  const dias=Array.from({length:F.nDias},(_,i)=>i+1);
  const nw=d=>isNonWorkday(new Date(F.ano,F.mes-1,d,12));
  const th=dias.map(d=>`<th class="c"${nw(d)?' style="background:#eef1f7"':''}>${d}</th>`).join('');
  let totN=0,totE=0,nTrab=0;
  const corpo=F.empresas.map(E=>{
    const sN=E.trab.reduce((s,t)=>s+t.n,0), sE=E.trab.reduce((s,t)=>s+t.e,0);
    totN+=sN; totE+=sE; nTrab+=E.trab.length;
    const linhas=E.trab.map(t=>`<tr><td style="white-space:nowrap;padding-left:20px"><b>${_fEsc(t.nome)}</b>${t.funcao?`<small style="display:block;color:var(--gray-400)">${_fEsc(t.funcao)}</small>`:''}</td>`
      +dias.map(d=>`<td class="c"${nw(d)?' style="background:#f6f8fc"':''}>${_fFmt(t.dias[d])}</td>`).join('')
      +`<td class="r">${_fFmt(t.n)}</td><td class="r">${_fFmt(t.e)}</td><td class="r"><b>${_fFmt(t.n+t.e)}</b></td></tr>`).join('');
    return `<tr><td colspan="${F.nDias+4}" style="background:var(--d-tint,#eaf0fc);font-weight:700;padding:9px 20px">${_fEsc(E.nome)} · ${E.trab.length} trabalhador${E.trab.length!==1?'es':''} · ${_fFmt(sN+sE)||'0'} h</td></tr>${linhas}`;
  }).join('');
  const cats=[...new Set([...Object.keys(_TAXAS_BASE),...F.empresas.flatMap(E=>E.trab.map(t=>String(t.funcao||'').trim().toLowerCase())).filter(Boolean)])];
  const taxasHTML=`<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin:12px 2px 6px"><b style="font-size:13px">Preço/hora</b>${cats.map(c=>`<label style="font-size:12px;color:var(--gray-500);display:flex;align-items:center;gap:6px;text-transform:capitalize">${_fEsc(c)}<input type="number" step="0.5" min="0" value="${_fTaxa(c)}" onchange="moaFechoTaxa('${_fEsc(c).replace(/'/g,"\\'")}',this.value)" style="width:70px;padding:5px 8px;border:1.5px solid #b9c1ce;border-radius:10px;font-size:13px"> €</label>`).join('')}</div>`;
  const fechoHTML=F.empresas.map(E=>{
    const X=_fFechoEmpresa(E);
    return `<div style="margin:18px 0 6px;font-weight:700;font-size:14px">Fecho de valores · ${_fEsc(E.nome)}</div>
    <div class="tbl-wrap" style="overflow:auto"><table class="fm-t" style="width:100%;border-collapse:collapse;font-size:12.5px">
    <thead><tr><th style="text-align:left;padding-left:20px">Nome</th><th style="text-align:left">Categoria</th><th style="text-align:left">Obra</th><th class="r">Horas</th><th class="r">Valor</th></tr></thead><tbody>${
      X.linhas.map(l=>`<tr><td style="padding-left:20px"><b>${_fEsc(l.nome)}</b></td><td>${_fEsc(_fCat(l.funcao))}</td><td>${_fEsc(_fObraNome(l.obraId))}</td><td class="r">${_fFmt(l.h)}</td><td class="r">${_fEur(l.valor)}</td></tr>`).join('')
    }<tr style="font-weight:700;background:var(--d-tint,#eaf0fc)"><td colspan="3" style="padding-left:20px">Totais</td><td class="r">${_fFmt(X.totH)}</td><td class="r">${_fEur(X.totV)}</td></tr></tbody></table></div>
    <div class="tbl-wrap" style="overflow:auto;margin-top:10px"><table class="fm-t" style="width:100%;border-collapse:collapse;font-size:12.5px">
    <thead><tr><th style="text-align:left;padding-left:20px">Obra</th><th class="r">Total valor</th><th class="r">Percentagem</th></tr></thead><tbody>${
      X.resumo.map(o=>`<tr><td style="padding-left:20px">${_fEsc(o.nome)}</td><td class="r">${_fEur(o.valor)}</td><td class="r">${X.totV?(o.valor/X.totV*100).toFixed(2).replace('.',','):'0,00'}%</td></tr>`).join('')
    }<tr style="font-weight:700"><td style="padding-left:20px">Total</td><td class="r">${_fEur(X.totV)}</td><td class="r">100,00%</td></tr></tbody></table></div>`;
  }).join('');
  res.innerHTML=taxasHTML+`<div style="margin:10px 2px;font-size:13px;color:var(--gray-500)">${nTrab} trabalhador${nTrab!==1?'es':''} · Normais ${_fFmt(totN)||'0'} h · Extra ${_fFmt(totE)||'0'} h · <b>Total ${_fFmt(totN+totE)||'0'} h</b>`
    +(F.porAprovar?` · <span style="color:var(--orange,#ea580c)">⚠ ${F.porAprovar} dia(s) de obra por aprovar</span>`:'')+`</div>
    <div class="tbl-wrap" style="overflow:auto"><table class="fm-t" style="min-width:${F.nDias*34+360}px;width:100%;border-collapse:collapse;font-size:12.5px">
    <thead><tr><th style="text-align:left;padding-left:20px">Trabalhador</th>${th}<th class="r">Normais</th><th class="r">Extra</th><th class="r">Total</th></tr></thead><tbody>${corpo}</tbody></table></div>`+fechoHTML;
}

async function moaFechoExport(){
  if(!_moaFecho||!_moaFecho.empresas.length){ showToast('Carregue primeiro a folha do mês'); return; }
  const {ano,mes,nDias,empresas}=_moaFecho;
  const mesNome=MESES_PT[mes-1];
  showToast('A gerar ficheiro Excel…');
  const wb=new ExcelJS.Workbook(); wb.creator='Plandese SA';
  const nCols=nDias+5;
  const azul={type:'pattern',pattern:'solid',fgColor:{argb:'FF002060'}};
  const claro={type:'pattern',pattern:'solid',fgColor:{argb:'FFD9E1F2'}};
  const usados=new Set();
  empresas.forEach(E=>{
    let nome=E.nome.replace(/[\\/*?:\[\]]/g,' ').slice(0,28)||'Empresa', k=nome, i=2;
    while(usados.has(k.toLowerCase())) k=nome.slice(0,26)+' '+(i++);
    usados.add(k.toLowerCase());
    // Folha de fecho com valores (formato do Excel do subempreiteiro)
    {
      const X=_fFechoEmpresa(E), wf=wb.addWorksheet(('Fecho '+k).slice(0,31));
      wf.columns=[{width:3},{width:3},{width:3},{width:30},{width:16},{width:34},{width:12},{width:16},{width:14}];
      wf.getCell('G4').value='MÊS'; wf.getCell('H4').value=`${MESES_PT[mes-1].slice(0,3).toLowerCase()}/${String(ano).slice(2)}`;
      wf.getCell('E5').value='Folha Horas Colaboradores'; wf.getCell('E5').font={bold:true,size:14};
      wf.getCell('D9').value='Subempreiteiro:'; wf.getCell('E9').value=E.nome;
      const hr=wf.getRow(11); ['NOME','CATEGORIA','OBRA','HORAS','VALOR'].forEach((t,i)=>{const c=hr.getCell(4+i);c.value=t;c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill=azul;c.alignment={horizontal:'center'};});
      const eur='#,##0.00 "€"';
      X.linhas.forEach((l,i)=>{ const r=wf.getRow(12+i);
        r.getCell(4).value=l.nome; r.getCell(5).value=_fCat(l.funcao); r.getCell(6).value=_fObraNome(l.obraId);
        r.getCell(7).value=_fNum(l.h); r.getCell(8).value=_fNum(l.valor); r.getCell(8).numFmt=eur; });
      const rt=12+X.linhas.length, a=12, b=rt-1;
      wf.getCell(rt,6).value='Totais'; wf.getCell(rt,7).value={formula:`SUM(G${a}:G${b})`}; wf.getCell(rt,8).value={formula:`SUM(H${a}:H${b})`}; wf.getCell(rt,8).numFmt=eur;
      [6,7,8].forEach(c=>{wf.getCell(rt,c).font={bold:true};wf.getCell(rt,c).fill=claro;});
      const lg=rt+2;
      ['Legenda','','OBRAS','TOTAL VALOR','PERCENTAGEM'].forEach((t,i)=>{ if(t){const c=wf.getCell(lg,4+i);c.value=t;c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill=azul;} });
      const leg=Object.keys(_TAXAS_BASE).map(c=>`${c[0].toUpperCase()+c.slice(1)} = ${String(_fTaxa(c)).replace('.',',')}€/Hora`);
      X.resumo.forEach((o,i)=>{ const r=lg+1+i;
        if(leg[i]) wf.getCell(r,4).value=leg[i];
        wf.getCell(r,6).value=o.nome; wf.getCell(r,7).value=_fNum(o.valor); wf.getCell(r,7).numFmt=eur;
        wf.getCell(r,8).value={formula:`G${r}/H${rt}`}; wf.getCell(r,8).numFmt='0.00%'; });
      const rs=lg+1+X.resumo.length;
      wf.getCell(rs,7).value={formula:`SUM(G${lg+1}:G${rs-1})`}; wf.getCell(rs,7).numFmt=eur; wf.getCell(rs,7).font={bold:true};
      wf.getCell(rs,8).value=1; wf.getCell(rs,8).numFmt='0.00%'; wf.getCell(rs,8).font={bold:true};
    }
    const ws=wb.addWorksheet(k);
    ws.columns=[{width:30},{width:18},...Array(nDias).fill({width:5}),{width:10},{width:10},{width:10}];
    ws.mergeCells(1,1,1,nCols);
    const t=ws.getCell(1,1); t.value=`Folha de Fecho MOA — ${E.nome} — ${mesNome} ${ano} (01 a ${String(nDias).padStart(2,'0')})`;
    t.font={bold:true,size:13,color:{argb:'FF002060'}}; t.alignment={horizontal:'center',vertical:'middle'}; t.fill=claro;
    ws.getRow(1).height=22;
    const hdr=ws.getRow(2);
    hdr.values=['Trabalhador','Função',...Array.from({length:nDias},(_,i)=>i+1),'H. Normais','H. Extra','Total'];
    hdr.eachCell(c=>{c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill=azul;c.alignment={horizontal:'center',vertical:'middle'};});
    E.trab.forEach((tr,i)=>{
      const row=ws.getRow(i+3);
      row.values=[tr.nome,tr.funcao,...Array.from({length:nDias},(_,d)=>tr.dias[d+1]?_fNum(tr.dias[d+1]):null),_fNum(tr.n),_fNum(tr.e),_fNum(tr.n+tr.e)];
      row.eachCell({includeEmpty:true},(c,col)=>{
        if(col>2) c.alignment={horizontal:'center'};
        if(col>2&&col<=nDias+2&&isNonWorkday(new Date(ano,mes-1,col-2,12))) c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEEF1F7'}};
      });
      row.getCell(nCols).font={bold:true};
    });
    const tot=ws.getRow(E.trab.length+3), r0=3, r1=E.trab.length+2;
    const colL=n=>ws.getColumn(n).letter;
    tot.getCell(1).value=`TOTAL (${E.trab.length} trabalhadores)`;
    for(let c=3;c<=nCols;c++) tot.getCell(c).value={formula:`SUM(${colL(c)}${r0}:${colL(c)}${r1})`};
    tot.eachCell({includeEmpty:true},(c,col)=>{ if(col<=nCols){c.font={bold:true,color:{argb:'FF002060'}};c.fill=claro;c.alignment={horizontal:col>2?'center':'left'};} });
    ws.views=[{state:'frozen',xSplit:2,ySplit:2}];
  });
  const buf=await wb.xlsx.writeBuffer();
  const url=URL.createObjectURL(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const a=document.createElement('a'); a.href=url; a.download=`Folha_Fecho_MOA_${mesNome}_${ano}.xlsx`; a.click();
  URL.revokeObjectURL(url);
  showToast('✓ Ficheiro exportado!');
}

// ── MOA Admin — edição/anulação de um registo (popover) ─────────────────────
let _moaCurrent=null;   // {id, row} do registo aberto no popover
let _moaRowsIndex={};   // id → row, repovoado a cada render

document.addEventListener('mousedown', (e) => {
  if (!_moaCurrent) return;
  const pop = document.getElementById('moa-editor');
  if (pop && !pop.contains(e.target) && !e.target.closest('.moa-edit-btn')) _moaClosePopover();
});
document.addEventListener('scroll', () => { if (_moaCurrent) _moaClosePopover(); }, true);

// Mantido por compatibilidade (window.moaEditRow)
function moaEditRow(evt, id) {
  const row = _moaRowsIndex[id] || _moaCache?.rows.find(r => r.id === id);
  if (!row) return;
  evt.stopPropagation();
  _moaCurrent = { id, row, regs: [row] };
  _moaRenderPopover(evt.currentTarget);
}

function _moaRenderPopover(anchorEl) {
  const { row, regs } = _moaCurrent;
  _moaCurrent._anchor = anchorEl;
  let pop = document.getElementById('moa-editor');
  let chooser = '';
  if (regs && regs.length > 1) {
    chooser = `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:7px 8px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:#9a3412;margin-bottom:5px">⚠ ${regs.length} registos neste dia — escolha qual editar</div>
      <div style="display:flex;flex-direction:column;gap:4px">${regs.map((r, i) => {
        const sel = r === row;
        return `<button onclick="moaPickReg(${i})" style="text-align:left;padding:5px 8px;font-size:11px;font-family:var(--font);border:1px solid ${sel ? 'var(--blue-500,#3b82f6)' : 'var(--gray-200)'};background:${sel ? 'var(--blue-50,#eff6ff)' : 'var(--white)'};border-radius:6px;cursor:pointer">${r.encarregado_nome || '—'} · ${(r.entrada || '').slice(0, 5)}–${(r.saida || '').slice(0, 5)}</button>`;
      }).join('')}</div></div>`;
  }
  if (!pop) { pop = document.createElement('div'); pop.id = 'moa-editor'; document.body.appendChild(pop); }
  pop.innerHTML = `
    <div style="font-weight:700;color:var(--gray-900);margin-bottom:2px">${row.trabalhador_nome || ''}</div>
    <div style="font-size:11px;color:var(--gray-400);margin-bottom:10px">${fmtPT(row.data)} · ${row.empresa_moa_nome || ''}</div>
    ${chooser}
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <div style="flex:1"><label style="font-size:10px;color:var(--gray-500);display:block;margin-bottom:3px">Entrada</label>
        <input type="time" id="moa-entrada" style="width:100%;padding:6px 8px;font-size:13px;border:1px solid var(--gray-200);border-radius:6px;font-family:var(--font)"/></div>
      <div style="flex:1"><label style="font-size:10px;color:var(--gray-500);display:block;margin-bottom:3px">Saída</label>
        <input type="time" id="moa-saida" style="width:100%;padding:6px 8px;font-size:13px;border:1px solid var(--gray-200);border-radius:6px;font-family:var(--font)"/></div>
    </div>
    <div id="moa-audit" style="font-size:10px;color:var(--gray-400);margin-bottom:10px;display:none"></div>
    <div style="display:flex;gap:6px">
      <button class="btn btn-primary btn-sm" style="flex:1;justify-content:center" onclick="moaSaveRow()">Guardar</button>
      <button class="btn btn-secondary btn-sm" onclick="_moaClosePopover()">Cancelar</button>
    </div>
    <button class="btn btn-sm" style="width:100%;justify-content:center;margin-top:6px;background:var(--red);color:#fff" onclick="moaAnularRow(event)">Apagar registo</button>
  `;
  document.getElementById('moa-entrada').value = row.entrada?.slice(0, 5) || '';
  document.getElementById('moa-saida').value = row.saida?.slice(0, 5) || '';
  const auditEl = document.getElementById('moa-audit');
  if (row.editado_por) {
    auditEl.style.display = 'block';
    const dt = row.editado_em ? new Date(row.editado_em).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    auditEl.textContent = `Editado por ${row.editado_por}${dt ? ' em ' + dt : ''}`;
  } else auditEl.style.display = 'none';
  pop.style.cssText = 'display:block;position:fixed;z-index:1500;background:var(--white);border:1px solid var(--gray-200);border-radius:var(--radius-lg);box-shadow:0 8px 28px rgba(0,0,0,.2);padding:14px;width:230px;font-size:13px';
  const rect = anchorEl.getBoundingClientRect();
  const maxLeft = window.innerWidth - 246;
  const left = Math.max(8, Math.min(rect.left, maxLeft));
  let top = rect.bottom + 6;
  if (top + 220 > window.innerHeight) top = Math.max(8, rect.top - 226);
  pop.style.top = top + 'px';
  pop.style.left = left + 'px';
}

function _moaClosePopover() {
  const pop = document.getElementById('moa-editor');
  if (pop) pop.style.display = 'none';
  _moaCurrent = null;
}

async function moaSaveRow() {
  if (!_moaCurrent) return;
  const entrada = document.getElementById('moa-entrada').value || null;
  const saida = document.getElementById('moa-saida').value || null;
  try {
    const { error } = await sb.from('registos_ponto_moa').update({
      entrada, saida,
      editado_por: S.currentUser?.nome || S.currentUser?.key || '—',
      editado_em: new Date().toISOString(),
    }).eq('id', _moaCurrent.id);
    if (error) throw error;
    showToast('Registo atualizado ✓');
    _moaClosePopover();
    await loadMOAWeek();
  } catch (e) {
    showToast('Erro ao guardar: ' + (e.message || e));
  }
}

// Dois cliques em vez de confirm(): os diálogos nativos são bloqueados em alguns
// ecrãs/webviews e o botão parecia "não fazer nada".
async function moaAnularRow(evt) {
  if (!_moaCurrent) return;
  const btn = evt?.currentTarget;
  if (btn && btn.dataset.armado !== '1') {
    btn.dataset.armado = '1';
    btn.textContent = 'Clique de novo para apagar mesmo';
    setTimeout(() => { if (btn.isConnected) { btn.dataset.armado = ''; btn.textContent = 'Apagar registo'; } }, 4000);
    return;
  }
  try {
    const { data, error } = await sb.from('registos_ponto_moa').delete().eq('id', _moaCurrent.id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('nenhum registo foi apagado (já não existe ou sem permissão)');
    showToast('Registo apagado');
    _moaClosePopover();
    await loadMOAWeek();
  } catch (e) {
    showToast('Erro ao apagar: ' + (e.message || e));
  }
}

async function initMOAFilters(){
  // Semana atual por omissão (igual à MO Plandese)
  const fs=document.getElementById('moa-f-semana');
  if(fs&&!fs.value) fs.value=fmt(new Date());
  // Registar trabalhadores: admin e diretores de obra (o encarregado regista na app dele)
  const btnReg=document.getElementById('moa-btn-registar');
  if(btnReg) btnReg.style.display=['admin','diretor_obra'].includes(S.currentUser?.role)?'':'none';
  // Preencher empresas no filtro do admin
  const es=document.getElementById('moa-f-empresa');
  if(es){
    es.innerHTML='<option value="">Todas</option>';
    EMPRESAS_MOA.filter(e=>e.ativa!==false).forEach(emp=>{const op=document.createElement('option');op.value=emp.id;op.textContent=emp.nome;es.appendChild(op);});
  }
  // Preencher obras no filtro admin
  const os=document.getElementById('moa-f-obra');
  if(os){
    os.innerHTML='<option value="">Todas</option>';
    S.OBRAS.filter(o=>obraEmCurso(o)&&obraVisivelPara(S.currentUser,S.OBRAS,o.id)).forEach(o=>{const op=document.createElement('option');op.value=o.id;op.textContent=o.nome;os.appendChild(op);});
  }
}

export {
  loadEmpresasMOA, loadColaboradoresMOA, removeColabMOA,
  moaTrabAbrir, moaTrabEmpresaChange, moaTrabFuncaoChange, moaTrabFotoChange, moaTrabFotoRemover, moaTrabGuardar,
  renderEmpresasMOA, editEmpresaMOA, saveEmpresaMOA, toggleEmpresaMOA,
  encAlugPassarTrabalhadores, encAlugVoltarA, encAlugAddTrabalhador,
  buildAlugList, adicionarTodosAnteriorAlug, carregarEquipaAnteriorAlug, encAlugSetHora, encAlugRemover, encAlugUpdateStats, encAlugSubmeter,
  applyMOAFilter, navMOASemana, loadMOAWeek, renderMOAResultado, exportMOAExcel, initMOAFilters,
  moaFechoInit, moaFechoCarregar, moaFechoExport, moaFechoTaxa,
  moaEditRow, moaSaveRow, moaAnularRow, _moaClosePopover,
  moaEditCell, moaPickReg, moaSelectDia, moaAbrirResumo, aprovarDiaMOA, retirarAprovacaoMOA
};
