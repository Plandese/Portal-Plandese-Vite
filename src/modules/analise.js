// ═══════════════════════════════════════
//  ANÁLISE — Vista de análise de dados (modo telemóvel)
//  Só de leitura: agrega ponto, compras, faturas e combustível
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S } from '../state.js';
import { fmt, getMonday, calcH, fmtH } from '../utils/helpers.js';
import { ROLE_ACCESS } from '../config.js';

let _periodo     = 'semana';   // semana | mes | ano
let _obra        = '';         // '' = todas
let _loading     = false;
let _obrasFeitas = false;

const MESES_ABR = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const DIAS_ABR  = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];

// ── Helpers ────────────────────────────────────────────────────────
// Meio-dia evita saltos de dia na conversão para ISO (fmt usa toISOString)
const _dia   = (y,m,d) => new Date(y, m, d, 12, 0, 0);
const _parse = dk => new Date(dk + 'T12:00:00');
const _eur   = v => (v||0).toLocaleString('pt-PT',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' €';
const _num   = v => (v||0).toLocaleString('pt-PT');
// fmtH devolve '—' para zero — nos KPIs queremos '0h'
const _horas = v => (v > 0 ? fmtH(v) : '0h');

function _range(){
  const agora = new Date();
  const hoje = _dia(agora.getFullYear(), agora.getMonth(), agora.getDate());
  let ini;
  if(_periodo === 'semana')   ini = getMonday(hoje);
  else if(_periodo === 'mes') ini = _dia(hoje.getFullYear(), hoje.getMonth(), 1);
  else                        ini = _dia(hoje.getFullYear(), 0, 1);
  ini.setHours(12,0,0,0);
  return { de: fmt(ini), ate: fmt(hoje), ini, fim: hoje };
}

function _labelPeriodo(){
  const { ini, fim } = _range();
  if(_periodo === 'semana') return `${ini.getDate()} ${MESES_ABR[ini.getMonth()]} — ${fim.getDate()} ${MESES_ABR[fim.getMonth()]}`;
  if(_periodo === 'mes')    return `${MESES_ABR[ini.getMonth()]} de ${ini.getFullYear()}`;
  return `Ano de ${ini.getFullYear()}`;
}

// Capítulo permitido para o perfil do utilizador (mesma matriz usada na sidebar)
function _pode(chapterId){
  const role = S.currentUser?.role;
  if(role === 'admin') return true;
  const acc = ROLE_ACCESS[role];
  if(!acc) return false;
  return (acc.chapters || []).includes(chapterId);
}

const _obraNome  = id => S.OBRAS.find(o => o.id === id)?.nome || id || '—';
const _colabNome = n  => S.COLABORADORES.find(c => c.n === n)?.nome || ('Nº ' + n);

// ── Carregamento dos dados do período ──────────────────────────────
async function _carregar(){
  const { de, ate } = _range();
  const out = { ponto:[], moa:[], compras:[], faturas:[], comb:[], erros:[] };

  const jobs = [];
  const push = (nome, query, alvo) => {
    jobs.push(Promise.resolve(query).then(res => {
      if(res.error) throw res.error;
      out[alvo] = res.data || [];
    }).catch(e => { out.erros.push(nome); console.warn('[analise] ' + nome + ':', e.message || e); }));
  };

  if(_pode('rh')){
    let q = sb.from('registos_ponto').select('data,colab_numero,obra_id,entrada,saida,tipo').gte('data', de).lte('data', ate);
    if(_obra) q = q.eq('obra_id', _obra);
    push('ponto', q, 'ponto');

    let qm = sb.from('registos_ponto_moa').select('data,obra_id,entrada,saida,empresa_moa_nome,trabalhador_nome').gte('data', de).lte('data', ate);
    if(_obra) qm = qm.eq('obra_id', _obra);
    push('mão-de-obra aluguer', qm, 'moa');
  }
  if(_pode('cmp')){
    push('compras', sb.from('pedidos_compra').select('id,estado,obra_id,created_at,urgencia,titulo').gte('created_at', de), 'compras');
  }
  if(_pode('fin')){
    push('faturas', sb.from('faturas').select('id,fornecedor,total,data,status,centro_custo').gte('data', de).lte('data', ate), 'faturas');
  }
  if(_pode('log')){
    let q = sb.from('registos_combustivel').select('data,litros,tipo_registo,movimento,obra_id').gte('data', de).lte('data', ate);
    if(_obra) q = q.eq('obra_id', _obra);
    push('combustível', q, 'comb');
  }

  await Promise.all(jobs);
  return out;
}

// ── Buckets do gráfico de horas ────────────────────────────────────
function _buckets(){
  const { ini } = _range();
  const out = [];
  if(_periodo === 'semana'){
    for(let i=0;i<7;i++){
      const d = new Date(ini); d.setDate(d.getDate()+i); d.setHours(12,0,0,0);
      out.push({ label: DIAS_ABR[i], key: fmt(d), h: 0 });
    }
  } else if(_periodo === 'mes'){
    const nDias = new Date(ini.getFullYear(), ini.getMonth()+1, 0).getDate();
    for(let s=0;s<Math.ceil(nDias/7);s++) out.push({ label: 'S'+(s+1), dias: [], h: 0 });
    for(let d=1;d<=nDias;d++) out[Math.floor((d-1)/7)].dias.push(fmt(_dia(ini.getFullYear(), ini.getMonth(), d)));
  } else {
    for(let m=0;m<12;m++) out.push({ label: MESES_ABR[m], mes: m, h: 0 });
  }
  return out;
}

function _distribuirHoras(buckets, horasPorDia){
  Object.entries(horasPorDia).forEach(([dk, h]) => {
    if(_periodo === 'semana'){
      const b = buckets.find(x => x.key === dk); if(b) b.h += h;
    } else if(_periodo === 'mes'){
      const b = buckets.find(x => x.dias.includes(dk)); if(b) b.h += h;
    } else {
      const m = _parse(dk).getMonth();
      const b = buckets.find(x => x.mes === m); if(b) b.h += h;
    }
  });
  return buckets;
}

// ── Blocos de HTML ─────────────────────────────────────────────────
function _kpi(valor, rotulo, cor, sub){
  return `<div class="anl-kpi">
    <div class="anl-kpi-v" style="color:${cor}">${valor}</div>
    <div class="anl-kpi-l">${rotulo}</div>
    ${sub ? `<div class="anl-kpi-s">${sub}</div>` : ''}
  </div>`;
}

function _cartao(titulo, icone, corpo, extra){
  return `<div class="anl-card">
    <div class="anl-card-hdr">
      <svg viewBox="0 0 24 24" fill="currentColor">${icone}</svg>
      <span>${titulo}</span>
      ${extra ? `<span class="anl-card-x">${extra}</span>` : ''}
    </div>
    ${corpo}
  </div>`;
}

function _barras(buckets){
  const max = Math.max(1, ...buckets.map(b => b.h));
  return `<div class="anl-bars">${buckets.map(b => `
    <div class="anl-bar-col" title="${b.label}: ${_horas(b.h)}">
      <div class="anl-bar-v">${b.h > 0 ? Math.round(b.h) : ''}</div>
      <div class="anl-bar-track"><div class="anl-bar-fill" style="height:${Math.max(2, (b.h/max)*100)}%"></div></div>
      <div class="anl-bar-l">${b.label}</div>
    </div>`).join('')}</div>`;
}

function _ranking(itens, unidade){
  if(!itens.length) return '<div class="anl-vazio">Sem dados no período.</div>';
  const max = Math.max(1, ...itens.map(i => i.v));
  return `<div class="anl-rank">${itens.map(i => `
    <div class="anl-rank-row">
      <div class="anl-rank-top">
        <span class="anl-rank-n">${i.nome}</span>
        <span class="anl-rank-v">${unidade === 'h' ? _horas(i.v) : _num(Math.round(i.v))}</span>
      </div>
      <div class="anl-rank-track"><div class="anl-rank-fill" style="width:${(i.v/max)*100}%"></div></div>
    </div>`).join('')}</div>`;
}

function _donut(partes){
  const total = partes.reduce((s,p) => s + p.v, 0);
  if(!total) return '<div class="anl-vazio">Sem registos no período.</div>';
  const R = 54, C = 2 * Math.PI * R;
  let acc = 0;
  const arcos = partes.filter(p => p.v > 0).map(p => {
    const frac = p.v / total;
    const seg = `<circle cx="64" cy="64" r="${R}" fill="none" stroke="${p.cor}" stroke-width="17"
      stroke-dasharray="${(frac*C).toFixed(2)} ${C.toFixed(2)}"
      stroke-dashoffset="${(-acc*C).toFixed(2)}" transform="rotate(-90 64 64)"/>`;
    acc += frac;
    return seg;
  }).join('');
  return `<div class="anl-donut-wrap">
    <svg class="anl-donut" viewBox="0 0 128 128">
      <circle cx="64" cy="64" r="${R}" fill="none" stroke="var(--gray-100)" stroke-width="17"/>
      ${arcos}
      <text x="64" y="60" text-anchor="middle" class="anl-donut-v">${_num(total)}</text>
      <text x="64" y="78" text-anchor="middle" class="anl-donut-l">registos</text>
    </svg>
    <div class="anl-legend">${partes.map(p => `
      <div class="anl-legend-i">
        <span class="anl-dot" style="background:${p.cor}"></span>
        <span class="anl-legend-n">${p.nome}</span>
        <span class="anl-legend-v">${_num(p.v)}</span>
      </div>`).join('')}</div>
  </div>`;
}

// ── Render principal ───────────────────────────────────────────────
export async function renderAnalise(){
  const body = document.getElementById('anl-body');
  if(!body || _loading) return;

  _preencherObras();
  document.querySelectorAll('#anl-chips .anl-chip').forEach(c => c.classList.toggle('active', c.dataset.p === _periodo));
  const sub = document.getElementById('anl-sub');
  if(sub) sub.textContent = _labelPeriodo() + (_obra ? ' · ' + _obraNome(_obra) : ' · todas as obras');

  _loading = true;
  body.innerHTML = '<div class="anl-loading"><div class="anl-spin"></div>A carregar dados…</div>';

  let d;
  try { d = await _carregar(); }
  catch(e){
    _loading = false;
    body.innerHTML = `<div class="anl-vazio">Não foi possível carregar os dados: ${e.message || e}</div>`;
    return;
  }
  _loading = false;

  let html = '';

  // ── Mão de obra (capítulo RH) ──────────────────────────────────
  if(_pode('rh')){
    let hN = 0, hE = 0, presencas = 0, faltas = 0, ferias = 0;
    const colabs = new Set(), porObra = {}, porDia = {}, porColab = {};
    d.ponto.forEach(r => {
      const tipo = r.tipo || 'Presença';
      if(tipo === 'Falta Injust.' || tipo === 'Falta Just.'){ faltas++; return; }
      if(tipo === 'Férias'){ ferias++; return; }
      const h = calcH((r.entrada||'').slice(0,5), (r.saida||'').slice(0,5), _parse(r.data));
      hN += h.n; hE += h.e;
      presencas++;
      colabs.add(r.colab_numero);
      porObra[r.obra_id]       = (porObra[r.obra_id]||0)       + h.t;
      porDia[r.data]           = (porDia[r.data]||0)           + h.t;
      porColab[r.colab_numero] = (porColab[r.colab_numero]||0) + h.t;
    });

    let hMoa = 0;
    d.moa.forEach(r => {
      const h = calcH((r.entrada||'').slice(0,5), (r.saida||'').slice(0,5), _parse(r.data));
      hMoa += h.t;
      porObra[r.obra_id] = (porObra[r.obra_id]||0) + h.t;
      porDia[r.data]     = (porDia[r.data]||0)     + h.t;
    });

    const extraTxt = hE > 0 ? fmtH(hE) + ' extra' : 'sem horas extra';
    html += `<div class="anl-kpis">
      ${_kpi(_horas(hN + hE), 'Horas Plandese', 'var(--blue-500)', extraTxt)}
      ${_kpi(_horas(hMoa), 'Horas aluguer', '#7c3aed', d.moa.length + ' registos')}
      ${_kpi(_num(colabs.size), 'Colaboradores', 'var(--green)', presencas + ' presenças')}
      ${_kpi(_num(faltas), 'Faltas', faltas > 0 ? 'var(--red)' : 'var(--gray-400)', ferias + ' de férias')}
    </div>`;

    html += _cartao('Horas por ' + (_periodo === 'semana' ? 'dia' : _periodo === 'mes' ? 'semana' : 'mês'),
      '<path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/>',
      _barras(_distribuirHoras(_buckets(), porDia)));

    const topObras = Object.entries(porObra).filter(([id]) => id && id !== 'null')
      .map(([id,v]) => ({ nome: _obraNome(id), v })).sort((a,b) => b.v - a.v).slice(0,6);
    html += _cartao('Horas por obra',
      '<path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10z"/>',
      _ranking(topObras, 'h'), topObras.length ? topObras.length + ' obras' : '');

    const topColabs = Object.entries(porColab)
      .map(([n,v]) => ({ nome: _colabNome(Number(n)), v })).sort((a,b) => b.v - a.v).slice(0,6);
    html += _cartao('Colaboradores com mais horas',
      '<path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>',
      _ranking(topColabs, 'h'));

    html += _cartao('Tipos de registo',
      '<path d="M11 2v20c-5.07-.5-9-4.79-9-10s3.93-9.5 9-10zm2.03 0v8.99H22c-.47-4.74-4.24-8.52-8.97-8.99zm0 11.01V22c4.74-.47 8.5-4.25 8.97-8.99h-8.97z"/>',
      _donut([
        { nome:'Presenças',    v: presencas,    cor:'var(--blue-500)' },
        { nome:'Faltas',       v: faltas,       cor:'var(--red)' },
        { nome:'Férias',       v: ferias,       cor:'var(--yellow)' },
        { nome:'M.O. Aluguer', v: d.moa.length, cor:'#7c3aed' },
      ]));
  }

  // ── Compras ────────────────────────────────────────────────────
  if(_pode('cmp')){
    const compras = _obra ? d.compras.filter(c => c.obra_id === _obra) : d.compras;
    const porEstado = {};
    compras.forEach(c => { const e = (c.estado||'pendente').toLowerCase(); porEstado[e] = (porEstado[e]||0)+1; });
    const pend = porEstado['pendente'] || 0;
    const urgentes = compras.filter(c => (c.urgencia||'').toLowerCase() === 'urgente').length;
    html += `<div class="anl-kpis">
      ${_kpi(_num(compras.length), 'Pedidos de compra', 'var(--gray-800)', 'no período')}
      ${_kpi(_num(pend), 'Pendentes', pend > 0 ? 'var(--orange)' : 'var(--gray-400)', urgentes + ' urgentes')}
    </div>`;
    const estados = Object.entries(porEstado)
      .map(([e,v]) => ({ nome: e.charAt(0).toUpperCase()+e.slice(1), v })).sort((a,b) => b.v - a.v);
    html += _cartao('Compras por estado',
      '<path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/>',
      _ranking(estados, 'n'));
  }

  // ── Faturas ────────────────────────────────────────────────────
  if(_pode('fin')){
    const total = d.faturas.reduce((s,f) => s + (parseFloat(f.total)||0), 0);
    const porForn = {};
    d.faturas.forEach(f => { const k = f.fornecedor || '—'; porForn[k] = (porForn[k]||0) + (parseFloat(f.total)||0); });
    const top = Object.entries(porForn).map(([nome,v]) => ({ nome, v })).sort((a,b) => b.v - a.v).slice(0,6);
    html += `<div class="anl-kpis">
      ${_kpi(_eur(total), 'Faturação', 'var(--gray-800)', d.faturas.length + ' faturas')}
      ${_kpi(_eur(d.faturas.length ? total/d.faturas.length : 0), 'Valor médio', 'var(--blue-500)', 'por fatura')}
    </div>`;
    html += _cartao('Fornecedores com maior valor',
      '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zM7 7h7v2H7V7zm10 12H7v-2h10v2zm0-4H7v-2h10v2zm-4-7V3.5L18.5 9H13z"/>',
      top.length ? `<div class="anl-rank">${top.map(t => `
        <div class="anl-rank-row">
          <div class="anl-rank-top"><span class="anl-rank-n">${t.nome}</span><span class="anl-rank-v">${_eur(t.v)}</span></div>
          <div class="anl-rank-track"><div class="anl-rank-fill" style="width:${(t.v/Math.max(1,top[0].v))*100}%"></div></div>
        </div>`).join('')}</div>` : '<div class="anl-vazio">Sem faturas no período.</div>');
  }

  // ── Combustível ────────────────────────────────────────────────
  if(_pode('log')){
    const isEnt = r => r.tipo_registo === 'deposito' && (r.movimento === 'entrada' || !r.movimento);
    const isSai = r => (r.tipo_registo === 'deposito' && r.movimento === 'saida') || r.tipo_registo === 'viatura';
    const litros = f => d.comb.filter(f).reduce((s,r) => s + (parseFloat(r.litros)||0), 0);
    const ent = litros(isEnt), sai = litros(isSai);
    html += `<div class="anl-kpis">
      ${_kpi(ent.toFixed(1)+'L', 'Entradas depósito', 'var(--green)', 'no período')}
      ${_kpi(sai.toFixed(1)+'L', 'Saídas / consumo', 'var(--orange)', d.comb.length + ' registos')}
    </div>`;
  }

  if(!html) html = '<div class="anl-vazio">Sem módulos de análise disponíveis para o seu perfil.</div>';
  if(d.erros.length) html += `<div class="anl-erro">Não foi possível carregar: ${d.erros.join(', ')}.</div>`;

  body.innerHTML = html;
}

function _preencherObras(){
  if(_obrasFeitas) return;
  const sel = document.getElementById('anl-obra');
  if(!sel || !S.OBRAS.length) return;
  sel.innerHTML = '<option value="">Todas as obras</option>' +
    S.OBRAS.filter(o => o.ativa).map(o => `<option value="${o.id}">${o.nome}</option>`).join('');
  sel.value = _obra;
  _obrasFeitas = true;
}

export function anlSetPeriodo(p){
  if(_periodo === p) return;
  _periodo = p;
  renderAnalise();
}

export function anlSetObra(v){
  _obra = v || '';
  renderAnalise();
}

// Repõe a lista de obras quando os dados são recarregados
export function anlResetObras(){ _obrasFeitas = false; }
