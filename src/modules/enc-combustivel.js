// ════════════════════════════════════════════════
//  COMBUSTÍVEL — Encarregado (depósito + viatura + compras)
// ════════════════════════════════════════════════
import { sb } from '../supabase.js';
import { S, R } from '../state.js';
import { fmt, fmtPT } from '../utils/helpers.js';
import { showToast } from './navigation.js';
import { EQUIPAMENTOS, EQ_CATS, eqCatNorm, eqCatIsVeiculo, sbFetchEquipamentoById, sbLoadEquipamentos, saveEqLocal, eqFmtDt } from './equipamentos.js';
import { obraEmCurso } from '../config.js';
import { comprasIAAbrir } from './enc-agente-ia.js';

let _combEqOpts = new Map();
let _combPickerCat = '';

// Lista de equipamentos para o registo manual: guarda em _combEqOpts o texto
// mostrado no campo → equipamento (o submit usa este mapa para obter o id)
function _combFillListaEquip(){
  const lista=EQUIPAMENTOS.slice().sort((a,b)=>a.nome.localeCompare(b.nome,'pt'));
  const cont={}; lista.forEach(e=>{cont[e.nome]=(cont[e.nome]||0)+1;});
  _combEqOpts=new Map();
  lista.forEach(e=>{
    let value=cont[e.nome]>1?`${e.nome} · ${e.ultimoLocal||'#'+e.id.slice(-4)}`:e.nome;
    if(_combEqOpts.has(value)) value+=` #${e.id.slice(-4)}`;
    _combEqOpts.set(value,e);
  });
  if(!document.getElementById('comb-picker')?.hidden) combPickerRender();
}

// ── Seletor em página inteira ──
const _norm = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const _escH = s => String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

let _combPickerOnSelect = null;
function combAbrirPicker(onSelect){
  _combPickerOnSelect = onSelect || (value=>{ document.getElementById('comb-viatura-nome-input').value=value; _cntSyncViatura(); });
  const pk=document.getElementById('comb-picker');
  pk.hidden=false;
  const q=document.getElementById('comb-picker-q');
  q.value=''; _combPickerCat='';
  combPickerRender();
  setTimeout(()=>q.focus(),50);
}
function combFecharPicker(){
  document.getElementById('comb-picker').hidden=true;
}
function combPickerSetCat(cat){ _combPickerCat=cat; combPickerRender(); }
function combPickerEscolher(value){
  (_combPickerOnSelect||(()=>{}))(value);
  combFecharPicker();
}
function combPickerUsarTexto(){
  const t=document.getElementById('comb-picker-q').value.trim();
  if(t) combPickerEscolher(t);
}

function combPickerRender(){
  const itens=[..._combEqOpts.entries()];
  const cats=[...new Set(itens.map(([,e])=>e.categoria).filter(Boolean))];
  document.getElementById('comb-picker-chips').innerHTML=cats.length>1
    ? [['','Todos'],...cats.map(c=>[c,(EQ_CATS[c]?.label||c)+'s'])].map(([c,l])=>
        `<button type="button" class="comb-picker-chip" aria-pressed="${_combPickerCat===c}" onclick="combPickerSetCat('${c}')">${_escH(l)}</button>`).join('')
    : '';
  // Cada palavra pesquisada tem de aparecer (em qualquer ordem) — ex.: "lagos sy35"
  const termos=_norm(document.getElementById('comb-picker-q').value).split(/\s+/).filter(Boolean);
  const res=itens.filter(([v,e])=>{
    if(_combPickerCat && e.categoria!==_combPickerCat) return false;
    const txt=_norm([v,e.nome,e.matricula,e.marcaModelo,e.ultimoLocal,e.numero,e.codigo].join(' '));
    return termos.every(t=>txt.includes(t));
  });
  document.getElementById('comb-picker-count').textContent=`${res.length} de ${itens.length}`;
  const atual=document.getElementById('comb-viatura-nome-input').value;
  const textoLivre=document.getElementById('comb-picker-q').value.trim();
  document.getElementById('comb-picker-list').innerHTML=
    res.map(([v,e])=>{
      const sub=[e.matricula,e.marcaModelo,e.ultimoLocal].filter(Boolean).join(' · ');
      return `<button type="button" class="comb-picker-item${v===atual?' sel':''}" data-v="${_escH(v)}">
        <span class="comb-picker-ic">${_escH((EQ_CATS[eqCatNorm(e.categoria)].label).charAt(0))}</span>
        <span class="comb-picker-tx"><b>${_escH(v)}</b>${sub?`<small>${_escH(sub)}</small>`:''}</span>
      </button>`;
    }).join('')
    + (textoLivre && !res.some(([v])=>_norm(v)===_norm(textoLivre))
      ? `<button type="button" class="comb-picker-item comb-picker-livre" onclick="combPickerUsarTexto()"><span class="comb-picker-ic">+</span><span class="comb-picker-tx"><b>Usar “${_escH(textoLivre)}”</b><small>Não está na lista — registar com este nome</small></span></button>`
      : '')
    + (!res.length && !textoLivre ? '<div class="comb-picker-empty">Sem equipamentos para mostrar.</div>' : '');
}

// Clique num item (delegado: os valores podem ter aspas/apóstrofos)
document.addEventListener('click',e=>{
  const it=e.target.closest('#comb-picker-list .comb-picker-item[data-v]');
  if(it) combPickerEscolher(it.dataset.v);
});

let _depMovimento = 'entrada';
// ── Horas / km do equipamento no momento do abastecimento ──
// Veículo → quilómetros; máquina (e restantes) → horas. Equipamento desconhecido → o utilizador escolhe.
function _cntTipoDe(eq){ return !eq?null:(eqCatIsVeiculo(eq.categoria)?'km':'horas'); }
function _cntAplicar(p, ativo, eq){
  const wrap=document.getElementById(p+'-cnt-wrap'); if(!wrap) return;
  wrap.style.display=ativo?'block':'none';
  if(!ativo) return;
  const tipo=_cntTipoDe(eq);
  wrap.dataset.tipo=tipo||'';
  const un=document.getElementById(p+'-cnt-un');
  un.style.display=tipo?'none':'';
  un.parentElement.style.gridTemplateColumns=tipo?'1fr':'1fr auto';
  const lbl=tipo==='km'?'Quilómetros':tipo==='horas'?'Horas de trabalho':'Horas ou km';
  document.getElementById(p+'-cnt-label').innerHTML=lbl+' <span style="font-weight:400;color:var(--gray-400)">(opcional)</span>';
}
function _cntLer(p){
  const wrap=document.getElementById(p+'-cnt-wrap');
  const v=parseFloat(document.getElementById(p+'-cnt').value);
  if(!wrap||wrap.style.display==='none'||!Number.isFinite(v)||v<0) return {};
  const tipo=wrap.dataset.tipo||document.getElementById(p+'-cnt-un').value;
  return {contador_valor:v, contador_tipo:tipo};
}
function _cntLimpar(p){ const i=document.getElementById(p+'-cnt'); if(i) i.value=''; }
function _cntSyncViatura(){
  let eq=null, ativo=true;
  if(_combModoManual){
    const nome=document.getElementById('comb-viatura-nome-input').value.trim();
    eq=_combEqOpts.get(nome)||null;
    ativo=!!nome;
  } else {
    eq=EQUIPAMENTOS.find(e=>e.id===_combQrEquipId)||null;
  }
  _cntAplicar('comb-viatura', ativo, eq);
}

let _depEquip = null;   // {id, nome} — equipamento que recebeu o combustível (só em saída)
let _depHtml5Qr = null;
let _combHtml5Qr = null;
let _combQrEquipId = null;
let _combModoManual = false;

function _encHideAll(){
  ['enc-screen0','enc-screen1','enc-screen2','enc-screen-equip','enc-screen-aluguer','enc-screen-historico-enc','enc-screen-combustivel','enc-screen-comb-deposito','enc-screen-comb-viatura','enc-screen-comb-ultimos','enc-screen-comb-aprovar',
   'enc-screen-compras-chat','enc-screen-ponto-ia'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.style.display='none';
  });
}

// ── Depósito de Obra ────────────────────────────

// Filtros PostgREST (.or): registos cujo DEPÓSITO é uma destas obras (sem depósito registado, vale a obra do registo),
// ou que têm a obra como destino (centro de custo)
const _orDeposito=ids=>{ const l=ids.join(','); return `deposito_obra_id.in.(${l}),and(deposito_obra_id.is.null,obra_id.in.(${l}))`; };
const _orDepOuDestino=ids=>{ const l=ids.join(','); return `deposito_obra_id.in.(${l}),obra_id.in.(${l})`; };
// Stock: movimentos do depósito + transferências recebidas (obra de destino)
const _orStock=ids=>_orDeposito(ids)+`,and(tipo_registo.eq.transferencia,obra_id.in.(${ids.join(',')}))`;
// Efeito de um registo no stock das obras dadas (transferência: sobe no destino, desce na origem)
function _stockDelta(r,ids){
  const l=parseFloat(r.litros)||0;
  if(r.tipo_registo==='transferencia') return (ids.includes(r.obra_id)?l:0)-(ids.includes(r.deposito_obra_id)?l:0);
  return (r.tipo_registo==='viatura'||r.movimento==='saida')?-l:l;
}

// Cartão da home: litros de gasóleo em stock no(s) depósito(s) da(s) obra(s) do encarregado
function _encObrasComb(){
  const username=S.currentUser?.key;
  return S.OBRAS.filter(o=>obraEmCurso(o)&&(o.encarregado_id===username||(o.encarregados_extra||[]).includes(username)));
}

// Código de acesso do QR (registo de gasóleo fora da app) das obras deste encarregado, no cabeçalho do início
async function encUpdateCodigosWidget(){
  const box=document.getElementById('e-hdr-cod'); if(!box) return;
  const obras=_encObrasComb();
  if(!obras.length){ box.hidden=true; return; }
  try{
    const {data,error}=await sb.from('obra_codigos').select('obra_id,codigo').in('obra_id',obras.map(o=>o.id));
    if(error) throw error;
    const porObra=new Map((data||[]).map(r=>[r.obra_id,r.codigo]));
    const lista=obras.filter(o=>porObra.has(o.id));
    if(!lista.length){ box.hidden=true; return; }
    // Uma obra: só o código. Várias: cada código com o nº da obra (ex.: "O064 K7M2QX")
    box.dataset.cod=lista.map(o=>porObra.get(o.id)).join(' ');
    box.innerHTML='<small>Código QR Code</small>'+lista.map(o=>{
      const n=(String(o.nome).match(/^O\d+/)||[''])[0];
      return `<b>${lista.length>1&&n?_escH(n)+' ':''}${_escH(porObra.get(o.id))}</b>`;
    }).join('');
    box.hidden=false;
  }catch(e){ console.warn('codigos QR:',e); box.hidden=true; }
}
function encCopiarCodigo(btn){
  const cod=btn.dataset.cod||'';
  const s=btn.querySelector('small'), antes=s?.textContent;
  const ok=()=>{ if(s){ s.textContent='Copiado ✓'; setTimeout(()=>{s.textContent=antes;},1500); } };
  try{ navigator.clipboard.writeText(cod).then(ok,()=>{}); }catch(e){ /* sem clipboard */ }
}
window.encCopiarCodigo=encCopiarCodigo;

async function encUpdateFuelWidget(){
  encUpdateCodigosWidget();
  encCombAtualizarBadgeApr();
  const litrosEl=document.getElementById('enc-fuel-litros');
  const labelEl=document.getElementById('enc-fuel-label');
  if(!litrosEl||!labelEl) return;
  const obras=_encObrasComb();
  litrosEl.classList.remove('neg');
  if(!obras.length){litrosEl.textContent='—';labelEl.textContent='sem obra atribuída';return;}
  const nomeObra=obras.length===1?obras[0].nome:obras.length+' obras';
  try{
    const {data,error}=await sb.from('registos_combustivel')
      .select('litros,movimento,tipo_registo,obra_id,deposito_obra_id')
      .eq('aprovacao','aprovado')
      .or(_orStock(obras.map(o=>o.id)))
      .or('tipo_combustivel.eq.Gasóleo,tipo_combustivel.is.null');
    if(error) throw error;
    // Stock = entradas no depósito − saídas (saídas do depósito + abastecimentos de viaturas)
    const ids=obras.map(o=>o.id);
    const stock=(data||[]).reduce((s,r)=>s+_stockDelta(r,ids),0);
    litrosEl.textContent=stock.toLocaleString('pt-PT',{maximumFractionDigits:1})+' L';
    litrosEl.classList.toggle('neg',stock<0);
    labelEl.textContent='Gasóleo · '+nomeObra;
  }catch(e){
    console.warn('fuel widget:',e);
    litrosEl.textContent='—';
    labelEl.textContent='Gasóleo · indisponível';
  }
}

function depSetMovimento(tipo){
  _depMovimento = tipo;
  const cor={entrada:['#22c55e','rgba(34,197,94,'],saida:['#ef4444','rgba(239,68,68,'],transferencia:['#0369a1','rgba(3,105,161,']};
  ['entrada','saida','transferencia'].forEach(k=>{
    const b=document.getElementById('dep-btn-'+k); if(!b) return;
    const on=k===tipo;
    b.style.background=on?cor[k][0]:'#f3f4f6'; b.style.borderColor=on?cor[k][0]:'#d1d5db'; b.style.color=on?'white':'#6b7280';
    b.style.boxShadow=on?'0 0 0 4px '+cor[k][1]+'.3),0 4px 12px '+cor[k][1]+'.4)':'none'; b.style.transform=on?'scale(1.02)':'scale(1)';
  });
  const tr=tipo==='transferencia';
  const wrap=document.getElementById('dep-equip-wrap');
  if(wrap) wrap.style.display = tipo==='saida' ? 'block' : 'none';
  const dw=document.getElementById('dep-dest-wrap');
  if(dw) dw.style.display = (tipo==='saida'||tr) ? 'block' : 'none';
  const dl=document.getElementById('dep-dest-label'); if(dl) dl.textContent=tr?'Obra de destino (vai levar o gasóleo)':'Obra de destino (centro de custo)';
  const d0=document.querySelector('#dep-dest option[value=""]'); if(d0) d0.textContent=tr?'— Selecione a obra de destino —':'— Igual ao depósito —';
  const ol=document.getElementById('dep-obra-label'); if(ol) ol.textContent=tr?'Obra de origem (de onde sai o gasóleo)':'Depósito (obra onde está o depósito)';
  const nota=document.getElementById('dep-transf-nota'); if(nota) nota.style.display=tr?'block':'none';
  if(tipo!=='saida'){ _depEquip=null; _depRenderEquipEscolhido(); }
}

// ── Equipamento associado à saída do depósito (QR ou lista) ──
// Obra onde o equipamento está registado (obra associada, ou pelo nome do último local)
function _obraDoEquip(equipId){
  const eq=EQUIPAMENTOS.find(e=>e.id===equipId); if(!eq) return '';
  if(eq.obraId) return eq.obraId;
  const o=S.OBRAS.find(x=>x.nome===eq.ultimoLocal);
  return o?o.id:'';
}
// Pré-seleciona a obra do equipamento num <select> (se estiver vazio e a obra constar da lista)
function _preObraEquip(selId, equipId){
  const sel=document.getElementById(selId); if(!sel||sel.value) return;
  const id=_obraDoEquip(equipId);
  if(id && [...sel.options].some(o=>o.value===id)) sel.value=id;
}
function _depRenderEquipEscolhido(){
  const chosen=document.getElementById('dep-equip-chosen');
  const choice=document.getElementById('dep-equip-choice');
  if(!chosen||!choice) return;
  if(_depEquip){
    document.getElementById('dep-equip-chosen-nome').textContent=_depEquip.nome;
    chosen.style.display='flex';
    choice.style.display='none';
  } else {
    chosen.style.display='none';
    choice.style.display='flex';
  }
  _cntAplicar('dep', !!_depEquip, _depEquip?(EQUIPAMENTOS.find(e=>e.id===_depEquip.id)||null):null);
  if(_depEquip&&_depEquip.id) _preObraEquip('dep-dest',_depEquip.id);
}
function depTrocarEquip(){ _depEquip=null; _depRenderEquipEscolhido(); }

function depAbrirPickerEquip(){
  _combFillListaEquip();
  sbLoadEquipamentos().then(_combFillListaEquip).catch(()=>{});
  combAbrirPicker(value=>{
    const escolhido=_combEqOpts.get(value);
    _depEquip = escolhido ? {id:escolhido.id, nome:escolhido.nome} : {id:null, nome:value};
    _depRenderEquipEscolhido();
  });
}

function depAbrirScannerEquip(){
  const ov=document.getElementById('dep-equip-scanner');
  if(!ov) return;
  ov.style.display='flex';
  document.getElementById('dep-qr-reader').innerHTML='';
  startDepQrScanner();
}
function depFecharScannerEquip(){
  stopDepQrScanner();
  const ov=document.getElementById('dep-equip-scanner');
  if(ov) ov.style.display='none';
}
function startDepQrScanner(){
  const readerEl=document.getElementById('dep-qr-reader');
  if(!readerEl) return;
  if(typeof Html5Qrcode==='undefined'){
    readerEl.innerHTML=`<div style="padding:28px 20px;text-align:center;background:rgba(0,0,0,.25);border-radius:12px;color:rgba(255,255,255,.75);font-size:13px;line-height:1.6">
      <svg viewBox="0 0 24 24" fill="currentColor" style="width:36px;height:36px;display:block;margin:0 auto 10px;opacity:.7"><path d="M9.5 6.5v3h-3v-3h3M11 5H5v6h6V5zm-1.5 9.5v3h-3v-3h3M11 13H5v6h6v-6zm6.5-6.5v3h-3v-3h3M20 5h-6v6h6V5z"/></svg>
      Leitor QR não disponível. Utilize "Escolher da lista".</div>`; return;
  }
  if(_depHtml5Qr){try{_depHtml5Qr.stop();}catch(e){} _depHtml5Qr=null;}
  _depHtml5Qr=new Html5Qrcode('dep-qr-reader');
  _depHtml5Qr.start(
    {facingMode:'environment'},
    {fps:10, qrbox:{width:220,height:220}, aspectRatio:1.0},
    (decoded)=>{ onDepQrScanned(decoded); },
    ()=>{}
  ).catch(err=>{
    console.warn('Dep QR scanner:',err);
    readerEl.innerHTML=`<div style="padding:24px 20px;text-align:center;background:rgba(0,0,0,.25);border-radius:12px;color:rgba(255,255,255,.75);font-size:13px;line-height:1.7">
      <svg viewBox="0 0 24 24" fill="currentColor" style="width:32px;height:32px;display:block;margin:0 auto 10px;opacity:.7"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
      Câmara não acessível.<br>
      <span style="font-size:11px;opacity:.8">Utilize "Escolher da lista".</span>
    </div>`;
  });
}
function stopDepQrScanner(){
  if(_depHtml5Qr){try{_depHtml5Qr.stop();}catch(e){} _depHtml5Qr=null;}
}
async function onDepQrScanned(text){
  stopDepQrScanner();
  let equipId=null;
  try{ const u=new URL(text); equipId=u.searchParams.get('reg'); }catch(e){}
  if(!equipId && /^[A-Za-z0-9_-]{6,}$/.test(String(text||'').trim())) equipId=String(text).trim();
  if(!equipId){
    showToast('QR code não reconhecido como equipamento Plandese');
    setTimeout(()=>startDepQrScanner(), 2500);
    return;
  }
  let eq=EQUIPAMENTOS.find(e=>e.id===equipId);
  if(!eq){
    eq=await sbFetchEquipamentoById(equipId).catch(()=>null);
    if(eq){ EQUIPAMENTOS.push(eq); saveEqLocal(); }
  }
  _depEquip = {id:equipId, nome: eq?eq.nome:`Equipamento ${equipId}`};
  depFecharScannerEquip();
  _depRenderEquipEscolhido();
}

// Resumo dos últimos registos de gasóleo das obras do encarregado
async function encOpenFuelModal(){
  const modal=document.getElementById('enc-fuel-modal');
  const box=document.getElementById('enc-fuel-content');
  if(!modal||!box) return;
  modal.style.display='flex';
  const obras=_encObrasComb();
  if(!obras.length){box.innerHTML='<div class="enc-fuel-empty">Sem obra atribuída.</div>';return;}
  box.innerHTML='<div class="pl-load"><span class="pl-logo"></span>A carregar…</div>';
  try{
    const {data,error}=await sb.from('registos_combustivel')
      .select('data,litros,movimento,tipo_registo,equipamento_nome,obra_id,obra_nome,deposito_obra_id,deposito_obra_nome,encarregado_nome')
      .eq('aprovacao','aprovado')
      .or(_orDepOuDestino(obras.map(o=>o.id)))
      .or('tipo_combustivel.eq.Gasóleo,tipo_combustivel.is.null')
      .order('data',{ascending:false}).order('criado_em',{ascending:false})
      .limit(8);
    if(error) throw error;
    if(!data?.length){box.innerHTML='<div class="enc-fuel-empty">Ainda sem registos de gasóleo.</div>';return;}
    const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    box.innerHTML=data.map(r=>{
      const dep=r.tipo_registo==='deposito';
      const tr=r.tipo_registo==='transferencia';
      const entrada=tr?_stockDelta(r,obras.map(o=>o.id))>0:dep&&r.movimento!=='saida';
      const titulo=tr?(entrada?'Transferência recebida de ':'Transferência para ')+esc(entrada?r.deposito_obra_nome:r.obra_nome):entrada?'Entrada no depósito':esc(r.equipamento_nome||(dep?'Saída do depósito':'Viatura'));
      const l=(parseFloat(r.litros)||0).toLocaleString('pt-PT',{maximumFractionDigits:1});
      const sub=[fmtPT(r.data),obras.length>1?esc(r.obra_nome):'',esc(r.encarregado_nome)].filter(Boolean).join(' · ');
      return `<div class="enc-fuel-row">
        <div class="enc-fuel-row-main"><div class="enc-fuel-row-t">${titulo}</div><div class="enc-fuel-row-s">${sub}</div></div>
        <div class="enc-fuel-row-l ${entrada?'in':'out'}">${entrada?'+':'−'}${l} L</div>
      </div>`;
    }).join('');
  }catch(e){
    console.warn('fuel modal:',e);
    box.innerHTML='<div class="enc-fuel-empty">Não foi possível carregar os registos.</div>';
  }
}

function encCloseFuelModal(){
  const modal=document.getElementById('enc-fuel-modal');
  if(modal) modal.style.display='none';
}

// ── Últimos registos de combustível das obras do encarregado (últimos 7 dias) ──
// O encarregado vê os registos dos últimos 7 dias e, nesse prazo, pode corrigi-los.
const _CREG_DIAS=7;
let _encUltRows=[];
let _encUltObras=[];
let _encCregId=null;

const _cregLimite=()=>{ const d=new Date(); d.setDate(d.getDate()-_CREG_DIAS); return fmt(d); };
const _cregEditavel=r=>!!r&&!!r.data&&r.data>=_cregLimite();
const _cregNum=v=>(parseFloat(v)||0).toLocaleString('pt-PT',{maximumFractionDigits:1});

function _cregInfo(r){
  if(r.tipo_registo==='transferencia'){
    const ent=_stockDelta(r,_encUltObras.map(o=>o.id))>0;
    return { dep:false, ent, tr:true,
      titulo:(ent?'Transferência recebida de ':'Transferência para ')+(ent?r.deposito_obra_nome:r.obra_nome),
      mov:'Transferência entre obras' };
  }
  const dep=r.tipo_registo==='deposito';
  const ent=dep&&r.movimento!=='saida';
  return {
    dep, ent,
    titulo: ent?'Entrada no depósito':(r.equipamento_nome||(dep?'Saída do depósito':'Viatura')),
    mov: dep?(ent?'Entrada em depósito':'Saída de depósito'):'Abastecimento de viatura',
  };
}

function _renderCombUltimos(){
  const lista=document.getElementById('enc-comb-ult-lista');
  if(!_encUltRows.length){
    lista.innerHTML='<div style="text-align:center;padding:48px 16px;color:var(--gray-400);font-size:14px">Sem registos de combustível nos últimos '+_CREG_DIAS+' dias.</div>';
    return;
  }
  lista.innerHTML=_encUltRows.map(r=>{
    const {ent,titulo}=_cregInfo(r);
    const sub=[r.data?fmtPT(r.data):'',_encUltObras.length>1?(r.obra_nome||''):'',r.tipo_combustivel||'',r.encarregado_nome||''].filter(Boolean).map(_escH).join(' · ');
    return `<div onclick="encCombRegAbrir('${_escH(r.id)}')" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 4px;border-bottom:1px solid var(--gray-100);cursor:pointer">
      <div style="min-width:0">
        <div style="font-size:15px;font-weight:700;color:var(--gray-900);line-height:1.3">${_escH(titulo)}</div>
        <div style="font-size:12.5px;color:var(--gray-500);margin-top:3px">${sub}</div>
      </div>
      <div style="font-size:16px;font-weight:800;color:${ent?'#16a34a':'#dc2626'};white-space:nowrap;font-variant-numeric:tabular-nums">${ent?'+':'−'}${_cregNum(r.litros)} L</div>
    </div>`;
  }).join('');
}

async function encGoCombUltimos(){
  stopCombQrScanner();
  _encHideAll();
  const s=document.getElementById('enc-screen-comb-ultimos');
  s.style.display='flex'; s.style.flexDirection='column';
  const lista=document.getElementById('enc-comb-ult-lista');
  _encUltObras=_encObrasComb();
  if(!_encUltObras.length){
    lista.innerHTML='<div style="text-align:center;padding:48px 16px;color:var(--gray-400);font-size:14px">Sem obra atribuída.</div>';
    return;
  }
  lista.innerHTML='<div class="pl-load"><span class="pl-logo"></span>A carregar…</div>';
  try{
    const _q=cols=>sb.from('registos_combustivel').select(cols)
      .or(_orDepOuDestino(_encUltObras.map(o=>o.id)))
      .eq('aprovacao','aprovado')
      .gte('data',_cregLimite())
      .order('data',{ascending:false}).order('criado_em',{ascending:false}).limit(100);
    const base='id,data,litros,movimento,tipo_registo,tipo_combustivel,equipamento_nome,obra_id,obra_nome,deposito_obra_id,deposito_obra_nome,encarregado_nome,obs,fornecedor';
    let {data,error}=await _q(base+',contador_valor,contador_tipo');
    // Se as colunas do contador ainda não existirem na base de dados, mostra a lista sem elas
    if(error) ({data,error}=await _q(base));
    if(error) throw error;
    _encUltRows=data||[];
    _renderCombUltimos();
  }catch(e){
    console.warn('últimos registos combustível:',e);
    lista.innerHTML='<div style="text-align:center;padding:32px 16px;color:#b91c1c;font-size:14px">Não foi possível carregar os registos.</div>';
  }
}

// Detalhe do registo (folha inferior)
function encCombRegAbrir(id){
  const r=_encUltRows.find(x=>String(x.id)===String(id));
  if(!r) return;
  _encCregId=r.id;
  const {ent,titulo,mov,tr}=_cregInfo(r);
  const kv=(k,v)=>`<div style="padding:11px 0;border-bottom:1px solid #edf0f5"><div style="font-size:11.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--m-mute)">${k}</div><div style="font-size:15.5px;font-weight:600;color:var(--m-ink);margin-top:3px;overflow-wrap:anywhere">${v}</div></div>`;
  document.getElementById('enc-creg-title').textContent=titulo;
  document.getElementById('enc-creg-body').innerHTML=`
    <div style="font-size:34px;font-weight:800;letter-spacing:-1px;color:${ent?'#166534':'#b3261e'};padding:6px 0 2px">${ent?'+':'−'}${_cregNum(r.litros)} L</div>
    <div style="font-size:13.5px;font-weight:600;color:var(--m-mute);margin-bottom:10px">${_escH(mov)}</div>
    ${kv('Data',r.data?fmtPT(r.data):'—')}
    ${tr?kv('Obra de origem',_escH(r.deposito_obra_nome||'—'))+kv('Obra de destino',_escH(r.obra_nome||'—')):''}
    ${r.tipo_registo==='deposito'?kv('Depósito',_escH(r.deposito_obra_nome||r.obra_nome||'—')):''}
    ${tr?'':kv(r.tipo_registo==='deposito'&&!ent?'Obra de destino (centro de custo)':'Obra',_escH(r.obra_nome||S.OBRAS.find(o=>o.id===r.obra_id)?.nome||'—'))}
    ${tr?'':kv('Equipamento',_escH(r.equipamento_nome||'—'))}
    ${kv('Combustível',_escH(r.tipo_combustivel||'—'))}
    ${r.contador_valor!=null?kv(r.contador_tipo==='km'?'Quilómetros':'Horas',_cregNum(r.contador_valor)+(r.contador_tipo==='km'?' km':' h')):''}
    ${kv('Registado por',_escH(r.encarregado_nome||'—'))}
    ${kv('Observações',_escH(r.obs||'—'))}
    <div style="display:flex;gap:10px;margin-top:16px">
      ${_cregEditavel(r)?'<button class="btn btn-primary" style="flex:1" onclick="encCombRegEditar()">Editar</button>':'<div style="flex:1;font-size:12.5px;color:var(--gray-500);align-self:center">Já passaram mais de '+_CREG_DIAS+' dias — não é possível editar.</div>'}
      <button class="btn btn-secondary" style="flex:1" onclick="encCombRegFechar()">Fechar</button>
    </div>`;
  document.getElementById('enc-creg-modal').style.display='flex';
}

function encCombRegEditar(){
  const r=_encUltRows.find(x=>String(x.id)===String(_encCregId));
  if(!r||!_cregEditavel(r)) return;
  const opt=v=>`<option${(r.tipo_combustivel||'Gasóleo')===v?' selected':''}>${v}</option>`;
  document.getElementById('enc-creg-body').innerHTML=`
    <div class="field"><label>Litros</label><input type="number" inputmode="decimal" step="0.1" min="0" id="enc-creg-litros" value="${_escH(r.litros??'')}"></div>
    ${r.equipamento_nome&&r.equipamento_nome!=='Depósito de Obra'?`<div class="field"><label>${r.contador_tipo==='km'?'Quilómetros':'Horas'}</label><input type="number" inputmode="decimal" step="0.1" min="0" id="enc-creg-cnt" value="${_escH(r.contador_valor??'')}" placeholder="Leitura do contador"></div>`:''}
    <div class="field"><label>Combustível</label><select id="enc-creg-tipo">${opt('Gasóleo')}${opt('Gasolina')}${opt('Outro')}</select></div>
    <div class="field"><label>Observações</label><textarea id="enc-creg-obs" rows="3" style="width:100%">${_escH(r.obs||'')}</textarea></div>
    <div style="display:flex;gap:10px;margin-top:8px">
      <button class="btn btn-primary" style="flex:1" id="enc-creg-save" onclick="encCombRegGuardar()">Guardar</button>
      <button class="btn btn-secondary" style="flex:1" onclick="encCombRegAbrir('${_escH(r.id)}')">Cancelar</button>
    </div>`;
}

async function encCombRegGuardar(){
  const r=_encUltRows.find(x=>String(x.id)===String(_encCregId));
  if(!r||!_cregEditavel(r)){ showToast('Já não é possível editar este registo'); return; }
  const litros=parseFloat(document.getElementById('enc-creg-litros').value);
  if(!litros||litros<=0){ showToast('Indique a quantidade de litros'); return; }
  const upd={
    litros,
    tipo_combustivel:document.getElementById('enc-creg-tipo').value,
    obs:document.getElementById('enc-creg-obs').value.trim()||null,
  };
  const cntEl=document.getElementById('enc-creg-cnt');
  if(cntEl && cntEl.value!==''){
    const cv=parseFloat(cntEl.value);
    if(Number.isFinite(cv)&&cv>=0){ upd.contador_valor=cv; upd.contador_tipo=r.contador_tipo||'horas'; }
  }
  const btn=document.getElementById('enc-creg-save'); if(btn) btn.disabled=true;
  try{
    const {error}=await sb.from('registos_combustivel').update(upd).eq('id',r.id);
    if(error) throw error;
    Object.assign(r,upd);
    showToast('Registo atualizado ✓');
    _renderCombUltimos();
    encUpdateFuelWidget();
    encCombRegAbrir(r.id);
  }catch(e){
    showToast('Erro ao guardar: '+(e.message||e));
    if(btn) btn.disabled=false;
  }
}

function encCombRegFechar(){
  const m=document.getElementById('enc-creg-modal'); if(m) m.style.display='none';
  _encCregId=null;
}

// ── Registos de gasóleo feitos por QR (fora da app): o encarregado da obra aprova ou rejeita ──
let _encAprRows = [];
async function _encAprBuscar(){
  const obras = _encObrasComb();
  if(!obras.length) return [];
  const {data,error} = await sb.from('registos_combustivel')
    .select('id,data,litros,tipo_registo,tipo_combustivel,equipamento_nome,obra_nome,deposito_obra_nome,encarregado_nome,obs,fornecedor')
    .or(_orDeposito(obras.map(o=>o.id))).eq('aprovacao','pendente')
    .order('criado_em',{ascending:false}).limit(100);
  if(error) throw error;
  return data || [];
}
async function encCombAtualizarBadgeApr(){
  const b = document.getElementById('enc-comb-apr-badge'); if(!b) return;
  try{
    const n = (await _encAprBuscar()).length;
    b.textContent = n; b.hidden = !n; b.style.display = n ? 'inline-flex' : 'none';
  }catch(e){ b.style.display = 'none'; }
}
function _renderCombAprovar(){
  const lista = document.getElementById('enc-comb-apr-lista');
  if(!_encAprRows.length){
    lista.innerHTML = '<div style="text-align:center;padding:48px 16px;color:var(--gray-400);font-size:14px">Não há registos por aprovar.</div>';
    return;
  }
  lista.innerHTML = _encAprRows.map(r=>{
    const tr = r.tipo_registo==='transferencia';
    const origem = tr ? 'Transferência entre obras' : r.tipo_registo==='deposito' ? 'Depósito de obra'+(r.deposito_obra_nome&&r.deposito_obra_nome!==r.obra_nome?' ('+r.deposito_obra_nome+')':'') : 'Bomba' + (r.fornecedor ? ' · '+r.fornecedor : '');
    const sub = [r.data?fmtPT(r.data):'', tr?'':(r.deposito_obra_nome&&r.deposito_obra_nome!==r.obra_nome?'Destino: '+(r.obra_nome||''):(r.obra_nome||'')), origem, r.tipo_combustivel||'', r.encarregado_nome||''].filter(Boolean).map(_escH).join(' · ');
    return `<div class="e-apr">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
        <div style="min-width:0">
          <div style="font-size:15px;font-weight:700;color:var(--gray-900);line-height:1.3">${_escH(tr?'Levantamento para '+(r.obra_nome||'outra obra'):(r.equipamento_nome||'Equipamento'))}</div>
          <div style="font-size:12.5px;color:var(--gray-500);margin-top:3px">${sub}</div>
          ${r.obs?`<div style="font-size:12.5px;color:var(--gray-600);margin-top:4px">“${_escH(r.obs)}”</div>`:''}
        </div>
        <div style="font-size:16px;font-weight:800;color:#dc2626;white-space:nowrap">−${_cregNum(r.litros)} L</div>
      </div>
      <div class="e-apr-btns">
        <button type="button" class="e-apr-rej" onclick="encCombDecidir('${_escH(r.id)}',false)">Rejeitar</button>
        <button type="button" class="e-apr-ok" onclick="encCombDecidir('${_escH(r.id)}',true)">Aprovar</button>
      </div>
    </div>`;
  }).join('');
}
async function encGoCombAprovar(){
  stopCombQrScanner();
  _encHideAll();
  const s = document.getElementById('enc-screen-comb-aprovar');
  s.style.display = 'flex'; s.style.flexDirection = 'column';
  const lista = document.getElementById('enc-comb-apr-lista');
  lista.innerHTML = '<div class="pl-load"><span class="pl-logo"></span>A carregar…</div>';
  try{ _encAprRows = await _encAprBuscar(); _renderCombAprovar(); }
  catch(e){ console.warn('por aprovar:',e); lista.innerHTML = '<div style="text-align:center;padding:32px 16px;color:#b91c1c;font-size:14px">Não foi possível carregar os registos.</div>'; }
}
async function encCombDecidir(id, aprovar){
  if(!aprovar && !confirm('Rejeitar este registo? Não contará para o stock nem para os custos.')) return;
  try{
    const {data,error} = await sb.rpc('fn_comb_decidir',{p_id:Number(id),p_aprovar:!!aprovar});
    if(error) throw error;
    if(!data || !data.ok){ showToast(data?.motivo==='sem_permissao' ? 'Só o encarregado da obra pode decidir' : 'Este registo já foi tratado'); }
    else {
      showToast(aprovar ? 'Registo aprovado ✓' : 'Registo rejeitado');
      R.emitEvent?.({ acao:'Combustível · registo por QR '+(aprovar?'aprovado':'rejeitado'), seccao:'combustivel' });
      encUpdateFuelWidget();
    }
  }catch(e){ showToast('Erro: '+(e.message||e)); }
  try{ _encAprRows = await _encAprBuscar(); _renderCombAprovar(); }catch(e){}
}

function encGoCombDeposito(){
  _encHideAll();
  const s=document.getElementById('enc-screen-comb-deposito');
  s.style.display='flex'; s.style.flexDirection='column';
  document.getElementById('dep-data').value=fmt(new Date());
  const os=document.getElementById('dep-obra');
  os.innerHTML='<option value="">— Selecione o depósito —</option>';
  S.OBRAS.filter(obraEmCurso).forEach(o=>{const op=document.createElement('option');op.value=o.id;op.textContent=o.nome;os.appendChild(op);});
  const ds=document.getElementById('dep-dest');
  if(ds){ ds.innerHTML='<option value="">— Igual ao depósito —</option>'; S.OBRAS.filter(obraEmCurso).forEach(o=>{const op=document.createElement('option');op.value=o.id;op.textContent=o.nome;ds.appendChild(op);}); }
  const minhas=_encObrasComb(); if(minhas.length===1) os.value=minhas[0].id;
  document.getElementById('dep-litros').value='';
  document.getElementById('dep-obs').value='';
  _cntLimpar('dep');
  document.getElementById('dep-tipo').value='Gasóleo';
  document.getElementById('dep-alert').style.display='none';
  _depMovimento='entrada';
  _depEquip=null;
  _depRenderEquipEscolhido();
  depSetMovimento('entrada');
}

// Vindo do QR do equipamento: saída do depósito já para este equipamento
function encCombDepositoComEquip(eq){
  encGoCombDeposito();
  depSetMovimento('saida');
  _depEquip={id:eq.id,nome:eq.nome};
  _depRenderEquipEscolhido();
}
// Vindo do QR do equipamento: abastecimento (bomba) já para este equipamento
function encCombViaturaComEquip(eq){
  _encHideAll();
  const s=document.getElementById('enc-screen-comb-viatura');
  s.style.display='flex'; s.style.flexDirection='column';
  stopCombQrScanner();
  _combQrEquipId=eq.id; _combModoManual=false;
  _combViaturaShowState('form');
  document.getElementById('comb-viatura-info-box').style.display='flex';
  document.getElementById('comb-viatura-nome-field').style.display='none';
  document.getElementById('comb-viatura-scan-btn').style.display='inline-flex';
  const real=EQUIPAMENTOS.find(e=>e.id===eq.id);
  document.getElementById('comb-viatura-nome').textContent=eq.nome;
  document.getElementById('comb-viatura-cat').textContent=real?(EQ_CATS[eqCatNorm(real.categoria)].label):'Equipamento';
  _combPreencherFormViatura();
  _preObraEquip('comb-viatura-obra',eq.id);
  _cntSyncViatura();
}

// Erro ao guardar: fica visível até ser fechado (o aviso rápido desaparecia antes de o utilizador o ler)
function _encErroGuardar(id,e){
  const m=String(e?.message||e||'');
  const motivo=/failed to fetch|networkerror|load failed/i.test(m)?'Sem ligação à internet.'
    :/jwt|expired|not authenticated|401/i.test(m)?'A sessão terminou. Saia e volte a entrar.'
    :/row-level security|permission|403/i.test(m)?'Não tem permissão para este registo.'
    :m;
  const el=document.getElementById(id);
  if(el){
    el.replaceChildren();
    const t=document.createElement('b'); t.textContent='Não foi possível guardar o registo.';
    const d=document.createElement('div'); d.textContent=motivo;
    const f=document.createElement('small'); f.textContent='Toque aqui para fechar e tente de novo.';
    el.append(t,d,f); el.style.display='block'; el.scrollIntoView?.({block:'center',behavior:'smooth'});
  }
  showToast('Erro ao guardar: '+m);
}

async function encSubmeterCombDeposito(){
  const data=document.getElementById('dep-data').value;
  const obraEl=document.getElementById('dep-obra');
  const obraId=obraEl.value;
  const obraNome=obraEl.options[obraEl.selectedIndex]?.text||'';
  // Saída: centro de custo = obra de destino (por omissão, a do próprio depósito); entrada: só o depósito
  const destEl=document.getElementById('dep-dest');
  const comDest=(_depMovimento==='saida'||_depMovimento==='transferencia')&&destEl?.value;
  const destId=comDest?destEl.value:obraId;
  const destNome=comDest?(destEl.options[destEl.selectedIndex]?.text||''):obraNome;
  const transf=_depMovimento==='transferencia';
  const litros=parseFloat(document.getElementById('dep-litros').value)||null;
  const tipo=document.getElementById('dep-tipo').value;
  const obs=document.getElementById('dep-obs').value.trim()||null;
  if(!data){showToast('Selecione a data');return;}
  if(!obraId){showToast(transf?'Selecione a obra de origem':'Selecione o depósito de onde sai o gasóleo');return;}
  if(transf&&(!destEl?.value||destEl.value===obraId)){showToast('Escolha uma obra de destino diferente da origem');return;}
  if(!litros||litros<=0){showToast('Indique a quantidade de litros');return;}
  if(_depMovimento==='saida' && !_depEquip){showToast('Escolha o equipamento que recebeu o combustível');return;}
  const btn=document.getElementById('dep-submit-btn');
  const er=document.getElementById('dep-erro'); if(er) er.style.display='none';
  if(btn){btn.disabled=true;}
  try{
    const {data:ins,error}=await sb.from('registos_combustivel').insert({
      data,
      equipamento_id:_depMovimento==='saida'?(_depEquip.id||null):null,
      equipamento_nome:_depMovimento==='saida'?_depEquip.nome:transf?'Transferência entre obras':'Depósito de Obra',
      obra_id:destId,
      obra_nome:destNome,
      deposito_obra_id:obraId,
      deposito_obra_nome:obraNome,
      litros,
      tipo_combustivel:tipo,
      tipo_registo:transf?'transferencia':'deposito',
      movimento:transf?'saida':_depMovimento,
      encarregado_nome:S.currentUser?.nome||'',
      obs,
      ...(_depMovimento==='saida'?_cntLer('dep'):{})
    }).select('aprovacao');
    if(error)throw error;
    document.getElementById('dep-alert').style.display='block';
    const pend=transf&&ins?.[0]?.aprovacao==='pendente';
    showToast(transf?(pend?'Transferência registada — falta o encarregado de '+obraNome+' confirmar':'Transferência registada ✓'):(_depMovimento==='entrada'?'Entrada':'Saída')+' no depósito registada ✓');
    encUpdateFuelWidget();
    R.emitEvent?.({ acao:'Combustível · '+(transf?'Transferência':_depMovimento==='entrada'?'Entrada':'Saída')+' depósito '+litros+'L'+(obraNome?' · '+obraNome:'')+(transf?' → '+destNome:_depMovimento==='saida'?' · '+_depEquip.nome+(destId!==obraId?' → '+destNome:''):''), seccao:'combustivel', obra:obraId });
    setTimeout(()=>{
      document.getElementById('dep-litros').value='';
      document.getElementById('dep-obs').value='';
      document.getElementById('dep-obra').value='';
      if(document.getElementById('dep-dest')) document.getElementById('dep-dest').value='';
      document.getElementById('dep-alert').style.display='none';
      _depEquip=null;
      _cntLimpar('dep');
      _depRenderEquipEscolhido();
      if(btn){btn.disabled=false;}
    },1800);
  }catch(e){
    _encErroGuardar('dep-erro',e);
    if(btn){btn.disabled=false;}
  }
}

// ── Viaturas / Equipamentos — QR + Manual ───────

function _combViaturaShowState(state){
  document.getElementById('comb-viatura-state-scanner').style.display = state==='scanner'?'':'none';
  const fEl=document.getElementById('comb-viatura-state-form');
  fEl.style.display = state==='form'?'flex':'none';
  if(state==='form') fEl.style.flexDirection='column';
  const sEl=document.getElementById('comb-viatura-state-success');
  sEl.style.display = state==='success'?'flex':'none';
  if(state==='success') sEl.style.flexDirection='column';
}

async function encGoCombViatura(){
  _encHideAll();
  const s=document.getElementById('enc-screen-comb-viatura');
  s.style.display='flex'; s.style.flexDirection='column';
  _combQrEquipId=null; _combModoManual=false;
  _combViaturaShowState('scanner');
  document.getElementById('comb-qr-reader').innerHTML='';
  setTimeout(()=>startCombQrScanner(), 350);
}

function startCombQrScanner(){
  const readerEl=document.getElementById('comb-qr-reader');
  if(!readerEl) return;
  if(typeof Html5Qrcode==='undefined'){
    readerEl.innerHTML=`<div style="padding:28px 20px;text-align:center;background:rgba(0,0,0,.25);border-radius:12px;color:rgba(255,255,255,.75);font-size:13px;line-height:1.6">
      <svg viewBox="0 0 24 24" fill="currentColor" style="width:36px;height:36px;display:block;margin:0 auto 10px;opacity:.7"><path d="M9.5 6.5v3h-3v-3h3M11 5H5v6h6V5zm-1.5 9.5v3h-3v-3h3M11 13H5v6h6v-6zm6.5-6.5v3h-3v-3h3M20 5h-6v6h6V5z"/></svg>
      Leitor QR não disponível.</div>`; return;
  }
  if(_combHtml5Qr){try{_combHtml5Qr.stop();}catch(e){} _combHtml5Qr=null;}
  _combHtml5Qr=new Html5Qrcode('comb-qr-reader');
  _combHtml5Qr.start(
    {facingMode:'environment'},
    {fps:10, qrbox:{width:220,height:220}, aspectRatio:1.0},
    (decoded)=>{onCombQrScanned(decoded);},
    ()=>{}
  ).catch(err=>{
    console.warn('Comb QR scanner:',err);
    readerEl.innerHTML=`<div style="padding:24px 20px;text-align:center;background:rgba(0,0,0,.25);border-radius:12px;color:rgba(255,255,255,.75);font-size:13px;line-height:1.7">
      <svg viewBox="0 0 24 24" fill="currentColor" style="width:32px;height:32px;display:block;margin:0 auto 10px;opacity:.7"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
      Câmara não acessível.<br>
      <span style="font-size:11px;opacity:.8">Utilize o botão abaixo para registo manual.</span>
    </div>`;
  });
}

function stopCombQrScanner(){
  if(_combHtml5Qr){try{_combHtml5Qr.stop();}catch(e){} _combHtml5Qr=null;}
}

async function onCombQrScanned(text){
  stopCombQrScanner();
  let equipId=null;
  try{const u=new URL(text); equipId=u.searchParams.get('reg');}catch(e){}
  if(!equipId && /^[A-Za-z0-9_-]{6,}$/.test(String(text||'').trim())) equipId=String(text).trim();
  if(!equipId){
    showToast('QR code não reconhecido como equipamento Plandese');
    setTimeout(()=>startCombQrScanner(), 2500);
    return;
  }
  _combQrEquipId=equipId; _combModoManual=false;
  let eq=EQUIPAMENTOS.find(e=>e.id===equipId);
  if(!eq){
    document.getElementById('comb-viatura-nome').textContent='A carregar…';
    document.getElementById('comb-viatura-cat').textContent='';
    _combViaturaShowState('form');
    eq=await sbFetchEquipamentoById(equipId).catch(()=>null);
    if(eq){EQUIPAMENTOS.push(eq); saveEqLocal();}
  } else {
    _combViaturaShowState('form');
  }
  document.getElementById('comb-viatura-info-box').style.display='flex';
  document.getElementById('comb-viatura-nome-field').style.display='none';
  document.getElementById('comb-viatura-scan-btn').style.display='inline-flex';
  document.getElementById('comb-viatura-nome').textContent=eq?eq.nome:`Equipamento ${equipId}`;
  document.getElementById('comb-viatura-cat').textContent=eq?(EQ_CATS[eqCatNorm(eq.categoria)].label):'Equipamento';
  _combPreencherFormViatura();
  _preObraEquip('comb-viatura-obra',equipId);
  _cntSyncViatura();
}

function combViaturaManual(){
  stopCombQrScanner();
  _combQrEquipId=null; _combModoManual=true;
  _combViaturaShowState('form');
  document.getElementById('comb-viatura-info-box').style.display='none';
  document.getElementById('comb-viatura-nome-field').style.display='block';
  document.getElementById('comb-viatura-scan-btn').style.display='inline-flex';
  document.getElementById('comb-viatura-nome-input').value='';
  _combPreencherFormViatura();
  _cntSyncViatura();
  _combFillListaEquip();
  sbLoadEquipamentos().then(_combFillListaEquip).catch(()=>{});
}

function _combPreencherFormViatura(){
  document.getElementById('comb-viatura-data').value=fmt(new Date());
  const os=document.getElementById('comb-viatura-obra');
  os.innerHTML='<option value="">— Selecione uma obra —</option>';
  S.OBRAS.filter(obraEmCurso).forEach(o=>{const op=document.createElement('option');op.value=o.id;op.textContent=o.nome;os.appendChild(op);});
  document.getElementById('comb-viatura-litros').value='';
  document.getElementById('comb-viatura-fornecedor').value='';
  document.getElementById('comb-viatura-obs').value='';
  document.getElementById('comb-viatura-tipo').value='Gasóleo';
  document.getElementById('comb-viatura-alert').style.display='none';
}

function combViaturaVoltarScanner(){
  _combQrEquipId=null; _combModoManual=false;
  document.getElementById('comb-qr-reader').innerHTML='';
  _combViaturaShowState('scanner');
  setTimeout(()=>startCombQrScanner(), 350);
}

async function encSubmeterCombViatura(){
  const data=document.getElementById('comb-viatura-data').value;
  const obraEl=document.getElementById('comb-viatura-obra');
  const obraId=obraEl.value;
  const obraNome=obraEl.options[obraEl.selectedIndex]?.text||'';
  const litros=parseFloat(document.getElementById('comb-viatura-litros').value)||null;
  const tipo=document.getElementById('comb-viatura-tipo').value;
  const fornecedor=document.getElementById('comb-viatura-fornecedor').value.trim()||null;
  const obs=document.getElementById('comb-viatura-obs').value.trim()||null;
  // Nome do equipamento
  let equipId=_combQrEquipId||null;
  let equipNome='';
  if(_combModoManual){
    equipNome=document.getElementById('comb-viatura-nome-input').value.trim();
    if(!equipNome){showToast('Indique o nome da viatura ou equipamento');return;}
    const escolhido=_combEqOpts.get(equipNome);
    if(escolhido){ equipId=escolhido.id; equipNome=escolhido.nome; }
  } else {
    const eq=EQUIPAMENTOS.find(e=>e.id===equipId);
    equipNome=eq?eq.nome:(equipId||'');
  }
  if(!data){showToast('Selecione a data');return;}
  if(!litros||litros<=0){showToast('Indique a quantidade de litros');return;}
  const btn=document.getElementById('comb-viatura-submit-btn');
  const er=document.getElementById('comb-viatura-erro'); if(er) er.style.display='none';
  if(btn){btn.disabled=true;}
  try{
    const {error}=await sb.from('registos_combustivel').insert({
      data,
      equipamento_id:equipId,
      equipamento_nome:equipNome,
      obra_id:obraId||null,
      obra_nome:obraId?obraNome:null,
      litros,
      tipo_combustivel:tipo,
      tipo_registo:'viatura',
      movimento:'saida',
      fornecedor,
      encarregado_nome:S.currentUser?.nome||'',
      obs,
      ..._cntLer('comb-viatura')
    });
    if(error)throw error;
    showToast('Abastecimento registado ✓');
    R.emitEvent?.({ acao:'Combustível · Abastecimento '+litros+'L em '+equipNome+(obraId?' · '+obraNome:''), seccao:'combustivel', obra:obraId });
    const encNome=S.currentUser?.nome||'Encarregado';
    document.getElementById('comb-viatura-success-txt').innerHTML=
      `<strong>${encNome}</strong> registou<br>`+
      `<strong>${litros}L de ${tipo}</strong><br>`+
      `em <strong>${equipNome}</strong>`+
      (obraId?`<br>Obra: <strong>${obraNome}</strong>`:'')+
      `<br><span style="font-size:11px;opacity:.65;display:block;margin-top:6px">${eqFmtDt(new Date())}</span>`;
    _combViaturaShowState('success');
    if(btn){btn.disabled=false;}
  }catch(e){
    _encErroGuardar('comb-viatura-erro',e);
    if(btn){btn.disabled=false;}
  }
}

// Manter compatibilidade com referências antigas ao encSubmeterCombustivel
function encSubmeterCombustivel(){ encSubmeterCombViatura(); }

// ════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
//  ASSISTENTE DE COMPRAS — ecrã do agente Plandese (src/modules/enc-compras-ia.js)
// ═══════════════════════════════════════════════════════════
function encGoComprasChat() {
  _encHideAll();
  const el = document.getElementById('enc-screen-compras-chat');
  if (el) { el.style.display = 'flex'; el.style.flexDirection = 'column'; }
  comprasIAAbrir();
}

window.encGoComprasChat = encGoComprasChat;

export {
  encCombDepositoComEquip, encCombViaturaComEquip, encGoCombAprovar, encCombDecidir, encCombAtualizarBadgeApr,
  encUpdateFuelWidget, encOpenFuelModal, encCloseFuelModal, depSetMovimento, encGoCombDeposito, encSubmeterCombDeposito,
  depAbrirPickerEquip, depAbrirScannerEquip, depFecharScannerEquip, depTrocarEquip,
  encGoCombViatura, encGoCombUltimos, encCombRegAbrir, encCombRegEditar, encCombRegGuardar, encCombRegFechar, startCombQrScanner, stopCombQrScanner, onCombQrScanned,
  combViaturaManual, combViaturaVoltarScanner, encSubmeterCombViatura, encSubmeterCombustivel,
  combAbrirPicker, combFecharPicker, combPickerRender, combPickerSetCat, combPickerUsarTexto,
  encGoComprasChat
};
