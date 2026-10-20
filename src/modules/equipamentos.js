// ═══════════════════════════════════════
//  EQUIPAMENTOS E LOGÍSTICA
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S, R } from '../state.js';
import { fmt, fmtPT } from '../utils/helpers.js';
import { showToast, closeModal, openModal } from './navigation.js';
import { obraEmCurso } from '../config.js';

let EQUIPAMENTOS  = JSON.parse(localStorage.getItem('plandese_eq')||'[]');
let EQ_MOVIMENTOS = JSON.parse(localStorage.getItem('plandese_eq_mov')||'[]');
let EQ_MANUT = [];
let _eqMap = null, _eqMapMarkers = [], _eqMapMarkerById = {}, _editingEqId = null, _eqManutId = null;
let _qrGpsLat = null, _qrGpsLng = null, _qrEquipId = null;
let _eqView = 'lista', _eqObraGroups = [];

// ═══════════════════════════════════════
//  EQUIPAMENTOS E LOGÍSTICA
// ═══════════════════════════════════════

// ── Dados (localStorage) ───────────────

function saveEqLocal(){
  localStorage.setItem('plandese_eq',     JSON.stringify(EQUIPAMENTOS));
  localStorage.setItem('plandese_eq_mov', JSON.stringify(EQ_MOVIMENTOS));
}
function genEqId(){ return 'EQ' + Date.now().toString(36).toUpperCase(); }

// ── Categorias ─────────────────────────
const EQ_CATS = {
  equipamento:         {label:'Equipamento',                       cls:'eq-cat-equipamento'},
  veiculo_passageiros: {label:'Veículo ligeiro de passageiros',    cls:'eq-cat-vpass'},
  veiculo_mercadorias: {label:'Veículo ligeiro de mercadorias',    cls:'eq-cat-vmerc'},
  veiculo_pesado:      {label:'Veículo pesado',                    cls:'eq-cat-vpes'}
};
// Valores antigos (maquina/ferramenta/outro/veiculo) passam para as novas categorias
function eqCatNorm(c){
  if(EQ_CATS[c]) return c;
  if(c==='veiculo') return 'veiculo_mercadorias';
  return 'equipamento';
}
function eqCatIsVeiculo(c){ return eqCatNorm(c).indexOf('veiculo_')===0; }
function eqCatBadge(cat){
  const c = EQ_CATS[eqCatNorm(cat)];
  return `<span class="eq-cat-badge ${c.cls}">${c.label}</span>`;
}

const EQ_ESTADOS = {
  operacional:{label:'Operacional', cls:'eq-est-ok'},
  manutencao: {label:'Manutenção',  cls:'eq-est-man'},
  oficina:    {label:'Em oficina',  cls:'eq-est-man'},
  parada:     {label:'Parada',      cls:'eq-est-par'}
};
function eqEsc(s){
  return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function eqSet(id,v){ const el=document.getElementById(id); if(el) el.value=v==null?'':v; }
function eqNum(v){ return (v===''||v==null)?null:Number(v); }
function eqDatePT(iso){ return iso?iso.split('-').reverse().join('/'):''; }
// Obra / centro de custo associado (da tabela de obras); se não houver, o texto do último local
function eqObraNome(eq){
  const o = eq.obraId && (S.OBRAS||[]).find(x=>x.id===eq.obraId);
  return o ? o.nome : (eq.ultimoLocal||'');
}
function eqPropBadge(eq){
  return eq.propriedade==='aluguer' ? '<span class="eq-prop-tag eq-prop-alu">Aluguer</span>' : '<span class="eq-prop-tag eq-prop-pla">Plandese</span>';
}
function eqEstadoBadge(e){
  const c = EQ_ESTADOS[e]||EQ_ESTADOS.operacional;
  return `<span class="eq-est-badge ${c.cls}">${c.label}</span>`;
}
function eqPendentes(id){ return EQ_MANUT.filter(m=>m.equipId===id && m.estado==='pendente'); }
function eqValChip(label, iso){
  if(!iso) return '';
  const dias = Math.ceil((new Date(iso+'T00:00:00') - new Date().setHours(0,0,0,0))/86400000);
  const cls  = dias<0?'bad':dias<=30?'warn':'ok';
  const txt  = dias<0?`expirado há ${-dias} d`:dias===0?'hoje':eqDatePT(iso);
  return `<span class="eq-val-chip ${cls}" title="${label}: ${eqDatePT(iso)}">${label} ${txt}</span>`;
}

// ── Mapeamento linha Supabase <-> objeto local ──
function eqFromRow(row){
  return {
    id:row.id, nome:row.nome, categoria:eqCatNorm(row.categoria),
    serie:row.serie||'', descricao:row.descricao||'',
    criadoEm:row.criado_em||new Date().toISOString(),
    obraId:row.obra_id||null, ultimoLocal:row.ultimo_local||null, ultimoLat:row.ultimo_lat||null,
    ultimoLng:row.ultimo_lng||null, ultimoRegisto:row.ultimo_registo||null,
    codigo:row.codigo||'', matricula:row.matricula||'', marcaModelo:row.marca_modelo||'',
    ano:row.ano==null?'':row.ano, combustivel:row.combustivel||'',
    propriedade:row.propriedade||'propria', estado:row.estado||'operacional',
    condutor:row.condutor||'', kmsHoras:row.kms_horas==null?'':row.kms_horas,
    seguroValidade:row.seguro_validade||'', ipoValidade:row.ipo_validade||'',
    fornecedor:row.fornecedor||'', dataAquisicao:row.data_aquisicao||'',
    valorAquisicao:row.valor_aquisicao==null?'':row.valor_aquisicao, garantiaAte:row.garantia_ate||''
  };
}
function eqToRow(eq){
  return {
    id:eq.id, nome:eq.nome, categoria:eq.categoria,
    serie:eq.serie||null, descricao:eq.descricao||null, criado_em:eq.criadoEm,
    obra_id:eq.obraId||null, ultimo_local:eq.ultimoLocal||null, ultimo_lat:eq.ultimoLat||null,
    ultimo_lng:eq.ultimoLng||null, ultimo_registo:eq.ultimoRegisto||null,
    codigo:eq.codigo||null, matricula:eq.matricula||null, marca_modelo:eq.marcaModelo||null,
    ano:eqNum(eq.ano), combustivel:eq.combustivel||null,
    propriedade:eq.propriedade||'propria', estado:eq.estado||'operacional',
    condutor:eq.condutor||null, kms_horas:eqNum(eq.kmsHoras),
    seguro_validade:eq.seguroValidade||null, ipo_validade:eq.ipoValidade||null,
    fornecedor:eq.fornecedor||null, data_aquisicao:eq.dataAquisicao||null,
    valor_aquisicao:eqNum(eq.valorAquisicao), garantia_ate:eq.garantiaAte||null,
    atualizado_em:new Date().toISOString()
  };
}
function eqManutFromRow(row){
  return { id:row.id, equipId:row.equip_id, data:row.data||'', descricao:row.descricao,
           custo:row.custo==null?'':row.custo, estado:row.estado||'pendente',
           origem:row.origem||'portal', solicitanteNome:row.solicitante_nome||'',
           obraNome:row.obra_nome||'', criadoEm:row.criado_em, fotos:row.fotos||[] };
}

// ── Helpers ────────────────────────────
function eqTimeAgo(d){
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff/60000);
  if(m < 1)  return 'agora mesmo';
  if(m < 60) return `há ${m} min`;
  const h = Math.floor(m/60);
  if(h < 24) return `há ${h}h`;
  const days = Math.floor(h/24);
  if(days === 1) return 'ontem';
  if(days < 30)  return `há ${days} dias`;
  return d.toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit',year:'numeric'});
}
function eqFmtDt(d){
  if(!(d instanceof Date)||isNaN(d)) return '—';
  return d.toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit',year:'numeric'}) +
         ' ' + d.toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'});
}
function showEqAlert(msg){
  const el = document.getElementById('eq-alert');
  if(!el) return;
  el.textContent = msg; el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), 3000);
}

// ── Badges (contagem na sidebar + pendentes na tab de manutenção) ──
// ── Portal em computador: indicadores, filtros por estado e cartões ──
const _eqDesk = () => document.body.classList.contains('device-desktop') && !document.body.classList.contains('enc-mode');
let _eqEstFiltro = 'todos';
let _eqCatFiltro = 'todas';
let _eqVista = 'lista';   // 'lista' (por defeito) | 'cartoes'
try{ if(localStorage.getItem('plandese_eq_vista')==='cartoes') _eqVista='cartoes'; }catch(e){}
const _EQ_IC = {
  equipamento:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M5 16v-4h5v4M10 12l4-7 5 5M19 10l1.5 4H17"/></svg>',
  veiculo_passageiros:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>',
  veiculo_mercadorias:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17V8a1 1 0 0 1 1-1h9v10M13 10h4l3 3v4h-2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M9 17h6"/></svg>',
  veiculo_pesado:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 17V6a1 1 0 0 1 1-1h11v12M13 9h5l3 4v4"/><circle cx="5.5" cy="17.5" r="2"/><circle cx="10.5" cy="17.5" r="2"/><circle cx="18" cy="17.5" r="2"/><path d="M1 17h2.5M12.5 17H16"/></svg>'
};
function _eqGrupoEstado(e){ return e==='operacional'?'operacional':(e==='manutencao'||e==='oficina')?'manutencao':e==='parada'?'parada':'operacional'; }
function _eqRenderKpisDesk(){
  const box = document.getElementById('eq-kpis-d');
  if(!box) return;
  if(!_eqDesk()){ box.innerHTML=''; return; }
  const n = g => EQUIPAMENTOS.filter(e=>_eqGrupoEstado(e.estado)===g).length;
  const hoje = new Date().setHours(0,0,0,0);
  const expira = EQUIPAMENTOS.filter(e=>[e.seguroValidade,e.ipoValidade,e.garantiaAte].some(d=>d && Math.ceil((new Date(d+'T00:00:00')-hoje)/86400000)<=30)).length;
  const k = (cls,l,v,sub)=>`<div class="cmp-kpi ${cls}"><div class="cmp-kpi-label">${l}</div><div class="cmp-kpi-value">${v}</div><div class="cmp-kpi-sub">${sub}</div></div>`;
  box.innerHTML = k('blue','Equipamentos',EQUIPAMENTOS.length,'na base de dados')+k('green','Operacionais',n('operacional'),'prontos a trabalhar')
    + k('yellow','Em manutenção',n('manutencao'),'manutenção ou oficina')+k('red','Parados',n('parada'),'sem poder trabalhar')
    + k('orange','Validades',expira,'seguro, IPO ou garantia a ≤ 30 dias');
}
const _EQ_CAT_CURTO = {equipamento:'Equipamento', veiculo_passageiros:'Ligeiros passageiros', veiculo_mercadorias:'Ligeiros mercadorias', veiculo_pesado:'Pesados'};
function _eqRenderChipsDesk(){
  const box = document.getElementById('eq-chips-d');
  if(!box) return;
  if(!_eqDesk()){ box.innerHTML=''; return; }
  box.innerHTML = [['todas','Todas','Todas as categorias'],...Object.entries(EQ_CATS).map(([k,v])=>[k,_EQ_CAT_CURTO[k],v.label])]
      .map(([k,l,t])=>`<button type="button" class="d-chip-f${_eqCatFiltro===k?' on':''}" data-eqc="${k}" title="${eqEsc(t)}">${l}${k==='todas'?'':`<b>${EQUIPAMENTOS.filter(e=>eqCatNorm(e.categoria)===k).length}</b>`}</button>`).join('')
    + `<div class="eq-vista-tg" role="group" aria-label="Vista">
        <button type="button" class="${_eqVista==='lista'?'on':''}" data-eqv="lista" title="Ver em lista"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg><span>Lista</span></button>
        <button type="button" class="${_eqVista==='cartoes'?'on':''}" data-eqv="cartoes" title="Ver em cartões"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg><span>Cartões</span></button>
      </div>`;
}
function _eqRowDesk(eq){
  const fd = iso => iso ? iso.slice(0,10).split('-').reverse().join('/') : '—';
  const ms = EQ_MANUT.filter(m=>m.equipId===eq.id && m.data);
  const feitas = ms.filter(m=>m.estado!=='pendente').map(m=>m.data).sort();
  const pend = ms.filter(m=>m.estado==='pendente').map(m=>m.data).sort();
  const quando = eq.ultimoRegisto ? eqTimeAgo(new Date(eq.ultimoRegisto)) : '';
  const ident = [eq.codigo, eq.matricula].filter(Boolean).map(eqEsc).join(' · ') || '—';
  return `<tr onclick="abrirEqDetalhe('${eq.id}')">
    <td><span class="eq-t-nome"><span class="d-ic sm">${_EQ_IC[eqCatNorm(eq.categoria)]}</span><b title="${eqEsc(eq.nome)}">${eqEsc(eq.nome)}</b></span></td>
    <td>${eqEsc(EQ_CATS[eqCatNorm(eq.categoria)].label)}</td>
    <td>${ident}</td>
    <td>${eqPropBadge(eq)}</td>
    <td>${eqEstadoBadge(eq.estado)}</td>
    <td>${eqEsc(eqObraNome(eq)||'—')}${quando?` <small class="eq-t-quando">${eqEsc(quando)}</small>`:''}</td>
    <td>${fd(feitas[feitas.length-1])}</td><td>${fd(pend[0])}</td></tr>`;
}
function _eqTabelaDesk(lista){
  return `<div class="eq-tbl-wrap"><table class="eq-tbl"><thead><tr><th>Equipamento</th><th>Categoria</th><th>Código / Matrícula</th><th>Propriedade</th><th>Estado</th><th>Obra / Centro de custo</th><th>Últ. manutenção</th><th>Próxima</th></tr></thead><tbody>${lista.map(_eqRowDesk).join('')}</tbody></table></div>`;
}
function _eqCardDesk(eq){
  const ult = eq.ultimoLocal || 'Sem localização registada';
  const sub = [eq.codigo, eq.matricula].filter(Boolean).map(eqEsc).join(' · ');
  const quando = eq.ultimoRegisto ? eqTimeAgo(new Date(eq.ultimoRegisto)) : '';
  const fd = iso => iso ? iso.slice(0,10).split('-').reverse().join('/') : '—';
  const ms = EQ_MANUT.filter(m=>m.equipId===eq.id && m.data);
  const feitas = ms.filter(m=>m.estado!=='pendente').map(m=>m.data).sort();
  const pend = ms.filter(m=>m.estado==='pendente').map(m=>m.data).sort();
  return `<div class="d-card eq-d-card" onclick="abrirEqDetalhe('${eq.id}')">
    <div class="d-card-top eq-d-top"><span class="d-ic">${_EQ_IC[eqCatNorm(eq.categoria)]}</span>
      <div class="d-card-tt"><b title="${eqEsc(eq.nome)}">${eqEsc(eq.nome)}</b><small>${sub||eqEsc(EQ_CATS[eqCatNorm(eq.categoria)].label)}</small></div>${eqEstadoBadge(eq.estado)}</div>
    <div class="eq-d-loc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg><span>${eqEsc(ult)}</span>${quando?`<small>${quando}</small>`:''}</div>
    <div class="d-card-kv"><div>Última manutenção<b>${fd(feitas[feitas.length-1])}</b></div><div>Próxima<b>${fd(pend[0])}</b></div></div>
  </div>`;
}
document.addEventListener('click', ev => {
  const v = ev.target.closest('[data-eqv]');
  if(v){
    _eqVista = v.dataset.eqv==='cartoes' ? 'cartoes' : 'lista';
    try{ localStorage.setItem('plandese_eq_vista', _eqVista); }catch(e){}
    renderEqBusca();
    return;
  }
  const c = ev.target.closest('[data-eqc]');
  if(c){ _eqCatFiltro = c.dataset.eqc; renderEqBusca(); return; }
  const b = ev.target.closest('[data-eqf]');
  if(!b) return;
  _eqEstFiltro = b.dataset.eqf;
  renderEqBusca();
});

function updateEqKPIs(){
  const total = EQUIPAMENTOS.length;
  const nb = document.getElementById('nb-eq');
  if(nb) nb.textContent = total;
  const equipIds = new Set(EQUIPAMENTOS.map(e=>e.id));
  const nPendManut = EQ_MANUT.filter(m=>m.estado==='pendente' && equipIds.has(m.equipId)).length;
  const nbManut = document.getElementById('eq-tab-manut-nb');
  if(nbManut){ nbManut.hidden = !nPendManut; nbManut.textContent = nPendManut; }
}

// ── Vistas (Lista / Por Obra / Manutenção) ─
function switchEqView(view){
  _eqView = view;
  ['lista','obra','manut','loc'].forEach(v=>{
    const panel = document.getElementById('eq-view-'+v);
    const btn   = document.getElementById('eq-tab-btn-'+v);
    if(panel) panel.style.display = v===view ? '' : 'none';
    if(btn)   btn.classList.toggle('active', v===view);
  });
  if(view==='obra')  renderEqPorObra();
  if(view==='manut') renderEqManutBoard();
  if(view==='loc'){ if(!_eqMap) initEqMap(); else { _eqMap.invalidateSize(); refreshEqMap(); } }
}

// ── Vista "Por Obra" ────────────────────
function renderEqPorObra(){
  const grid  = document.getElementById('eq-obras-grid');
  const empty = document.getElementById('eq-obras-empty');
  if(!grid) return;
  const map = {};
  EQUIPAMENTOS.forEach(eq=>{
    // agrupa pela obra associada (assim 0065/O065 ficam juntos); sem obra, pelo texto do último local
    const key = eq.obraId || eq.ultimoLocal || '__sem_local__';
    if(!map[key]) map[key] = { nome: eqObraNome(eq) || 'Sem localização registada', items: [] };
    map[key].items.push(eq);
  });
  const semLocal = map['__sem_local__'];
  delete map['__sem_local__'];
  const obras = Object.values(map).sort((a,b)=>a.nome.localeCompare(b.nome,'pt'));
  if(semLocal) obras.push(semLocal);
  _eqObraGroups = obras;
  if(!obras.length){ grid.innerHTML=''; if(empty) empty.style.display=''; return; }
  if(empty) empty.style.display='none';
  grid.innerHTML = obras.map((ob,i)=>{
    const total = ob.items.length;
    const op    = ob.items.filter(e=>(e.estado||'operacional')==='operacional').length;
    const man   = ob.items.filter(e=>['manutencao','oficina'].includes(e.estado)).length;
    const par   = ob.items.filter(e=>e.estado==='parada').length;
    const pend  = ob.items.reduce((s,e)=>s+eqPendentes(e.id).length,0);
    const chips = [
      op  ? `<span style="font-size:11px;font-weight:600;color:var(--green,#16a34a)">${op!==1?op+' operacionais':op+' operacional'}</span>` : '',
      man ? `<span style="font-size:11px;font-weight:600;color:#b45309">${man} em manutenção</span>` : '',
      par ? `<span style="font-size:11px;font-weight:600;color:#b91c1c">${par} parado${par!==1?'s':''}</span>` : ''
    ].filter(Boolean).join(' · ');
    return `<div class="card" style="padding:16px 18px;cursor:pointer" onclick="abrirEqObraDetalhe(${i})" onmouseover="this.style.boxShadow='0 4px 14px rgba(0,0,0,.08)'" onmouseout="this.style.boxShadow=''">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div style="min-width:0">
          <div style="font-size:14px;font-weight:700;color:var(--gray-900);line-height:1.3;overflow-wrap:anywhere">${eqEsc(ob.nome)}</div>
          <div style="font-size:11px;color:var(--gray-400);margin-top:3px">${total} equipamento${total!==1?'s':''}${chips?' · '+chips:''}</div>
        </div>
        ${pend?`<div style="background:#fef2f2;border:1.5px solid #fecaca;border-radius:10px;padding:8px 12px;text-align:center;flex-shrink:0">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#b91c1c">Pendente</div>
          <div style="font-size:18px;font-weight:700;color:#b91c1c;line-height:1">${pend}</div>
        </div>`:''}
      </div>
    </div>`;
  }).join('');
}

function _eqObraRowHtml(eq){
  const pend = eqPendentes(eq.id).length;
  return `<div style="display:flex;align-items:center;gap:10px;padding:10px 2px;border-bottom:1px solid var(--gray-100)">
    <div style="flex:1;min-width:0">
      <div style="font-size:13px;font-weight:600;color:var(--gray-900)">${eqEsc(eq.nome)}</div>
      <div style="font-size:11px;color:var(--gray-400);margin-top:1px">${[eqCatBadge(eq.categoria),eqEstadoBadge(eq.estado),eqPropBadge(eq)].join(' ')}</div>
    </div>
    <button class="btn btn-secondary btn-sm" onclick="openEqManut('${eq.id}')" title="Manutenção">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>${pend?`<span class="eq-pend-dot">${pend}</span>`:''}
    </button>
    <button class="btn btn-secondary btn-sm" onclick="editEquipamento('${eq.id}')" title="Editar">
      <svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
    </button>
  </div>`;
}

// Parados e em manutenção/oficina primeiro; depois os operacionais
const _eqOrdemEstado = eq => ({parada:0, manutencao:1, oficina:1})[eq.estado] ?? 2;
function abrirEqObraDetalhe(i){
  const ob = _eqObraGroups[i]; if(!ob) return;
  document.getElementById('meqo-title').textContent = ob.nome;
  document.getElementById('meqo-sub').textContent = `${ob.items.length} equipamento${ob.items.length!==1?'s':''}`;
  document.getElementById('meqo-list').innerHTML = ob.items
    .sort((a,b)=>_eqOrdemEstado(a)-_eqOrdemEstado(b)||a.nome.localeCompare(b.nome,'pt'))
    .map(_eqObraRowHtml).join('');
  openModal('modal-eq-obra-detalhe');
}

// ── Vista "Manutenção" (quadro Pendente/Resolvida) ──
// Miniaturas das fotografias de um pedido (bucket privado → URLs assinados, carregados após o render)
function eqManutFotosHtml(m){
  if(!m.fotos?.length) return '';
  return `<div class="eq-manut-fotos" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">`+
    m.fotos.map(p=>`<img data-foto-path="${eqEsc(p)}" alt="Fotografia" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--gray-200,#e4e9f1);background:var(--gray-100,#f1f4f9);cursor:zoom-in" onclick="event.stopPropagation();eqManutFotoAbrir(this)"/>`).join('')+`</div>`;
}
async function eqManutCarregarFotos(root){
  const imgs=[...(root?.querySelectorAll('img[data-foto-path]:not([src])')||[])];
  if(!imgs.length) return;
  const paths=[...new Set(imgs.map(i=>i.dataset.fotoPath))];
  const {data,error}=await sb.storage.from('eq-manut-fotos').createSignedUrls(paths,3600);
  if(error||!data) return;
  const map=Object.fromEntries(data.map(d=>[d.path,d.signedUrl]));
  imgs.forEach(i=>{ if(map[i.dataset.fotoPath]) i.src=map[i.dataset.fotoPath]; });
}
function eqManutFotoAbrir(img){
  if(!img.src) return;
  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:16px;cursor:zoom-out';
  ov.innerHTML=`<img src="${img.src}" style="max-width:100%;max-height:100%;border-radius:10px"/>`;
  ov.onclick=()=>ov.remove();
  document.body.appendChild(ov);
}

function eqManutOrigemBadge(m){
  const isEnc = m.origem==='encarregado';
  return `<span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;padding:2px 7px;border-radius:5px;background:${isEnc?'var(--blue-50)':'var(--gray-100)'};color:${isEnc?'var(--blue-600)':'var(--gray-500)'};flex-shrink:0">${isEnc?'Encarregado':'Portal'}</span>`;
}

function _eqManutFillFiltros(){
  const selObra = document.getElementById('eq-manut-f-obra');
  if(selObra){
    const locs = [...new Set(EQUIPAMENTOS.map(e=>e.ultimoLocal).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt'));
    const cur = selObra.value;
    selObra.innerHTML = '<option value="">Todas as obras</option>' + locs.map(l=>`<option value="${eqEsc(l)}">${eqEsc(l)}</option>`).join('');
    if(locs.includes(cur)) selObra.value = cur;
  }
  const selEquip = document.getElementById('eq-manut-f-equip');
  if(selEquip){
    const cur = selEquip.value;
    const ordenados = EQUIPAMENTOS.slice().sort((a,b)=>a.nome.localeCompare(b.nome,'pt'));
    selEquip.innerHTML = '<option value="">Todos os equipamentos</option>' + ordenados.map(e=>`<option value="${e.id}">${eqEsc(e.nome)}</option>`).join('');
    if(EQUIPAMENTOS.some(e=>e.id===cur)) selEquip.value = cur;
  }
}

function renderEqManutBoard(){
  _eqManutFillFiltros();
  const obraFilt  = document.getElementById('eq-manut-f-obra')?.value  || '';
  const equipFilt = document.getElementById('eq-manut-f-equip')?.value || '';
  const equipMap  = Object.fromEntries(EQUIPAMENTOS.map(e=>[e.id,e]));
  let items = EQ_MANUT.filter(m=>equipMap[m.equipId]);
  if(equipFilt) items = items.filter(m=>m.equipId===equipFilt);
  if(obraFilt)  items = items.filter(m=>(equipMap[m.equipId]?.ultimoLocal||'')===obraFilt);
  const pend = items.filter(m=>m.estado==='pendente').sort((a,b)=>new Date(b.criadoEm)-new Date(a.criadoEm));
  const done = items.filter(m=>m.estado==='resolvida').sort((a,b)=>new Date(b.criadoEm)-new Date(a.criadoEm));

  const cardHtml = m=>{
    const eq   = equipMap[m.equipId];
    const meta = [m.data?eqDatePT(m.data):'', m.custo!==''?(+m.custo).toLocaleString('pt-PT',{minimumFractionDigits:2})+' €':''].filter(Boolean).join(' · ');
    const rodape = [eq?.ultimoLocal, meta, m.solicitanteNome].filter(Boolean).join(' · ');
    return `<div class="card" style="padding:12px 14px;margin-bottom:10px;cursor:pointer" onclick="openEqManut('${m.equipId}')">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
        <div style="font-size:13px;font-weight:700;color:var(--gray-900)">${eqEsc(eq?eq.nome:m.equipId)}</div>
        ${eqManutOrigemBadge(m)}
      </div>
      <div style="font-size:12px;color:var(--gray-600);margin-top:5px">${eqEsc(m.descricao)}</div>
      ${rodape?`<div style="font-size:11px;color:var(--gray-400);margin-top:6px">${eqEsc(rodape)}</div>`:''}
      ${eqManutFotosHtml(m)}
    </div>`;
  };
  const colP = document.getElementById('eq-manut-col-pendente');
  const colD = document.getElementById('eq-manut-col-resolvida');
  if(colP) colP.innerHTML = pend.length ? pend.map(cardHtml).join('') : '<div style="text-align:center;padding:20px;color:var(--gray-300);font-size:12px">Sem manutenções pendentes</div>';
  if(colD) colD.innerHTML = done.length ? done.map(cardHtml).join('') : '<div style="text-align:center;padding:20px;color:var(--gray-300);font-size:12px">Sem manutenções resolvidas</div>';
  eqManutCarregarFotos(colP); eqManutCarregarFotos(colD);
  const cP = document.getElementById('eq-manut-count-pend'); if(cP) cP.textContent = pend.length;
  const cD = document.getElementById('eq-manut-count-done'); if(cD) cD.textContent = done.length;
}

function abrirEqManutPicker(){
  const search = document.getElementById('eqmp-search');
  if(search) search.value='';
  _renderEqManutPickList('');
  openModal('modal-eq-manut-pick');
}

function _renderEqManutPickList(term){
  const list = document.getElementById('eqmp-list');
  if(!list) return;
  const t = term.toLowerCase().trim();
  const items = EQUIPAMENTOS
    .filter(e=>!t || [e.nome,e.matricula,e.codigo].join(' ').toLowerCase().includes(t))
    .sort((a,b)=>a.nome.localeCompare(b.nome,'pt'))
    .slice(0,60);
  list.innerHTML = items.length ? items.map(e=>`<button type="button" onclick="closeModal('modal-eq-manut-pick');openEqManut('${e.id}')" style="display:block;width:100%;text-align:left;padding:9px 10px;border:none;border-bottom:1px solid var(--gray-100);background:none;cursor:pointer;font-family:var(--font);font-size:13px;color:var(--gray-800)">
    <strong>${eqEsc(e.nome)}</strong>${e.ultimoLocal?` <span style="color:var(--gray-400);font-size:11px">· ${eqEsc(e.ultimoLocal)}</span>`:''}
  </button>`).join('') : '<div style="padding:16px;text-align:center;color:var(--gray-400);font-size:12px">Sem resultados</div>';
}

function eqManutPickFiltra(v){ _renderEqManutPickList(v); }

// ── KPIs (sem tabela — a vista "Lista" usa apenas mapa + pesquisa) ──
function renderEquipamentos(){
  updateEqKPIs();
  if(_eqDesk()) renderEqBusca();
}

// ── Pesquisa de equipamento (vista "Lista") ──
function _eqBuscaRowHtml(eq){
  const ult  = eq.ultimoLocal||'Sem localização registada';
  const sub  = [eq.matricula, eq.codigo&&('Nº '+eq.codigo), eq.marcaModelo].filter(Boolean).map(eqEsc).join(' · ');
  const pend = eqPendentes(eq.id).length;
  const vals = eqValChip('Seguro',eq.seguroValidade)+eqValChip('IPO',eq.ipoValidade)+eqValChip('Garantia',eq.garantiaAte);
  return `<div class="card eq-row" style="padding:12px 16px;margin-bottom:8px;cursor:pointer" onclick="abrirEqDetalhe('${eq.id}')">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-weight:700;color:var(--gray-900)">${eqEsc(eq.nome)}</span>
          ${eqCatBadge(eq.categoria)}${eqEstadoBadge(eq.estado)}${eq.propriedade==='aluguer'?'<span class="eq-prop-badge">Aluguer</span>':''}${pend?`<span class="eq-pend-dot" title="Manutenções pendentes" style="position:static">${pend}</span>`:''}
        </div>
        ${sub?`<div style="font-size:12px;color:var(--gray-500);margin-top:3px">${sub}</div>`:''}
        <div style="font-size:11px;color:var(--gray-400);margin-top:3px">${eqEsc(ult)}</div>
        ${vals?`<div style="margin-top:4px">${vals}</div>`:''}
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>
    </div>
  </div>`;
}

// Janela de detalhe do equipamento: escolher entre QR, manutenção, histórico e edição
// (as outras janelas abrem por cima desta, que fica por baixo)
function abrirEqDetalhe(id){
  const eq = EQUIPAMENTOS.find(e=>e.id===id); if(!eq) return;
  const pend = eqPendentes(eq.id).length;
  const sub  = [eq.matricula, eq.codigo&&('Nº '+eq.codigo), eq.marcaModelo].filter(Boolean).map(eqEsc).join(' · ');
  const opt = (icon,titulo,desc,click,extra='')=>`<button type="button" onclick="${click}" style="display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding:20px;text-align:left;cursor:pointer;background:var(--card-bg,rgba(255,255,255,.62));border:1px solid var(--gray-200,#e4e9f1);border-radius:16px;color:var(--gray-900)">
      <span style="display:flex;align-items:center;gap:8px;color:var(--blue,#2563eb)">${icon}${extra}</span>
      <span style="font-size:15px;font-weight:700">${titulo}</span>
      <span style="font-size:12px;color:var(--gray-500)">${desc}</span></button>`;
  const box = document.getElementById('meqd-body'); if(!box) return;
  box.innerHTML = `<div class="dr-h" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="dr-t" style="font-size:18px;font-weight:700;color:var(--gray-900)">${eqEsc(eq.nome)}</span>
        ${eqCatBadge(eq.categoria)}${eqEstadoBadge(eq.estado)}
      </div>
      ${sub?`<div style="font-size:12px;color:var(--gray-500);margin-top:4px">${sub}</div>`:''}
      <div style="font-size:12px;color:var(--gray-400);margin-top:3px">${eqEsc(eq.ultimoLocal||'Sem localização registada')}</div>
    </div>
    ${eq.propriedade==='aluguer'?`<div id="meqd-aluguer" class="eq-alu-box"></div>`:''}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
      ${opt(`<svg viewBox="0 0 24 24" fill="currentColor" style="width:28px;height:28px"><path d="M3 11h8V3H3v8zm2-6h4v4H5V5zM3 21h8v-8H3v8zm2-6h4v4H5v-4zM13 3v8h8V3h-8zm6 6h-4V5h4v4zM13 13h2v2h-2zm2 2h2v2h-2zm2-2h2v2h-2zm-4 4h2v2h-2zm2 2h2v2h-2zm2-4h2v2h-2zm0 4h2v2h-2z"/></svg>`,'QR Code','Ver e imprimir o código do equipamento',`showQrCode('${eq.id}')`)}
      ${opt(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:28px;height:28px"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,'Manutenção','Pedidos e registos de manutenção',`openEqManut('${eq.id}')`,pend?`<span class="eq-pend-dot">${pend}</span>`:'')}
      ${opt(`<svg viewBox="0 0 24 24" fill="currentColor" style="width:28px;height:28px"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>`,'Histórico','Movimentos e localizações anteriores',`showEqHistorico('${eq.id}')`)}
      ${opt(`<svg viewBox="0 0 24 24" fill="currentColor" style="width:28px;height:28px"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`,'Editar registo','Alterar os dados do equipamento',`editEquipamento('${eq.id}')`)}
      ${opt(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:28px;height:28px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,'Localização',(eq.ultimoLat&&eq.ultimoLng?'<span id="meqd-cidade">A obter cidade…</span>':'Sem localização GPS registada'),`eqVerLocalizacao('${eq.id}')`)}
    </div>`;
  openModal('modal-eq-det');
  if(eq.propriedade==='aluguer') eqAluguerCarregar(eq.id);
  if(eq.ultimoLat&&eq.ultimoLng) eqCidade(eq.ultimoLat,eq.ultimoLng).then(c=>{ const el=document.getElementById('meqd-cidade'); if(el) el.textContent=c||'Ver no mapa onde está o equipamento'; });
}

// ── Equipamentos de aluguer: pedido de recolha e histórico de entregas/recolhas em obra ──
const _eqHoje = ()=>{ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const _eqFd = iso => iso ? iso.slice(0,10).split('-').reverse().join('/') : '—';
const _eqDias = (a,b)=>{ const t=x=>Date.UTC(+x.slice(0,4),+x.slice(5,7)-1,+x.slice(8,10)); return Math.max(1,Math.round((t(b)-t(a))/86400000)); };
const EQ_ALUGUERES = {};
async function eqAluguerCarregar(id){
  try{
    const {data,error}=await sb.from('eq_alugueres').select('*').eq('equip_id',id).order('entrega_em',{ascending:false}).order('id',{ascending:false});
    if(error) throw error;
    EQ_ALUGUERES[id]=data||[];
  }catch(e){ console.warn('eqAluguerCarregar:',e); EQ_ALUGUERES[id]=EQ_ALUGUERES[id]||[]; }
  eqAluguerRender(id);
}
function eqAluguerRender(id){
  const box=document.getElementById('meqd-aluguer'); if(!box) return;
  const rows=EQ_ALUGUERES[id]||[], hoje=_eqHoje();
  const atual=rows.find(r=>!r.recolhido_em);
  let cls,tit,sub;
  if(atual&&atual.pedido_recolha_em){ cls='eq-alu-btn eq-alu-amarelo'; tit='Recolha pedida em '+_eqFd(atual.pedido_recolha_em); sub='Volta a clicar quando a recolha já tiver sido feita'; }
  else if(!atual&&rows.length){ cls='eq-alu-btn eq-alu-vermelho'; tit='Equipamento já recolhido'; sub='Volta a clicar se o equipamento for entregue de novo em obra'; }
  else { cls='eq-alu-btn eq-alu-azul'; tit='Pedido de recolha'; sub='Clica para pedir ao fornecedor a recolha do equipamento'; }
  const linhas=rows.map(r=>{
    const fim=r.recolhido_em||hoje, dias=_eqDias(r.entrega_em,fim);
    return `<tr><td>${eqEsc(r.obra_nome||'—')}</td><td>${_eqFd(r.entrega_em)}</td><td>${r.recolhido_em?_eqFd(r.recolhido_em):'<span class="eq-alu-em">Em obra</span>'}</td><td class="r">${dias} ${dias===1?'dia':'dias'}</td></tr>`;
  }).join('');
  const total=rows.reduce((t,r)=>t+_eqDias(r.entrega_em,r.recolhido_em||hoje),0);
  box.innerHTML=`<button type="button" class="${cls}" onclick="eqAluguerClick('${id}')"><b>${tit}</b><small>${sub}</small></button>
    ${rows.length?`<div class="eq-alu-hist"><div class="eq-alu-h">Histórico em obra</div><table><thead><tr><th>Obra</th><th>Entregue</th><th>Recolhido</th><th class="r">Dias</th></tr></thead><tbody>${linhas}</tbody><tfoot><tr><td colspan="3">Total em obra</td><td class="r">${total} ${total===1?'dia':'dias'}</td></tr></tfoot></table></div>`:''}`;
}
async function eqAluguerClick(id){
  const eq=EQUIPAMENTOS.find(e=>e.id===id); if(!eq) return;
  const rows=EQ_ALUGUERES[id]||[], hoje=_eqHoje(), atual=rows.find(r=>!r.recolhido_em);
  let r;
  if(atual&&atual.pedido_recolha_em){
    r=await sb.from('eq_alugueres').update({recolhido_em:hoje}).eq('id',atual.id);
  } else if(atual){
    r=await sb.from('eq_alugueres').update({pedido_recolha_em:hoje}).eq('id',atual.id);
  } else {
    // novo ciclo: a entrega é o primeiro movimento registado depois da última recolha (ou hoje, se não houver)
    let entrega=hoje;
    try{
      const ultima=rows.length?rows[0].recolhido_em:null;
      let q=sb.from('eq_movimentos').select('criado_em').eq('equip_id',id).order('criado_em',{ascending:true}).limit(1);
      if(ultima) q=q.gt('criado_em',ultima+'T23:59:59');
      const {data}=await q;
      if(data&&data[0]&&!ultima) entrega=data[0].criado_em.slice(0,10);
    }catch(e){}
    r=await sb.from('eq_alugueres').insert(rows.length?{equip_id:id,obra_nome:eq.ultimoLocal||null,entrega_em:hoje}:{equip_id:id,obra_nome:eq.ultimoLocal||null,entrega_em:entrega,pedido_recolha_em:hoje});
  }
  if(r&&r.error){ console.warn('eqAluguerClick:',r.error); showToast('Não foi possível guardar o pedido de recolha'); return; }
  eqAluguerCarregar(id);
}

// ── Ler o QR code de um equipamento (câmara ao vivo ou fotografia) e abrir as suas opções ──
let _eqQr = null;
async function eqQrParar(){
  const q=_eqQr; _eqQr=null;
  if(q){ try{ await q.stop(); }catch(e){} try{ q.clear(); }catch(e){} }
}
function eqQrMsg(t){ const el=document.getElementById('eq-qr-msg'); if(el) el.textContent=t||''; }
function eqQrAbrir(){
  eqQrMsg('');
  document.getElementById('eq-qr-reader').innerHTML='';
  openModal('modal-eq-qr');
  setTimeout(async ()=>{
    if(typeof Html5Qrcode==='undefined'){ eqQrMsg('Leitor indisponível — use "Tirar fotografia".'); return; }
    await eqQrParar();
    _eqQr=new Html5Qrcode('eq-qr-reader');
    _eqQr.start({facingMode:'environment'},{fps:10,qrbox:{width:230,height:230}},txt=>eqQrLido(txt),()=>{})
      .catch(err=>{ console.warn('eqQrAbrir:',err); _eqQr=null; eqQrMsg('Câmara não acessível — use "Tirar fotografia".'); });
  },250);
}
async function eqQrFechar(){ await eqQrParar(); closeModal('modal-eq-qr'); }
async function eqQrFoto(inp){
  const f=inp.files&&inp.files[0]; inp.value=''; if(!f) return;
  await eqQrParar();
  eqQrMsg('A ler a fotografia…');
  try{
    const q=new Html5Qrcode('eq-qr-reader');
    const txt=await q.scanFile(f,false);
    try{ q.clear(); }catch(e){}
    eqQrLido(txt);
  }catch(e){ eqQrMsg('Não foi possível ler o QR code. Tente outra fotografia, mais perto e com boa luz.'); }
}
async function eqQrLido(texto){
  let id=null;
  try{ id=new URL(texto).searchParams.get('reg'); }catch(e){}
  if(!id) id=String(texto||'').trim();
  let eq=EQUIPAMENTOS.find(e=>e.id===id);
  if(!eq){
    eq=await sbFetchEquipamentoById(id);
    if(eq){ EQUIPAMENTOS.push(eq); saveEqLocal(); }
  }
  if(!eq){ eqQrMsg('QR code não reconhecido como equipamento Plandese.'); return; }
  await eqQrFechar();
  abrirEqDetalhe(eq.id);
}

// Morada a partir das coordenadas (geocodificação inversa OpenStreetMap, com cache em memória)
const _eqMoradaCache = {};
async function eqMorada(lat,lng){
  const k=(+lat).toFixed(4)+','+(+lng).toFixed(4);
  if(k in _eqMoradaCache) return _eqMoradaCache[k];
  let m={rua:'',cidade:'',concelho:''};
  try{
    const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=pt&lat=${lat}&lon=${lng}`);
    const a=(await r.json()).address||{};
    const cidade=a.city||a.town||a.village||a.hamlet||a.suburb||'';
    // Em Portugal o OSM põe o distrito em 'county'; o concelho vem em 'municipality' ou na sede (city/town)
    const concelho=a.municipality||a.city||a.town||a.village||'';
    m={ rua:a.road||a.pedestrian||a.neighbourhood||'', cidade, concelho };
  }catch(e){ console.warn('eqMorada:',e); return m; }
  if(m.cidade||m.rua) _eqMoradaCache[k]=m;
  return m;
}
const eqCidade = (lat,lng)=>eqMorada(lat,lng).then(m=>m.cidade);

// Janela com um mapa pequeno mostrando onde está o equipamento (fica por cima da janela de opções)
let _eqLocMap = null;
function eqVerLocalizacao(id){
  const eq = EQUIPAMENTOS.find(e=>e.id===id); if(!eq) return;
  const temGps = !!(eq.ultimoLat&&eq.ultimoLng);
  document.getElementById('meql-title').textContent = eq.nome;
  document.getElementById('meql-sub').textContent = [eq.ultimoLocal||'Sem obra registada', eq.ultimoRegisto?eqTimeAgo(new Date(eq.ultimoRegisto)):''].filter(Boolean).join(' · ');
  const mapEl=document.getElementById('meql-map'), vazio=document.getElementById('meql-vazio');
  mapEl.style.display = temGps ? '' : 'none';
  vazio.style.display = temGps ? 'none' : '';
  const mor=document.getElementById('meql-morada'); mor.textContent=''; mor.style.display=temGps?'':'none';
  openModal('modal-eq-loc');
  if(_eqLocMap){ _eqLocMap.remove(); _eqLocMap=null; }
  if(!temGps) return;
  eqMorada(eq.ultimoLat,eq.ultimoLng).then(m=>{
    const t=[['Rua',m.rua],['Cidade',m.cidade],['Concelho',m.concelho]].filter(x=>x[1]);
    mor.innerHTML=t.length?t.map(([l,v])=>`<div><span style="color:var(--gray-400)">${l}</span> <strong>${eqEsc(v)}</strong></div>`).join(''):'Morada não disponível';
  });
  setTimeout(()=>{
    const lat=parseFloat(eq.ultimoLat), lng=parseFloat(eq.ultimoLng);
    const colors={equipamento:'#6D28D9',veiculo_passageiros:'#1D4ED8',veiculo_mercadorias:'#0F766E',veiculo_pesado:'#B45309'};
    _eqLocMap = L.map('meql-map').setView([lat,lng],15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      attribution:'© <a href="https://www.openstreetmap.org/">OpenStreetMap</a>', maxZoom:19
    }).addTo(_eqLocMap);
    const icon=L.divIcon({className:'',
      html:`<div style="width:28px;height:28px;background:${colors[eqCatNorm(eq.categoria)]||'#6B7280'};border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2.5px solid white;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>`,
      iconSize:[28,28],iconAnchor:[14,28]});
    L.marker([lat,lng],{icon}).addTo(_eqLocMap);
    _eqLocMap.invalidateSize();
  },80);
}

function renderEqBusca(){
  const box  = document.getElementById('eq-busca-resultados');
  const hint = document.getElementById('eq-busca-hint');
  if(!box) return;
  const term = (document.getElementById('eq-busca-input')?.value||'').toLowerCase().trim();
  if(_eqDesk()){
    // no computador a lista mostra sempre todos os equipamentos (filtrados por pesquisa e estado)
    if(hint) hint.style.display='none';
    _eqRenderChipsDesk();
    const lista = EQUIPAMENTOS.filter(eq =>
      (_eqEstFiltro==='todos' || _eqGrupoEstado(eq.estado)===_eqEstFiltro) &&
      (_eqCatFiltro==='todas' || eqCatNorm(eq.categoria)===_eqCatFiltro) &&
      (!term || [eq.nome,eq.serie,eq.matricula,eq.codigo,eq.marcaModelo,eq.condutor,eq.fornecedor,eq.ultimoLocal].join(' ').toLowerCase().includes(term))
    ).sort((a,b)=>a.nome.localeCompare(b.nome,'pt'));
    box.innerHTML = lista.length ? (_eqVista==='cartoes' ? `<div class="d-cards">${lista.map(_eqCardDesk).join('')}</div>` : _eqTabelaDesk(lista)) : '<div class="d-empty">Sem equipamentos para o filtro escolhido.</div>';
    return;
  }
  if(!term){ box.innerHTML=''; if(hint) hint.style.display=''; return; }
  if(hint) hint.style.display='none';
  const list = EQUIPAMENTOS.filter(eq=>
    [eq.nome,eq.serie,eq.matricula,eq.codigo,eq.marcaModelo,eq.condutor,eq.fornecedor].join(' ').toLowerCase().includes(term)
  ).sort((a,b)=>a.nome.localeCompare(b.nome,'pt')).slice(0,40);
  box.innerHTML = list.length
    ? list.map(_eqBuscaRowHtml).join('')
    : `<div style="text-align:center;padding:20px;color:var(--gray-400);font-size:13px">Sem resultados para "${eqEsc(term)}"</div>`;
}

// Mostra todos os equipamentos (sem filtro nem limite de 40) na mesma zona
// de resultados da pesquisa — atalho para quem quer ver o inventário
// completo em vez de ter de escrever um termo.
function eqVerListaCompleta(){
  const box  = document.getElementById('eq-busca-resultados');
  const hint = document.getElementById('eq-busca-hint');
  if(!box) return;
  if(hint) hint.style.display='none';
  const list = [...EQUIPAMENTOS].sort((a,b)=>a.nome.localeCompare(b.nome,'pt'));
  box.innerHTML = list.length
    ? list.map(_eqBuscaRowHtml).join('')
    : `<div style="text-align:center;padding:20px;color:var(--gray-400);font-size:13px">Sem equipamentos registados.</div>`;
}

// ── Mapa Leaflet ────────────────────────
function initEqMap(){
  const mapEl = document.getElementById('eq-map');
  if(!mapEl) return;
  if(_eqMap){ _eqMap.remove(); _eqMap=null; _eqMapMarkers=[]; _eqMapMarkerById={}; }
  _eqMap = L.map('eq-map').setView([38.716,-9.139], 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'© <a href="https://www.openstreetmap.org/">OpenStreetMap</a>', maxZoom:19
  }).addTo(_eqMap);
  refreshEqMap();
}
function refreshEqMap(){
  if(!_eqMap) return;
  _eqMapMarkers.forEach(m=>m.remove()); _eqMapMarkers=[]; _eqMapMarkerById={};
  const withLoc = EQUIPAMENTOS.filter(eq=>eq.ultimoLat&&eq.ultimoLng);
  const mapEl   = document.getElementById('eq-map');
  const emptyEl = document.getElementById('eq-map-empty');
  if(!withLoc.length){
    if(mapEl)   mapEl.style.display  ='none';
    if(emptyEl) emptyEl.style.display='';
    return;
  }
  if(mapEl)   mapEl.style.display  ='';
  if(emptyEl) emptyEl.style.display='none';
  const colors={equipamento:'#6D28D9',veiculo_passageiros:'#1D4ED8',veiculo_mercadorias:'#0F766E',veiculo_pesado:'#B45309'};
  const bounds=[];
  withLoc.forEach(eq=>{
    const lat=parseFloat(eq.ultimoLat), lng=parseFloat(eq.ultimoLng);
    const color=colors[eqCatNorm(eq.categoria)]||'#6B7280';
    const icon=L.divIcon({className:'',
      html:`<div style="width:28px;height:28px;background:${color};border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2.5px solid white;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>`,
      iconSize:[28,28],iconAnchor:[14,28],popupAnchor:[0,-30]});
    const cat = EQ_CATS[eqCatNorm(eq.categoria)];
    const ago = eq.ultimoRegisto ? eqTimeAgo(new Date(eq.ultimoRegisto)) : '—';
    const popup=`<div class="eq-popup-name">${eq.nome}</div>
      <div class="eq-popup-cat">${cat.label}${eq.serie?' · '+eq.serie:''}</div>
      <div class="eq-popup-loc">📍 ${eq.ultimoLocal||'Localização GPS'}</div>
      <div class="eq-popup-time">🕐 ${ago}</div>`;
    const mk=L.marker([lat,lng],{icon}).addTo(_eqMap).bindPopup(popup);
    _eqMapMarkers.push(mk); _eqMapMarkerById[eq.id]=mk;
    bounds.push([lat,lng]);
  });
  if(bounds.length===1) _eqMap.setView(bounds[0],14);
  else _eqMap.fitBounds(bounds,{padding:[40,40]});
}

// ── Modal add / edit ────────────────────
function openEqModal(eq=null){
  _editingEqId=eq?eq.id:null;
  document.getElementById('meq-title').textContent=eq?'Editar equipamento':'Novo equipamento';
  const d=eq||{};
  document.getElementById('meq-id').value   =eq?eq.id:'';
  eqSet('meq-nome',d.nome); eqSet('meq-cat',eqCatNorm(d.categoria));
  eqSet('meq-serie',d.serie); eqSet('meq-desc',d.descricao);
  eqSet('meq-prop',d.propriedade||'propria'); eqSet('meq-estado',d.estado||'operacional');
  eqSet('meq-codigo',d.codigo); eqSet('meq-matricula',d.matricula); eqSet('meq-marca',d.marcaModelo);
  eqSet('meq-ano',d.ano); eqSet('meq-comb',d.combustivel); eqSet('meq-condutor',d.condutor); eqSet('meq-kms',d.kmsHoras);
  eqSet('meq-seguro',d.seguroValidade); eqSet('meq-ipo',d.ipoValidade);
  eqSet('meq-forn',d.fornecedor); eqSet('meq-aquis',d.dataAquisicao);
  eqSet('meq-valor',d.valorAquisicao); eqSet('meq-garantia',d.garantiaAte);
  eqPreencherObras(d);
  const del=document.getElementById('meq-del-btn'); if(del) del.style.display=eq?'':'none';
  openModal('modal-equip');
  document.querySelectorAll('#modal-equip .modal > div').forEach(d=>{ d.scrollTop=0; });
}
// Lista de obras em curso; a obra atual do equipamento aparece sempre, mesmo que entretanto tenha acabado
function eqPreencherObras(eq){
  const sel=document.getElementById('meq-obra'); if(!sel) return;
  const obras=(S.OBRAS||[]).filter(o=>obraEmCurso(o)||o.id===eq.obraId).sort((a,b)=>a.nome.localeCompare(b.nome,'pt'));
  const atual=eq.obraId&&obras.some(o=>o.id===eq.obraId)?eq.obraId:'';
  sel.innerHTML='<option value="">— Sem obra —</option>'+obras.map(o=>`<option value="${eqEsc(o.id)}">${eqEsc(o.nome)}</option>`).join('')+'<option value="__outras__">Outras obras…</option>';
  sel.value=atual;
  sel.onchange=()=>{ if(sel.value==='__outras__'){ sel.value=sel.dataset.prev||''; eqObrasPickerAbrir(); } else sel.dataset.prev=sel.value; };
  sel.dataset.prev=atual;
  // equipamento com local que não é uma obra (ex.: SEDE): mantém-se se não for alterado
  sel.dataset.orig=atual;
}
// Seletor com todas as obras (ativas e inativas) para quando a obra não está na lista curta
function eqObrasPickerAbrir(){
  document.getElementById('meqo-q').value='';
  eqObrasPickerFiltra();
  openModal('modal-eq-obras');
  setTimeout(()=>document.getElementById('meqo-q')?.focus(),50);
}
function eqObrasPickerFiltra(){
  const t=(document.getElementById('meqo-q').value||'').toLowerCase();
  const obras=(S.OBRAS||[]).filter(o=>!t||o.nome.toLowerCase().includes(t)).sort((a,b)=>a.nome.localeCompare(b.nome,'pt'));
  const tag=o=>obraEmCurso(o)?'<span class="eq-est-badge eq-est-ok">Em curso</span>':(o.estado==='concluida'?'<span class="eq-est-badge eq-est-par">Concluída</span>':'<span class="eq-est-badge eq-est-man">Inativa</span>');
  document.getElementById('meqo-lista').innerHTML=obras.map(o=>`<div onclick="eqObrasPickerEscolher('${eqEsc(o.id)}')" style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid #eef1f6;cursor:pointer;font-size:13.5px"><span>${eqEsc(o.nome)}</span>${tag(o)}</div>`).join('')||'<div style="padding:14px;color:var(--gray-500)">Nenhuma obra encontrada</div>';
}
function eqObrasPickerEscolher(id){
  const o=(S.OBRAS||[]).find(x=>x.id===id), sel=document.getElementById('meq-obra'); if(!o||!sel) return;
  if(![...sel.options].some(op=>op.value===id)){
    const op=document.createElement('option'); op.value=id; op.textContent=o.nome;
    sel.insertBefore(op, sel.querySelector('option[value="__outras__"]'));
  }
  sel.value=id; sel.dataset.prev=id;
  closeModal('modal-eq-obras');
}
function editEquipamento(id){ const eq=EQUIPAMENTOS.find(e=>e.id===id); if(eq) openEqModal(eq); }
function saveEquipamento(){
  const nome=document.getElementById('meq-nome').value.trim();
  if(!nome){ showToast('Preencha o nome do equipamento'); return; }
  const id=_editingEqId||genEqId();
  const ex=_editingEqId?EQUIPAMENTOS.find(e=>e.id===_editingEqId):null;
  const g=fid=>document.getElementById(fid).value.trim();
  const obj={...(ex||{}),id,nome,
    categoria:   document.getElementById('meq-cat').value,
    serie:       g('meq-serie'),
    descricao:   g('meq-desc'),
    propriedade: g('meq-prop')||'propria', estado: g('meq-estado')||'operacional',
    codigo:      g('meq-codigo'), matricula: g('meq-matricula').toUpperCase(), marcaModelo: g('meq-marca'),
    ano:         g('meq-ano'), combustivel: g('meq-comb'), condutor: g('meq-condutor'), kmsHoras: g('meq-kms'),
    seguroValidade: g('meq-seguro'), ipoValidade: g('meq-ipo'),
    fornecedor:  g('meq-forn'), dataAquisicao: g('meq-aquis'),
    valorAquisicao: g('meq-valor'), garantiaAte: g('meq-garantia'),
    criadoEm:    ex?ex.criadoEm:new Date().toISOString(),
    obraId:      ex?ex.obraId:null,
    ultimoLocal: ex?ex.ultimoLocal:null, ultimoLat:ex?ex.ultimoLat:null,
    ultimoLng:   ex?ex.ultimoLng:null,   ultimoRegisto:ex?ex.ultimoRegisto:null
  };
  const selObra=document.getElementById('meq-obra');
  if(selObra && selObra.value!==(selObra.dataset.orig||'')){
    const o=(S.OBRAS||[]).find(x=>x.id===selObra.value);
    obj.obraId=o?o.id:null; obj.ultimoLocal=o?o.nome:null; obj.ultimoRegisto=new Date().toISOString();
  }
  if(_editingEqId){ const i=EQUIPAMENTOS.findIndex(e=>e.id===_editingEqId); if(i>=0)EQUIPAMENTOS[i]=obj; else EQUIPAMENTOS.push(obj); }
  else EQUIPAMENTOS.push(obj);
  saveEqLocal(); closeModal('modal-equip'); renderEquipamentos(); refreshEqMap();
  showEqAlert('Equipamento guardado com sucesso.');
  sbUpsertEquipamento(obj);
  R.emitEvent?.({ acao:(_editingEqId?'Equipamento atualizado':'Novo equipamento')+': '+nome, seccao:'equipamentos' });
}
function apagarEquipamento(){
  if(!_editingEqId) return;
  if(!confirm('Apagar este equipamento e todo o seu histórico?')) return;
  const delId=_editingEqId;
  EQUIPAMENTOS  =EQUIPAMENTOS.filter(e=>e.id!==delId);
  EQ_MOVIMENTOS =EQ_MOVIMENTOS.filter(m=>m.equipId!==delId);
  EQ_MANUT      =EQ_MANUT.filter(m=>m.equipId!==delId);
  saveEqLocal(); closeModal('modal-equip'); renderEquipamentos(); refreshEqMap();
  showToast('Equipamento apagado.');
  try{ sb.from('equipamentos').delete().eq('id',delId).then(()=>{}).catch(()=>{}); }catch(e){}
}

// ── QR Code display ─────────────────────
function showQrCode(id){
  const eq=EQUIPAMENTOS.find(e=>e.id===id); if(!eq){ showToast('Equipamento não encontrado'); return; }
  const qrUrl=location.href.split('?')[0]+'?reg='+id;
  document.getElementById('mqr-title').textContent=eq.nome;
  document.getElementById('mqr-sub').textContent=(EQ_CATS[eqCatNorm(eq.categoria)].label)+(eq.serie?' · '+eq.serie:'');
  document.getElementById('mqr-url').textContent=qrUrl;
  const qrDiv=document.getElementById('mqr-qrcode'); qrDiv.innerHTML='';
  if(window.QRCodeLib){
    const canvas=document.createElement('canvas');
    qrDiv.appendChild(canvas);
    window.QRCodeLib.toCanvas(canvas,qrUrl,{width:200,margin:1,color:{dark:'#0a1f3d',light:'#ffffff'}},err=>{
      if(err){ qrDiv.innerHTML=`<div style="width:200px;height:200px;background:var(--gray-100);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--gray-400);font-size:12px;text-align:center;padding:12px">Erro ao gerar QR</div>`; }
    });
  } else {
    qrDiv.innerHTML=`<div style="width:200px;height:200px;background:var(--gray-100);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--gray-400);font-size:12px;text-align:center;padding:12px">Biblioteca QR não carregada</div>`;
  }
  openModal('modal-qr');
}
function printQrCode(){
  const title=document.getElementById('mqr-title').textContent;
  const sub  =document.getElementById('mqr-sub').textContent;
  const url  =document.getElementById('mqr-url').textContent;
  const qrDiv=document.getElementById('mqr-qrcode');
  const canvas=qrDiv.querySelector('canvas'); const img=qrDiv.querySelector('img');
  const imgSrc=canvas?canvas.toDataURL():(img?img.src:'');
  const w=window.open('','_blank','width=420,height=520');
  w.document.write(`<!DOCTYPE html><html><head><title>QR — ${title}</title>
    <style>body{font-family:Arial,sans-serif;text-align:center;padding:40px;margin:0}
    h2{margin:0 0 4px;font-size:18px;color:#0a1f3d}p{color:#6B7280;font-size:13px;margin:0 0 18px}
    img{max-width:200px;border:1px solid #eee;padding:8px;border-radius:8px}
    .url{font-size:9px;color:#9CA3AF;word-break:break-all;margin-top:12px;font-family:monospace}
    </style></head><body><h2>${title}</h2><p>${sub}</p>
    ${imgSrc?`<img src="${imgSrc}"/>`:'<p style="color:red">QR indisponível</p>'}
    <div class="url">${url}</div></body></html>`);
  w.document.close(); w.onload=()=>{ w.print(); };
}

// ── Histórico de movimentos ─────────────
function showEqHistorico(id){
  const eq=EQUIPAMENTOS.find(e=>e.id===id); if(!eq) return;
  document.getElementById('meqh-title').textContent='Histórico — '+eq.nome;
  document.getElementById('meqh-sub').textContent=(EQ_CATS[eqCatNorm(eq.categoria)].label)+(eq.serie?' · '+eq.serie:'');
  const movs=EQ_MOVIMENTOS.filter(m=>m.equipId===id).sort((a,b)=>new Date(b.criadoEm)-new Date(a.criadoEm));
  const list=document.getElementById('meqh-list');
  if(!movs.length){
    list.innerHTML=`<div style="text-align:center;padding:28px;color:var(--gray-400);font-size:13px">
      <svg viewBox="0 0 24 24" fill="currentColor" style="width:36px;height:36px;color:var(--gray-300);display:block;margin:0 auto 8px"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
      Sem registos de movimentos ainda.</div>`;
  } else {
    list.innerHTML=movs.map((m,i)=>{
      const coords=m.lat?`<div style="font-size:10px;color:var(--gray-400);font-family:'DM Mono',monospace;margin-top:2px">${parseFloat(m.lat).toFixed(5)}, ${parseFloat(m.lng).toFixed(5)}</div>`:'';
      return `<div style="display:flex;gap:12px;padding:12px 2px;border-bottom:${i<movs.length-1?'1px solid var(--gray-100)':'none'}">
        <div style="display:flex;flex-direction:column;align-items:center">
          <div style="width:32px;height:32px;background:var(--blue-50);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px;color:var(--blue-500)"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
          </div>
          ${i<movs.length-1?'<div style="width:1px;flex:1;min-height:12px;background:var(--gray-200);margin:3px 0"></div>':''}
        </div>
        <div style="flex:1;min-width:0;padding-bottom:6px">
          <div style="font-weight:600;font-size:13px;color:var(--gray-900)">${m.obraNome||m.local||'Localização registada'}</div>
          ${m.obs?`<div style="font-size:12px;color:var(--gray-500);margin-top:2px;font-style:italic">"${m.obs}"</div>`:''}
          ${coords}
          <div style="font-size:11px;color:var(--gray-400);margin-top:4px">${eqFmtDt(new Date(m.criadoEm))}${m.encarregado?' · <strong style="color:var(--gray-600)">'+m.encarregado+'</strong>':''}</div>
        </div>
      </div>`;
    }).join('');
  }
  openModal('modal-eq-hist');
}

// ── Export XLSX ─────────────────────────
function exportEquipamentosXLSX(){
  if(!EQUIPAMENTOS.length){ showToast('Sem equipamentos para exportar'); return; }
  const dados=EQUIPAMENTOS.map(eq=>({
    'ID':eq.id,'Código':eq.codigo||'','Nome':eq.nome,
    'Categoria':EQ_CATS[eqCatNorm(eq.categoria)].label,
    'Propriedade':eq.propriedade==='aluguer'?'Aluguer':'Plandese',
    'Estado':(EQ_ESTADOS[eq.estado]||EQ_ESTADOS.operacional).label,
    'Matrícula':eq.matricula||'','Marca/modelo':eq.marcaModelo||'','Nº Série':eq.serie||'',
    'Ano':eq.ano||'','Combustível':eq.combustivel||'','Condutor/responsável':eq.condutor||'','Kms/horas':eq.kmsHoras||'',
    'Seguro até':eqDatePT(eq.seguroValidade),'IPO até':eqDatePT(eq.ipoValidade),
    'Fornecedor':eq.fornecedor||'','Data aquisição':eqDatePT(eq.dataAquisicao),
    'Valor aquisição (€)':eq.valorAquisicao||'','Garantia até':eqDatePT(eq.garantiaAte),
    'Manutenções pendentes':eqPendentes(eq.id).map(m=>m.descricao).join('; '),
    'Descrição':eq.descricao||'','Última localização':eq.ultimoLocal||'',
    'Lat':eq.ultimoLat||'','Lng':eq.ultimoLng||'',
    'Último registo':eq.ultimoRegisto?eqFmtDt(new Date(eq.ultimoRegisto)):''
  }));
  const ws=XLSX.utils.json_to_sheet(dados); const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Equipamentos');
  XLSX.writeFile(wb,`equipamentos_${fmt(new Date())}.xlsx`);
}

// ── Supabase sync helpers ────────────────
async function sbLoadEquipamentos(){
  try{
    const {data,error}=await sb.from('equipamentos').select('*').order('criado_em',{ascending:false});
    if(error||!data) return;
    const localMap=Object.fromEntries(EQUIPAMENTOS.map(e=>[e.id,e]));
    data.forEach(row=>{ localMap[row.id]=eqFromRow(row); });
    EQUIPAMENTOS=Object.values(localMap);
    saveEqLocal();
  }catch(e){ console.warn('sbLoadEquipamentos:',e); }
  try{
    const {data:mrows,error:merr}=await sb.from('eq_manutencoes').select('*');
    if(!merr&&mrows) EQ_MANUT=mrows.map(eqManutFromRow);
  }catch(e){ console.warn('sbLoadManutencoes:',e); }
}

async function sbFetchEquipamentoById(id){
  try{
    const {data,error}=await sb.from('equipamentos').select('*').eq('id',id).single();
    if(error||!data) return null;
    return eqFromRow(data);
  }catch(e){ return null; }
}

function sbUpsertEquipamento(eq){
  try{
    sb.from('equipamentos').upsert(eqToRow(eq)).then(({error})=>{
      if(error){ console.warn('sbUpsertEquipamento:',error); showToast('Erro ao sincronizar o equipamento com o servidor'); }
    }).catch(e=>console.warn('sbUpsertEquipamento:',e));
  }catch(e){}
}

// ── Manutenção (histórico estruturado) ──
function renderEqManut(){
  const list=document.getElementById('meqm-list');
  if(!list||!_eqManutId) return;
  const items=EQ_MANUT.filter(m=>m.equipId===_eqManutId)
    .sort((a,b)=>(a.estado===b.estado?0:a.estado==='pendente'?-1:1)||new Date(b.criadoEm)-new Date(a.criadoEm));
  if(!items.length){
    list.innerHTML='<div style="text-align:center;padding:24px;color:var(--gray-400);font-size:13px">Sem manutenções registadas.</div>';
    return;
  }
  list.innerHTML=items.map(m=>{
    const done=m.estado==='resolvida';
    const meta=[m.data?eqDatePT(m.data):'', m.custo!==''?(+m.custo).toLocaleString('pt-PT',{minimumFractionDigits:2})+' €':'', m.solicitanteNome].filter(Boolean).join(' · ');
    return `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 2px;border-bottom:1px solid var(--gray-100)">
      <input type="checkbox" ${done?'checked':''} onchange="toggleEqManut(${m.id})" title="${done?'Marcar como pendente':'Marcar como resolvida'}" style="margin-top:3px;flex-shrink:0"/>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px">
          <div style="font-size:13px;color:${done?'var(--gray-400)':'var(--gray-900)'};${done?'text-decoration:line-through':''}">${eqEsc(m.descricao)}</div>
          ${eqManutOrigemBadge(m)}
        </div>
        ${meta?`<div style="font-size:11px;color:var(--gray-400);margin-top:2px">${meta}</div>`:''}
        ${eqManutFotosHtml(m)}
      </div>
      <button class="btn btn-secondary btn-sm" onclick="removeEqManut(${m.id},event)" title="Apagar" style="color:var(--red)">×</button>
    </div>`;
  }).join('');
  eqManutCarregarFotos(list);
}
function openEqManut(id){
  const eq=EQUIPAMENTOS.find(e=>e.id===id); if(!eq) return;
  _eqManutId=id;
  document.getElementById('meqm-title').textContent='Manutenção — '+eq.nome;
  document.getElementById('meqm-sub').textContent=[eq.matricula,eq.marcaModelo,eq.ultimoLocal].filter(Boolean).join(' · ')||'Histórico de manutenção';
  ['meqm-desc','meqm-data','meqm-custo'].forEach(i=>eqSet(i,''));
  renderEqManut();
  openModal('modal-eq-manut');
}
function _eqManutRefreshViews(){
  renderEquipamentos();
  if(_eqView==='obra')  renderEqPorObra();
  if(_eqView==='manut') renderEqManutBoard();
}
async function addEqManut(){
  const desc=document.getElementById('meqm-desc').value.trim();
  if(!desc){ showToast('Descreva a manutenção'); return; }
  const data=document.getElementById('meqm-data').value||null;
  const custo=eqNum(document.getElementById('meqm-custo').value);
  const eq=EQUIPAMENTOS.find(e=>e.id===_eqManutId);
  const {data:ins,error}=await sb.from('eq_manutencoes').insert({
    equip_id:_eqManutId,descricao:desc,data,custo,estado:'pendente',origem:'portal',
    solicitante_nome:S.currentUser?.nome||null, obra_nome:eq?.ultimoLocal||null
  }).select().single();
  if(error||!ins){ showToast('Erro ao guardar a manutenção'); return; }
  EQ_MANUT.push(eqManutFromRow(ins));
  ['meqm-desc','meqm-data','meqm-custo'].forEach(i=>eqSet(i,''));
  renderEqManut(); _eqManutRefreshViews();
}
async function toggleEqManut(id){
  const m=EQ_MANUT.find(x=>x.id===id); if(!m) return;
  const novo=m.estado==='pendente'?'resolvida':'pendente';
  const {error}=await sb.from('eq_manutencoes').update({estado:novo}).eq('id',id);
  if(error){ showToast('Erro ao atualizar a manutenção'); renderEqManut(); return; }
  m.estado=novo; renderEqManut(); _eqManutRefreshViews();
}
// Dois cliques em vez de confirm(): os diálogos nativos são bloqueados em alguns
// ecrãs/webviews e o botão parecia "não fazer nada".
async function removeEqManut(id,evt){
  const btn=evt?.currentTarget;
  if(btn && btn.dataset.armado!=='1'){
    btn.dataset.armado='1'; btn.textContent='Apagar?'; btn.style.width='auto';
    setTimeout(()=>{ if(btn.isConnected){ btn.dataset.armado=''; btn.textContent='×'; btn.style.width=''; } },4000);
    return;
  }
  const {data,error}=await sb.from('eq_manutencoes').delete().eq('id',id).select('fotos');
  if(error){ console.warn('removeEqManut:',error); showToast('Erro ao apagar a manutenção'); return; }
  if(!data?.length){ showToast('Sem permissão para apagar esta manutenção'); return; }
  const fotos=data[0].fotos||[];
  if(fotos.length) sb.storage.from('eq-manut-fotos').remove(fotos).catch(()=>{});
  EQ_MANUT=EQ_MANUT.filter(x=>x.id!==id); renderEqManut(); _eqManutRefreshViews();
}

function sbUpdateEquipamentoLocal(id, ultimoLocal, ultimoLat, ultimoLng, ultimoRegisto){
  try{
    sb.from('equipamentos').update({
      ultimo_local:ultimoLocal||null, ultimo_lat:ultimoLat||null,
      ultimo_lng:ultimoLng||null, ultimo_registo:ultimoRegisto||null
    }).eq('id',id).then(()=>{}).catch(e=>console.warn('sbUpdateEquipLocal:',e));
  }catch(e){}
}

// ── Init da secção ──────────────────────
async function initEquipamentos(){
  renderEquipamentos();
  setTimeout(()=>{ if(_eqView==='loc') initEqMap(); }, 120);
  await sbLoadEquipamentos();
  renderEquipamentos(); refreshEqMap();
  if(_eqView==='obra')  renderEqPorObra();
  if(_eqView==='manut') renderEqManutBoard();
}

// ═══════════════════════════════════════
//  QR REGISTRATION — ecrã para o encarregado
// ═══════════════════════════════════════
async function initQrRegistration(){
  const params=new URLSearchParams(location.search);
  const regId=params.get('reg');
  if(!regId) return false;
  _qrEquipId=regId;
  const sc=document.getElementById('qr-reg-screen');
  sc.style.display='flex';
  // por cima de tudo, mesmo que haja uma sessão guardada que abra a app por trás
  sc.style.cssText+=';position:fixed;inset:0;z-index:99999;overflow:auto';
  document.getElementById('login-screen').style.display='none';
  qrGasNovo();
  return true;
}

// ── QR lido fora da app: pede o código de acesso da obra e depois regista o gasóleo ──
let _qrGas = null;   // { codigo, obra, equipamento } depois de validado
const _qrGasMostra = passo => {
  ['gate','form','ok'].forEach(p=>{ const el=document.getElementById('qr-gas-'+p); if(el) el.style.display = p===passo ? '' : 'none'; });
};
function qrGasNovo(){
  _qrGas = null;
  const cod=document.getElementById('qr-gas-codigo'); if(cod) cod.value='';
  const m=document.getElementById('qr-gas-gate-msg'); if(m) m.textContent='';
  _qrGasMostra('gate');
  setTimeout(()=>cod&&cod.focus(),100);
}
async function qrGasValidar(){
  const cod=document.getElementById('qr-gas-codigo').value.trim().toUpperCase();
  const msg=document.getElementById('qr-gas-gate-msg'), btn=document.getElementById('qr-gas-gate-btn');
  if(!cod){ msg.textContent='Introduza o código.'; return; }
  btn.disabled=true; msg.textContent='';
  try{
    const {data,error}=await sb.rpc('fn_qr_gas_info',{p_equip_id:_qrEquipId,p_codigo:cod});
    if(error) throw error;
    if(!data||!data.ok){
      msg.textContent = data?.motivo==='bloqueado' ? 'Demasiadas tentativas. Tente daqui a alguns minutos.'
        : data?.motivo==='equipamento' ? 'Equipamento não encontrado.' : 'Código inválido.';
      return;
    }
    _qrGas={ codigo:cod, obra:data.obra, equipamento:data.equipamento };
    document.getElementById('qr-gas-eq-nome').textContent=data.equipamento.nome;
    document.getElementById('qr-gas-obra-nome').textContent=data.obra.nome;
    document.getElementById('qr-gas-origem').value='deposito'; qrGasOrigem();
    document.getElementById('qr-gas-litros').value='';
    // Km/Horas (opcional): o servidor decide a unidade pela categoria do equipamento
    document.getElementById('qr-gas-cnt').value='';
    document.getElementById('qr-gas-data').value=fmt(new Date());
    document.getElementById('qr-gas-tipo').value='Gasóleo';
    document.getElementById('qr-gas-forn').value='';
    document.getElementById('qr-gas-obs').value='';
    document.getElementById('qr-gas-msg').textContent='';
    let nome=''; try{ nome=JSON.parse(localStorage.getItem('plandese_enc_nome')||'""'); }catch(e){}
    document.getElementById('qr-gas-nome').value=nome||'';
    _qrGasMostra('form');
  }catch(e){ console.warn('qrGasValidar:',e); msg.textContent='Não foi possível verificar o código. Tente novamente.'; }
  finally{ btn.disabled=false; }
}
function qrGasOrigem(){
  const w=document.getElementById('qr-gas-forn-wrap');
  if(w) w.style.display = document.getElementById('qr-gas-origem').value==='bomba' ? '' : 'none';
}
async function qrGasSubmeter(){
  if(!_qrGas) return qrGasNovo();
  const g=id=>document.getElementById(id).value.trim();
  const msg=document.getElementById('qr-gas-msg'), btn=document.getElementById('qr-gas-btn');
  const litros=parseFloat(g('qr-gas-litros').replace(',','.'));
  const nome=g('qr-gas-nome');
  if(!litros||litros<=0){ msg.textContent='Indique os litros.'; return; }
  if(!nome){ msg.textContent='Indique o nome de quem está a registar.'; return; }
  btn.disabled=true; msg.textContent='';
  try{
    const origem=g('qr-gas-origem');
    const {data,error}=await sb.rpc('fn_qr_gas_registar',{
      p_equip_id:_qrEquipId, p_codigo:_qrGas.codigo, p_origem:origem, p_litros:litros, p_tipo:g('qr-gas-tipo'),
      p_data:g('qr-gas-data')||null, p_obs:g('qr-gas-obs')||null, p_encarregado:nome, p_fornecedor:origem==='bomba'?(g('qr-gas-forn')||null):null,
      p_contador:(()=>{ const v=parseFloat(g('qr-gas-cnt').replace(',','.')); return Number.isFinite(v)&&v>=0?v:null; })()
    });
    if(error) throw error;
    if(!data||!data.ok){ msg.textContent = data?.motivo==='litros' ? 'Quantidade de litros inválida.' : data?.motivo==='contador' ? 'Valor de horas/quilómetros inválido.' : 'Não foi possível registar. Volte a introduzir o código.'; if(data?.motivo==='codigo'||data?.motivo==='bloqueado') setTimeout(qrGasNovo,1500); return; }
    try{ localStorage.setItem('plandese_enc_nome',JSON.stringify(nome)); }catch(e){}
    document.getElementById('qr-gas-ok-txt').innerHTML=
      `<strong>${eqEsc(nome)}</strong> registou<br><strong>${litros} L de ${eqEsc(g('qr-gas-tipo'))}</strong><br>em <strong>${eqEsc(_qrGas.equipamento.nome)}</strong><br>Obra: <strong>${eqEsc(_qrGas.obra.nome)}</strong>`+
      `<br><span style="font-size:11px;color:var(--gray-400);display:block;margin-top:6px">${eqFmtDt(new Date())}</span>`;
    _qrGasMostra('ok');
  }catch(e){ console.warn('qrGasSubmeter:',e); msg.textContent='Erro ao guardar. Verifique a ligação e tente novamente.'; }
  finally{ btn.disabled=false; }
}

function submitQrRegistration(){
  const obraId  =document.getElementById('qr-obra-sel').value;
  const obs     =document.getElementById('qr-obs').value.trim();
  const useGps  =document.getElementById('qr-use-gps').checked;
  const encNome =(document.getElementById('qr-enc-nome').value.trim())||'Encarregado';
  // Nome da obra a partir da option
  const selEl=document.getElementById('qr-obra-sel');
  const selOpt=selEl.querySelector(`option[value="${obraId}"]`);
  const obraNome=selOpt&&obraId?selOpt.textContent:null;
  const mov={
    id:'MOV'+Date.now().toString(36).toUpperCase(),
    equipId:_qrEquipId, obraId:obraId||null, obraNome:obraNome||null,
    lat:(useGps&&_qrGpsLat)?_qrGpsLat:null, lng:(useGps&&_qrGpsLng)?_qrGpsLng:null,
    obs, encarregado:encNome, criadoEm:new Date().toISOString()
  };
  EQ_MOVIMENTOS.push(mov);
  const idx=EQUIPAMENTOS.findIndex(e=>e.id===_qrEquipId);
  if(idx>=0){
    EQUIPAMENTOS[idx].ultimoLocal   =obraNome||(mov.lat?`${mov.lat.toFixed(4)}, ${mov.lng.toFixed(4)}`:'Registado');
    EQUIPAMENTOS[idx].ultimoLat     =mov.lat;
    EQUIPAMENTOS[idx].ultimoLng     =mov.lng;
    EQUIPAMENTOS[idx].ultimoRegisto =mov.criadoEm;
  }
  saveEqLocal();
  // Guardar movimento + último local em Supabase via fn_qr_registar (funciona sem login; silencioso)
  sb.rpc('fn_qr_registar',{
    p_equip_id:_qrEquipId, p_obra_id:mov.obraId, p_lat:mov.lat, p_lng:mov.lng, p_obs:mov.obs||null, p_encarregado:mov.encarregado,
    p_ultimo_local:obraNome||(mov.lat?`${mov.lat.toFixed(4)}, ${mov.lng.toFixed(4)}`:'Registado')
  }).then(({error})=>{ if(error) console.warn('fn_qr_registar:',error); },e=>console.warn('fn_qr_registar:',e));
  // Mostrar sucesso
  const form=document.getElementById('qr-reg-form'), succ=document.getElementById('qr-success');
  if(form) form.style.display='none'; if(succ) succ.style.display='block';
  document.getElementById('qr-success-txt').innerHTML=
    `<strong>${encNome}</strong> registou o equipamento<br>`+
    (obraNome?`em <strong>${obraNome}</strong>`:'sem obra associada')+
    `<br><span style="font-size:11px;color:var(--gray-400);display:block;margin-top:6px">${eqFmtDt(new Date())}</span>`;
}

// ═══════════════════════════════════════
//  ENCARREGADO — NAVEGAÇÃO HOME + QR SCANNER
// ═══════════════════════════════════════

export {
  EQUIPAMENTOS, EQ_MOVIMENTOS, EQ_MANUT,
  EQ_CATS, eqCatNorm, eqCatIsVeiculo, eqFmtDt, eqDatePT, saveEqLocal,
  renderEquipamentos, updateEqKPIs, renderEqBusca, eqVerListaCompleta,
  initEqMap, refreshEqMap,
  openEqModal, editEquipamento, saveEquipamento, apagarEquipamento,
  showQrCode, printQrCode, showEqHistorico, exportEquipamentosXLSX, eqAluguerClick, eqQrAbrir, eqQrFechar, eqQrFoto, eqObrasPickerFiltra, eqObrasPickerEscolher,
  openEqManut, eqManutFotoAbrir, abrirEqDetalhe, eqVerLocalizacao, addEqManut, toggleEqManut, removeEqManut, eqManutFromRow,
  switchEqView, renderEqPorObra, abrirEqObraDetalhe,
  renderEqManutBoard, abrirEqManutPicker, eqManutPickFiltra,
  sbLoadEquipamentos, sbFetchEquipamentoById, sbUpsertEquipamento, sbUpdateEquipamentoLocal,
  initEquipamentos, initQrRegistration, submitQrRegistration,
  qrGasValidar, qrGasOrigem, qrGasSubmeter, qrGasNovo
};
