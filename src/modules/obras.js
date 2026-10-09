// ═══════════════════════════════════════
//  ADMIN — OBRAS
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S, R } from '../state.js';
import { sbToggleObra } from '../db.js';
import { closeModal, populateFilterSelects, flashAlert } from './navigation.js';
import { fmtPT } from '../utils/helpers.js';

let _moDiretoresExtra=[];
let _moEncarregadosExtra=[];

export function novaObra(){
  document.getElementById('mo-title').textContent='Nova obra';
  document.getElementById('mo-id').value='';
  document.getElementById('mo-nome').value='';
  document.getElementById('mo-local').value='';
  document.getElementById('mo-desc').value='';
  document.getElementById('mo-prazo').value='';
  _moDiretoresExtra=[];
  _moEncarregadosExtra=[];
  _populateEncSelect('');
  _populateDiretorSelect('');
  _renderMoExtras();
  document.getElementById('modal-obra').classList.add('open');
}

let _obrHideInativas=true;

export function obrToggleHideInativas(){
  _obrHideInativas=document.getElementById('obr-hide-inativas').checked;
  renderObras();
}

function _nomeUser(id){ return S.USERS[id]?.nome || id; }

function _pessoas(o){
  const diretores=[o.diretor_id, ...(o.diretores_extra||[])].filter(Boolean);
  const encs=[o.encarregado_id, ...(o.encarregados_extra||[])].filter(Boolean);
  return {
    diretorNome: diretores.length ? _nomeUser(diretores[0]) + (diretores.length>1 ? ` +${diretores.length-1}` : '') : null,
    diretorTitle: diretores.map(_nomeUser).join(', '),
    encNome: encs.length ? _nomeUser(encs[0]) + (encs.length>1 ? ` +${encs.length-1}` : '') : null,
    encTitle: encs.map(_nomeUser).join(', ')
  };
}

// Portal em computador: cartões (como o resto da shell)
function _renderObrasCartoes(lista){
  const esc=t=>String(t==null?'':t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ic='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V8l7-4.5L19 8v13"/><path d="M9 21v-5h6v5M9 11h.01M15 11h.01M9 14h.01M15 14h.01"/></svg>';
  const wrap=document.createElement('div');wrap.className='d-cards';
  wrap.innerHTML=lista.map(o=>{
    const {diretorNome,diretorTitle,encNome,encTitle}=_pessoas(o);
    const m=String(o.nome||'').match(/^(O\d+)\s*[-–]\s*(.+)$/);
    return `<div class="d-card${o.ativa?'':' off'}">
      <div class="d-card-top"><span class="d-ic">${ic}</span><div class="d-card-tt"><b title="${esc(o.nome)}">${m?esc(m[2]):esc(o.nome)}</b><small>${m?`<span class="d-cod">${esc(m[1])}</span> `:''}${esc(o.local||'')}</small></div><span class="badge ${o.ativa?'b-green':'b-gray'}">${o.ativa?'Ativa':'Inativa'}</span></div>
      <div class="d-card-kv"><div>Prazo<b>${o.prazo?fmtPT(o.prazo):'—'}</b></div><div>Diretor<b title="${esc(diretorTitle)}">${esc(diretorNome||'—')}</b></div><div class="full">Encarregado<b title="${esc(encTitle)}">${esc(encNome||'—')}</b></div></div>
      <div class="d-card-act"><button class="btn btn-secondary btn-sm" onclick="editObra('${o.id}')">Editar</button><button class="btn btn-sm ${o.ativa?'d-b-off':'d-b-on'}" onclick="toggleObra('${o.id}')">${o.ativa?'Desativar':'Ativar'}</button></div>
    </div>`;
  }).join('');
  return wrap;
}

function _renderObrasLista(lista){
  if(document.body.classList.contains('device-desktop') && !document.body.classList.contains('enc-mode')) return _renderObrasCartoes(lista);
  const wrap=document.createElement('div');wrap.className='card';wrap.style.cssText='padding:0;overflow:hidden';
  const tblWrap=document.createElement('div');tblWrap.className='tbl-wrap';
  const rows=lista.map(o=>{
    const {diretorNome,diretorTitle,encNome,encTitle}=_pessoas(o);
    return `<tr>
      <td><span style="width:8px;height:8px;border-radius:50%;background:${o.ativa?'var(--green)':'var(--gray-300)'};display:inline-block;margin-right:8px"></span><span style="font-weight:500">${o.nome}</span></td>
      <td style="color:var(--gray-500)">${o.local||'—'}</td>
      <td style="color:var(--gray-500)">${o.prazo?fmtPT(o.prazo):'—'}</td>
      <td style="color:var(--gray-500)" title="${diretorTitle}">${diretorNome||'—'}</td>
      <td style="color:var(--gray-500)" title="${encTitle}">${encNome||'—'}</td>
      <td><span class="badge ${o.ativa?'b-green':'b-gray'}">${o.ativa?'Ativa':'Inativa'}</span></td>
      <td><div style="display:flex;gap:4px"><button class="btn btn-secondary btn-sm" onclick="editObra('${o.id}')">Editar</button><button class="btn btn-sm" style="background:${o.ativa?'var(--yellow-bg)':'var(--green-bg)'};color:${o.ativa?'var(--yellow)':'var(--green)'};border:1px solid ${o.ativa?'#FDE68A':'var(--green-light)'}" onclick="toggleObra('${o.id}')">${o.ativa?'Desativar':'Ativar'}</button></div></td>
    </tr>`;
  }).join('');
  tblWrap.innerHTML=`<table><thead><tr><th>Nome</th><th>Local</th><th>Prazo</th><th>Diretor</th><th>Encarregado</th><th>Estado</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  wrap.appendChild(tblWrap);
  return wrap;
}

export function renderObras(){
  const cont=document.getElementById('obras-list');cont.innerHTML='';
  document.getElementById('nb-obras').textContent=S.OBRAS.filter(o=>o.ativa).length;
  if(!S.OBRAS.length){cont.innerHTML='<div class="card" style="text-align:center;color:var(--gray-400);padding:32px">Nenhuma obra criada. Clique em "Nova obra".</div>';return;}
  const lista=_obrHideInativas ? S.OBRAS.filter(o=>o.ativa) : S.OBRAS;
  if(!lista.length){cont.innerHTML='<div class="card" style="text-align:center;color:var(--gray-400);padding:32px">Nenhuma obra ativa.</div>';return;}
  cont.appendChild(_renderObrasLista(lista));
}

export function editObra(id){
  const o=S.OBRAS.find(x=>x.id===id);if(!o)return;
  document.getElementById('mo-title').textContent='Editar obra';
  document.getElementById('mo-id').value=id;
  document.getElementById('mo-nome').value=o.nome;
  document.getElementById('mo-local').value=o.local||'';
  document.getElementById('mo-desc').value=o.desc||'';
  document.getElementById('mo-prazo').value=o.prazo||'';
  _moDiretoresExtra=[...(o.diretores_extra||[])];
  _moEncarregadosExtra=[...(o.encarregados_extra||[])];
  _populateEncSelect(o.encarregado_id||'');
  _populateDiretorSelect(o.diretor_id||'');
  _renderMoExtras();
  document.getElementById('modal-obra').classList.add('open');
}

function _populateEncSelect(selectedId=''){
  const sel=document.getElementById('mo-encarregado');
  if(!sel) return;
  sel.innerHTML='<option value="">— Nenhum —</option>';
  Object.entries(S.USERS||{}).filter(([,u])=>u.role==='encarregado').forEach(([username,u])=>{
    const op=document.createElement('option');
    op.value=username; op.textContent=u.nome||username;
    if(username===selectedId) op.selected=true;
    sel.appendChild(op);
  });
}

function _populateDiretorSelect(selectedId=''){
  const sel=document.getElementById('mo-diretor');
  if(!sel) return;
  sel.innerHTML='<option value="">— Nenhum —</option>';
  Object.entries(S.USERS||{}).filter(([,u])=>u.role==='diretor_obra').forEach(([username,u])=>{
    const op=document.createElement('option');
    op.value=username; op.textContent=u.nome||username;
    if(username===selectedId) op.selected=true;
    sel.appendChild(op);
  });
}

// ── Diretores/encarregados adicionais (além do principal, acima) ──
function _chipsHTML(ids, onRemove){
  return ids.map(id=>`<span class="mo-chip">${_nomeUser(id)}<button type="button" onclick="${onRemove}('${id}')" aria-label="Remover">×</button></span>`).join('');
}

function _renderMoExtras(){
  const diretorPrincipal=document.getElementById('mo-diretor')?.value||'';
  const encPrincipal=document.getElementById('mo-encarregado')?.value||'';

  const listaDir=document.getElementById('mo-diretores-extra');
  if(listaDir) listaDir.innerHTML=_chipsHTML(_moDiretoresExtra,'moRemoveDiretorExtra');
  const addDir=document.getElementById('mo-diretor-extra-add');
  if(addDir){
    addDir.innerHTML='<option value="">+ adicionar diretor…</option>';
    Object.entries(S.USERS||{}).filter(([un,u])=>u.role==='diretor_obra' && un!==diretorPrincipal && !_moDiretoresExtra.includes(un))
      .forEach(([un,u])=>{ const op=document.createElement('option'); op.value=un; op.textContent=u.nome||un; addDir.appendChild(op); });
  }

  const listaEnc=document.getElementById('mo-encarregados-extra');
  if(listaEnc) listaEnc.innerHTML=_chipsHTML(_moEncarregadosExtra,'moRemoveEncarregadoExtra');
  const addEnc=document.getElementById('mo-encarregado-extra-add');
  if(addEnc){
    addEnc.innerHTML='<option value="">+ adicionar encarregado…</option>';
    Object.entries(S.USERS||{}).filter(([un,u])=>u.role==='encarregado' && un!==encPrincipal && !_moEncarregadosExtra.includes(un))
      .forEach(([un,u])=>{ const op=document.createElement('option'); op.value=un; op.textContent=u.nome||un; addEnc.appendChild(op); });
  }
}

export function moRefreshExtraAdds(){ _renderMoExtras(); }

export function moAddDiretorExtra(id){
  if(!id || _moDiretoresExtra.includes(id)) return;
  _moDiretoresExtra.push(id);
  _renderMoExtras();
}
export function moRemoveDiretorExtra(id){
  _moDiretoresExtra=_moDiretoresExtra.filter(x=>x!==id);
  _renderMoExtras();
}
export function moAddEncarregadoExtra(id){
  if(!id || _moEncarregadosExtra.includes(id)) return;
  _moEncarregadosExtra.push(id);
  _renderMoExtras();
}
export function moRemoveEncarregadoExtra(id){
  _moEncarregadosExtra=_moEncarregadosExtra.filter(x=>x!==id);
  _renderMoExtras();
}

// Sincroniza uma tabela de junção (obra_diretores_extra / obra_encarregados_extra)
// com a lista atual, inserindo os novos e apagando os removidos.
async function _syncObraExtra(table, col, obraId, novos, antigos){
  const antigosSet=new Set(antigos), novosSet=new Set(novos);
  const aAdicionar=novos.filter(x=>!antigosSet.has(x));
  const aRemover=antigos.filter(x=>!novosSet.has(x));
  if(aAdicionar.length){
    const {error}=await sb.from(table).insert(aAdicionar.map(id=>({obra_id:obraId,[col]:id})));
    if(error) throw error;
  }
  if(aRemover.length){
    const {error}=await sb.from(table).delete().eq('obra_id',obraId).in(col,aRemover);
    if(error) throw error;
  }
}

export async function saveObra(){
  const nome=document.getElementById('mo-nome').value.trim();if(!nome){alert('Nome obrigatório.');return;}
  const id=document.getElementById('mo-id').value||('obra_'+Date.now());
  const existing=S.OBRAS.findIndex(o=>o.id===id);
  const prazo=document.getElementById('mo-prazo').value||null;
  const encarregado_id=document.getElementById('mo-encarregado').value||null;
  const diretor_id=document.getElementById('mo-diretor').value||null;
  const ativa=existing>=0?S.OBRAS[existing].ativa:true;
  const diretores_extra=[..._moDiretoresExtra], encarregados_extra=[..._moEncarregadosExtra];
  const rec={id,nome,local:document.getElementById('mo-local').value.trim(),desc:document.getElementById('mo-desc').value.trim(),ativa,prazo,encarregado_id,diretor_id,diretores_extra,encarregados_extra};
  try {
    const {error} = await sb.from('obras').upsert({
      id:rec.id, nome:rec.nome, local:rec.local||null, descricao:rec.desc||null, ativa,
      prazo:prazo||null, encarregado_id:encarregado_id||null, diretor_id:diretor_id||null
    });
    if(error) throw error;
    const antigoDir=existing>=0?(S.OBRAS[existing].diretores_extra||[]):[];
    const antigoEnc=existing>=0?(S.OBRAS[existing].encarregados_extra||[]):[];
    await _syncObraExtra('obra_diretores_extra','diretor_id',id,diretores_extra,antigoDir);
    await _syncObraExtra('obra_encarregados_extra','encarregado_id',id,encarregados_extra,antigoEnc);
    if(existing>=0)S.OBRAS[existing]={...S.OBRAS[existing],...rec};else S.OBRAS.push(rec);
    closeModal('modal-obra');renderObras();populateFilterSelects();flashAlert('obra-alert');
    R.emitEvent?.({ acao:(existing>=0?'Obra atualizada':'Nova obra')+': '+nome, seccao:'obras' });
  } catch(e){
    alert('Erro ao guardar obra: '+e.message+'\nVerifique a ligação ao Supabase.');
  }
}

export async function toggleObra(id){
  const o=S.OBRAS.find(x=>x.id===id);if(!o)return;
  o.ativa=!o.ativa;
  await sbToggleObra(id,o.ativa);
  renderObras();populateFilterSelects();
}
