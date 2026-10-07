// ═══════════════════════════════════════
//  PRODUÇÃO — Balanço (custos vs proveitos, carga MO/equipamentos, tipologias)
//  Funções puras: recebem os dados e devolvem HTML. Sem estado nem imports.
// ═══════════════════════════════════════

const COR = {
  custo:   'oklch(0.62 0.18 25)',
  prov:    'oklch(0.68 0.13 155)',
  equip:   'oklch(0.55 0.15 255)',
  sede:    'oklch(0.50 0.17 290)',
  transf:  'oklch(0.70 0.15 350)',
  exist:   'oklch(0.55 0.14 145)',
};

export const TIPOLOGIAS = [
  { key:'mo',     label:'Mão de Obra' },
  { key:'eq',     label:'Equipamentos' },
  { key:'mat',    label:'Materiais' },
  { key:'geral',  label:'Geral' },
  { key:'sub',    label:'Subcontratos' },
  { key:'outros', label:'Outros' },
  { key:'transf', label:'Material transferido de outra obra', cor:COR.transf },
  { key:'sede',   label:'Estrutura central', cor:COR.sede },
  { key:'exist',  label:'Existências Finais', cor:COR.exist },
];
const GRUPO_KEY = { 'Mão de Obra':'mo', 'Equipamento':'eq', 'MateriaPrima':'mat', 'Geral':'geral', 'N/D':'sub' };

const eur0 = v => new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(v||0);
const eurK = v => Math.abs(v)>=1000 ? (v/1000).toFixed(Math.abs(v)>=100000?0:1).replace('.',',')+'k €' : Math.round(v)+' €';
const pct  = (v,d=1) => (v*100).toFixed(d).replace('.',',')+'%';
const esc  = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function mesLabel(ym){
  const [y,m]=ym.split('-'); const ns=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return (ns[parseInt(m)-1]||m)+'/'+y.slice(2);
}
function niceCeil(v){
  if(v<=0) return 1;
  const mag=Math.pow(10,Math.floor(Math.log10(v))), n=v/mag;
  return (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*mag;
}

// ── Cálculo ────────────────────────────────────────────────────────────
// obras: [{id,nome,extra}], mensal: linhas de co_mensal ({obra_id,mes,proveitos,mo,eq,mat,geral,sub,outros})
// periodo: {de, ate} em 'YYYY-MM' (vazio = sem limite). Ajustes sem mês (transferido, existências)
// só entram se o período incluir o último mês da obra.
export function coBalancoCalc(obras, mensal, periodo){
  const de = periodo && periodo.de || '', ate = periodo && periodo.ate || '';
  const dentro = ym => (!de || ym>=de) && (!ate || ym<=ate);
  const meses = {};
  const mk = ym => meses[ym] || (meses[ym] = { ym, prov:0, mo:0, eq:0, mat:0, geral:0, sub:0, outros:0, transf:0, sede:0, exist:0 });
  const tot = Object.fromEntries(TIPOLOGIAS.map(t=>[t.key,0]));
  let provTot = 0;

  obras.forEach(o => {
    const ex = o.extra || {};
    const sedePct = (parseFloat(ex.sede_pct)||0)/100;
    const todas = mensal.filter(r=>r.obra_id===o.id);
    const linhas = todas.filter(r=>dentro(r.mes));
    linhas.forEach(r => {
      const m = mk(r.mes), v = parseFloat(r.proveitos)||0;
      m.prov += v; provTot += v;
      ['mo','eq','mat','geral','sub','outros'].forEach(k => { const x=parseFloat(r[k])||0; m[k]+=x; tot[k]+=x; });
      if(sedePct){ const sd=v*sedePct; m.sede+=sd; tot.sede+=sd; }
    });
    // ajustes sem mês: ficam no último mês com movimentos da obra
    const ultimo = todas.map(r=>r.mes).sort().pop();
    if(ultimo && dentro(ultimo)){
      const transf = parseFloat(ex.transferido)||0;
      if(transf){ mk(ultimo).transf += transf; tot.transf += transf; }
    }
    // Existências em obra (stock comprado e ainda não consumido/faturado): é um saldo, não um fluxo.
    // Conta o valor do último mês do período com existências lançadas, e abate aos custos.
    const comStock = linhas.filter(r=>parseFloat(r.exist)).map(r=>r.mes).sort().pop();
    if(comStock){
      const s = -(parseFloat(linhas.find(r=>r.mes===comStock).exist)||0);
      mk(comStock).exist += s; tot.exist += s;
    }
  });

  const rows = Object.values(meses).sort((a,b)=>a.ym.localeCompare(b.ym));
  let acc = 0;
  rows.forEach(r => {
    r.custos = TIPOLOGIAS.reduce((s,t)=>s+r[t.key],0);
    r.saldo = r.prov - r.custos; acc += r.saldo; r.acum = acc;
    r.margem = r.prov>0 ? r.saldo/r.prov : null;
  });
  const custosTot = TIPOLOGIAS.reduce((s,t)=>s+tot[t.key],0);
  return { rows, tot, provTot, custosTot, saldo: provTot-custosTot, margem: provTot>0 ? (provTot-custosTot)/provTot : null };
}

// ── Gráficos SVG ───────────────────────────────────────────────────────
let W = 560, H = 230, PL = 52;
const PR = 10, PT = 14, PB = 26;
// Gráficos mais estreitos para o telemóvel (as funções leem W/H/PL ao desenhar)
const comDim = (w,h,pl,fn) => { const o=[W,H,PL]; W=w; H=h; PL=pl; try{ return fn(); } finally{ [W,H,PL]=o; } };
const svgOpen = label => `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${label}" style="display:block;overflow:visible">`;
const axisY = (ymax, yfn, fmt) => Array.from({length:5},(_,i)=>{
  const v=ymax*i/4, y=yfn(v);
  return `<line x1="${PL}" x2="${W-PR}" y1="${y}" y2="${y}" stroke="var(--gray-100)"/><text x="${PL-6}" y="${y+3}" font-size="10" text-anchor="end" fill="var(--gray-400)">${fmt(v)}</text>`;
}).join('');

function barsCustoProv(rows, kA, kB, labelA, labelB, extraTip){
  const n=rows.length, pw=W-PL-PR, ph=H-PT-PB, gw=pw/n, bw=Math.min(20,gw*.32);
  const ymax=niceCeil(Math.max(1,...rows.flatMap(r=>[kA(r),kB(r)])));
  const y=v=>PT+ph-(v/ymax)*ph;
  let s=svgOpen('Custos e proveitos por mês')+axisY(ymax,y,eurK);
  rows.forEach((r,i)=>{
    const cx=PL+i*gw+gw/2, a=kA(r), b=kB(r);
    const tip=`<title>${mesLabel(r.ym)}\n${labelA}: ${eur0(a)}\n${labelB}: ${eur0(b)}${extraTip?'\n'+extraTip(r):''}</title>`;
    s+=`<g>${tip}<rect x="${cx-bw-1}" y="${y(a)}" width="${bw}" height="${Math.max(0,PT+ph-y(a))}" rx="2" fill="${COR.custo}"/><rect x="${cx+1}" y="${y(b)}" width="${bw}" height="${Math.max(0,PT+ph-y(b))}" rx="2" fill="${COR.prov}"/></g>`;
    s+=`<text x="${cx}" y="${H-8}" font-size="10" text-anchor="middle" fill="var(--gray-400)">${mesLabel(r.ym)}</text>`;
  });
  return s+`<line x1="${PL}" x2="${W-PR}" y1="${y(0)}" y2="${y(0)}" stroke="var(--gray-300)"/></svg>`;
}

function linhaSaldo(rows){
  const n=rows.length, pw=W-PL-PR, ph=H-PT-PB;
  const vals=rows.flatMap(r=>[r.saldo,r.acum]);
  let lo=Math.min(0,...vals), hi=Math.max(0,...vals); if(lo===hi){lo-=1;hi+=1;}
  const pad=(hi-lo)*.15; lo-=pad; hi+=pad;
  const y=v=>PT+ph-((v-lo)/(hi-lo))*ph, x=i=>PL+(n===1?pw/2:(i/(n-1))*pw);
  let s=svgOpen('Saldo mensal e acumulado');
  for(let i=0;i<=4;i++){ const v=lo+(hi-lo)*i/4; s+=`<line x1="${PL}" x2="${W-PR}" y1="${y(v)}" y2="${y(v)}" stroke="var(--gray-100)"/><text x="${PL-6}" y="${y(v)+3}" font-size="10" text-anchor="end" fill="var(--gray-400)">${eurK(v)}</text>`; }
  s+=`<line x1="${PL}" x2="${W-PR}" y1="${y(0)}" y2="${y(0)}" stroke="var(--gray-400)" stroke-opacity=".6"/>`;
  const path=k=>rows.map((r,i)=>(i?'L':'M')+x(i).toFixed(1)+','+y(r[k]).toFixed(1)).join(' ');
  s+=`<path d="${path('saldo')}" fill="none" stroke="var(--gray-400)" stroke-width="1.5" stroke-linejoin="round"/>`;
  s+=`<path d="${path('acum')}" fill="none" stroke="var(--gray-900)" stroke-width="2.5" stroke-linejoin="round"/>`;
  rows.forEach((r,i)=>{
    s+=`<g><title>${mesLabel(r.ym)}\nSaldo do mês: ${eur0(r.saldo)}${r.margem!==null?' ('+pct(r.margem)+')':''}\nAcumulado: ${eur0(r.acum)}</title><circle cx="${x(i)}" cy="${y(r.saldo)}" r="4" fill="${r.saldo>=0?'var(--green)':'var(--red)'}" stroke="var(--white)" stroke-width="1.5"/><circle cx="${x(i)}" cy="${y(r.acum)}" r="3.5" fill="var(--gray-900)" stroke="var(--white)" stroke-width="1.5"/></g>`;
    s+=`<text x="${x(i)}" y="${H-8}" font-size="10" text-anchor="middle" fill="var(--gray-400)">${mesLabel(r.ym)}</text>`;
  });
  const u=rows[n-1];
  s+=`<text x="${x(n-1)-7}" y="${u.acum>=u.saldo?y(u.acum)-11:y(u.acum)+19}" font-size="11" font-weight="600" text-anchor="end" fill="var(--gray-900)">${eur0(u.acum)}</text>`;
  return s+'</svg>';
}

function barrasCarga(rows){
  const n=rows.length, pw=W-PL-PR, ph=H-PT-PB, gw=pw/n, bw=Math.min(26,gw*.5);
  const val=rows.map(r=>r.prov>0?{...r,rmo:r.mo/r.prov,req:r.eq/r.prov,tot:(r.mo+r.eq)/r.prov}:{...r,tot:null});
  const ymax=Math.max(.1,Math.ceil(Math.max(.1,...val.map(v=>v.tot||0))*10)/10);
  const y=v=>PT+ph-(v/ymax)*ph;
  const ok=val.filter(v=>v.tot!==null), sp=ok.reduce((a,v)=>a+v.prov,0);
  const media=sp?ok.reduce((a,v)=>a+v.mo+v.eq,0)/sp:0;
  let s=svgOpen('Carga sobre o faturado')+axisY(ymax,y,v=>pct(v,0));
  val.forEach((v,i)=>{
    const cx=PL+i*gw+gw/2-bw/2;
    if(v.tot!==null){
      const yEq=y(v.tot), hEq=Math.max(y(v.rmo)-yEq-2,0);
      s+=`<g><title>${mesLabel(v.ym)}\nMão de obra: ${pct(v.rmo)}\nEquipamentos: ${pct(v.req)}\nCarga total: ${pct(v.tot)}\nsobre ${eur0(v.prov)} faturados</title><rect x="${cx}" y="${y(v.rmo)}" width="${bw}" height="${Math.max(PT+ph-y(v.rmo),0)}" fill="${COR.custo}"/><rect x="${cx}" y="${yEq}" width="${bw}" height="${hEq}" rx="2" fill="${COR.equip}"/></g><text x="${cx+bw/2}" y="${yEq-5}" font-size="10" text-anchor="middle" fill="var(--gray-700)">${pct(v.tot,0)}</text>`;
    } else s+=`<text x="${cx+bw/2}" y="${y(0)-6}" font-size="10" text-anchor="middle" fill="var(--gray-400)">—</text>`;
    s+=`<text x="${PL+i*gw+gw/2}" y="${H-8}" font-size="10" text-anchor="middle" fill="var(--gray-400)">${mesLabel(v.ym)}</text>`;
  });
  if(media>0 && media<=ymax) s+=`<line x1="${PL}" x2="${W-PR}" y1="${y(media)}" y2="${y(media)}" stroke="var(--gray-400)" stroke-width="2" stroke-dasharray="5 4"/>`;
  return s+`<line x1="${PL}" x2="${W-PR}" y1="${y(0)}" y2="${y(0)}" stroke="var(--gray-300)"/></svg>`;
}

// ── Blocos HTML ────────────────────────────────────────────────────────
const leg = (cor,txt,dash) => `<span style="display:inline-flex;align-items:center;gap:5px">${dash?`<i style="width:14px;border-top:2px dashed var(--gray-400)"></i>`:`<i style="width:9px;height:9px;border-radius:2px;background:${cor}"></i>`}${txt}</span>`;
const legend = items => `<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:var(--gray-500);margin-top:8px">${items.join('')}</div>`;
const panel = (title, desc, body) => `<div class="co-panel"><div class="co-panel-hd"><div class="co-panel-title">${title}</div></div><div class="co-panel-bd">${desc?`<div style="font-size:12px;color:var(--gray-500);margin:-4px 0 10px">${desc}</div>`:''}${body}</div></div>`;
const tile = (lbl,val,sub,cor) => `<div class="co-an-tile"><div class="co-an-lbl">${lbl}</div><div class="co-an-val" style="${cor?'color:'+cor:''}">${val}</div><div class="co-an-sub">${sub||'&nbsp;'}</div></div>`;

function tipoBodyHtml(c, tot){
  const linhas = TIPOLOGIAS.filter(t=>Math.abs(tot[t.key])>0.005);
  const maxAbs = Math.max(1,...linhas.map(t=>Math.abs(tot[t.key])));
  return linhas.map(t=>`<div class="co-an-tip">
      <div>${t.label}</div>
      <div class="co-an-track"><div style="width:${Math.abs(tot[t.key])/maxAbs*100}%;height:100%;border-radius:4px;background:${t.cor||COR.custo}"></div></div>
      <div class="co-an-n">${eur0(tot[t.key])}</div>
      <div class="co-an-n" style="color:var(--gray-400)">${c.provTot>0?pct(tot[t.key]/c.provTot):'—'}</div>
    </div>`).join('') + `<div class="co-an-tip" style="border-top:1px solid var(--gray-200);font-weight:600"><div>Total</div><div></div><div class="co-an-n">${eur0(c.custosTot)}</div><div class="co-an-n">${c.provTot>0?pct(c.custosTot/c.provTot):'—'}</div></div>`;
}

// ── Versão resumida para telemóvel ─────────────────────────────────────
function coBalancoHtmlMobile(obras, mensal, periodo){
  const c = coBalancoCalc(obras, mensal, periodo);
  const unica = obras.length === 1;
  const notas = obras.filter(o=>o.extra&&o.extra.nota).map(o=>`<div class="co-an-nota"><span>${esc(o.extra.nota)}</span></div>`).join('');
  if(!c.rows.length) return notas + `<div class="co-empty">${periodo&&(periodo.de||periodo.ate)?'Sem lançamentos no período escolhido.':'Sem lançamentos.'}</div>`;
  const { rows, tot } = c;
  const bom = c.saldo>=0;
  const tiles = `<div class="co-an-tiles">
    ${tile('Proveitos', eur0(c.provTot), rows.length+(rows.length===1?' mês':' meses'), COR.prov)}
    ${tile('Custos', eur0(c.custosTot), 'diretos + ajustes', COR.custo)}
    ${tile('Saldo', (bom?'+':'')+eur0(c.saldo), 'proveitos − custos', bom?'var(--green)':'var(--red)')}
    ${tile('Margem', c.margem===null?'—':pct(c.margem), 'sobre proveitos', bom?'var(--green)':'var(--red)')}
  </div>`;
  const grafico = panel('Custos e proveitos por mês','',
    comDim(340,185,38,()=>barsCustoProv(rows,r=>r.custos,r=>r.prov,'Custos','Proveitos',r=>'Saldo: '+eur0(r.saldo))) + legend([leg(COR.custo,'Custos'),leg(COR.prov,'Proveitos')]));
  const tab = `<div class="co-panel" style="margin-top:12px"><div class="co-panel-bd" style="padding:6px 8px"><table class="co-pivot"><thead><tr><th>Mês</th><th>Prov.</th><th>Custos</th><th>Saldo</th></tr></thead><tbody>${
    rows.map(r=>`<tr><td>${mesLabel(r.ym)}</td><td>${eurK(r.prov)}</td><td>${eurK(r.custos)}</td><td style="color:${r.saldo<0?'var(--red)':'inherit'}">${eurK(r.saldo)}</td></tr>`).join('')
  }<tr class="total"><td>Total</td><td>${eurK(c.provTot)}</td><td>${eurK(c.custosTot)}</td><td>${eurK(c.saldo)}</td></tr></tbody></table></div></div>`;
  const tmo=rows.reduce((a,r)=>a+r.mo,0), teq=rows.reduce((a,r)=>a+r.eq,0);
  const carga = c.provTot>0 ? `<div class="co-an-tiles" style="grid-template-columns:1fr;margin-top:12px">${tile('Carga de mão de obra + equip.', pct((tmo+teq)/c.provTot), `MO ${pct(tmo/c.provTot)} · Equip. ${pct(teq/c.provTot)} do faturado`)}</div>` : '';
  const tipo = `<div class="co-an-sec" style="margin:18px 0 8px">Custos por tipologia</div><div class="co-panel"><div class="co-panel-bd" style="padding:6px 14px">${tipoBodyHtml(c, tot)}</div></div>`;
  return notas + tiles + grafico + tab + carga + tipo;
}

export function coBalancoHtml(obras, mensal, periodo, mobile){
  if(mobile) return coBalancoHtmlMobile(obras, mensal, periodo);
  const c = coBalancoCalc(obras, mensal, periodo);
  const unica = obras.length === 1;
  const notas = obras.filter(o=>o.extra&&o.extra.nota).map(o=>`<div class="co-an-nota"><b>Nota${unica?'':' · '+esc(o.nome)}</b><span>${esc(o.extra.nota)}</span></div>`).join('');
  if(!c.rows.length) return notas + `<div class="co-empty">${periodo&&(periodo.de||periodo.ate)?'Sem lançamentos no período escolhido.':'Sem lançamentos. Importe o Excel de custos e registe os proveitos mensais.'}</div>`;

  const { rows, tot } = c;
  const mesesComSede = obras.some(o=>parseFloat((o.extra||{}).sede_pct));
  const tiles = `<div class="co-an-tiles">
    ${tile('Proveitos', eur0(c.provTot), rows.length+' meses com movimento', COR.prov)}
    ${tile('Custos totais', eur0(c.custosTot), mesesComSede?'diretos + sede + ajustes':'diretos + ajustes', COR.custo)}
    ${tile('Saldo', (c.saldo>=0?'+':'')+eur0(c.saldo), 'proveitos − custos', c.saldo>=0?'var(--green)':'var(--red)')}
    ${tile('Margem', c.margem===null?'—':pct(c.margem), 'sobre proveitos')}
  </div>`;

  const evo = `<div class="co-an-grid">
    ${panel('Custos e proveitos por mês','Custos incluem imputação de sede e ajustes.', barsCustoProv(rows,r=>r.custos,r=>r.prov,'Custos','Proveitos',r=>'Saldo: '+eur0(r.saldo)) + legend([leg(COR.custo,'Custos'),leg(COR.prov,'Proveitos')]))}
    ${panel('Saldo mensal e acumulado','A linha escura é onde a obra está de facto.', linhaSaldo(rows) + legend([leg('var(--gray-900)','Saldo acumulado'),leg('var(--gray-400)','Saldo do mês')]))}
  </div>`;

  // Carga MO + equipamentos
  const com = rows.filter(r=>r.prov>0);
  const tmo=rows.reduce((a,r)=>a+r.mo,0), teq=rows.reduce((a,r)=>a+r.eq,0), tp=rows.reduce((a,r)=>a+r.prov,0);
  const p = v => tp>0 ? pct(v/tp) : '—';
  const pico = com.length ? com.reduce((a,r)=>(r.mo+r.eq)/r.prov>(a.mo+a.eq)/a.prov?r:a) : null;
  const cargaTiles = `<div class="co-an-tiles" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">
    ${tile('Mão de obra', p(tmo), eur0(tmo))}
    ${tile('Equipamentos', p(teq), eur0(teq))}
    ${tile('Carga total sobre o faturado', p(tmo+teq), pico?`pico em ${mesLabel(pico.ym)}, com ${pct((pico.mo+pico.eq)/pico.prov)}`:'—')}
  </div>`;
  const carga = `<div class="co-an-sec">Carga de mão de obra e equipamentos</div>
    <div style="font-size:12px;color:var(--gray-500);margin:-6px 0 12px">Quanto de cada euro faturado é absorvido por pessoal próprio e equipamento. Meses sem faturação não têm percentagem.</div>
    ${cargaTiles}
    <div class="co-an-grid">
      ${panel('Mão de obra + equipamentos vs faturação (€)','', barsCustoProv(rows,r=>r.mo+r.eq,r=>r.prov,'Mão de obra + equipamentos','Faturação',r=>'Carga: '+(r.prov>0?pct((r.mo+r.eq)/r.prov):'—')) + legend([leg(COR.custo,'Mão de obra + equipamentos'),leg(COR.prov,'Faturação')]))}
      ${panel('Carga sobre o faturado (%)','', barrasCarga(rows) + legend([leg(COR.custo,'Mão de obra'),leg(COR.equip,'Equipamentos'),leg('', 'Média do período', true)]))}
    </div>`;

  // Tipologias
  const tipoBody = tipoBodyHtml(c, tot);
  const tipo = `<div class="co-an-sec">Custos por tipologia</div>` + panel('Peso de cada rubrica face ao total faturado','As rubricas que não são custo direto de obra (sede, material transferido, existências) têm cor própria.', tipoBody);

  // Tabela mensal
  const tabela = `<div class="co-an-sec">Detalhe mensal</div><div class="co-panel"><div class="co-panel-bd" style="overflow:auto"><table class="co-pivot"><thead><tr><th>Mês</th><th>Custos</th><th>Proveitos</th><th>Saldo</th><th>Margem</th><th>Saldo acum.</th></tr></thead><tbody>${
    rows.map(r=>`<tr><td>${mesLabel(r.ym)}</td><td>${eur0(r.custos)}</td><td>${eur0(r.prov)}</td><td style="color:${r.saldo<0?'var(--red)':'inherit'}">${eur0(r.saldo)}</td><td>${r.margem===null?'—':pct(r.margem)}</td><td style="color:${r.acum<0?'var(--red)':'inherit'}">${eur0(r.acum)}</td></tr>`).join('')
  }<tr class="total"><td>TOTAL</td><td>${eur0(c.custosTot)}</td><td>${eur0(c.provTot)}</td><td>${eur0(c.saldo)}</td><td>${c.margem===null?'—':pct(c.margem)}</td><td>${eur0(c.saldo)}</td></tr></tbody></table></div></div>`;

  return notas + tiles + evo + carga + tipo + tabela;
}
