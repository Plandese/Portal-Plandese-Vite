// ═══════════════════════════════════════
//  CONTROLO DE OBRAS — autos de medição em PDF
//  Reconhece 4 modelos pelo conteúdo (não pelo nome do ficheiro):
//    · "mapa"  — SMAS/Caldas da Rainha: "MAPA DOS TRABALHOS EXECUTADOS … AUTO DE MEDIÇÃO N.º n … REFERENTE A MMM/AAAA"
//    · "smas"  — autos de vistoria e medição: "Valor deste auto X €" + data por extenso ("Ao quinto dia do mês de agosto…")
//    · "cc"    — Plandese "AUTO DE MEDIÇÃO MENSAL E CONTA CORRENTE": "n  mês aaaa  valor €"
//    · "oeiras"— Município de Oeiras: "Auto nº n de dd-mm-aaaa …" + "Total da medição: X"
//  Devolve { tipo, n, mes:'AAAA-MM', valor, tc, chave } ou null.
// ═══════════════════════════════════════

const semAc = s => String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const M3 = { jan:1, fev:2, mar:3, abr:4, mai:5, jun:6, jul:7, ago:8, set:9, out:10, nov:11, dez:12 };
const MEXT = { janeiro:1, fevereiro:2, marco:3, abril:4, maio:5, junho:6, julho:7, agosto:8, setembro:9, outubro:10, novembro:11, dezembro:12 };

// "64 229,70" · "58 489.85" · "8.953,88" · "484,65" → número
export function coNumPt(s){
  let t = String(s||'').replace(/[€\s ]/g,'');
  if(!t) return 0;
  if(t.includes(',')) t = t.replace(/\./g,'').replace(',','.');
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}
const r2 = n => Math.round(n*100)/100;
const mm = (a, m) => `${a}-${String(m).padStart(2,'0')}`;

// Auto entregue nos primeiros dias do mês refere-se, em regra, ao mês anterior
function mesDeData(dia, mes, ano){
  if(dia && dia <= 10){ mes -= 1; if(mes < 1){ mes = 12; ano -= 1; } }
  return mm(ano, mes);
}

const NUM = { um:1, uma:1, primeiro:1, dois:2, segundo:2, tres:3, terceiro:3, quatro:4, quarto:4, cinco:5, quinto:5, seis:6, sexto:6,
  sete:7, setimo:7, oito:8, oitavo:8, nove:9, nono:9, dez:10, decimo:10, onze:11, doze:12, treze:13, catorze:14, quatorze:14, quinze:15,
  dezasseis:16, dezassete:17, dezoito:18, dezanove:19, vinte:20, vigesimo:20, trinta:30, trigesimo:30 };
const somaPalavras = txt => semAc(txt).split(/[^a-z]+/).reduce((s, w) => s + (NUM[w] || 0), 0);
const anoExtenso = txt => { const t = semAc(txt); const i = t.indexOf('mil'); return i<0 ? 0 : 2000 + somaPalavras(t.slice(i+3)); };

export function coParseAutoPdfTexto(texto){
  const T = String(texto||'');
  const S = semAc(T);

  // ── Mapa de trabalhos executados (SMAS Caldas da Rainha) ──
  if(/mapa dos trabalhos executados/.test(S)){
    const n = +(T.match(/AUTO DE MEDI[CÇ][AÃ]O N\.?\s*º\.?\s*(\d+)/i)||[])[1];
    const ref = T.match(/REFERENTE A\s+([A-Za-z]{3})\s*\/\s*(\d{4})/i);
    if(!n || !ref || !M3[semAc(ref[1])]) return null;
    const linhas = T.split('\n');
    const i0 = linhas.findIndex(l => /\*Total/.test(l));
    if(i0 < 0) return null;
    let valor = 0, proj = [];
    for(let i = i0+1; i < linhas.length; i++){
      const l = linhas[i];
      if(/lista de quantidades/i.test(l)) break;
      if(/^erros e omiss/i.test(l)){
        // valor na mesma linha ou na seguinte
        const v = l.match(/(-?\d[\d  ]*[.,]\d{2})\s*$/) || (linhas[i+1]||'').match(/^\s*(-?\d[\d  ]*[.,]\d{2})\s*$/);
        if(v) valor += coNumPt(v[1]);
        break;
      }
      const p = l.match(/^(\d+\/\d+)\s/);
      const v = l.match(/(\d[\d  ]*[.,]\d{2})\s*€\s*$/);
      if(p) proj.push(p[1]);
      if(p && v) valor += coNumPt(v[1]);
    }
    if(!valor) return null;
    return { tipo:'mapa', n, mes:mm(+ref[2], M3[semAc(ref[1])]), valor:r2(valor), tc:false, chave:`mapa|${proj.join('+')}|${n}` };
  }

  // ── Auto mensal e conta corrente (Plandese) ──
  if(/auto de medicao mensal e conta corrente/.test(S)){
    const m = S.match(/(\d+)\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(\d{4})\s+(-?\d[\d ]*,\d{2})\s*€/);
    if(!m) return null;
    return { tipo:'cc', n:+m[1], mes:mm(+m[3], MEXT[m[2]]), valor:r2(coNumPt(m[4])), tc:false, chave:`cc|${m[1]}` };
  }

  // ── Município de Oeiras ("Auto nº 4 de 08-06-2026") ──
  const oe = T.match(/Auto n[ºo°.]*\s*(\d+)\s+de\s+(\d{2})-(\d{2})-(\d{4})([^\n]*)/i);
  if(oe && /total da medi/i.test(S)){
    const tot = T.match(/Total da medi[cç][aã]o:\s*(-?\d[\d  ]*,\d{2})/i);
    if(!tot) return null;
    const tc = /complementares/i.test(oe[5]);
    return { tipo:'oeiras', n:+oe[1], mes:mesDeData(+oe[2], +oe[3], +oe[4]), valor:r2(coNumPt(tot[1])), tc, chave:`oe|${tc?'tc':'ct'}|${oe[1]}` };
  }

  // ── Auto de vistoria e medição (SMAS V. F. Xira, …) ──
  const vd = T.match(/Valor deste auto\s+(-?\d[\d  ]*,\d{2})\s*€/i);
  if(vd){
    const n = +(T.match(/Auto de medi[cç][aã]o n\.?\s*º\.?\s*(\d+)/i)||[])[1];
    const d = S.match(/ao\s+(.+?)\s+dias?\s+do\s+mes\s+de\s+([a-z]+)\s+do\s+ano\s+de\s+(.+?)\s+no\s+local/s);
    if(!n || !d || !MEXT[d[2]]) return null;
    const ano = anoExtenso(d[3]);
    if(!ano) return null;
    return { tipo:'smas', n, mes:mesDeData(somaPalavras(d[1]), MEXT[d[2]], ano), valor:r2(coNumPt(vd[1])), tc:false, chave:`smas|${n}` };
  }
  return null;
}

// Linhas de texto de um PDF aberto com o pdf.js (agrupadas por coordenada vertical)
export async function coPdfTexto(doc, maxPaginas = 4){
  const out = [];
  for(let p = 1; p <= Math.min(doc.numPages, maxPaginas); p++){
    const t = await (await doc.getPage(p)).getTextContent();
    const L = {};
    t.items.forEach(i => { const y = Math.round(i.transform[5]); (L[y] ||= []).push([i.transform[4], i.str]); });
    Object.keys(L).map(Number).sort((a,b)=>b-a).forEach(y => {
      out.push(L[y].sort((a,b)=>a[0]-b[0]).map(x=>x[1]).join(' ').replace(/\s+/g,' ').trim());
    });
  }
  return out.join('\n');
}

// Junta os autos (já lidos) de uma obra: um valor por (modelo, projeto, n.º), o mais recente ganha.
// → { contr:{mes:valor}, compl:{mes:valor} }
export function coAgregaAutosPdf(lista){
  const porChave = new Map();
  lista.forEach(a => { const p = porChave.get(a.chave); if(!p || (a.mod||0) > (p.mod||0)) porChave.set(a.chave, a); });
  const contr = {}, compl = {};
  porChave.forEach(a => { const d = a.tc ? compl : contr; d[a.mes] = r2((d[a.mes]||0) + a.valor); });
  return { contr, compl };
}
