// ═══════════════════════════════════════
//  ALUGUER MOA — Encarregado e Admin MOA
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S, R } from '../state.js';
import { fmt, fmtPT, calcH, fmtH, getMonday, isWeekend } from '../utils/helpers.js';
import { podeAprovarObra, aprovCelulaHTML } from './ponto.js';
import { showToast } from './navigation.js';

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

function renderEmpresasMOA(){
  const cont=document.getElementById('empresas-moa-list');
  if(!cont) return;
  cont.innerHTML='';
  if(!EMPRESAS_MOA.length){
    cont.innerHTML='<div class="card" style="text-align:center;color:var(--gray-400);padding:32px">Nenhuma empresa criada. Clique em "Nova empresa".</div>';
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
  // Pré-carregar colaboradores registados da empresa selecionada
  const colabsPreDef=(COLABORADORES_MOA[empresaId]||[]);
  encAlugTrabalhadores=colabsPreDef.map(c=>_novoTrab(c));
  // Atualizar resumo
  const obraNome=S.OBRAS.find(o=>o.id===obraId)?.nome||'—';
  const [y,m,d]=data.split('-');
  document.getElementById('enc-alug-resumo-empresa').textContent=empresaNome;
  document.getElementById('enc-alug-resumo-info').textContent=`${obraNome}  ·  ${d}/${m}/${y}  ·  ${ini} – ${fim}`;
  document.getElementById('enc-alug-screen-a').style.display='none';
  const screenB=document.getElementById('enc-alug-screen-b');
  screenB.style.display='flex'; screenB.style.flexDirection='column';
  buildAlugList();
}

function encAlugVoltarA(){
  document.getElementById('enc-alug-screen-a').style.display='block';
  const screenB=document.getElementById('enc-alug-screen-b');
  screenB.style.display='none';
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
  sel.innerHTML=`<option value="">${disp.length?'— Selecione o trabalhador —':'Todos os registados já estão na lista'}</option>`+
    disp.map(c=>`<option value="${c.id}">${c.nome}${c.funcao?' · '+c.funcao:''}</option>`).join('');
}

function encAlugAddTrabalhador(){
  const sel=document.getElementById('enc-alug-sel-trab');
  const c=(COLABORADORES_MOA[encAlugEmpresaId]||[]).find(x=>x.id===sel?.value);
  if(!c){showToast('Selecione um trabalhador ou registe um novo');return;}
  encAlugTrabalhadores.push(_novoTrab(c));
  buildAlugList();
}

function buildAlugList(){
  const cont=document.getElementById('enc-alug-list'); cont.innerHTML='';
  if(!encAlugTrabalhadores.length){
    cont.innerHTML='<div style="text-align:center;padding:32px 16px;color:var(--gray-400);font-size:14px">Adicione trabalhadores acima para iniciar o registo.</div>';
    encAlugUpdateStats([]);_fillEncTrabSel();return;
  }
  // Separador informativo quando há colaboradores pré-carregados
  const temPreDef=(COLABORADORES_MOA[encAlugEmpresaId]||[]).length>0;
  if(temPreDef){
    const sep=document.createElement('div');
    sep.style.cssText='font-size:11px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.5px;padding:8px 4px 4px;display:flex;align-items:center;gap:6px';
    sep.innerHTML=`<svg viewBox="0 0 24 24" fill="currentColor" style="width:13px;height:13px"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg> Lista pré-carregada · remova os ausentes`;
    cont.appendChild(sep);
  }
  const dateObj=new Date(encAlugData+'T12:00:00');
  const cards=encAlugTrabalhadores.map(t=>{
    const h=calcH(t.entrada,t.saida,dateObj);
    const card=document.createElement('div');
    card.className='mob-colab-card';
    card.innerHTML=`
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        ${_moaAvatarHTML(t,36)}
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:700;color:var(--gray-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.nome}</div>
          ${t.funcao?`<div style="font-size:11px;color:#7c3aed;font-weight:500;margin-bottom:1px">${t.funcao}</div>`:''}
          <div class="mob-horas" id="alug-horas-${t.id}">${h.t>0?`<span class="mob-horas-n">${fmtH(h.n)}</span>${h.e>0?` +<span class="mob-horas-e">${fmtH(h.e)}E</span>`:''}` : '<span style="color:var(--gray-300)">—</span>'}</div>
        </div>
        <button onclick="encAlugRemover(${t.id})" style="padding:4px 8px;background:#fee2e2;border:none;border-radius:6px;color:#b91c1c;font-size:11px;font-weight:600;cursor:pointer">✕ Remover</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--gray-500);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Entrada</div>
          <input type="time" value="${t.entrada}" class="enc-input enc-time" style="width:100%;font-size:13px;padding:6px 10px" onchange="encAlugSetHora(${t.id},'entrada',this.value)"/>
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--gray-500);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Saída</div>
          <input type="time" value="${t.saida}" class="enc-input enc-time" style="width:100%;font-size:13px;padding:6px 10px" onchange="encAlugSetHora(${t.id},'saida',this.value)"/>
        </div>
      </div>`;
    return card;
  });
  cards.forEach(c=>cont.appendChild(c));
  encAlugUpdateStats(encAlugTrabalhadores);
  _fillEncTrabSel();
  _moaCarregarFotos(cont);
}

function encAlugSetHora(id,campo,val){
  const t=encAlugTrabalhadores.find(x=>x.id===id);
  if(!t)return;
  t[campo]=val;
  const dateObj=new Date(encAlugData+'T12:00:00');
  const h=calcH(t.entrada,t.saida,dateObj);
  const hEl=document.getElementById(`alug-horas-${id}`);
  if(hEl) hEl.innerHTML=h.t>0?`<span class="mob-horas-n">${fmtH(h.n)}</span>${h.e>0?` +<span class="mob-horas-e">${fmtH(h.e)}E</span>`:''}` : '<span style="color:var(--gray-300)">—</span>';
  encAlugUpdateStats(encAlugTrabalhadores);
}

function encAlugRemover(id){
  encAlugTrabalhadores=encAlugTrabalhadores.filter(t=>t.id!==id);
  buildAlugList();
}

function encAlugUpdateStats(lista){
  const dateObj=new Date(encAlugData+'T12:00:00');
  let tn=0,te=0,tt=0;
  lista.forEach(t=>{const h=calcH(t.entrada,t.saida,dateObj);tn+=h.n;te+=h.e;tt+=h.t;});
  document.getElementById('alug-st-p').textContent=lista.length;
  document.getElementById('alug-st-n').textContent=fmtH(tn)||'0h';
  document.getElementById('alug-st-e').textContent=fmtH(te)||'0h';
  document.getElementById('alug-st-t').textContent=fmtH(tt)||'0h';
}

async function encAlugSubmeter(){
  if(!encAlugTrabalhadores.length){showToast('Adicione pelo menos um trabalhador');return;}
  const btn=document.querySelector('#enc-alug-screen-b .mob-save-btn');
  if(btn){btn.disabled=true;btn.textContent='A guardar…';}
  try{
    const rows=encAlugTrabalhadores.map(t=>({
      data:encAlugData,
      empresa_moa_id:encAlugEmpresaId,
      empresa_moa_nome:encAlugEmpresaNome,
      trabalhador_nome:t.nome,
      trabalhador_funcao:t.funcao||null,
      colab_moa_id:t.colabId||null,
      obra_id:encAlugObraId,
      entrada:t.entrada,
      saida:t.saida,
      encarregado_nome:S.currentUser?.nome||'',
      criado_em:new Date().toISOString()
    }));
    const {error}=await sb.from('registos_ponto_moa').insert(rows);
    if(error)throw error;
    showToast(`✓ ${encAlugTrabalhadores.length} registo(s) guardado(s)!`);
    setTimeout(()=>encVoltarHome(),1500);
  }catch(e){
    showToast('Erro ao guardar: '+(e.message||e));
    if(btn){btn.disabled=false;btn.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> Submeter registo';}
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
let _mmtFotoBlob=null, _mmtDoEnc=false;

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
function moaTrabAbrir(doEnc, empId){
  _mmtDoEnc=!!doEnc;
  _mmtFotoBlob=null;
  ['mmt-nome','mmt-funcao-outra','mmt-empresa-nova'].forEach(id=>{document.getElementById(id).value='';});
  _mmtFillFuncoes();
  document.getElementById('mmt-foto').value='';
  moaTrabFotoRemover();
  _mmtFillEmpresas(doEnc?encAlugEmpresaId:(empId||''));
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
    if(panel) _renderColabsPanelMOA(empId,panel); else if(document.getElementById('empresas-moa-list')) renderEmpresasMOA();
    // No ecrã do encarregado, o trabalhador entra logo no registo do dia (se for da empresa em curso)
    if(_mmtDoEnc){
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
let _moaCellIndex={};   // cellKey → [registos]
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
  res.innerHTML='<div style="text-align:center;color:var(--gray-400);padding:32px;font-size:13px">A carregar...</div>';
  let rows, aprovRows;
  try{
    let q=sb.from('registos_ponto_moa').select('*').gte('data',dStrs[0]).lte('data',dStrs[6]);
    if(empresaFil) q=q.eq('empresa_moa_id',empresaFil);
    if(obraFil) q=q.eq('obra_id',obraFil);
    const [r1,r2]=await Promise.all([q, sb.from('aprovacoes_ponto_moa').select('*').in('data',dStrs)]);
    if(r1.error) throw r1.error;
    rows=r1.data||[]; aprovRows=r2.data||[];
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
  const dir=S.OBRAS.find(o=>o.id===obraId)?.diretor_id;
  const nomeDir=dir?(S.USERS?.[dir]?.nome||dir):'sem diretor atribuído';
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
  _moaCellIndex={}; _moaClosePopover();

  let nDias=0,nAprov=0;
  Object.keys(obraMap).filter(id=>id!=='_sem').forEach(id=>dStrs.forEach((ds,i)=>{
    if(!Object.values(obraMap[id]).some(t=>t.cells[i].length)) return;
    nDias++; if(aprov[_moaAprovKey(id,ds)]) nAprov++;
  }));
  document.getElementById('moa-week-sub').textContent=nDias?`${nAprov}/${nDias} dias de obra aprovados pelo diretor de obra`:'—';

  res.innerHTML='';
  if(document.body.classList.contains('device-mobile')){ _moaDrawMobile(res); _moaCarregarFotos(res); return; }

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
      const bg=isWeekend(d)?'#C2410C':'var(--blue-600)';
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
        <td style="font-weight:500;font-size:13px;white-space:nowrap"><div style="display:flex;align-items:center;gap:8px">${_moaAvatarHTML(tv,24)}<span>${t.nome}</span></div></td>
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
    R.emitEvent?.({acao:`Folha de ponto MO Aluguer aprovada: ${obraNome} · ${fmtPT(ds)}`,seccao:'historico'});
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
    R.emitEvent?.({acao:`Aprovação da MO Aluguer retirada: ${obraNome} · ${fmtPT(ds)}`,seccao:'historico'});
    await loadMOAWeek();
  }catch(e){ showToast('Erro ao retirar aprovação: '+(e.message||e)); }
}

function renderMOAResultado(){ _moaDraw(); }

function exportMOAExcel(){showToast('Exportação Excel MOA em breve!');}

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
    <button class="btn btn-sm" style="width:100%;justify-content:center;margin-top:6px;background:var(--red);color:#fff" onclick="moaAnularRow()">Apagar registo</button>
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

async function moaAnularRow() {
  if (!_moaCurrent) return;
  const r = _moaCurrent.row;
  if (!confirm(`APAGAR o registo de ${r?.trabalhador_nome || 'este trabalhador'} em ${fmtPT(r?.data)}? Deixa de aparecer na folha de ponto e não pode ser recuperado.`)) return;
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
    S.OBRAS.filter(o=>o.ativa).forEach(o=>{const op=document.createElement('option');op.value=o.id;op.textContent=o.nome;os.appendChild(op);});
  }
}

export {
  loadEmpresasMOA, loadColaboradoresMOA, removeColabMOA,
  moaTrabAbrir, moaTrabEmpresaChange, moaTrabFuncaoChange, moaTrabFotoChange, moaTrabFotoRemover, moaTrabGuardar,
  renderEmpresasMOA, editEmpresaMOA, saveEmpresaMOA, toggleEmpresaMOA,
  encAlugPassarTrabalhadores, encAlugVoltarA, encAlugAddTrabalhador,
  buildAlugList, encAlugSetHora, encAlugRemover, encAlugUpdateStats, encAlugSubmeter,
  applyMOAFilter, navMOASemana, loadMOAWeek, renderMOAResultado, exportMOAExcel, initMOAFilters,
  moaEditRow, moaSaveRow, moaAnularRow, _moaClosePopover,
  moaEditCell, moaPickReg, moaSelectDia, aprovarDiaMOA, retirarAprovacaoMOA
};
