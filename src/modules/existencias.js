// ═══════════════════════════════════════
//  EXISTÊNCIAS — stock de material em obra, por empreitada e por mês
//  Lista de materiais = custos de "Materiais" importados (co_custo_det, tipologia 'mat')
//  com o preço unitário (valor/quantidade do último mês em que o artigo teve custo).
//  Cada contagem gravada fica no histórico (co_existencia). Para o controlo de custos conta
//  sempre a última existência gravada: o seu total é copiado para co_obra.existencias.
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S } from '../state.js';
import { showToast } from './navigation.js';
import { obraEmCurso } from '../config.js';

const EX = { view:'', addCat:'', addQ:'', addOpen:false, obra:null, mes:'', linhas:[], hist:[], q:'', carregado:false, dirty:false, gravadoMes:null };

const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const eur = v => new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR'}).format(v||0);
const nQ = v => new Intl.NumberFormat('pt-PT',{maximumFractionDigits:3}).format(v||0);
const num = v => { const n = parseFloat(String(v).replace(/[€\s ]/g,'').replace(',','.')); return isNaN(n) ? 0 : n; };
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const mesLong = ym => { const [y,m] = ym.split('-'); return MESES[parseInt(m)-1]+' '+y; };
const mesAtual = () => { const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); };
const keyOf = l => (l.f||'')+'|'+(l.a||'');
const draftKey = () => `plandese_exist_${EX.obra}_${EX.mes}`;
const split = nome => { const m = String(nome||'').match(/^(O\d+)\s*[-–]\s*(.+)$/); return m ? { cod:m[1], nome:m[2] } : { cod:'', nome:nome||'' }; };

// Obras visíveis: o diretor vê as suas (se não tiver nenhuma atribuída, vê todas); os restantes veem todas
function obrasVisiveis(){
  const todas = (S.OBRAS||[]).filter(o => obraEmCurso(o) && !/^O099/.test(o.nome||''));
  const u = S.currentUser;
  if(u && u.role === 'diretor_obra'){
    const minhas = todas.filter(o => o.diretor_id === u.key || (o.diretores_extra||[]).includes(u.key));
    if(minhas.length) return minhas;
  }
  return todas;
}

// Entrada na página: começa sempre pela lista de obras em cartões
export async function initExistencias(){
  EX.obra = null; EX.view = '';
  if(!EX.mes) EX.mes = mesAtual();
  await exCartoes();
}

const nomesDiretores = o => [o.diretor_id, ...(o.diretores_extra||[])].filter(Boolean).map(u=>S.USERS?.[u]?.nome||u);

async function exCartoes(){
  const root = document.getElementById('ex-root'); if(!root) return;
  const obras = obrasVisiveis();
  if(!obras.length){ root.innerHTML = '<div class="co-empty" style="padding:30px">Sem obras disponíveis.</div>'; return; }
  root.innerHTML = '<div class="co-empty" style="padding:30px">A carregar…</div>';
  const ult = {};
  try{
    const { data, error } = await sb.from('co_existencia').select('obra_id,mes,total,atualizado')
      .in('obra_id', obras.map(o=>o.id)).order('mes',{ascending:false});
    if(error) throw error;
    (data||[]).forEach(r=>{ if(!ult[r.obra_id]) ult[r.obra_id] = r; });
  }catch(e){ root.innerHTML = `<div class="co-empty" style="padding:30px">Erro ao carregar: ${esc(e.message||e)}</div>`; return; }
  const cartao = o => {
    const sp = split(o.nome), u = ult[o.id], dirs = nomesDiretores(o);
    return `<button class="co-ob" type="button" onclick="exAbrirObra('${esc(o.id)}')">
      <div class="co-ob-top"><span class="co-ob-cod">${esc(sp.cod||'Obra')}</span></div>
      <div class="co-ob-nome">${esc(sp.nome)}</div>
      <div class="co-ob-saldo">${u?eur(u.total):'—'}</div>
      <div class="co-ob-sub">${u?'Existência de '+mesLong(u.mes):'Sem existência registada'}</div>
      <div class="co-ob-lin"><span>Diretor <b>${esc(dirs.join(', ')||'—')}</b></span></div>
      <div class="co-ob-lin"><span>Última existência <b>${u&&u.atualizado?new Date(u.atualizado).toLocaleDateString('pt-PT'):'—'}</b></span></div>
    </button>`;
  };
  root.innerHTML = `<div class="co-list">${obras.map(cartao).join('')}</div>`;
}

export async function exAbrirObra(id){
  EX.view = ''; EX.obra = id; EX.q = ''; EX.mes = mesAtual();
  await exCarregar();
}
export function exVoltar(){
  if(EX.dirty && !confirm('Há alterações por gravar. Sair mesmo assim? (ficam guardadas como rascunho neste browser)')) return;
  EX.obra = null; EX.dirty = false;
  exCartoes();
}

async function exCarregar(){
  const root = document.getElementById('ex-root'); if(!root) return;
  if(!EX.obra){ root.innerHTML = '<div class="co-empty" style="padding:30px">Sem obras disponíveis.</div>'; return; }
  root.innerHTML = '<div class="co-empty" style="padding:30px">A carregar…</div>';
  let det = [];
  try{
    for(let from=0;;from+=1000){
      const { data, error } = await sb.from('co_custo_det').select('mes,fornecedor,artigo,qtd,valor')
        .eq('obra_id', EX.obra).eq('tipologia','mat').order('mes').range(from, from+999);
      if(error) throw error;
      det = det.concat(data||[]);
      if(!data || data.length<1000) break;
    }
    const h = await sb.from('co_existencia').select('mes,linhas,total,nota,guardado_por,atualizado').eq('obra_id', EX.obra).order('mes',{ascending:false});
    if(h.error) throw h.error;
    EX.hist = h.data||[];
  }catch(e){ root.innerHTML = `<div class="co-empty" style="padding:30px">Erro ao carregar: ${esc(e.message||e)}</div>`; return; }

  // Agrega por fornecedor+artigo; preço = valor/qtd do último mês com quantidade
  const m = {};
  det.forEach(r=>{
    const l = (m[(r.fornecedor||'')+'|'+(r.artigo||'')] ||= { f:r.fornecedor||'', a:r.artigo||'', p:0, comprado:0, _mes:'' });
    l.comprado += +r.qtd||0;
    if((+r.qtd||0) > 0 && r.mes >= l._mes){ l._mes = r.mes; l.p = (+r.valor||0)/(+r.qtd); }
  });
  EX.base = Object.values(m).map(l => ({ f:l.f, a:l.a, p:Math.round(l.p*10000)/10000, comprado:l.comprado }))
    .sort((a,b)=> (a.a||'').localeCompare(b.a||'','pt'));
  EX.carregado = true;
  exAplicarMes();
}

// Constrói as linhas do mês: quantidades do gravado (ou do rascunho local) sobre a lista de materiais
function exAplicarMes(){
  const gravado = EX.hist.find(h=>h.mes===EX.mes);
  let qtds = {}, precos = {}, rasc = {}, extras = [];
  (gravado?.linhas||[]).forEach(l=>{ qtds[keyOf(l)] = l.q; precos[keyOf(l)] = l.p; });
  EX.dirty = false;
  try{
    const raw = localStorage.getItem(draftKey());
    if(raw){
      const d = JSON.parse(raw);
      extras = Array.isArray(d.__extra) ? d.__extra : [];
      delete d.__extra;
      rasc = d; qtds = { ...qtds, ...d }; EX.dirty = true;
    }
  }catch(e){}
  const base = EX.base.map(l => ({ ...l, q:qtds[keyOf(l)]||0, p:(precos[keyOf(l)] ?? l.p) }));
  // linhas gravadas que já não estão na lista de custos mantêm-se
  // (e artigos acrescentados à mão: manual=true, com preço editável)
  (gravado?.linhas||[]).forEach(l=>{ if(!base.some(b=>keyOf(b)===keyOf(l)) && rasc[keyOf(l)] !== 0) base.push({ f:l.f, a:l.a, r:l.r, un:l.u, p:l.p, comprado:0, q:qtds[keyOf(l)]??l.q, manual:true }); });
  extras.forEach(l=>{ if(!base.some(b=>keyOf(b)===keyOf(l))) base.push({ f:l.f, a:l.a, r:l.r, un:l.un, p:l.p, comprado:0, q:qtds[keyOf(l)]||0, manual:true }); });
  EX.linhas = base;
  exRender();
}

function exTotal(){ return EX.linhas.reduce((s,l)=>s+(+l.q||0)*(+l.p||0),0); }

function exRender(){
  const root = document.getElementById('ex-root'); if(!root) return;
  const obras = obrasVisiveis();
  const gravado = EX.hist.find(h=>h.mes===EX.mes);
  const ultima = EX.hist[0];
  const q = EX.q.trim().toLowerCase();
  const vis = EX.linhas.map((l,i)=>({l,i})).filter(({l}) => !q || (l.a+' '+l.f).toLowerCase().includes(q));
  const linhas = vis.map(({l,i}) => `<tr>
      <td>${esc(l.a||'(sem artigo)')}${l.manual?' <span class="ex-pill">acrescentado</span>':''}<div style="font-size:11px;color:var(--gray-400)">${esc(l.manual?(l.r||''):(l.f||'(sem fornecedor)'))}</div></td>
      <td class="r">${l.manual?`<input type="text" inputmode="decimal" class="ex-q" value="${l.p?String(l.p).replace('.',','):''}" placeholder="0" onchange="exSetPreco(${i},this)" style="width:84px;text-align:right">`:(l.p?eur(l.p):'—')}</td>
      <td class="r ex-hide-m">${l.comprado?nQ(l.comprado):'—'}</td>
      <td class="r"><input type="text" inputmode="decimal" class="ex-q" value="${l.q?String(l.q).replace('.',','):''}" placeholder="0" onchange="exSetQtd(${i},this)" style="width:84px;text-align:right"></td>
      <td class="r" id="ex-v-${i}">${l.q&&l.p?eur(l.q*l.p):'—'}${l.manual?` <button type="button" class="perm-reset" title="Remover artigo" onclick="exRemover(${i})">✕</button>`:''}</td></tr>`).join('');
  root.innerHTML = `
    <style>
      .ex-head{display:flex;flex-wrap:wrap;align-items:center;gap:12px 16px;margin-bottom:14px}
      .ex-obra{font-size:17px;font-weight:700;color:var(--gray-900);flex:1;min-width:140px}
      .ex-bar{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin-bottom:14px}
      .ex-search{flex:1;min-width:200px}
      .ex-bar label{font-size:11px;font-weight:600;color:var(--gray-500);display:flex;flex-direction:column;gap:4px}
      .ex-bar select,.ex-bar input{padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px;background:var(--white)}
      .ex-tot{text-align:right}.ex-tot b{display:block;font-size:22px;color:var(--gray-900)}
      .ex-tot span{font-size:11px;color:var(--gray-500)}
      .ex-tbl{width:100%;border-collapse:collapse;font-size:13px}
      .ex-tbl th{text-align:left;padding:9px 12px;background:var(--gray-50);border-bottom:2px solid var(--gray-200);font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--gray-500);position:sticky;top:0}
      .ex-tbl td{padding:8px 12px;border-bottom:1px solid var(--gray-100);vertical-align:middle}
      .ex-tbl .r,.ex-tbl th.r{text-align:right}
      .ex-q{padding:6px 8px;border:1px solid var(--gray-200);border-radius:6px}
      .ex-hist tr{cursor:pointer}.ex-hist tr:hover td{background:var(--gray-50)}
      .ex-pill{display:inline-block;font-size:10.5px;font-weight:600;border-radius:10px;padding:2px 8px;background:var(--blue-50);color:var(--blue-500)}
      .ex-pill.warn{background:#fef3c7;color:#92400e}
      @media(max-width:700px){.ex-hide-m{display:none}.ex-tot{width:100%;text-align:left}}
    </style>
    <div class="ex-head">
      <button class="btn btn-secondary" type="button" onclick="exVoltar()">← Obras</button>
      <div class="ex-obra">${esc((()=>{const o=obras.find(x=>x.id===EX.obra);if(!o)return '';const s=split(o.nome);return (s.cod?s.cod+' · ':'')+s.nome;})())}</div>
      <div class="ex-tot"><span>Total da existência de ${mesLong(EX.mes)}</span><b id="ex-total">${eur(exTotal())}</b>
        ${EX.dirty?'<span class="ex-pill warn">alterações por gravar</span>':(gravado?'<span class="ex-pill">gravada</span>':'')}</div>
    </div>
    <div class="ex-bar">
      <label>Mês<input type="month" value="${EX.mes}" onchange="exMudarMes(this.value)"></label>
      <label class="ex-search">Pesquisar material<input type="search" value="${esc(EX.q)}" placeholder="Artigo ou fornecedor…" oninput="exPesquisa(this.value)"></label>
      <button class="btn btn-secondary" type="button" onclick="exAbrirAdd()">+ Adicionar artigo</button>
    </div>

    ${ultima?`<div style="font-size:12px;color:var(--gray-500);margin-bottom:10px">Para o controlo de custos conta a última existência gravada: <b>${mesLong(ultima.mes)}</b> — ${eur(ultima.total)}.</div>`:'<div style="font-size:12px;color:var(--gray-500);margin-bottom:10px">Ainda não há nenhuma existência gravada para esta obra.</div>'}
    ${EX.linhas.length?`<div class="card" style="padding:0;overflow:auto;max-height:60vh"><table class="ex-tbl">
      <thead><tr><th>Material</th><th class="r">Preço unit.</th><th class="r ex-hide-m">Comprado</th><th class="r">Existência (qtd)</th><th class="r">Valor</th></tr></thead>
      <tbody>${linhas||'<tr><td colspan="5" style="text-align:center;color:var(--gray-400);padding:24px">Nenhum material corresponde à pesquisa.</td></tr>'}</tbody></table></div>`
      :'<div class="card" style="padding:30px;text-align:center;color:var(--gray-500)">Esta obra ainda não tem materiais nos custos. Importe-os em Controlo de Obras (Atualizar das pastas).</div>'}
    <div style="display:flex;justify-content:flex-end;gap:10px;margin:14px 0 24px;flex-wrap:wrap">
      ${EX.dirty?'<button class="btn btn-secondary" type="button" onclick="exDescartar()">Descartar alterações</button>':''}
      <button class="btn btn-primary" type="button" onclick="exGravar()">Gravar existência de ${mesLong(EX.mes)}</button>
    </div>
    <div style="font-size:13px;font-weight:700;margin-bottom:8px">Histórico de existências</div>
    <div class="card" style="padding:0;overflow:auto"><table class="ex-tbl ex-hist"><thead><tr><th>Mês</th><th class="r">Total</th><th>Gravado por</th><th>Data</th><th></th></tr></thead><tbody>
      ${EX.hist.length?EX.hist.map((h,i)=>`<tr onclick="exMudarMes('${h.mes}')"><td><b>${mesLong(h.mes)}</b> ${i===0?'<span class="ex-pill">em vigor</span>':''}</td><td class="r">${eur(h.total)}</td><td>${esc(S.USERS?.[h.guardado_por]?.nome||h.guardado_por||'—')}</td><td>${h.atualizado?new Date(h.atualizado).toLocaleDateString('pt-PT'):''}</td><td class="r"><span style="color:var(--gray-400)">abrir ›</span></td></tr>`).join(''):'<tr><td colspan="5" style="text-align:center;color:var(--gray-400);padding:20px">Sem histórico.</td></tr>'}
    </tbody></table></div>`;
}

function exGuardarRascunho(){
  const d = {};
  EX.linhas.forEach(l=>{ if(l.q) d[keyOf(l)] = l.q; });
  try{
    // linhas a zero também têm de ser lembradas para sobrepor o gravado
    const g = EX.hist.find(h=>h.mes===EX.mes);
    (g?.linhas||[]).forEach(l=>{ if(!(keyOf(l) in d)) d[keyOf(l)] = 0; });
    d.__extra = EX.linhas.filter(l=>l.manual).map(l=>({ f:l.f, a:l.a, r:l.r||'', un:l.un||'', p:l.p }));
    localStorage.setItem(draftKey(), JSON.stringify(d));
  }catch(e){}
}

export function exSetQtd(i, inp){
  const l = EX.linhas[i]; if(!l) return;
  l.q = Math.abs(num(inp.value));
  inp.value = l.q ? String(l.q).replace('.',',') : '';
  EX.dirty = true;
  exGuardarRascunho();
  const v = document.getElementById('ex-v-'+i); if(v) v.textContent = l.q&&l.p ? eur(l.q*l.p) : '—';
  const t = document.getElementById('ex-total'); if(t) t.textContent = eur(exTotal());
}
export function exPesquisa(v){ EX.q = v; exRenderTabelaFocus(); }
function exRenderTabelaFocus(){
  const pos = document.activeElement?.selectionStart;
  exRender();
  const s = document.querySelector('#ex-root input[type=search]');
  if(s){ s.focus(); try{ s.setSelectionRange(pos ?? s.value.length, pos ?? s.value.length); }catch(e){} }
}
export function exMudarObra(id){ EX.obra = id; EX.q=''; exCarregar(); }
export function exMudarMes(mes){ if(!mes) return; EX.mes = mes; exAplicarMes(); }
export function exDescartar(){
  if(!confirm('Descartar as alterações por gravar deste mês?')) return;
  try{ localStorage.removeItem(draftKey()); }catch(e){}
  exAplicarMes();
}

export async function exGravar(){
  const mes = EX.mes;
  const linhas = EX.linhas.filter(l=>l.q>0).map(l=>({ f:l.f, a:l.a, r:l.r||'', u:l.un||'', p:l.p, q:l.q }));
  const total = Math.round(exTotal()*100)/100;
  const existe = EX.hist.some(h=>h.mes===mes);
  if(existe && !confirm(`Já existe uma existência gravada para ${mesLong(mes)}. Substituir?`)) return;
  const row = { obra_id:EX.obra, mes, linhas, total, guardado_por:S.currentUser?.key||'', atualizado:new Date().toISOString() };
  const { error } = await sb.from('co_existencia').upsert(row, { onConflict:'obra_id,mes' });
  if(error){ console.warn('co_existencia', error); showToast('Sem permissão ou erro ao gravar a existência'); return; }
  EX.hist = [ ...EX.hist.filter(h=>h.mes!==mes), row ].sort((a,b)=>b.mes.localeCompare(a.mes));
  // O controlo de custos usa sempre a última existência gravada
  const vigor = EX.hist[0];
  const up = await sb.from('co_obra').upsert({ obra_id:EX.obra, existencias:vigor.total, atualizado:new Date().toISOString() }, { onConflict:'obra_id' });
  if(up.error){ console.warn('co_obra', up.error); showToast('Existência gravada, mas não foi possível atualizar o controlo de custos'); }
  else showToast('Existência gravada ✓ — em vigor no controlo de custos: ' + mesLong(vigor.mes));
  try{ localStorage.removeItem(draftKey()); }catch(e){}
  EX.dirty = false;
  exRender();
}

// "Adicionar artigo": abre a mesma lista de materiais (ecrã inteiro, catálogo CentralGest) do departamento de Compras.
export function exAbrirAdd(){
  if(typeof window.abrirListaMateriais !== 'function'){ showToast('Lista de materiais indisponível'); return; }
  const atuais = EX.linhas.filter(l=>l.manual).map(l=>({ ref:l.r||'', nome:l.a, un:l.un||'', qty:l.q||1, p:l.p||0 }));
  window.abrirListaMateriais({ artigos: atuais, onConfirm: exAplicarLista });
}
function exZerarRascunho(keys){
  try{
    const d = JSON.parse(localStorage.getItem(draftKey())||'{}');
    keys.forEach(k=>{ d[k] = 0; });
    localStorage.setItem(draftKey(), JSON.stringify(d));
  }catch(e){}
}
// Aplica a seleção: as linhas acrescentadas passam a ser exatamente as escolhidas (catálogo e avulsos)
const mesmoArt = (l, a) => l.manual && (a.ref ? l.r===a.ref : (!l.r && l.a===a.nome));
function exAplicarLista(sel){
  const removidas = EX.linhas.filter(l=>l.manual && !sel.some(a=>mesmoArt(l,a)));
  EX.linhas = EX.linhas.filter(l=>!removidas.includes(l));
  sel.forEach(a=>{
    const ex = EX.linhas.find(l=>mesmoArt(l,a));
    const q = Math.abs(+a.qty||0), p = Math.abs(+a.p||0);
    if(ex){ ex.q = q; if(p) ex.p = p; }
    else EX.linhas.push({ f:'', a:a.nome, r:a.ref||'', un:a.un, p, comprado:0, q, manual:true });
  });
  EX.linhas.sort((x,y)=>(x.a||'').localeCompare(y.a||'','pt'));
  EX.dirty = true;
  exGuardarRascunho();
  exZerarRascunho(removidas.map(keyOf));
  exRender();
  showToast(sel.length ? `${sel.length} artigo${sel.length!==1?'s':''} na contagem — confirme os preços unitários` : 'Seleção atualizada');
}
export function exSetPreco(i, inp){
  const l = EX.linhas[i]; if(!l) return;
  l.p = Math.abs(num(inp.value));
  inp.value = l.p ? String(l.p).replace('.',',') : '';
  EX.dirty = true; exGuardarRascunho(); exRender();
}
export function exRemover(i){
  const l = EX.linhas[i]; if(!l) return;
  if(!confirm('Remover o artigo "'+l.a+'" desta existência?')) return;
  // fica a 0 no rascunho para sobrepor o gravado
  const k = keyOf(l);
  EX.linhas.splice(i,1);
  EX.dirty = true;
  exGuardarRascunho();
  try{ const d = JSON.parse(localStorage.getItem(draftKey())||'{}'); d[k] = 0; localStorage.setItem(draftKey(), JSON.stringify(d)); }catch(e){}
  exRender();
}
