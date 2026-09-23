// ═══════════════════════════════════════
//  PENDENTES TAVIRA — trabalhos por concluir nas obras 49 e 53
//  Tabelas partilhadas com o artifact "Pendentes Tavira":
//  tavira_topicos (tópicos adicionados), tavira_estado (resolvido/aberto), tavira_fotos (fotos em dataURL)
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { showToast } from './navigation.js';

// Lista base (ids fixos — o estado e as fotos em Supabase referem estes ids)
const BASE = [
  {id:'49-01',o:'49',r:'Rua da Porta Nova',t:'Reposição de sinalização rodoviária vertical e horizontal. A passadeira não está visível, deverá ser pintada de branco.'},
  {id:'49-02',o:'49',r:'Rua da Porta Nova',t:'Reposição das lombas existentes. As 2 lombas já foram repostas, mas uma delas está incompleta.'},
  {id:'49-03',o:'49',r:'Rua Porta Nova, n.º 106',rec:1,t:'O proprietário da habitação solicitou reparação de danos causados durante a obra. Na altura já foi retificado o azulejo azul na parede que se danificou e a tampa da antiga torneira de corte de água na parede também ficou resolvida.'},
  {id:'49-04',o:'49',r:'Rua de Santa Ana',t:'Falta reabilitar o lancil partido na zona.'},
  {id:'49-05',o:'49',r:'Rua de Santa Ana',t:'Falta requalificar o lancil rebaixado, danificado com a passagem das máquinas.'},
  {id:'49-06',o:'49',r:'Rua do Apeadeiro',t:'Executar abrigo para ventosa – nó 199, no fim da Rua do Apeadeiro.'},
  {id:'49-07',o:'49',r:'Rua dos Namarrais',t:'Reposição das condições iniciais na lateral da padaria da “Porta Nova”: falta repor o revestimento do piso na zona da vala da nova conduta e ligação do ramal domiciliário do conjunto habitacional, desde o limite do betuminoso até ao portão, entre o nó 315 e 316a.'},
  {id:'49-08',o:'49',r:'Rua do Óculo',t:'Melhorar os remates nas juntas de união entre o betuminoso existente e o novo, ao longo de toda a rua entre o nó 257 e o nó 260, principalmente na ligação à rede pública existente no Largo do Carmo, entre o nó 260 e o nó 261.'},
  {id:'49-09',o:'49',r:'Rua do Óculo',t:'Na zona da vala do ramal domiciliário do infantário “Pimpão” o lancil foi reposicionado, mas no outro ramal domiciliário (caixa de piso) a reabilitação do lancil com argamassa de cimento não está em condições. Reabilitar o lancil junto ao candeeiro de iluminação pública.'},
  {id:'49-10',o:'49',r:'Rua do Óculo',t:'Falta a camada de desgaste em betuminoso nas zonas das travessias dos ramais domiciliários.'},
  {id:'49-11',o:'49',r:'Rua do Óculo',t:'Existe um lancil por retificar.'},
  {id:'49-12',o:'49',r:'Rua Dr. Renato Mansinho da Graça, n.º 6',t:'Proprietário (Sr. Messias): melhorar com massa a rampa de acesso a veículos, onde a massa existente está partida, e tapar o buraco existente com massa.'},
  {id:'49-13',o:'49',r:'Rua Irene Rolo',t:'Limpeza e impermeabilização interior das caixas de caudalímetros e VRP’s.'},
  {id:'49-14',o:'49',r:'Rua Álvaro de Campos',t:'Limpeza e impermeabilização interior das caixas de caudalímetros e VRP’s.'},
  {id:'49-15',o:'49',r:'Rua Miraflores',t:'Tal como a ventosa da Rua Prof. Egas Moniz, falta retificar o topo da ventosa, que está mais baixo que o nível do passeio. A PLANDESE ficou de apresentar uma solução e retificar até ao final da obra.'},
  {id:'49-16',o:'49',r:'Rua Professor Egas Moniz',t:'Falta retificar o topo da ventosa, muito baixo em relação ao topo do pavê no passeio. A PLANDESE ficou de apresentar uma solução e retificar até ao final da obra.'},
  {id:'49-17',o:'49',r:'Travessa dos Fumeiros de Trás',t:'Repor as condições iniciais no remate da calçada grossa com o betuminoso da Rua dos Fumeiros, que partiu na vala da nova conduta e da ligação à rede pública no nó 252 (fim da Tv. Fumeiros de Trás e Rua Fumeiros de Trás).'},
  {id:'49-18',o:'49',r:'Travessa dos Fumeiros de Trás',rec:1,t:'Tratar do buraco existente e executar o rejuntamento em torno da caixa de visita pluvial.'},
];
const OBRAS = {'49':'Margem Direita','53':'Margem Esquerda Norte'};

let obra = '49', filtro = 'pend', custom = [], estado = {}, fotos = [], editId = null;
let iniciado = false, eventosLigados = false;
const dstr = t => new Date(t).toLocaleDateString('sv');
let repDate = dstr(Date.now());

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// Tópicos base com as edições (sobreposições em tavira_estado) aplicadas
const todos = () => BASE.map(i=>{
  const e = estado[i.id];
  if(!e) return i;
  return {...i, o:e.obra??i.o, r:e.rua??i.r, t:e.descricao??i.t, rec:e.reclamacao??i.rec};
}).concat(custom);

const mapTopico = x => ({id:x.id,o:x.obra,r:x.rua,t:x.descricao,rec:x.reclamacao,custom:1});
const mapFoto   = x => ({id:x.id,topic:x.topico_id,data:x.data,ts:new Date(x.created_at).getTime()});

async function carregarTopicos(){
  const {data,error} = await sb.from('tavira_topicos').select('*').order('created_at');
  if(error) throw error;
  custom = (data||[]).map(mapTopico);
}
async function carregarEstado(){
  const {data,error} = await sb.from('tavira_estado').select('*');
  if(error) throw error;
  estado = {};
  (data||[]).forEach(x => estado[x.topico_id] = {done:x.done, ts:new Date(x.updated_at).getTime(), obra:x.obra, rua:x.rua, descricao:x.descricao, reclamacao:x.reclamacao});
}
async function carregarFotos(){
  const {data,error} = await sb.from('tavira_fotos').select('*').order('created_at');
  if(error) throw error;
  fotos = (data||[]).map(mapFoto);
}

function setSync(ok){
  const el = $('pt-sync'); if(!el) return;
  el.textContent = ok ? 'Sincronizado' : 'Sem ligação';
  el.classList.toggle('on', ok);
}

// Chamado pelo hook goTo('pendentes-tavira')
export async function initPendentesTavira(){
  ligarEventos();
  render();
  try {
    await Promise.all([carregarTopicos(), carregarEstado(), carregarFotos()]);
    setSync(true);
  } catch(e){
    setSync(false);
    showToast('Sem ligação à base de dados — a mostrar apenas a lista base');
  }
  render();
  if(iniciado) return;
  iniciado = true;
  // Tempo real: alterações feitas no artifact ou noutro dispositivo aparecem logo
  sb.channel('portal-tavira-sync')
    .on('postgres_changes',{event:'*',schema:'public',table:'tavira_topicos'},()=>carregarTopicos().then(render).catch(()=>{}))
    .on('postgres_changes',{event:'*',schema:'public',table:'tavira_estado'}, ()=>carregarEstado().then(render).catch(()=>{}))
    .on('postgres_changes',{event:'*',schema:'public',table:'tavira_fotos'},  ()=>carregarFotos().then(render).catch(()=>{}))
    .subscribe();
}

function render(){
  const sec = $('sec-pendentes-tavira'); if(!sec) return;
  const items = todos();
  $('pt-tabs').innerHTML = Object.keys(OBRAS).map(k=>{
    const l = items.filter(i=>i.o===k), d = l.filter(i=>estado[i.id]?.done).length;
    return `<button class="pt-tab" type="button" data-o="${k}" aria-selected="${k===obra}"><b>Obra ${k}</b><small>${OBRAS[k]} · ${l.length?`${l.length-d} por fazer`:'sem tópicos'}</small></button>`;
  }).join('');
  const mine = items.filter(i=>i.o===obra), done = mine.filter(i=>estado[i.id]?.done).length;
  $('pt-prog').style.width = mine.length ? (100*done/mine.length)+'%' : '0';
  $('pt-prog-lbl').textContent = mine.length ? `${done} de ${mine.length} resolvidos` : '';
  sec.querySelectorAll('.pt-chip[data-f]').forEach(c=>c.setAttribute('aria-pressed', c.dataset.f===filtro));
  // Um tópico em edição fica sempre visível (mesmo que o filtro o esconda)
  const shown = mine.filter(i=>i.id===editId || filtro==='all' || (filtro==='done')===!!estado[i.id]?.done);
  // Preservar o que já foi escrito no formulário se a lista for redesenhada (ex.: atualização em tempo real)
  const rascunho = editId && $('pt-e-txt') ? {obra:$('pt-e-obra').value, rua:$('pt-e-rua').value, txt:$('pt-e-txt').value, rec:$('pt-e-rec').checked} : null;
  if(!shown.length){
    $('pt-list').innerHTML = `<p class="pt-empty">${mine.length?'Nada nesta lista.':'Ainda não há tópicos nesta obra.'}</p>`;
  } else {
    const grupos = [];
    shown.forEach(i=>{ let g = grupos.find(x=>x.r===i.r); if(!g) grupos.push(g={r:i.r,l:[]}); g.l.push(i); });
    $('pt-list').innerHTML = grupos.map(g=>`<h3 class="pt-rua">${esc(g.r)}</h3>`+g.l.map(card).join('')).join('');
  }
  if(rascunho && $('pt-e-txt')){
    $('pt-e-obra').value = rascunho.obra; $('pt-e-rua').value = rascunho.rua;
    $('pt-e-txt').value = rascunho.txt;   $('pt-e-rec').checked = rascunho.rec;
  }
  $('pt-addnote').textContent = `Será adicionado à obra ${obra} – ${OBRAS[obra]}.`;
  if(!$('pt-rep').hidden) drawRep();
}

function formEditar(i){
  return `<article class="pt-item pt-editing">
    <div class="field"><label for="pt-e-obra">Obra</label><select id="pt-e-obra">${Object.keys(OBRAS).map(k=>`<option value="${k}" ${k===i.o?'selected':''}>Obra ${k} – ${OBRAS[k]}</option>`).join('')}</select></div>
    <div class="field"><label for="pt-e-rua">Rua / local</label><input type="text" id="pt-e-rua" value="${esc(i.r)}"/></div>
    <div class="field"><label for="pt-e-txt">Descrição</label><textarea id="pt-e-txt" rows="4">${esc(i.t)}</textarea></div>
    <label class="pt-chk"><input type="checkbox" id="pt-e-rec" ${i.rec?'checked':''}/> Reclamação</label>
    <div class="pt-acts">
      <button type="button" class="btn btn-primary btn-sm" data-save="${i.id}">Guardar</button>
      <button type="button" class="btn btn-secondary btn-sm" data-cancel="1">Cancelar</button>
    </div></article>`;
}

function card(i){
  if(i.id===editId) return formEditar(i);
  const d = !!estado[i.id]?.done, ph = fotos.filter(f=>f.topic===i.id);
  return `<article class="pt-item ${d?'done':''}">
    <div class="pt-meta"><span class="pt-pill ${d?'ok':'pend'}">${d?'Resolvido':'Pendente'}</span>${i.rec?'<span class="pt-pill rec">Reclamação</span>':''}${i.custom?'<span class="pt-pill">Adicionado</span>':''}</div>
    <p class="pt-txt">${esc(i.t)}</p>
    ${ph.length?`<div class="pt-photos">${ph.map(f=>`<button type="button" class="pt-ph" data-ph="${f.id}" aria-label="Ver foto"><img loading="lazy" alt="Foto do pendente" src="${f.data}"></button>`).join('')}</div>`:''}
    <div class="pt-acts">
      <label class="btn btn-primary btn-sm" for="pt-f-${i.id}">+ Foto</label><input type="file" id="pt-f-${i.id}" data-up="${i.id}" accept="image/*" multiple hidden>
      <button type="button" class="btn btn-secondary btn-sm" data-tog="${i.id}">${d?'Reabrir':'Marcar resolvido'}</button>
      <button type="button" class="btn btn-secondary btn-sm" data-edit="${i.id}">Editar</button>
      ${i.custom?`<button type="button" class="btn btn-secondary btn-sm" data-del="${i.id}">Apagar</button>`:''}
    </div></article>`;
}

// Reduz a foto até ~230 KB (JPEG) para caber bem na tabela
async function comprimir(file){
  const url = URL.createObjectURL(file);
  const img = await new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=rej;im.src=url;});
  let max = 1100, q = .7, out;
  for(let n=0;n<6;n++){
    const s = Math.min(1, max/Math.max(img.width,img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width*s); c.height = Math.round(img.height*s);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    out = c.toDataURL('image/jpeg', q);
    if(out.length < 230000) break;
    q -= .08; max -= 150;
  }
  URL.revokeObjectURL(url);
  return out;
}

function ligarEventos(){
  if(eventosLigados) return;
  eventosLigados = true;
  const sec = $('sec-pendentes-tavira');

  sec.addEventListener('change', async e=>{
    const id = e.target.dataset?.up; if(!id) return;
    const files = [...e.target.files]; e.target.value = '';
    for(const f of files){
      try {
        showToast('A enviar foto…');
        const data = await comprimir(f);
        const {error} = await sb.from('tavira_fotos').insert({topico_id:id, data});
        if(error) throw error;
        await carregarFotos(); render();
        showToast('Foto guardada');
      } catch(_){ showToast('Não foi possível guardar a foto. Verifique a ligação.'); }
    }
  });

  sec.addEventListener('click', async e=>{
    const t = e.target.closest('[data-o],[data-f],[data-tog],[data-del],[data-ph],[data-edit],[data-save],[data-cancel]'); if(!t) return;
    if(t.dataset.edit){ editId = t.dataset.edit; render(); $('pt-e-txt')?.focus(); }
    else if(t.dataset.cancel){ editId = null; render(); }
    else if(t.dataset.save){ await guardarEdicao(t.dataset.save, t); }
    else if(t.dataset.o){ obra = t.dataset.o; editId = null; render(); }
    else if(t.dataset.f){ filtro = t.dataset.f; render(); }
    else if(t.dataset.tog){
      const id = t.dataset.tog, d = !estado[id]?.done;
      try {
        const {error} = await sb.from('tavira_estado').upsert({topico_id:id, done:d, updated_at:new Date().toISOString()});
        if(error) throw error;
        await carregarEstado(); render();
      } catch(_){ showToast('Não foi possível gravar. Verifique a ligação.'); }
    }
    else if(t.dataset.del){
      if(t.dataset.arm){
        try {
          const {error} = await sb.from('tavira_topicos').delete().eq('id', t.dataset.del);
          if(error) throw error;
          await carregarTopicos(); render();
        } catch(_){ showToast('Não foi possível apagar.'); }
      } else {
        t.dataset.arm = 1; t.textContent = 'Confirmar apagar';
        setTimeout(()=>{ t.dataset.arm=''; t.textContent='Apagar'; }, 3000);
      }
    }
    else if(t.dataset.ph){ abrirFoto(t.dataset.ph); }
  });

  $('pt-lb').addEventListener('click', e=>{ if(e.target.id==='pt-lb') $('pt-lb').hidden = true; });
}

async function guardarEdicao(id, btn){
  const novo = {obra:$('pt-e-obra').value, rua:$('pt-e-rua').value.trim(), descricao:$('pt-e-txt').value.trim(), reclamacao:$('pt-e-rec').checked};
  if(!novo.rua || !novo.descricao){ showToast('Preencha a rua e a descrição.'); return; }
  btn.disabled = true;
  try {
    const eCustom = custom.some(c=>c.id===id);
    // Tópicos adicionados: editar a própria linha. Tópicos base: guardar sobreposição em tavira_estado
    // (sem mexer em done/updated_at, que marcam a data de resolução usada no relatório)
    const {error} = eCustom
      ? await sb.from('tavira_topicos').update(novo).eq('id', id)
      : await sb.from('tavira_estado').upsert({topico_id:id, ...novo});
    if(error) throw error;
    await (eCustom ? carregarTopicos() : carregarEstado());
    editId = null;
    if(novo.obra !== obra){ obra = novo.obra; showToast(`Tópico movido para a obra ${novo.obra}`); }
    else showToast('Tópico atualizado');
    render();
  } catch(_){ btn.disabled = false; showToast('Não foi possível gravar. Verifique a ligação.'); }
}

function abrirFoto(pid){
  const f = fotos.find(x=>x.id===pid); if(!f) return;
  const lb = $('pt-lb');
  lb.innerHTML = `<img alt="Foto ampliada" src="${f.data}"><div class="pt-lb-row"><button type="button" class="btn btn-primary" id="pt-lbx">Fechar</button><button type="button" class="btn btn-secondary" id="pt-lbd">Apagar foto</button></div>`;
  lb.hidden = false;
  $('pt-lbx').onclick = ()=> lb.hidden = true;
  const d = $('pt-lbd');
  d.onclick = async ()=>{
    if(!d.dataset.arm){ d.dataset.arm = 1; d.textContent = 'Confirmar apagar'; return; }
    try {
      const {error} = await sb.from('tavira_fotos').delete().eq('id', pid);
      if(error) throw error;
      lb.hidden = true;
      await carregarFotos(); render();
    } catch(_){ showToast('Não foi possível apagar.'); }
  };
}

export async function ptAdicionar(){
  const r = $('pt-nrua').value.trim(), t = $('pt-ntxt').value.trim();
  if(!r || !t){ showToast('Preencha a rua e a descrição.'); return; }
  try {
    const {error} = await sb.from('tavira_topicos').insert({obra, rua:r, descricao:t, reclamacao:$('pt-nrec').checked});
    if(error) throw error;
    $('pt-nrua').value = ''; $('pt-ntxt').value = ''; $('pt-nrec').checked = false;
    await carregarTopicos(); render();
    showToast('Pendente adicionado');
  } catch(_){ showToast('Não foi possível adicionar. Verifique a ligação.'); }
}

// ── Relatório diário (imprimir / guardar PDF) ──
export function ptAbrirRelatorio(){
  const rep = $('pt-rep');
  // Fica fora do layout do portal para o @media print o poder isolar
  if(rep.parentElement !== document.body) document.body.appendChild(rep);
  rep.hidden = false;
  document.body.classList.add('pt-rep-open');
  drawRep();
}
export function ptFecharRelatorio(){
  $('pt-rep').hidden = true;
  document.body.classList.remove('pt-rep-open');
}

function drawRep(){
  const items = todos().filter(i=>i.o===obra), ph = id => fotos.filter(x=>x.topic===id);
  const act = items.filter(i=>ph(i.id).some(f=>dstr(f.ts)===repDate) || (estado[i.id]?.done && dstr(estado[i.id].ts)===repDate));
  const open = items.filter(i=>!estado[i.id]?.done);
  const dl = new Date(repDate+'T12:00').toLocaleDateString('pt-PT',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  $('pt-rep').innerHTML = `<div class="pt-rep-tools"><button type="button" class="btn btn-primary" onclick="window.print()">Imprimir / Guardar PDF</button><button type="button" class="btn btn-secondary" onclick="ptFecharRelatorio()">Fechar</button><label for="pt-rdate">Dia</label><input type="date" id="pt-rdate" value="${repDate}"></div>
  <div class="pt-rep-page"><h1>Relatório diário · Obra ${obra}</h1><p>${OBRAS[obra]} · Tavira · ${esc(dl)}</p>
  <h2>Atividade do dia</h2>${act.length?act.map(i=>{
    const fs = ph(i.id).filter(f=>dstr(f.ts)===repDate), r = estado[i.id]?.done && dstr(estado[i.id].ts)===repDate;
    return `<div class="pt-rep-item"><h3>${esc(i.r)}${i.rec?' (RECLAMAÇÃO)':''}${r?' — RESOLVIDO':''}</h3><p>${esc(i.t)}</p>${fs.length?`<div class="pt-rep-ph">${fs.map(f=>`<img alt="Foto" src="${f.data}">`).join('')}</div>`:''}</div>`;
  }).join(''):'<p>Sem fotos nem resoluções registadas neste dia.</p>'}
  <h2>Pendentes em aberto (${open.length} de ${items.length})</h2>${open.length?open.map(i=>`<div class="pt-rep-item"><h3>${esc(i.r)}${i.rec?' (RECLAMAÇÃO)':''}</h3><p>${esc(i.t)}</p></div>`).join(''):'<p>Sem pendentes em aberto.</p>'}
  <div class="pt-rep-sig"><div>Diretor de Obra</div><div>Fiscalização</div></div></div>`;
  $('pt-rdate').onchange = e=>{ repDate = e.target.value || repDate; drawRep(); };
}
