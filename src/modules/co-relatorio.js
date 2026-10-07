// ═══════════════════════════════════════
//  CONTROLO DE OBRAS — relatório PDF resumido (1 página A4, jsPDF em vetor)
// ═══════════════════════════════════════
import { coBalancoCalc, TIPOLOGIAS } from './co-balanco.js';

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const mesLabel = ym => { const [y,m]=ym.split('-'); return MESES[parseInt(m)-1]+'/'+y.slice(2); };
const fmt = v => new Intl.NumberFormat('pt-PT',{ maximumFractionDigits:0, useGrouping:'always' }).format(Math.round(v||0)).replace(/[  ]/g,' ');
const eur = v => fmt(v)+' €';
const pct = v => (v*100).toFixed(1).replace('.',',')+'%';

const C = {
  dark:[23,48,63], ink:[28,35,43], mute:[110,120,130], line:[220,225,230], soft:[246,248,250],
  custo:[214,86,72], prov:[72,166,124], eq:[66,110,196], good:[30,140,90], bad:[200,60,50],
};

// obras: [{id,nome,extra}], titulo: {cod, nome, sub}
export function coRelatorioPdf(obras, mensal, periodo, titulo){
  if(!window.jspdf) throw new Error('Biblioteca PDF não carregada.');
  const { jsPDF } = window.jspdf;
  const c = coBalancoCalc(obras, mensal, periodo);
  if(!c.rows.length) throw new Error('Sem dados no período escolhido.');
  const pdf = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
  const L = 14, R = 196, W = R-L;
  let y = 0;
  const txt = (s, x, yy, { size=9, bold=false, color=C.ink, align='left' }={}) => {
    pdf.setFont('helvetica', bold?'bold':'normal'); pdf.setFontSize(size); pdf.setTextColor(...color);
    pdf.text(String(s), x, yy, { align });
  };
  const need = h => { if(y+h > 284){ pdf.addPage(); y = 16; } };
  const secao = nome => { need(14); txt(nome.toUpperCase(), L, y, { size:8, bold:true, color:C.mute }); y += 2; pdf.setDrawColor(...C.line); pdf.line(L, y, R, y); y += 5; };

  const primeiro = c.rows[0].ym, ultimo = c.rows[c.rows.length-1].ym;
  const periodoTxt = primeiro===ultimo ? mesLabel(primeiro) : mesLabel(primeiro)+' a '+mesLabel(ultimo);

  // Cabeçalho
  pdf.setFillColor(...C.dark); pdf.rect(0, 0, 210, 38, 'F');
  txt('PLANDESE · CONTROLO DE OBRAS'+(titulo.cod?' · '+titulo.cod:''), L, 12, { size:8, bold:true, color:[170,190,200] });
  txt(titulo.nome, L, 22, { size:17, bold:true, color:[255,255,255] });
  txt(`Período analisado: ${periodoTxt}${titulo.sub?'  ·  '+titulo.sub:''}`, L, 30, { size:9, color:[200,215,222] });
  txt('Emitido em '+new Date().toLocaleDateString('pt-PT'), R, 12, { size:8, color:[170,190,200], align:'right' });
  y = 48;

  // KPIs
  const kpis = [
    ['Proveitos', eur(c.provTot), C.prov],
    ['Custos totais', eur(c.custosTot), C.custo],
    ['Saldo', (c.saldo>=0?'+':'')+eur(c.saldo), c.saldo>=0?C.good:C.bad],
    ['Margem', c.margem===null?'—':pct(c.margem), c.saldo>=0?C.good:C.bad],
  ];
  const kw = (W-9)/4;
  kpis.forEach(([lbl,val,cor],i)=>{
    const x = L+i*(kw+3);
    pdf.setFillColor(...C.soft); pdf.setDrawColor(...C.line); pdf.roundedRect(x, y, kw, 20, 2, 2, 'FD');
    txt(lbl, x+4, y+7, { size:8, color:C.mute });
    txt(val, x+4, y+15, { size:13, bold:true, color:cor });
  });
  y += 27;

  if(c.provKTot || c.provRTot){ txt(`Proveitos: trabalho contratual ${eur(c.provCTot)}` + (c.provKTot ? `  ·  trabalhos complementares ${eur(c.provKTot)}` : '') + (c.provRTot ? `  ·  revisão de preços ${eur(c.provRTot)}` : ''), L, y, { size:8.5, color:C.mute }); y += 6; }
  const sede = obras.map(o=>parseFloat((o.extra||{}).sede_pct)||0);
  if(obras.length===1 && sede[0] && c.tot.sede){
    txt(`Inclui estrutura central a ${String(sede[0]).replace('.',',')}% da faturação: ${eur(c.tot.sede)}.`, L, y, { size:8.5, color:C.mute }); y += 7;
  }

  // Gráfico custos vs proveitos
  secao('Custos e proveitos por mês');
  const gh = 42, gx = L+14, gw = W-14, base = y+gh;
  const ymax = Math.max(1, ...c.rows.flatMap(r=>[r.custos, r.prov]));
  const mag = Math.pow(10, Math.floor(Math.log10(ymax))), n = ymax/mag;
  const top = (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*mag;
  for(let i=0;i<=4;i++){
    const v = top*i/4, yy = base - gh*i/4;
    pdf.setDrawColor(...C.line); pdf.line(gx, yy, R, yy);
    txt(v>=1000 ? Math.round(v/1000)+'k' : Math.round(v), gx-2, yy+1.2, { size:7, color:C.mute, align:'right' });
  }
  const gwid = gw/c.rows.length, bw = Math.min(9, gwid*.32);
  c.rows.forEach((r,i)=>{
    const cx = gx+i*gwid+gwid/2;
    const h1 = Math.max(0, r.custos)/top*gh, h2 = Math.max(0, r.prov)/top*gh;
    pdf.setFillColor(...C.custo); pdf.rect(cx-bw-.4, base-h1, bw, h1, 'F');
    pdf.setFillColor(...C.prov);  pdf.rect(cx+.4, base-h2, bw, h2, 'F');
    txt(mesLabel(r.ym), cx, base+4.5, { size:7, color:C.mute, align:'center' });
  });
  y = base+8;
  pdf.setFillColor(...C.custo); pdf.rect(L, y-2.4, 3, 3, 'F'); txt('Custos', L+4.5, y, { size:8, color:C.mute });
  pdf.setFillColor(...C.prov);  pdf.rect(L+22, y-2.4, 3, 3, 'F'); txt('Proveitos', L+26.5, y, { size:8, color:C.mute });
  y += 9;

  // Tabela mensal
  secao('Detalhe mensal');
  const cols = [['Mês',L,'left'],['Proveitos',L+62,'right'],['Custos',L+92,'right'],['Saldo',L+122,'right'],['Margem',L+150,'right'],['Saldo acum.',R,'right']];
  const cab = () => { cols.forEach(([t,x,a])=>txt(t, x, y, { size:8, bold:true, color:C.mute, align:a })); y += 5; };
  cab();
  const linha = (vals, bold, fundo) => {
    need(6);
    if(fundo){ pdf.setFillColor(...C.soft); pdf.rect(L-1, y-4, W+2, 6, 'F'); }
    vals.forEach((v,i)=>{
      const neg = (i===3||i===5) && String(v).startsWith('-');
      txt(v, cols[i][1], y, { size:9, bold, color:neg?C.bad:C.ink, align:cols[i][2] });
    });
    y += 6;
  };
  c.rows.forEach(r=>linha([mesLabel(r.ym), eur(r.prov), eur(r.custos), eur(r.saldo), r.margem===null?'—':pct(r.margem), eur(r.acum)], false, false));
  pdf.setDrawColor(...C.line); pdf.line(L, y-4, R, y-4);
  linha(['TOTAL', eur(c.provTot), eur(c.custosTot), eur(c.saldo), c.margem===null?'—':pct(c.margem), eur(c.saldo)], true, true);
  y += 4;

  // Tipologias + carga lado a lado (se couber)
  need(60);
  const yTop = y;
  secao('Custos por tipologia');
  TIPOLOGIAS.filter(t=>Math.abs(c.tot[t.key])>0.005).forEach(t=>{
    need(6);
    txt(t.label, L, y, { size:9 });
    txt(eur(c.tot[t.key]), L+88, y, { size:9, align:'right' });
    txt(c.provTot>0?pct(c.tot[t.key]/c.provTot):'—', L+108, y, { size:9, color:C.mute, align:'right' });
    y += 5.6;
  });
  const yFim = y;
  y = yTop;
  const x2 = L+120;
  txt('CARGA SOBRE O FATURADO', x2, y, { size:8, bold:true, color:C.mute }); pdf.setDrawColor(...C.line); pdf.line(x2, y+2, R, y+2); y += 7;
  const tmo = c.rows.reduce((a,r)=>a+r.mo,0), teq = c.rows.reduce((a,r)=>a+r.eq,0);
  [['Mão de obra', tmo], ['Equipamentos', teq], ['Total', tmo+teq]].forEach(([l,v],i)=>{
    txt(l, x2, y, { size:9, bold:i===2 });
    txt(c.provTot>0?pct(v/c.provTot):'—', R, y, { size:9, bold:true, align:'right' });
    txt(eur(v), R, y+4.2, { size:7.5, color:C.mute, align:'right' });
    y += 10;
  });
  y = Math.max(yFim, y) + 4;

  // Notas
  const notas = obras.filter(o=>o.extra&&o.extra.nota);
  if(notas.length){
    secao('Notas');
    notas.forEach(o=>{
      const linhas = pdf.splitTextToSize((obras.length>1?o.nome+': ':'')+o.extra.nota, W);
      need(linhas.length*4.5+2);
      pdf.setFont('helvetica','normal'); pdf.setFontSize(9); pdf.setTextColor(...C.ink);
      pdf.text(linhas, L, y); y += linhas.length*4.5+2;
    });
  }

  // Rodapé
  const np = pdf.getNumberOfPages();
  for(let p=1;p<=np;p++){
    pdf.setPage(p);
    txt('Portal Plandese · Controlo de Obras · valores sem IVA', L, 291, { size:7.5, color:C.mute });
    if(np>1) txt(p+'/'+np, R, 291, { size:7.5, color:C.mute, align:'right' });
  }
  const slug = s => String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^\w]+/g,'_').replace(/^_|_$/g,'');
  pdf.save(`Balanco_${slug(titulo.cod||titulo.nome)}_${primeiro}_${ultimo}.pdf`);
}
