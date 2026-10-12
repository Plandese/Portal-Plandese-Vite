// ═══════════════════════════════════════
//  CONTROLO DE OBRAS — ler os ficheiros das pastas das obras (File System Access API)
//  Pasta raiz → uma subpasta por obra ("O065 - ..."). Lá dentro:
//    · "... Custos ....xlsx"                      → custos por mês (o mais recente)
//    · "... Autos de Medição nº4.xlsx"            → proveitos contratuais (o mais recente)
//    · "... Autos de Medição 02 - TEC01 ....xls"  → proveitos de trabalhos complementares (1 por TECxx, o mais recente)
// ═══════════════════════════════════════

import { coParseAutoPdfTexto, coPdfTexto, coAgregaAutosPdf } from './co-autos-pdf.js';

const GRUPO_KEY = { 'Mão de Obra':'mo', 'Equipamento':'eq', 'MateriaPrima':'mat', 'Geral':'geral', 'N/D':'sub' };
const num = v => { const n = parseFloat(String(v).replace(/[€\s ]/g,'').replace(',','.')); return isNaN(n) ? 0 : n; };
const sem = s => String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();

// ── Pasta raiz (o handle fica guardado no browser) ────────────────────
const dbOpen = () => new Promise((ok, ko) => {
  const rq = indexedDB.open('plandese-co', 1);
  rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
  rq.onsuccess = () => ok(rq.result); rq.onerror = () => ko(rq.error);
});
const dbGet = async k => { const db = await dbOpen(); return new Promise(ok => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); }); };
const dbSet = async (k, v) => { const db = await dbOpen(); return new Promise(ok => { const t = db.transaction('kv','readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = ok; t.onerror = ok; }); };

export const pastasSuportado = () => typeof window.showDirectoryPicker === 'function';

// Tem de ser chamado a partir de um clique (pedir permissão exige gesto do utilizador).
export async function coPastaRaiz(escolher){
  let h = escolher ? null : await dbGet('raiz');
  if(h){
    let p = await h.queryPermission({ mode:'read' });
    if(p !== 'granted') p = await h.requestPermission({ mode:'read' });
    if(p !== 'granted') h = null;
  }
  if(!h){
    h = await window.showDirectoryPicker({ id:'co-raiz', mode:'read' });
    await dbSet('raiz', h);
  }
  return h;
}

// ── Leitura do Excel de custos (mesma lógica do botão "Importar custos") ──
export function coParseCustos(wb){
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, defval:'' });
  const norm = h => String(h).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim();
  let hi = -1;
  for(let i=0;i<Math.min(rows.length,5);i++){ const r=rows[i].map(norm); if(r.includes('data')||r.includes('grupoartigo')){ hi=i; break; } }
  if(hi<0) throw new Error('Cabeçalho não encontrado');
  const h = rows[hi].map(norm);
  const col = (nome, pref, dflt) => { let c=h.indexOf(nome); if(c<0) c=h.findIndex(x=>x.startsWith(pref)); return c<0?dflt:c; };
  const cData=col('data','data',0), cGrupo=col('grupoartigo','grupo',1), cCusto=col('custos','custo',5);
  const cProv=col('proveitos','proveito',-1), cNome=col('nomeartigo','nome',-1);
  const cMes=h.indexOf('mes')<0?8:h.indexOf('mes'), cAno=h.indexOf('ano')<0?9:h.indexOf('ano');
  const agg = {}, prov = {}; let n = 0;
  for(let i=hi+1;i<rows.length;i++){
    const r = rows[i]; if(!r || r.every(c=>c===''||c==null)) continue;
    const v = num(r[cCusto]), pv = cProv>=0 ? num(r[cProv]) : 0;
    if(!v && !pv) continue;
    const grupo = String(r[cGrupo]||'').trim();
    let d = r[cData], data = '';
    if(d instanceof Date) data = d.toISOString().slice(0,10);
    else if(typeof d==='number') data = new Date((d-25569)*86400000).toISOString().slice(0,10);
    else data = String(d).slice(0,10).replace(/\//g,'-');
    let mes = data.slice(0,7);
    const mv=r[cMes], av=r[cAno];
    if(mv!=='' && av!=='' && String(av).trim().length===4) mes = String(av).trim()+'-'+String(mv).trim().padStart(2,'0');
    if(!/^\d{4}-\d{2}$/.test(mes)) continue;
    // Proveitos (faturação de autos e revisões de preços) — mantém o sinal: estornos abatem
    if(pv){
      const rev = cNome>=0 && /revisao\s+de\s+precos/.test(sem(r[cNome]));
      const p = (prov[mes] ||= { c:0, r:0 });
      p[rev ? 'r' : 'c'] += pv;
    }
    if(v && grupo!=='Servico'){
      const k = GRUPO_KEY[grupo] || 'outros';
      (agg[mes] ||= { mo:0, eq:0, mat:0, geral:0, sub:0, outros:0 })[k] += Math.abs(v); n++;
    }
  }
  Object.values(prov).forEach(p => { p.c = Math.round(p.c*100)/100; p.r = Math.round(p.r*100)/100; });
  Object.values(agg).forEach(a => Object.keys(a).forEach(k => a[k] = Math.round(a[k]*100)/100));
  return { agg, n, prov };
}

// ── Leitura de um auto de medição: total de cada auto (linha 4) e data (linha 5) ──
// Devolve { 'YYYY-MM': valor }. Autos com data repetida/anterior passam para o mês seguinte.
// Segundo modelo (Mercadona Alfragide, SIMAS Algés…): uma folha por auto ("Auto 1", "Auto 2"…) com o valor
// mensal na lista "Auto n → valor" (colunas Q:S) no fim da folha do último auto. O mês vem de
// "Trabalhos realizados: dd-mm-aaaa a dd-mm-aaaa" de cada folha.
function coParseAutosFolhas(wb){
  const folhas = wb.SheetNames.map(n => ({ n, k:(String(n).trim().match(/^auto\s*(\d+)$/i)||[])[1] })).filter(x => x.k).map(x => ({ ...x, k:+x.k }));
  if(!folhas.length) return null;
  const rowsDe = n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header:1, defval:'', raw:true });
  const ultima = folhas.reduce((a,b) => b.k>a.k ? b : a);
  const valores = {};
  rowsDe(ultima.n).forEach((r,i) => {
    if(i<8) return;
    for(let c=10;c<r.length-2;c++){
      const m = typeof r[c]==='string' && r[c].trim().match(/^auto\s*(\d+)$/i);
      if(m && typeof r[c+2]==='number' && r[c+2]) { valores[+m[1]] = r[c+2]; break; }
    }
  });
  const out = {};
  for(const f of folhas){
    const v = valores[f.k]; if(!v) continue;
    const txt = rowsDe(f.n).slice(0,8).flat().filter(x => typeof x==='string').join(' | ');
    const m = txt.match(/realizados:\s*\d{2}-\d{2}-\d{4}\s*a\s*\d{2}-(\d{2})-(\d{4})/i) || txt.match(/data do auto:\s*\d{2}-(\d{2})-(\d{4})/i);
    if(!m) throw new Error(`Mês do auto ${f.k} não encontrado`);
    const mes = m[2]+'-'+m[1];
    out[mes] = Math.round(((out[mes]||0)+v)*100)/100;
  }
  if(!Object.keys(out).length) throw new Error('Valores dos autos não encontrados');
  return out;
}

// Terceiro modelo (ex.: trabalhos complementares do Alto dos Barronhos): uma folha só, com um único auto mensal.
// Valor = linha "TOTAL MENSAL"; mês = fim de "Trabalhos realizados: dd-mm-aaaa a dd-mm-aaaa".
function coParseAutoMensal(wb){
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, defval:'', raw:true });
  let valor = 0;
  for(const r of rows){
    const c = r.findIndex(x => typeof x==='string' && /^total\s+mensal/i.test(x.trim()));
    if(c<0) continue;
    const n = r.slice(c+1).find(x => typeof x==='number');
    if(n!==undefined){ valor = n; break; }
  }
  if(!valor) return null;
  const txt = rows.slice(0,10).flat().filter(x => typeof x==='string').join(' | ');
  const m = txt.match(/realizados:\s*\d{2}-\d{2}-\d{4}\s*a\s*\d{2}-(\d{2})-(\d{4})/i) || txt.match(/data do auto:\s*\d{2}-(\d{2})-(\d{4})/i);
  if(!m) throw new Error('Mês do auto não encontrado');
  return { [m[2]+'-'+m[1]]: Math.round(valor*100)/100 };
}

// Quarto modelo: "Resumo de autos de medição" — uma linha por mês (data na 1.ª coluna), uma coluna para o auto
// contratual e uma por cada trabalho complementar (TC01, TC02…). Devolve { contr:{mes:v}, compl:{mes:v} } ou null.
export function coParseResumoAutos(wb){
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, defval:'', raw:true });
  let h = -1, cc = -1;
  for(let i=0;i<Math.min(rows.length,15) && h<0;i++){
    const c = rows[i].findIndex(x => typeof x==='string' && /contratual/i.test(x));
    if(c>=0){ h = i; cc = c; }
  }
  if(h<0) return null;
  const tcCols = [];
  rows[h].forEach((x,c) => { if(c>cc && typeof x==='string' && x.trim()) tcCols.push(c); });
  const contr = {}, compl = {};
  const somar = (d, mes, v) => { if(v) d[mes] = Math.round(((d[mes]||0)+v)*100)/100; };
  for(let i=h+1;i<rows.length;i++){
    const r = rows[i];
    const dc = r.findIndex((x,c) => c<cc && typeof x==='number' && x>40000 && x<70000);
    if(dc<0) continue;
    const dt = new Date((r[dc]-25569)*86400000);
    const mes = dt.getUTCFullYear()+'-'+String(dt.getUTCMonth()+1).padStart(2,'0');
    if(typeof r[cc]==='number') somar(contr, mes, r[cc]);
    tcCols.forEach(c => { if(typeof r[c]==='number') somar(compl, mes, r[c]); });
  }
  if(!Object.keys(contr).length && !Object.keys(compl).length) throw new Error('Valores do resumo de autos não encontrados');
  return { contr, compl };
}

export function coParseAutos(wb){
  const porFolhas = coParseAutosFolhas(wb);
  if(porFolhas) return porFolhas;
  const mensal = coParseAutoMensal(wb);
  if(mensal) return mensal;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, defval:'', raw:true });
  let hd = -1;
  for(let i=0;i<Math.min(rows.length,10) && hd<0;i++){
    const r = rows[i];
    for(let c=0;c<r.length-1;c++) if(typeof r[c]==='number' && r[c]>40000 && r[c]<70000 && /^auto/i.test(String(r[c+1]).trim())){ hd = i; break; }
  }
  if(hd<1) throw new Error('Datas dos autos não encontradas');
  const out = {}; let prev = '';
  for(let c=0;c<rows[hd].length-1;c++){
    const d = rows[hd][c];
    if(!(typeof d==='number' && d>40000 && d<70000 && /^auto/i.test(String(rows[hd][c+1]).trim()))) continue;
    const dt = new Date((d-25569)*86400000);
    let mes = dt.getUTCFullYear()+'-'+String(dt.getUTCMonth()+1).padStart(2,'0');
    if(prev && mes<=prev){ const [y,m]=prev.split('-').map(Number); mes = (m===12?y+1:y)+'-'+String(m===12?1:m+1).padStart(2,'0'); }
    prev = mes;
    const v = num(rows[hd-1][c]);
    if(v) out[mes] = Math.round(((out[mes]||0)+v)*100)/100;
  }
  return out;
}

// ── Autos em PDF (ver co-autos-pdf.js) ────────────────────────────────
let _pdfjsP = null;
async function getPdfjs(){
  if(window.pdfjsLib) return window.pdfjsLib;
  if(!_pdfjsP) _pdfjsP = (async () => {
    const mod = await import('pdfjs-dist');
    const pdfjs = mod.getDocument ? mod : (mod.default || mod);
    try{ const W = (await import('pdfjs-dist/build/pdf.worker.min.js?worker')).default; pdfjs.GlobalWorkerOptions.workerPort = new W(); }
    catch(e){ try{ pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.js?url')).default; }catch(e2){} }
    window.pdfjsLib = pdfjs;
    return pdfjs;
  })();
  return _pdfjsP;
}
// Faturas, plantas, mapas de detalhe e resumos não são autos
const PDF_IGNORAR = /(^|[_\s-])FR([_\s.-]|$)|planta|detalhado|resumo|fatura|vistoria/i;
const MESES_TAG = { jan:1, fev:2, mar:3, abr:4, mai:5, jun:6, jul:7, ago:8, set:9, out:10, nov:11, dez:12 };
// Pasta do tipo "04_Auto de Medição nº 4 (Jun.26)" indica o mês do auto
const mesDaPasta = caminho => { const m = sem(caminho).match(/\((jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?\s*(\d{2})\)/); return m ? `20${m[2]}-${String(MESES_TAG[m[1]]).padStart(2,'0')}` : null; };

async function lerAutosPdf(pdfs, avisos){
  const nomesPorPasta = new Set(pdfs.map(x => x.caminho + x.nome.toLowerCase()));
  const cand = pdfs.filter(x => /auto/.test(sem(x.nome)) && !PDF_IGNORAR.test(x.nome)
    // cópia assinada só conta se não houver o original ao lado
    && !(/[_ ](signed|assin)\w*\.pdf$/i.test(x.nome) && nomesPorPasta.has(x.caminho + x.nome.replace(/[_ ](signed|assin)\w*(\.pdf)$/i, '$2').toLowerCase())));
  if(!cand.length) return [];
  let pdfjs; try{ pdfjs = await getPdfjs(); }catch(e){ avisos.push('PDF.js indisponível: '+e.message); return []; }
  const out = [];
  for(const x of cand){
    try{
      const doc = await pdfjs.getDocument({ data:new Uint8Array(await x.f.arrayBuffer()) }).promise;
      const a = coParseAutoPdfTexto(await coPdfTexto(doc, 8));
      if(!a) continue;
      const tag = mesDaPasta(x.caminho);
      out.push({ ...a, mes: tag || a.mes, mod:x.mod, nome:x.nome });
    }catch(e){ avisos.push(`${x.nome}: ${e.message}`); }
  }
  return out;
}

// Maior n.º de auto de um Excel: folhas "Auto n" ou "nº n" no nome do ficheiro
function nAutoExcel(wb, nome){
  const f = wb.SheetNames.map(n => +((String(n).trim().match(/^auto\s*(\d+)$/i)||[])[1]||0));
  const m = sem(nome).match(/medicao\s*(?:n[o.º°]*\s*)?(\d+)/);
  return Math.max(0, ...f, m ? +m[1] : 0);
}

// ── Procurar e ler os ficheiros de uma obra ───────────────────────────
async function ficheiros(dir, caminho = '', prof = 0){
  const out = [];
  for await (const [nome, h] of dir.entries()){
    if(h.kind==='directory'){
      if(prof < 2) out.push(...await ficheiros(h, caminho + nome + '/', prof + 1));
      continue;
    }
    if(h.kind!=='file' || nome.startsWith('~$') || !/\.(xlsx?|pdf)$/i.test(nome)) continue;
    const f = await h.getFile();
    out.push({ nome, f, mod:f.lastModified, caminho, prof, pdf:/\.pdf$/i.test(nome) });
  }
  return out;
}
const maisRecente = l => l.slice().sort((a,b)=>b.mod-a.mod || b.nome.localeCompare(a.nome))[0];
const lerWb = async (f, opts) => XLSX.read(await f.arrayBuffer(), { type:'array', ...opts });

// → { custos:{agg,n,ficheiro}|null, prov:{mes:valor}|null, ficheiros:[...], avisos:[...] }
export async function coLerObra(dir){
  const tudo = await ficheiros(dir), avisos = [];
  const todos = tudo.filter(x => !x.pdf), pdfs = tudo.filter(x => x.pdf);
  // _CMO = extrato de mão de obra de um auto (não é o auto) → ignorado
  const autosTodos = todos.filter(x => /autos?\s+de\s+medi/.test(sem(x.nome)) && !/(^|[\s_-])cmo\.xlsx?$/.test(sem(x.nome)));
  // "Resumo de autos de medição" (um mês por linha) é a fonte oficial da obra: dispensa os autos individuais e os PDF
  const resumoF = autosTodos.filter(x => /resumo/.test(sem(x.nome)));
  const autos = resumoF.length ? [] : autosTodos;
  const custosF = todos.filter(x => x.prof===0 && /custos/.test(sem(x.nome)) && !autos.includes(x));
  const res = { custos:null, provContr:null, provCompl:null, ficheiros:[], avisos };
  const cobreContr = { n:0 }, cobreCompl = { n:0 };   // maior n.º de auto já coberto pelo Excel

  if(custosF.length){
    const x = maisRecente(custosF);
    try{ const p = coParseCustos(await lerWb(x.f, { cellDates:true })); res.custos = { ...p, ficheiro:x.nome }; res.ficheiros.push(x.nome); }
    catch(e){ avisos.push(`${x.nome}: ${e.message}`); }
  }

  if(resumoF.length){
    const x = maisRecente(resumoF);
    try{
      const p = coParseResumoAutos(await lerWb(x.f, { cellDates:false }));
      if(p){
        res.provContr = Object.keys(p.contr).length ? p.contr : null;
        res.provCompl = Object.keys(p.compl).length ? p.compl : null;
        res.ficheiros.push(x.nome);
      } else avisos.push(`${x.nome}: formato não reconhecido`);
    }catch(e){ avisos.push(`${x.nome}: ${e.message}`); }
  }

  if(autos.length){
    // trabalhos complementares de um auto por mês: pasta "Trabalhos Complementares" ou nome com "TC"/"adicional"
    const ehTC = x => /complementar/.test(sem(x.caminho)) || /(^|[^a-z])tc([^a-z]|$)|adicional/.test(sem(x.nome));
    const tcs = autos.filter(x => !/tec\s*\d+/i.test(x.nome) && ehTC(x));
    const contr = autos.filter(x => !/tec\s*\d+/i.test(x.nome) && !ehTC(x));
    const tec = {};
    autos.filter(x => /tec\s*\d+/i.test(x.nome)).forEach(x => { const k = +x.nome.match(/tec\s*0*(\d+)/i)[1]; (tec[k] ||= []).push(x); });
    // um ficheiro por auto de TC (cada um traz só o seu mês): fica o mais recente de cada número
    tcs.forEach(x => { const n = (sem(x.nome).match(/medicao\s*n[o.º°]*\s*(\d+)/)||[])[1]; (tec['tc'+(n||x.nome)] ||= []).push(x); });
        // contratual e complementares ficam separados: assim, se um dos ficheiros faltar, não se perde o outro
    const somar = (dest, p) => Object.entries(p).forEach(([m,v]) => dest[m] = Math.round(((dest[m]||0)+v)*100)/100);
    const lerGrupo = async (lista, cobre) => {
      const out = {}; let ok = 0;
      for(const x of lista){
        try{
          const wb = await lerWb(x.f, { cellDates:false });
          somar(out, coParseAutos(wb)); res.ficheiros.push(x.nome); ok++;
          if(cobre) cobre.n = Math.max(cobre.n, nAutoExcel(wb, x.nome));
        }
        catch(e){ avisos.push(`${x.nome}: ${e.message}`); }
      }
      return ok ? out : null;
    };
    if(contr.length) res.provContr = await lerGrupo([maisRecente(contr)], cobreContr);
    const tecs = Object.values(tec).map(maisRecente);
    if(tecs.length) res.provCompl = await lerGrupo(tecs, cobreCompl);
  }

  // Autos em PDF: completam o que o Excel não cobre (n.º de auto acima do último do Excel)
  if(pdfs.length && !resumoF.length){
    const lidos = await lerAutosPdf(pdfs, avisos);
    if(lidos.length){
      const junta = (dest, add) => { if(!Object.keys(add).length) return dest; const d = { ...(dest||{}) }; Object.entries(add).forEach(([m,v]) => d[m] = Math.round(((d[m]||0)+v)*100)/100); return d; };
      // Os autos assinados (PDF) são os oficiais: se cobrem todos os n.os do Excel, substituem-no; senão só completam
      const cobertos = (tc, ate) => { const ns = new Set(lidos.filter(a => a.tc===tc).map(a => a.n)); return ate>0 && Array.from({ length:ate }, (_,i) => ns.has(i+1)).every(Boolean); };
      const gTodos = coAgregaAutosPdf(lidos);
      const gNovos = coAgregaAutosPdf(lidos.filter(a => a.n > (a.tc ? cobreCompl.n : cobreContr.n)));
      res.provContr = cobertos(false, cobreContr.n) ? gTodos.contr : junta(res.provContr, gNovos.contr);
      res.provCompl = cobertos(true,  cobreCompl.n) ? gTodos.compl : junta(res.provCompl, gNovos.compl);
      if(res.provContr && !Object.keys(res.provContr).length) res.provContr = null;
      if(res.provCompl && !Object.keys(res.provCompl).length) res.provCompl = null;
      lidos.forEach(a => { if(!res.ficheiros.includes(a.nome)) res.ficheiros.push(a.nome); });
    }
  }
  return res;
}

// Subpasta da obra pelo código (O065 → "O065 - ...")
export async function coPastaObra(raiz, cod){
  if(!cod) return null;
  for await (const [nome, h] of raiz.entries()){
    if(h.kind==='directory' && new RegExp('^'+cod+'(\\D|$)','i').test(nome)) return h;
  }
  return null;
}
