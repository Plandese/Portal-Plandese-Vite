// ═══════════════════════════════════════
//  ADMIN — OBRAS
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S, R } from '../state.js';
import { sbToggleObra } from '../db.js';
import { closeModal, populateFilterSelects, flashAlert } from './navigation.js';
import { fmtPT } from '../utils/helpers.js';

export function novaObra(){
  document.getElementById('mo-title').textContent='Nova obra';
  document.getElementById('mo-id').value='';
  document.getElementById('mo-nome').value='';
  document.getElementById('mo-local').value='';
  document.getElementById('mo-desc').value='';
  document.getElementById('mo-prazo').value='';
  _populateEncSelect('');
  _populateDiretorSelect('');
  document.getElementById('modal-obra').classList.add('open');
}

let _obrView='lista';

export function obrSetView(mode){
  _obrView=mode;
  ['lista','cards'].forEach(m=>{
    document.getElementById('obr-vbtn-'+m)?.classList.toggle('active', m===mode);
  });
  renderObras();
}

function _pessoas(o){
  return {
    diretorNome: o.diretor_id ? (S.USERS[o.diretor_id]?.nome || o.diretor_id) : null,
    encNome: o.encarregado_id ? (S.USERS[o.encarregado_id]?.nome || o.encarregado_id) : null
  };
}

function _renderObrasCards(){
  const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px';
  S.OBRAS.forEach(o=>{
    const {diretorNome,encNome}=_pessoas(o);
    const pessoasHtml = (diretorNome || encNome) ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--gray-100);display:flex;flex-direction:column;gap:4px">${diretorNome?`<div style="font-size:12px;color:var(--gray-500);display:flex;align-items:center;gap:6px"><span style="font-weight:600;color:var(--gray-400);min-width:80px">Diretor</span>${diretorNome}</div>`:''}${encNome?`<div style="font-size:12px;color:var(--gray-500);display:flex;align-items:center;gap:6px"><span style="font-weight:600;color:var(--gray-400);min-width:80px">Encarregado</span>${encNome}</div>`:''}</div>` : '';
    const card=document.createElement('div');card.className='card';card.style.padding='16px';card.innerHTML=`<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px"><div style="display:flex;align-items:center;gap:10px;flex:1"><div style="width:10px;height:10px;border-radius:50%;background:${o.ativa?'var(--green)':'var(--gray-300)'};flex-shrink:0;margin-top:3px"></div><div><div style="font-weight:600;font-size:14px">${o.nome}</div>${o.local?`<div style="font-size:12px;color:var(--gray-400);margin-top:2px">${o.local}</div>`:''}</div></div><div style="display:flex;gap:4px;flex-shrink:0"><button class="btn btn-secondary btn-sm" onclick="editObra('${o.id}')">Editar</button><button class="btn btn-sm" style="background:${o.ativa?'var(--yellow-bg)':'var(--green-bg)'};color:${o.ativa?'var(--yellow)':'var(--green)'};border:1px solid ${o.ativa?'#FDE68A':'var(--green-light)'}" onclick="toggleObra('${o.id}')">${o.ativa?'Desativar':'Ativar'}</button></div></div>${pessoasHtml}`;
    grid.appendChild(card);
  });
  return grid;
}

function _renderObrasLista(){
  const wrap=document.createElement('div');wrap.className='card';wrap.style.cssText='padding:0;overflow:hidden';
  const tblWrap=document.createElement('div');tblWrap.className='tbl-wrap';
  const rows=S.OBRAS.map(o=>{
    const {diretorNome,encNome}=_pessoas(o);
    return `<tr>
      <td><span style="width:8px;height:8px;border-radius:50%;background:${o.ativa?'var(--green)':'var(--gray-300)'};display:inline-block;margin-right:8px"></span><span style="font-weight:500">${o.nome}</span></td>
      <td style="color:var(--gray-500)">${o.local||'—'}</td>
      <td style="color:var(--gray-500)">${o.prazo?fmtPT(o.prazo):'—'}</td>
      <td style="color:var(--gray-500)">${diretorNome||'—'}</td>
      <td style="color:var(--gray-500)">${encNome||'—'}</td>
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
  if(!S.OBRAS.length){cont.innerHTML='<div class="card" style="text-align:center;color:var(--gray-400);padding:32px">Nenhuma obra criada. Clique em "Nova obra".</div>';document.getElementById('nb-obras').textContent=0;return;}
  cont.appendChild(_obrView==='cards' ? _renderObrasCards() : _renderObrasLista());
  document.getElementById('nb-obras').textContent=S.OBRAS.filter(o=>o.ativa).length;
}

export function editObra(id){
  const o=S.OBRAS.find(x=>x.id===id);if(!o)return;
  document.getElementById('mo-title').textContent='Editar obra';
  document.getElementById('mo-id').value=id;
  document.getElementById('mo-nome').value=o.nome;
  document.getElementById('mo-local').value=o.local||'';
  document.getElementById('mo-desc').value=o.desc||'';
  document.getElementById('mo-prazo').value=o.prazo||'';
  _populateEncSelect(o.encarregado_id||'');
  _populateDiretorSelect(o.diretor_id||'');
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

export async function saveObra(){
  const nome=document.getElementById('mo-nome').value.trim();if(!nome){alert('Nome obrigatório.');return;}
  const id=document.getElementById('mo-id').value||('obra_'+Date.now());
  const existing=S.OBRAS.findIndex(o=>o.id===id);
  const prazo=document.getElementById('mo-prazo').value||null;
  const encarregado_id=document.getElementById('mo-encarregado').value||null;
  const diretor_id=document.getElementById('mo-diretor').value||null;
  const ativa=existing>=0?S.OBRAS[existing].ativa:true;
  const rec={id,nome,local:document.getElementById('mo-local').value.trim(),desc:document.getElementById('mo-desc').value.trim(),ativa,prazo,encarregado_id,diretor_id};
  try {
    const {error} = await sb.from('obras').upsert({
      id:rec.id, nome:rec.nome, local:rec.local||null, descricao:rec.desc||null, ativa,
      prazo:prazo||null, encarregado_id:encarregado_id||null, diretor_id:diretor_id||null
    });
    if(error) throw error;
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
