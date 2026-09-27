// ═══════════════════════════════════════
//  ENC-EQUIP — Identificação (QR ou lista) + Registo/Manutenção — Encarregado
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S, R } from '../state.js';
import { showToast } from './navigation.js';
import { sbFetchEquipamentoById, sbUpdateEquipamentoLocal, EQUIPAMENTOS, EQ_MOVIMENTOS, EQ_CATS, eqFmtDt, saveEqLocal, renderEquipamentos, refreshEqMap, updateEqKPIs } from './equipamentos.js';

let _encHtml5Qr = null;
let _encQrGpsLat = null, _encQrGpsLng = null;
let _encEqEquip = null;   // {id, nome, categoria, ultimo_local} — equipamento identificado (por QR ou lista)
let _encEqAction = null;  // 'registo' | 'manut'
let _encEqCache = null;   // cache da lista de equipamentos para escolha manual

function _encEsc(s){
  return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

const _ENC_EQ_STATES = ['metodo','scanner','lista','acao','form-reg','form-man','sucesso'];
function _encEqShowState(state){
  _ENC_EQ_STATES.forEach(s=>{
    const el = document.getElementById('enc-eq-state-'+s);
    if(!el) return;
    el.style.display = (s===state) ? 'flex' : 'none';
  });
}

// ── Entrada no ecrã (a partir do bento do encarregado) ──
function encEqAbrir(){
  stopEncQrScanner();
  _encEqEquip=null; _encEqAction=null;
  _encEqShowState('metodo');
}

function encEqVoltarMetodo(){
  stopEncQrScanner();
  _encEqEquip=null; _encEqAction=null;
  _encEqShowState('metodo');
}

// ── Método 1: QR code ───────────────────
function encEqEscolherMetodoQR(){
  _encEqShowState('scanner');
  setTimeout(()=>startEncQrScanner(), 200);
}

function startEncQrScanner(){
  const readerEl = document.getElementById('enc-qr-reader');
  if(!readerEl) return;
  if(typeof Html5Qrcode === 'undefined'){
    readerEl.innerHTML=`<div style="padding:28px 20px;text-align:center;background:rgba(0,0,0,.25);border-radius:12px;color:rgba(255,255,255,.75);font-size:13px;line-height:1.6">
      <svg viewBox="0 0 24 24" fill="currentColor" style="width:36px;height:36px;display:block;margin:0 auto 10px;opacity:.7"><path d="M9.5 6.5v3h-3v-3h3M11 5H5v6h6V5zm-1.5 9.5v3h-3v-3h3M11 13H5v6h6v-6zm6.5-6.5v3h-3v-3h3M20 5h-6v6h6V5z"/></svg>
      Leitor QR não disponível.<br>
      <span style="font-size:11px;opacity:.8">Utilize a câmara nativa para fotografar o QR code — o link abrirá automaticamente.</span>
    </div>`;
    return;
  }
  if(_encHtml5Qr){ try{_encHtml5Qr.stop();}catch(e){} _encHtml5Qr=null; }
  _encHtml5Qr = new Html5Qrcode('enc-qr-reader');
  _encHtml5Qr.start(
    {facingMode:'environment'},
    {fps:10, qrbox:{width:220, height:220}, aspectRatio:1.0},
    (decoded)=>{ onEncQrScanned(decoded); },
    ()=>{}
  ).catch(err=>{
    console.warn('QR scanner:', err);
    readerEl.innerHTML=`<div style="padding:24px 20px;text-align:center;background:rgba(0,0,0,.25);border-radius:12px;color:rgba(255,255,255,.75);font-size:13px;line-height:1.7">
      <svg viewBox="0 0 24 24" fill="currentColor" style="width:32px;height:32px;display:block;margin:0 auto 10px;opacity:.7"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
      Câmara não acessível.<br>
      <span style="font-size:11px;opacity:.8">Verifique as permissões do browser ou fotografe o QR code com a câmara nativa.</span>
    </div>`;
  });
}

function stopEncQrScanner(){
  if(_encHtml5Qr){
    try{_encHtml5Qr.stop();}catch(e){}
    _encHtml5Qr=null;
  }
}

async function onEncQrScanned(text){
  stopEncQrScanner();
  // Extrair equipId da URL ou texto directo
  let equipId=null;
  try{ const u=new URL(text); equipId=u.searchParams.get('reg'); }catch(e){}
  if(!equipId && /^EQ[A-Z0-9]+$/.test(text)) equipId=text;
  if(!equipId){
    showToast('QR code não reconhecido como equipamento Plandese');
    setTimeout(()=>startEncQrScanner(), 2500);
    return;
  }
  // Info do equipamento — primeiro local, depois Supabase se não encontrar
  let eq=EQUIPAMENTOS.find(e=>e.id===equipId);
  if(!eq){
    eq=await sbFetchEquipamentoById(equipId);
    if(eq){ EQUIPAMENTOS.push(eq); saveEqLocal(); }
  }
  _encEqIrParaAcao({
    id: equipId,
    nome: eq?eq.nome:`Equipamento ${equipId}`,
    categoria: eq?eq.categoria:null,
    ultimo_local: eq?eq.ultimoLocal:null
  });
}

// ── Método 2: escolha manual da lista ───
async function encEqEscolherMetodoLista(){
  _encEqShowState('lista');
  const search=document.getElementById('enc-eq-lista-search');
  if(search) search.value='';
  const list=document.getElementById('enc-eq-lista-list');
  if(list) list.innerHTML='<div style="padding:24px;text-align:center;color:var(--gray-400);font-size:12px">A carregar equipamentos…</div>';
  if(!_encEqCache){
    try{
      const {data,error}=await sb.from('equipamentos').select('id,nome,categoria,ultimo_local').order('nome');
      if(error) throw error;
      _encEqCache=data||[];
    }catch(e){ console.warn('encEqEscolherMetodoLista:',e); _encEqCache=EQUIPAMENTOS.map(e=>({id:e.id,nome:e.nome,categoria:e.categoria,ultimo_local:e.ultimoLocal})); }
  }
  encEqListaFiltra('');
}

function encEqListaFiltra(term){
  const list=document.getElementById('enc-eq-lista-list');
  if(!list) return;
  const t=(term||'').toLowerCase().trim();
  const items=(_encEqCache||[]).filter(e=>!t||e.nome.toLowerCase().includes(t)).slice(0,80);
  list.innerHTML = items.length ? items.map(e=>`<button type="button" onclick="encEqListaEscolher('${e.id}')" style="display:block;width:100%;text-align:left;padding:11px 12px;margin-bottom:6px;border:1px solid var(--gray-200);border-radius:10px;background:var(--white);cursor:pointer;font-family:var(--font)">
    <div style="font-size:13px;font-weight:700;color:var(--gray-900)">${_encEsc(e.nome)}</div>
    ${e.ultimo_local?`<div style="font-size:11px;color:var(--gray-400);margin-top:2px">${_encEsc(e.ultimo_local)}</div>`:''}
  </button>`).join('') : '<div style="padding:24px;text-align:center;color:var(--gray-400);font-size:12px">Sem resultados</div>';
}

function encEqListaEscolher(id){
  const eq=(_encEqCache||[]).find(e=>e.id===id); if(!eq) return;
  _encEqIrParaAcao(eq);
}

// ── Equipamento identificado → escolher ação ──
function _encEqIrParaAcao(eq){
  _encEqEquip = eq;
  document.getElementById('enc-eq-act-nome').textContent = eq.nome;
  document.getElementById('enc-eq-act-cat').textContent = EQ_CATS[eq.categoria]?.label || 'Equipamento';
  _encEqShowState('acao');
}

function encEqVoltarAcao(){
  _encEqShowState('acao');
}

function encEqEscolherAcao(acao){
  if(!_encEqEquip) return;
  _encEqAction = acao;
  if(acao==='registo'){
    _encEqPrepFormRegisto();
    _encEqShowState('form-reg');
  } else {
    _encEqPrepFormManut();
    _encEqShowState('form-man');
  }
}

// ── Formulário: registar localização ────
function _encEqPrepFormRegisto(){
  const eq=_encEqEquip;
  document.getElementById('enc-eq-nome').textContent=eq.nome;
  document.getElementById('enc-eq-cat').textContent=EQ_CATS[eq.categoria]?.label||'Equipamento';
  const sel=document.getElementById('enc-eq-obra-sel');
  sel.innerHTML='<option value="">Selecionar obra…</option>';
  S.OBRAS.filter(o=>o.ativa).forEach(o=>{ const op=document.createElement('option'); op.value=o.id; op.textContent=o.nome; sel.appendChild(op); });
  document.getElementById('enc-eq-obs').value='';
  document.getElementById('enc-eq-use-gps').checked=true;
  document.getElementById('enc-eq-loc-dot').className='qr-loc-dot loading';
  document.getElementById('enc-eq-loc-txt').textContent='A obter localização GPS…';
  _encQrGpsLat=null; _encQrGpsLng=null;
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(pos=>{
      _encQrGpsLat=pos.coords.latitude; _encQrGpsLng=pos.coords.longitude;
      document.getElementById('enc-eq-loc-dot').className='qr-loc-dot ok';
      document.getElementById('enc-eq-loc-txt').textContent=`GPS: ${_encQrGpsLat.toFixed(5)}, ${_encQrGpsLng.toFixed(5)}`;
    },()=>{
      document.getElementById('enc-eq-loc-dot').className='qr-loc-dot err';
      document.getElementById('enc-eq-loc-txt').textContent='GPS não disponível';
      document.getElementById('enc-eq-use-gps').checked=false;
    },{timeout:8000,enableHighAccuracy:true});
  } else {
    document.getElementById('enc-eq-loc-dot').className='qr-loc-dot err';
    document.getElementById('enc-eq-loc-txt').textContent='GPS não suportado';
    document.getElementById('enc-eq-use-gps').checked=false;
  }
}

function submitEncEquipamento(){
  if(!_encEqEquip){ showToast('Nenhum equipamento seleccionado'); return; }
  const equipId =_encEqEquip.id;
  const obraId  =document.getElementById('enc-eq-obra-sel').value;
  const obs     =document.getElementById('enc-eq-obs').value.trim();
  const useGps  =document.getElementById('enc-eq-use-gps').checked;
  const encNome =S.currentUser?.nome || 'Encarregado';
  const selEl   =document.getElementById('enc-eq-obra-sel');
  const selOpt  =selEl.querySelector(`option[value="${obraId}"]`);
  const obraNome=selOpt&&obraId?selOpt.textContent:null;
  const mov={
    id:'MOV'+Date.now().toString(36).toUpperCase(),
    equipId, obraId:obraId||null, obraNome:obraNome||null,
    lat:(useGps&&_encQrGpsLat)?_encQrGpsLat:null,
    lng:(useGps&&_encQrGpsLng)?_encQrGpsLng:null,
    obs, encarregado:encNome, criadoEm:new Date().toISOString()
  };
  EQ_MOVIMENTOS.push(mov);
  const idx=EQUIPAMENTOS.findIndex(e=>e.id===equipId);
  if(idx>=0){
    EQUIPAMENTOS[idx].ultimoLocal   =obraNome||(mov.lat?`${mov.lat.toFixed(4)}, ${mov.lng.toFixed(4)}`:'Registado');
    EQUIPAMENTOS[idx].ultimoLat     =mov.lat;
    EQUIPAMENTOS[idx].ultimoLng     =mov.lng;
    EQUIPAMENTOS[idx].ultimoRegisto =mov.criadoEm;
  }
  saveEqLocal();
  // Actualizar tabela e mapa do admin em tempo real (mesma SPA)
  try{ renderEquipamentos(); refreshEqMap(); updateEqKPIs(); }catch(e){}
  // Guardar movimento em Supabase
  try{ sb.from('eq_movimentos').insert({equip_id:equipId,obra_id:mov.obraId,obra_nome:mov.obraNome,lat:mov.lat,lng:mov.lng,obs:mov.obs,encarregado:mov.encarregado,criado_em:mov.criadoEm}).then(()=>{}).catch(()=>{}); }catch(e){}
  // Actualizar último local do equipamento em Supabase
  const _eIdx=EQUIPAMENTOS.findIndex(e=>e.id===equipId);
  if(_eIdx>=0){ sbUpdateEquipamentoLocal(equipId,EQUIPAMENTOS[_eIdx].ultimoLocal,EQUIPAMENTOS[_eIdx].ultimoLat,EQUIPAMENTOS[_eIdx].ultimoLng,EQUIPAMENTOS[_eIdx].ultimoRegisto); }
  document.getElementById('enc-eq-sucesso-titulo').textContent='Localização registada!';
  document.getElementById('enc-eq-sucesso-txt').innerHTML=
    `<strong>${encNome}</strong> registou<br>`+
    `<strong>${_encEsc(_encEqEquip.nome)}</strong><br>`+
    (obraNome?`em <strong>${_encEsc(obraNome)}</strong>`:'sem obra associada')+
    `<br><span style="font-size:11px;opacity:.65;display:block;margin-top:6px">${eqFmtDt(new Date())}</span>`;
  _encEqShowState('sucesso');
  R.emitEvent?.({ acao:'Equipamento registado: '+_encEqEquip.nome+(obraNome?' · '+obraNome:''), seccao:'equipamentos' });
}

// ── Formulário: pedir manutenção ────────
function _encEqPrepFormManut(){
  const eq=_encEqEquip;
  document.getElementById('enc-manut-eq-nome').textContent=eq.nome;
  document.getElementById('enc-manut-eq-cat').textContent=EQ_CATS[eq.categoria]?.label||'Equipamento';
  const descEl=document.getElementById('enc-manut-desc');
  if(descEl) descEl.value='';
  const sel=document.getElementById('enc-manut-obra-sel');
  sel.innerHTML='<option value="">Selecionar obra…</option>';
  S.OBRAS.filter(o=>o.ativa).forEach(o=>{ const op=document.createElement('option'); op.value=o.nome; op.textContent=o.nome; sel.appendChild(op); });
  const ultimoLocal = eq.ultimo_local || eq.ultimoLocal;
  if(ultimoLocal && [...sel.options].some(o=>o.value===ultimoLocal)) sel.value=ultimoLocal;
}

async function submitEncManutencao(){
  if(!_encEqEquip){ showToast('Nenhum equipamento seleccionado'); return; }
  const desc=document.getElementById('enc-manut-desc').value.trim();
  if(!desc){ showToast('Descreva o problema'); return; }
  const obraNome=document.getElementById('enc-manut-obra-sel').value||null;
  const nome=S.currentUser?.nome||'Encarregado';
  const {error}=await sb.from('eq_manutencoes').insert({
    equip_id:_encEqEquip.id, descricao:desc, estado:'pendente', origem:'encarregado',
    solicitante_nome:nome, obra_nome:obraNome
  });
  if(error){ console.warn('submitEncManutencao:',error); showToast('Erro ao enviar o pedido'); return; }
  document.getElementById('enc-eq-sucesso-titulo').textContent='Pedido enviado!';
  document.getElementById('enc-eq-sucesso-txt').innerHTML=
    `<strong>${_encEsc(nome)}</strong> pediu manutenção para<br>`+
    `<strong>${_encEsc(_encEqEquip.nome)}</strong>`+
    (obraNome?`<br>em <strong>${_encEsc(obraNome)}</strong>`:'')+
    `<br><span style="font-size:11px;opacity:.65;display:block;margin-top:6px">${eqFmtDt(new Date())}</span>`;
  _encEqShowState('sucesso');
  R.emitEvent?.({ acao:'Pedido de manutenção: '+_encEqEquip.nome+(obraNome?' · '+obraNome:''), seccao:'equipamentos' });
}

export {
  encEqAbrir, encEqVoltarMetodo,
  encEqEscolherMetodoQR, startEncQrScanner, stopEncQrScanner, onEncQrScanned,
  encEqEscolherMetodoLista, encEqListaFiltra, encEqListaEscolher,
  encEqVoltarAcao, encEqEscolherAcao,
  submitEncEquipamento, submitEncManutencao
};
