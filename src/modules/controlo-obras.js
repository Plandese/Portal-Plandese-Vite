// ═══════════════════════════════════════
//  CONTROLO DE OBRAS — lista de empreitadas + balanço por empreitada
//  Dados no Supabase (co_obra, co_mensal), partilhados por todos.
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S } from '../state.js';
import { showToast, closeModal } from './navigation.js';
import { coBalancoHtml, coBalancoCalc } from './co-balanco.js';
import { coRelatorioPdf } from './co-relatorio.js';
import { coParseCustos, coPastaRaiz, coPastaObra, coLerObra, pastasSuportado } from './co-pastas.js';

const CO = { loaded:false, extra:{}, mensal:[], sel:null, importObra:null, de:'', ate:'' };
const periodo = () => ({ de:CO.de, ate:CO.ate });
const isMobile = () => document.body.classList.contains('device-mobile');
const CORES = ['oklch(0.58 0.15 255)','oklch(0.66 0.17 40)','oklch(0.68 0.13 165)','oklch(0.76 0.15 80)','oklch(0.52 0.16 295)','oklch(0.62 0.18 5)'];
const CAMPOS = [['proveitos','Proveitos'],['mo','Mão de obra'],['eq','Equipamentos'],['mat','Materiais'],['sub','Subcontratos'],['geral','Geral'],['outros','Outros'],['exist','Existências']];

const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const eur0 = v => new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(v||0);
const pct = v => (v*100).toFixed(1).replace('.',',')+'%';
const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const mesLabel = ym => { const [y,m]=ym.split('-'); return MESES[parseInt(m)-1]+'/'+y.slice(2); };
const mesLong = ym => { const [y,m]=ym.split('-'); return ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'][parseInt(m)-1]+' '+y; };
const num = v => { const n = parseFloat(String(v).replace(/[€\s ]/g,'').replace(',','.')); return isNaN(n) ? 0 : n; };

// O099 (CC Estrutura central) é um centro de custos, não uma empreitada
const obrasAtivas = () => S.OBRAS.filter(o => o.ativa !== false && !/^O099/.test(o.nome||''));
const split = nome => { const m = String(nome||'').match(/^(O\d+)\s*[-–]\s*(.+)$/); return m ? { cod:m[1], nome:m[2] } : { cod:'', nome:nome||'' }; };
const withExtra = o => ({ id:o.id, nome:o.nome, extra:CO.extra[o.id]||{} });
const noPeriodo = r => (!CO.de || r.mes>=CO.de) && (!CO.ate || r.mes<=CO.ate);

// Seletor De/Até: só afeta a análise; os lançamentos mensais mostram sempre tudo.
function coPeriodoBar(ids){
  const ms = [...new Set(CO.mensal.filter(r=>ids.has(r.obra_id)).map(r=>r.mes))].sort();
  const opt = (sel, vazio) => `<option value="">${vazio}</option>` + ms.map(m=>`<option value="${m}"${m===sel?' selected':''}>${mesLong(m)}</option>`).join('');
  const per = ms.length<2 ? '' : `<span>${isMobile()?'De':'Analisar de'}</span><select onchange="coPeriodo('de',this.value)">${opt(CO.de,'início')}</select><span>até</span><select onchange="coPeriodo('ate',this.value)">${opt(CO.ate,'último mês')}</select>${(CO.de||CO.ate) && !isMobile()?`<button onclick="coPeriodo('reset')">Limpar</button>`:''}`;
  const upd = (!pastasSuportado() || isMobile()) ? '' : `<span style="margin-left:auto;display:flex;gap:6px"><button id="co-upd-btn" onclick="coAtualizar()" title="Lê os ficheiros das pastas das obras (custos e autos de medição) e atualiza os valores">↻ Atualizar das pastas</button><button onclick="coAtualizar(true)" title="Escolher outra pasta raiz">Pasta…</button></span>`;
  return (per||upd) ? `<div class="co-per">${per}${upd}</div><div id="co-upd-log"></div>` : '';
}
function coPeriodo(qual, val){
  if(qual==='reset'){ CO.de = CO.ate = ''; }
  else { CO[qual] = val||''; if(CO.de && CO.ate && CO.de>CO.ate){ if(qual==='de') CO.ate = CO.de; else CO.de = CO.ate; } }
  if(CO.sel) coRenderDetail(true); else coRenderList();
}

async function coLoad(){
  const [a, b] = await Promise.all([
    sb.from('co_obra').select('*'),
    sb.from('co_mensal').select('*').order('mes').range(0, 4999),
  ]);
  if(a.error || b.error){ console.warn('co_load', a.error||b.error); showToast('Erro ao carregar o Controlo de Obras'); return; }
  CO.extra = Object.fromEntries((a.data||[]).map(r=>[r.obra_id, r]));
  CO.mensal = b.data||[];
  CO.loaded = true;
}

// ── Página ────────────────────────────────────────────────────────────
async function renderControloObras(){
  const el = document.getElementById('co-root'); if(!el) return;
  if(!CO.loaded){ el.innerHTML = '<div class="co-empty">A carregar…</div>'; await coLoad(); }
  if(CO.sel && CO.sel!=='ALL' && !obrasAtivas().some(o=>o.id===CO.sel)) CO.sel = null;
  if(CO.sel) coRenderDetail(); else coRenderList();
}

function coRenderList(){
  const el = document.getElementById('co-root');
  const obras = obrasAtivas();
  if(!obras.length){ el.innerHTML = '<div class="co-empty">Sem obras ativas. Adicione obras na secção Administração.</div>'; return; }
  const total = coBalancoCalc(obras.map(withExtra), CO.mensal, periodo());
  const card = (id, cor, cod, nome, c, meses) => `<button class="co-ob" style="--dot:${cor}" onclick="coAbrir('${id}')">
      <div class="co-ob-top"><span class="co-ob-dot"></span><span class="co-ob-cod">${esc(cod)}</span></div>
      <div class="co-ob-nome">${esc(nome)}</div>
      <div class="co-ob-saldo">${meses?eur0(c.saldo):'—'}</div>
      <div class="co-ob-sub">${meses&&c.margem!==null?`<span class="co-pill ${c.saldo>=0?'good':'bad'}">${c.saldo>=0?'▲':'▼'} ${pct(c.margem)}</span> margem · `:''}${meses} ${meses===1?'mês':'meses'}</div>
      <div class="co-ob-lin"><span>Proveitos <b>${eur0(c.provTot)}</b></span><span>Custos <b>${eur0(c.custosTot)}</b></span></div>
    </button>`;
  const cards = obras.map((o,i) => {
    const c = coBalancoCalc([withExtra(o)], CO.mensal, periodo()), sp = split(o.nome);
    return card(o.id, CORES[i%CORES.length], sp.cod||'Obra', sp.nome, c, CO.mensal.filter(r=>r.obra_id===o.id && noPeriodo(r)).length);
  }).join('');
  el.innerHTML = `${coPeriodoBar(new Set(obras.map(o=>o.id)))}<div class="co-list">${card('ALL','var(--gray-900)','TODAS AS EMPREITADAS',obras.length+' obras em curso',total,new Set(CO.mensal.filter(r=>obras.some(o=>o.id===r.obra_id) && noPeriodo(r)).map(r=>r.mes)).size).replace('class="co-ob"','class="co-ob total"')}${cards}</div>`;
}

function coRenderDetail(manterScroll){
  const el = document.getElementById('co-root');
  const todas = CO.sel==='ALL';
  const obras = todas ? obrasAtivas() : obrasAtivas().filter(o=>o.id===CO.sel);
  const o = todas ? null : obras[0], sp = o ? split(o.nome) : null;
  const ids = new Set(obras.map(x=>x.id));
  const meses = CO.mensal.filter(r=>ids.has(r.obra_id) && noPeriodo(r)).map(r=>r.mes).sort();
  const ate = meses.length ? mesLong(meses[meses.length-1]) : '—';
  const sedeVal = o ? (+(CO.extra[o.id]||{}).sede_pct||0) : 0;
  const cabMobile = `<div class="co-mb">
      <div class="co-mb-top"><span style="display:flex;gap:8px"><button class="co-back" onclick="coVoltar()">← Empreitadas</button><button class="co-back" onclick="coRelatorio()">PDF</button></span><span class="co-mb-cod">${todas?'TODAS':esc(sp.cod||'Obra')}</span></div>
      <h2>${todas?'Balanço geral':esc(sp.nome)}</h2>
      <div class="co-mb-meta">Dados até <strong>${ate}</strong>${todas?' · '+obras.length+' empreitadas':(o.local?' · '+esc(o.local):'')}</div>
      ${o?`<div class="co-mb-sede"><label class="co-sede" style="justify-content:flex-start">Estrutura central <input type="text" inputmode="decimal" value="${sedeVal?String(sedeVal).replace('.',','):''}" placeholder="0" onchange="coGuardarSede('${o.id}',this)"> %</label><div class="co-sede-val" id="co-sede-val"></div></div>`:''}
    </div>`;
  if(isMobile()){
    el.innerHTML = `${cabMobile}
    ${coPeriodoBar(ids)}
    <div id="co-an-box"></div>
    ${o?'<details class="co-det"><summary>Lançamentos mensais (editar)</summary><div id="co-lanc-box"></div></details>':''}`;
    coRenderAnalise();
    if(o) coRenderLancamentos();
    if(manterScroll!==true) window.scrollTo({top:0});
    return;
  }
  el.innerHTML = `
    <div class="co-banner">
      <div>
        <button class="co-back" onclick="coVoltar()">← Empreitadas</button>
        <p class="co-eyebrow">PLANDESE · ${todas?'Direção de Obra':esc(sp.cod||'Obra')}</p>
        <h2>${todas?'Balanço geral das empreitadas':esc(sp.nome)}</h2>
        <div class="co-banner-btns" style="margin-top:14px">${o?`<button onclick="coImportar('${o.id}')">Importar custos (Excel)</button>`:''}<button onclick="coRelatorio()">Relatório PDF</button></div>
      </div>
      <div class="co-banner-r">
        ${o?`<div class="co-sede-wrap" style="margin:0;text-align:right"><label class="co-sede" style="justify-content:flex-end" title="Percentagem da faturação imputada como custo de estrutura central">Estrutura central <input type="text" inputmode="decimal" value="${(+(CO.extra[o.id]||{}).sede_pct||0)?String(+CO.extra[o.id].sede_pct).replace('.',','):''}" placeholder="0" onchange="coGuardarSede('${o.id}',this)"> %</label>
        <div class="co-sede-val" id="co-sede-val"></div></div>`:''}
        <div class="co-meta">Dados apurados até <strong>${ate}</strong><br>${todas?obras.length+' empreitadas em curso':(o.local?esc(o.local):'1 empreitada')}</div>
      </div>
    </div>
    ${coPeriodoBar(ids)}
    <div id="co-an-box"></div>
    ${o?'<div id="co-lanc-box"></div>':''}`;
  coRenderAnalise();
  if(o) coRenderLancamentos();
  if(manterScroll!==true) window.scrollTo({top:0});
}

function coRenderAnalise(){
  const box = document.getElementById('co-an-box'); if(!box) return;
  const obras = CO.sel==='ALL' ? obrasAtivas() : obrasAtivas().filter(o=>o.id===CO.sel);
  box.innerHTML = coBalancoHtml(obras.map(withExtra), CO.mensal, periodo(), isMobile());
  const sv = document.getElementById('co-sede-val');
  if(sv && CO.sel!=='ALL'){
    const c = coBalancoCalc(obras.map(withExtra), CO.mensal, periodo());
    sv.innerHTML = c.tot.sede ? `<strong>${eur0(c.tot.sede)}</strong> nos meses em análise` : 'sem valor nos meses em análise';
  }
}

function coRenderLancamentos(){
  const box = document.getElementById('co-lanc-box'); if(!box) return;
  const id = CO.sel;
  const rows = CO.mensal.filter(r=>r.obra_id===id).sort((a,b)=>a.mes.localeCompare(b.mes));
  const cab = CAMPOS.map(([,l])=>`<th>${l}</th>`).join('');
  const lin = rows.map(r=>`<tr><td>${mesLabel(r.mes)}</td>${CAMPOS.map(([k])=>`<td><input class="co-in" inputmode="decimal" value="${(+r[k]||0)?String(+r[k]).replace('.',','):''}" placeholder="0" onchange="coGuardarCelula('${id}','${r.mes}','${k}',this)"></td>`).join('')}<td><button class="co-x" title="Apagar mês" onclick="coApagarMes('${id}','${r.mes}')">✕</button></td></tr>`).join('');
  box.innerHTML = `<div class="co-an-sec">Lançamentos mensais</div>
    <div class="co-panel"><div class="co-panel-bd">
      <div style="font-size:12px;color:var(--gray-500);margin-bottom:10px">Os custos vêm do Excel importado; os proveitos (faturação do mês) lançam-se aqui. Todos os valores podem ser corrigidos à mão.<br><b>Existências</b>: valor do stock de material em obra no fim do mês (comprado mas ainda não consumido/faturado), em valor positivo. A análise usa o último mês do período com existências e abate-o aos custos.</div>
      <div style="overflow:auto"><table class="co-pivot co-lanc"><thead><tr><th>Mês</th>${cab}<th></th></tr></thead><tbody>${lin||'<tr><td colspan="10" style="text-align:center;color:var(--gray-400);padding:18px">Sem lançamentos.</td></tr>'}</tbody></table></div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="month" id="co-novo-mes" class="co-in" style="width:160px;text-align:left"><button class="btn btn-secondary btn-sm" onclick="coAdicionarMes('${id}')">+ Adicionar mês</button></div>
    </div></div>`;
}

// ── Navegação ─────────────────────────────────────────────────────────
function coAbrir(id){ CO.sel = id; coRenderDetail(); }
function coVoltar(){ CO.sel = null; coRenderList(); window.scrollTo({top:0}); }

// ── Lançamentos ───────────────────────────────────────────────────────
async function coUpsert(rows){
  const { error } = await sb.from('co_mensal').upsert(rows, { onConflict:'obra_id,mes' });
  if(error){ console.warn('co_upsert', error); showToast('Sem permissão ou erro ao guardar'); return false; }
  return true;
}
function coAplicarLocal(obra_id, mes, campos){
  let r = CO.mensal.find(x=>x.obra_id===obra_id && x.mes===mes);
  if(!r){ r = { obra_id, mes, proveitos:0, mo:0, eq:0, mat:0, geral:0, sub:0, outros:0, exist:0 }; CO.mensal.push(r); }
  Object.assign(r, campos);
}
async function coGuardarCelula(obra_id, mes, campo, inp){
  const v = num(inp.value);
  if(!await coUpsert([{ obra_id, mes, [campo]:v, atualizado:new Date().toISOString() }])){ coRenderLancamentos(); return; }
  coAplicarLocal(obra_id, mes, { [campo]:v });
  inp.value = v ? String(v).replace('.',',') : '';
  coRenderAnalise();
}
async function coAdicionarMes(obra_id){
  const mes = document.getElementById('co-novo-mes').value;
  if(!mes){ showToast('Escolha o mês'); return; }
  if(CO.mensal.some(r=>r.obra_id===obra_id && r.mes===mes)){ showToast('Esse mês já existe'); return; }
  if(!await coUpsert([{ obra_id, mes }])) return;
  coAplicarLocal(obra_id, mes, {});
  coRenderLancamentos(); coRenderAnalise();
}
async function coApagarMes(obra_id, mes){
  if(!confirm('Apagar todos os valores de '+mesLong(mes)+'?')) return;
  const { error } = await sb.from('co_mensal').delete().eq('obra_id',obra_id).eq('mes',mes);
  if(error){ showToast('Sem permissão ou erro ao apagar'); return; }
  CO.mensal = CO.mensal.filter(r=>!(r.obra_id===obra_id && r.mes===mes));
  coRenderLancamentos(); coRenderAnalise();
}

// ── Dados da obra (sede, ajustes, nota) ───────────────────────────────
function coEditar(obra_id){
  const o = S.OBRAS.find(x=>x.id===obra_id), e = CO.extra[obra_id]||{};
  document.getElementById('coo-id').value = obra_id;
  document.getElementById('coo-nome').textContent = o ? o.nome : obra_id;
  document.getElementById('coo-sede').value = e.sede_pct || '';
  document.getElementById('coo-transf').value = e.transferido || '';
  document.getElementById('coo-nota').value = e.nota || '';
  document.getElementById('modal-co-obra').classList.add('open');
}
function coRelatorio(){
  const todas = CO.sel==='ALL';
  const obras = todas ? obrasAtivas() : obrasAtivas().filter(o=>o.id===CO.sel);
  if(!obras.length) return;
  const sp = todas ? null : split(obras[0].nome);
  const titulo = todas ? { cod:'', nome:'Balanço geral das empreitadas', sub:obras.length+' empreitadas' } : { cod:sp.cod, nome:sp.nome, sub:obras[0].local||'' };
  try{ coRelatorioPdf(obras.map(withExtra), CO.mensal, periodo(), titulo); }
  catch(err){ console.warn('coRelatorio', err); showToast(err.message||'Erro ao gerar o PDF'); }
}
async function coGuardarSede(obra_id, inp){
  const v = num(inp.value);
  const { error } = await sb.from('co_obra').upsert({ obra_id, sede_pct:v, atualizado:new Date().toISOString() }, { onConflict:'obra_id' });
  if(error){ console.warn('co_obra', error); showToast('Sem permissão ou erro ao guardar'); inp.value = (+(CO.extra[obra_id]||{}).sede_pct||0) || ''; return; }
  CO.extra[obra_id] = { ...(CO.extra[obra_id]||{ obra_id }), sede_pct:v };
  inp.value = v ? String(v).replace('.',',') : '';
  coRenderAnalise();
}
async function coGuardarObra(){
  const obra_id = document.getElementById('coo-id').value;
  const row = { obra_id, sede_pct:num(document.getElementById('coo-sede').value), transferido:num(document.getElementById('coo-transf').value),
    nota:document.getElementById('coo-nota').value.trim(), atualizado:new Date().toISOString() };
  const { error } = await sb.from('co_obra').upsert(row, { onConflict:'obra_id' });
  if(error){ console.warn('co_obra', error); showToast('Sem permissão ou erro ao guardar'); return; }
  CO.extra[obra_id] = row;
  closeModal('modal-co-obra');
  if(CO.sel) coRenderDetail();
  showToast('Dados da obra guardados');
}

// ── Atualizar a partir das pastas (Dropbox) ──────────────────────────
async function coAtualizar(escolher){
  if(!pastasSuportado()){ showToast('Este browser não permite ler pastas. Use o Chrome ou o Edge.'); return; }
  const btn = document.getElementById('co-upd-btn'), log = () => document.getElementById('co-upd-log');
  let raiz;
  try{ raiz = await coPastaRaiz(escolher===true); }
  catch(e){ if(e.name!=='AbortError') showToast('Sem acesso à pasta: '+e.message); return; }
  if(btn){ btn.disabled = true; btn.textContent = 'A atualizar…'; }
  const linhas = [];
  try{
    const now = new Date().toISOString();
    for(const o of obrasAtivas()){
      const sp = split(o.nome), dir = await coPastaObra(raiz, sp.cod);
      if(!dir){ linhas.push(`<b>${esc(sp.cod||o.nome)}</b> — pasta não encontrada`); continue; }
      const r = await coLerObra(dir);
      const meses = new Set([...Object.keys(r.custos?r.custos.agg:{}), ...Object.keys(r.prov||{})]);
      if(r.prov) CO.mensal.filter(x=>x.obra_id===o.id).forEach(x=>meses.add(x.mes));
      const payload = [...meses].sort().map(mes => {
        const cur = CO.mensal.find(x=>x.obra_id===o.id && x.mes===mes) || {};
        const row = { obra_id:o.id, mes, proveitos:+cur.proveitos||0, mo:+cur.mo||0, eq:+cur.eq||0, mat:+cur.mat||0, geral:+cur.geral||0, sub:+cur.sub||0, outros:+cur.outros||0, exist:+cur.exist||0, atualizado:now };
        if(r.custos && r.custos.agg[mes]) Object.assign(row, { mo:0, eq:0, mat:0, geral:0, sub:0, outros:0 }, r.custos.agg[mes]);
        if(r.prov) row.proveitos = r.prov[mes] || 0;
        return row;
      });
      const partes = [];
      if(r.custos) partes.push(`custos de ${Object.keys(r.custos.agg).length} meses`);
      if(r.prov) partes.push(`proveitos de ${Object.keys(r.prov).length} meses`);
      if(!partes.length) partes.push('nenhum ficheiro reconhecido');
      else if(payload.length){
        if(!await coUpsert(payload)){ linhas.push(`<b>${esc(sp.cod)}</b> — erro ao guardar`); continue; }
        payload.forEach(p => coAplicarLocal(o.id, p.mes, p));
      }
      linhas.push(`<b>${esc(sp.cod)}</b> — ${partes.join(', ')}${r.ficheiros.length?` <span style="color:var(--gray-400)">(${r.ficheiros.map(esc).join(' · ')})</span>`:''}${r.avisos.map(a=>`<br><span style="color:var(--red)">⚠ ${esc(a)}</span>`).join('')}`);
    }
  }catch(e){ console.error('coAtualizar', e); linhas.push(`<span style="color:var(--red)">Erro: ${esc(e.message)}</span>`); }
  if(CO.sel) coRenderDetail(true); else coRenderList();
  const l = log();
  if(l) l.innerHTML = `<div class="co-upd-log"><div><b>Atualizado às ${new Date().toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'})}</b> <button onclick="this.closest('.co-upd-log').remove()">✕</button></div>${linhas.map(x=>`<div>${x}</div>`).join('')}</div>`;
}

// ── Importar Excel de custos ──────────────────────────────────────────
function coImportar(obra_id){ CO.importObra = obra_id; document.getElementById('co-file-input').click(); }
function coFicheiro(ev){
  const file = ev.target.files && ev.target.files[0]; ev.target.value = '';
  if(!file || !CO.importObra) return;
  const obra_id = CO.importObra;
  const reader = new FileReader();
  reader.onload = async e => {
    try{
      const wb = XLSX.read(e.target.result, { type:'binary', cellDates:true });
      let agg, n;
      try{ ({ agg, n } = coParseCustos(wb)); }catch(err){ showToast(err.message+' no ficheiro'); return; }
      const ms = Object.keys(agg).sort();
      if(!ms.length){ showToast('Nenhuma linha reconhecida'); return; }
      if(!confirm(`Importar ${n} linhas de ${mesLabel(ms[0])} a ${mesLabel(ms[ms.length-1])} (${ms.length} meses)?\n\nOs custos destes meses são substituídos; os proveitos mantêm-se.`)) return;
      const now = new Date().toISOString();
      const payload = ms.map(mes => {
        const a = agg[mes]; Object.keys(a).forEach(k=>a[k]=Math.round(a[k]*100)/100);
        return { obra_id, mes, ...a, atualizado:now };
      });
      if(!await coUpsert(payload)) return;
      payload.forEach(p => coAplicarLocal(obra_id, p.mes, p));
      coRenderDetail();
      showToast(`${ms.length} meses de custos importados`);
    }catch(err){ console.error('coFicheiro', err); showToast('Erro ao processar o ficheiro: '+err.message); }
  };
  reader.readAsBinaryString(file);
}

export {
  renderControloObras, coAbrir, coVoltar, coEditar, coGuardarObra, coImportar, coFicheiro, coPeriodo, coGuardarSede, coRelatorio, coAtualizar,
  coGuardarCelula, coAdicionarMes, coApagarMes,
};
