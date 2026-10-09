// ═══════════════════════════════════════
//  CONTROLO DE OBRAS — ler os ficheiros das pastas das obras (File System Access API)
//  Pasta raiz → uma subpasta por obra ("O065 - ..."). Lá dentro:
//    · "... Custos ....xlsx"                      → custos por mês (o mais recente)
//    · "... Autos de Medição nº4.xlsx"            → proveitos contratuais (o mais recente)
//    · "... Autos de Medição 02 - TEC01 ....xls"  → proveitos de trabalhos complementares (1 por TECxx, o mais recente)
// ═══════════════════════════════════════

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
  const cMes=h.indexOf('mes')<0?8:h.indexOf('mes'), cAno=h.indexOf('ano')<0?9:h.indexOf('ano');
  const agg = {}; let n = 0;
  for(let i=hi+1;i<rows.length;i++){
    const r = rows[i]; if(!r || r.every(c=>c===''||c==null)) continue;
    const v = num(r[cCusto]); if(!v) continue;
    const grupo = String(r[cGrupo]||'').trim(); if(grupo==='Servico') continue;
    let d = r[cData], data = '';
    if(d instanceof Date) data = d.toISOString().slice(0,10);
    else if(typeof d==='number') data = new Date((d-25569)*86400000).toISOString().slice(0,10);
    else data = String(d).slice(0,10).replace(/\//g,'-');
    let mes = data.slice(0,7);
    const mv=r[cMes], av=r[cAno];
    if(mv!=='' && av!=='' && String(av).trim().length===4) mes = String(av).trim()+'-'+String(mv).trim().padStart(2,'0');
    if(!/^\d{4}-\d{2}$/.test(mes)) continue;
    const k = GRUPO_KEY[grupo] || 'outros';
    (agg[mes] ||= { mo:0, eq:0, mat:0, geral:0, sub:0, outros:0 })[k] += Math.abs(v); n++;
  }
  Object.values(agg).forEach(a => Object.keys(a).forEach(k => a[k] = Math.round(a[k]*100)/100));
  return { agg, n };
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

export function coParseAutos(wb){
  const porFolhas = coParseAutosFolhas(wb);
  if(porFolhas) return porFolhas;
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

// ── Procurar e ler os ficheiros de uma obra ───────────────────────────
async function ficheiros(dir){
  const out = [];
  for await (const [nome, h] of dir.entries()){
    if(h.kind!=='file' || nome.startsWith('~$') || !/\.xlsx?$/i.test(nome)) continue;
    const f = await h.getFile();
    out.push({ nome, f, mod:f.lastModified });
  }
  return out;
}
const maisRecente = l => l.slice().sort((a,b)=>b.mod-a.mod || b.nome.localeCompare(a.nome))[0];
const lerWb = async (f, opts) => XLSX.read(await f.arrayBuffer(), { type:'array', ...opts });

// → { custos:{agg,n,ficheiro}|null, prov:{mes:valor}|null, ficheiros:[...], avisos:[...] }
export async function coLerObra(dir){
  const todos = await ficheiros(dir), avisos = [];
  const autos = todos.filter(x => /autos?\s+de\s+medi/.test(sem(x.nome)));
  const custosF = todos.filter(x => /custos/.test(sem(x.nome)) && !autos.includes(x));
  const res = { custos:null, provContr:null, provCompl:null, ficheiros:[], avisos };

  if(custosF.length){
    const x = maisRecente(custosF);
    try{ const p = coParseCustos(await lerWb(x.f, { cellDates:true })); res.custos = { ...p, ficheiro:x.nome }; res.ficheiros.push(x.nome); }
    catch(e){ avisos.push(`${x.nome}: ${e.message}`); }
  }

  if(autos.length){
    const contr = autos.filter(x => !/tec\s*\d+/i.test(x.nome));
    const tec = {};
    autos.filter(x => /tec\s*\d+/i.test(x.nome)).forEach(x => { const k = +x.nome.match(/tec\s*0*(\d+)/i)[1]; (tec[k] ||= []).push(x); });
        // contratual e complementares ficam separados: assim, se um dos ficheiros faltar, não se perde o outro
    const somar = (dest, p) => Object.entries(p).forEach(([m,v]) => dest[m] = Math.round(((dest[m]||0)+v)*100)/100);
    const lerGrupo = async lista => {
      const out = {}; let ok = 0;
      for(const x of lista){
        try{ somar(out, coParseAutos(await lerWb(x.f, { cellDates:false }))); res.ficheiros.push(x.nome); ok++; }
        catch(e){ avisos.push(`${x.nome}: ${e.message}`); }
      }
      return ok ? out : null;
    };
    if(contr.length) res.provContr = await lerGrupo([maisRecente(contr)]);
    const tecs = Object.values(tec).map(maisRecente);
    if(tecs.length) res.provCompl = await lerGrupo(tecs);
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
