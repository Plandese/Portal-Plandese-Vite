// ═══════════════════════════════════════
//  ADMIN — Painel principal e Fecho de Mês
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S } from '../state.js';
import { fmt, fmtPT, getMonday, calcH, fmtH } from '../utils/helpers.js';
import { MESES_PT } from '../config.js';
import { showToast } from './navigation.js';
import { canAccessSection } from './permissions.js';

let _painelSeq = 0; // evita que uma resposta antiga sobrescreva uma mais recente

// ── Painel Principal — presenças e ausências da semana ────────────
const _DIAS_CURTO = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];

const _esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const _ymd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

// Segunda a domingo da semana corrente
function _painelSemana() {
  const mon = getMonday(new Date());
  mon.setHours(12,0,0,0);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d; });
}

// Registos da semana: vai buscar ao servidor (para apanhar o que outros
// encarregados lançaram entretanto) e recorre ao estado local se falhar.
async function _painelCarregarSemana(dias) {
  const ini = _ymd(dias[0]), fim = _ymd(dias[6]);
  const local = () => dias.flatMap(d => (S.REGISTOS[_ymd(d)] || []).map(r => ({ data: _ymd(d), colab: r.colabN, obra: r.obra || null, tipo: r.tipo || 'Presença' })));
  let registos, previstas = [];
  try {
    const { data, error } = await sb.from('registos_ponto').select('data,colab_numero,obra_id,tipo').gte('data', ini).lte('data', fim);
    if (error) throw error;
    registos = (data || []).map(r => ({ data: r.data, colab: r.colab_numero, obra: r.obra_id || null, tipo: r.tipo || 'Presença' }));
  } catch (e) { console.warn('painel (registos):', e); registos = local(); }
  try {
    const { data, error } = await sb.from('ferias_previstas').select('colab_numero,data').gte('data', ini).lte('data', fim);
    if (error) throw error;
    previstas = (data || []).map(r => ({ data: r.data, colab: r.colab_numero }));
  } catch (e) { console.warn('painel (férias previstas):', e); }
  return { registos, previstas };
}

function _painelPessoa(n) {
  const c = S.COLABORADORES.find(x => x.n === n);
  return { nome: c?.nome || `Colaborador ${n}`, func: c?.func || '' };
}

function _painelCardHtml(titulo, subtitulo, corIcon, bgIcon, iconPath, corpo) {
  return `<div class="card" style="padding:20px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <div style="width:36px;height:36px;border-radius:9px;background:${bgIcon};color:${corIcon};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px">${iconPath}</svg>
      </div>
      <div>
        <div style="font-size:14px;font-weight:600;color:var(--gray-800)">${titulo}</div>
        <div style="font-size:11px;color:var(--gray-400)">${subtitulo}</div>
      </div>
    </div>
    ${corpo}
  </div>`;
}

function _painelVazio(txt) {
  return `<div style="font-size:13px;color:var(--gray-400);padding:8px 0">${txt}</div>`;
}

function _painelHtmlAusentes(registos, previstas, dias) {
  // colab → { ferias, fInj, fJust, prev } (conjuntos de datas)
  const porColab = new Map();
  const get = (n) => { if (!porColab.has(n)) porColab.set(n, { ferias: new Set(), fInj: new Set(), fJust: new Set(), prev: new Set() }); return porColab.get(n); };
  registos.forEach(r => {
    if (r.tipo === 'Férias') get(r.colab).ferias.add(r.data);
    else if (r.tipo === 'Falta Just.') get(r.colab).fJust.add(r.data);
    else if (r.tipo.includes('Falta')) get(r.colab).fInj.add(r.data); // 'Falta Injust.' e registos antigos
  });
  // férias planeadas que ainda não têm registo no ponto
  previstas.forEach(p => {
    if (porColab.get(p.colab)?.ferias.has(p.data)) return;
    get(p.colab).prev.add(p.data);
  });
  if (!porColab.size) return _painelVazio('Ninguém de férias ou a faltar nesta semana.');

  const diasTxt = (set) => dias.map((d, i) => set.has(_ymd(d)) ? _DIAS_CURTO[i] : '').filter(Boolean).join(', ');
  const tag = (set, txt, cls) => set.size ? `<span class="badge ${cls}" style="font-size:10px;white-space:nowrap">${txt} · ${diasTxt(set)}</span>` : '';

  return [...porColab.entries()]
    .map(([n, t]) => ({ n, t, ...(_painelPessoa(n)) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'))
    .map(p => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--gray-100)">
      <div style="min-width:0">
        <div style="font-size:13px;color:var(--gray-800);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(p.nome)}</div>
        ${p.func ? `<div style="font-size:11px;color:var(--gray-400)">${_esc(p.func)}</div>` : ''}
      </div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">
        ${tag(p.t.ferias, 'Férias', 'b-blue')}${tag(p.t.prev, 'Férias previstas', 'b-blue')}${tag(p.t.fJust, 'Falta just.', 'b-orange')}${tag(p.t.fInj, 'Falta injust.', 'b-red')}
      </div>
    </div>`).join('');
}

async function renderPainel() {
  const grid = document.getElementById('painel-grid');
  if (!grid) return;

  // Saudação personalizada
  const titulo = document.getElementById('painel-titulo');
  if (titulo) {
    const h = new Date().getHours();
    const saudacao = h < 12 ? 'Bom dia' : h < 19 ? 'Boa tarde' : 'Boa noite';
    const nomePropio = S.currentUser?.nome?.split(' ')[0] || '';
    titulo.textContent = nomePropio ? `${saudacao}, ${nomePropio}` : 'Painel Principal';
  }

  const dias = _painelSemana();
  const semanaTxt = `${fmtPT(_ymd(dias[0]))} a ${fmtPT(_ymd(dias[6]))}`;
  const sub = document.getElementById('painel-sub');
  if (sub) sub.textContent = `Folhas de ponto · semana de ${semanaTxt}`;

  // Os dados vêm das folhas de ponto — só para quem tem acesso a essa secção
  if (!canAccessSection('historico')) { grid.innerHTML = ''; return; }

  const seq = ++_painelSeq;
  grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:var(--gray-400);font-size:14px">A carregar folhas de ponto…</div>';

  const { registos, previstas } = await _painelCarregarSemana(dias);
  if (seq !== _painelSeq) return;

  const iconAus = '<path d="M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V8h14v11z"/>';

  grid.innerHTML = _painelCardHtml('Férias e faltas', `Esta semana · ${semanaTxt}`, 'var(--orange)', 'var(--orange-bg)', iconAus, _painelHtmlAusentes(registos, previstas, dias));
}

async function renderFechoMes(){
  const sel = document.getElementById('fecho-mes-sel');
  if(!sel) return;
  const mesVal = parseInt(sel.value);
  const ano = 2026;

  // Período: 22 do mês anterior → 21 do mês atual
  // Usar hora 12:00 para evitar problemas de timezone (UTC vs UTC+1)
  const dataIni = new Date(ano, mesVal === 1 ? -1 : mesVal - 2, 22, 12, 0, 0);
  const dataFim = new Date(ano, mesVal - 1, 21, 12, 0, 0);

  // Formatar datas para string YYYY-MM-DD sem desvio de timezone
  const fmtLocal = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return y + '-' + m + '-' + day;
  };

  const dIniStr = fmtLocal(dataIni);
  const dFimStr = fmtLocal(dataFim);

  // Atualiza info do período
  const infoEl = document.getElementById('fecho-periodo-info');
  if(infoEl) infoEl.textContent = 'Período: ' + dIniStr.split('-').reverse().join('/') + ' a ' + dFimStr.split('-').reverse().join('/');

  const tbody = document.getElementById('fecho-tbody');
  if(tbody) tbody.innerHTML = '<tr><td colspan="10" style="padding:40px;text-align:center;color:var(--gray-500)">A carregar dados…</td></tr>';

  try {
    const {data: regs, error} = await sb.from('registos_ponto').select('*').gte('data', dIniStr).lte('data', dFimStr);
    if(error) throw new Error(error.message);

    // Construir mapa: data → colabNumero → registo
    const regMap = {};
    (regs||[]).forEach(r => {
      if(!regMap[r.data]) regMap[r.data] = {};
      regMap[r.data][String(r.colab_numero)] = r;
    });

    // Gerar lista de datas do período usando fmtLocal
    const datas = [];
    for(let d = new Date(dataIni); fmtLocal(d) <= dFimStr; d.setDate(d.getDate()+1)){
      datas.push(fmtLocal(new Date(d)));
    }

    // Calcular horas por colaborador
    const colabsAtivos = [...S.COLABORADORES].filter(c => c.ativo).sort((a,b) => a.n - b.n);
    const rows = [];

    for(const colab of colabsAtivos){
      const {n, nome, func} = colab;
      let totN = 0, totE = 0, dFer = 0, dFaltInj = 0, dFaltJust = 0;
      const obraHoras = {};

      for(const dk of datas){
        const r = (regMap[dk]||{})[String(n)];
        if(!r) continue;
        if(r.tipo === 'Folga') continue;
        if(r.tipo === 'Férias'){dFer++; continue;}
        if(r.tipo === 'Falta Injust.'){dFaltInj++; continue;}
        if(r.tipo === 'Falta Just.'){dFaltJust++; continue;}
        if(r.tipo && r.tipo.includes('Falta')){dFaltInj++; continue;} // compat. registos antigos
        const dateObj = new Date(dk + 'T12:00:00');
        const h = calcH(r.entrada ? r.entrada.slice(0,5) : '', r.saida ? r.saida.slice(0,5) : '', dateObj);
        totN += h.n;
        totE += h.e;
        const oId = r.obra_id || '_sem_obra';
        obraHoras[oId] = (obraHoras[oId]||0) + h.t;
      }

      const totT = totN + totE;
      if(totT === 0 && dFer === 0 && dFaltInj === 0 && dFaltJust === 0) continue;
      rows.push({n, nome, func, totN, totE, totT, obraHoras, dFer, dFaltInj, dFaltJust});
    }

    if(!tbody) return;

    if(rows.length === 0){
      tbody.innerHTML = '<tr><td colspan="10" style="padding:40px;text-align:center;color:var(--gray-400)">Sem registos para este período (' + dIniStr + ' a ' + dFimStr + '). Total de registos carregados: ' + (regs||[]).length + '</td></tr>';
      const totaisEl = document.getElementById('fecho-totais');
      if(totaisEl) totaisEl.style.display = 'none';
      return;
    }

    let globalN = 0, globalE = 0, globalT = 0;
    const htmlRows = rows.map((row, i) => {
      globalN += row.totN;
      globalE += row.totE;
      globalT += row.totT;

      const obraEntries = Object.entries(row.obraHoras).sort((a,b) => b[1]-a[1]);
      const obraBadges = obraEntries.map(([oId, horas]) => {
        const pct = row.totT > 0 ? Math.round((horas / row.totT) * 100) : 0;
        const obra = S.OBRAS.find(o => String(o.id) === String(oId));
        const oNome = obra ? (obra.nome || obra.numero || oId) : (oId === '_sem_obra' ? 'Sem obra' : oId);
        return '<span style="display:inline-flex;align-items:center;gap:4px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:2px 8px;font-size:11px;font-weight:600;color:#1d4ed8;white-space:nowrap;margin:2px 2px 2px 0">' + oNome + ' <span style="color:#6b7280">' + pct + '%</span></span>';
      }).join('');

      const bg = i % 2 === 0 ? '' : 'background:var(--gray-50)';
      return '<tr style="' + bg + '">'
        + '<td style="padding:10px 14px;color:var(--gray-500);font-family:monospace;font-size:12px">' + row.n + '</td>'
        + '<td style="padding:10px 14px;font-weight:600;color:var(--gray-900)">' + row.nome + '</td>'
        + '<td style="padding:10px 14px;color:var(--gray-600);font-size:12px">' + (row.func||'—') + '</td>'
        + '<td style="padding:10px 14px;text-align:right;font-family:monospace;color:var(--gray-700)">' + fmtH(row.totN) + '</td>'
        + '<td style="padding:10px 14px;text-align:right;font-family:monospace;color:#3b82f6">' + fmtH(row.totE) + '</td>'
        + '<td style="padding:10px 14px;text-align:right;font-family:monospace;font-weight:700;color:var(--green)">' + fmtH(row.totT) + '</td>'
        + '<td style="padding:10px 14px;text-align:center;font-family:monospace;color:#16a34a;font-weight:600">' + (row.dFer > 0 ? row.dFer + 'd' : '—') + '</td>'
        + '<td style="padding:10px 14px;text-align:center;font-family:monospace;color:#dc2626;font-weight:600">' + (row.dFaltInj > 0 ? row.dFaltInj + 'd' : '—') + '</td>'
        + '<td style="padding:10px 14px;text-align:center;font-family:monospace;color:#dc2626;font-weight:600">' + (row.dFaltJust > 0 ? row.dFaltJust + 'd' : '—') + '</td>'
        + '<td style="padding:10px 14px">' + (obraBadges || '<span style="color:var(--gray-300);font-size:12px">—</span>') + '</td>'
        + '</tr>';
    });
    tbody.innerHTML = htmlRows.join('');

    // Totais rodapé
    const totaisEl = document.getElementById('fecho-totais');
    if(totaisEl){
      totaisEl.style.display = '';
      document.getElementById('fecho-tot-n').textContent = fmtH(globalN);
      document.getElementById('fecho-tot-e').textContent = fmtH(globalE);
      document.getElementById('fecho-tot-t').textContent = fmtH(globalT);
      document.getElementById('fecho-tot-w').textContent = rows.length;
    }

    window._fechoMesData = {rows, mesVal, ano, dIniStr, dFimStr};

  } catch(err) {
    console.error('renderFechoMes error:', err);
    if(tbody) tbody.innerHTML = '<tr><td colspan="10" style="padding:32px;text-align:center;color:var(--red)">Erro: ' + err.message + '</td></tr>';
  }
}

async function exportFechoMes(){
  if(!window._fechoMesData || !window._fechoMesData.rows || !window._fechoMesData.rows.length){
    showToast('Carregue primeiro os dados clicando em Atualizar.');
    return;
  }
  const {rows, mesVal, dIniStr, dFimStr} = window._fechoMesData;
  const mesNome = MESES_PT[mesVal-1];

  showToast('A gerar ficheiro Excel\u2026');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Plandese SA';
  const ws = workbook.addWorksheet('Folha de Fecho');

  ws.columns = [
    {header:'N\u00ba', key:'n', width:6},
    {header:'Nome', key:'nome', width:28},
    {header:'Fun\u00e7\u00e3o', key:'func', width:18},
    {header:'H.Normais', key:'hn', width:12},
    {header:'H.Extra', key:'he', width:10},
    {header:'Total', key:'ht', width:10},
    {header:'F\u00e9rias', key:'fer', width:9},
    {header:'F.Injust.', key:'finj', width:10},
    {header:'F.Just.', key:'fjust', width:10},
    {header:'Distribui\u00e7\u00e3o por Obra', key:'obras', width:50},
  ];

  // Linha de título (inserida antes do cabeçalho)
  ws.spliceRows(1, 0, []);
  ws.mergeCells('A1:J1');
  const titleCell = ws.getCell('A1');
  titleCell.value = 'Folha de Fecho \u2014 ' + mesNome + ' 2026 (' + dIniStr + ' a ' + dFimStr + ')';
  titleCell.font = {bold:true, size:13, color:{argb:'FF002060'}};
  titleCell.alignment = {horizontal:'center', vertical:'middle'};
  titleCell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FFD9E1F2'}};
  ws.getRow(1).height = 22;

  // Cabeçalhos da tabela
  const hdr = ws.getRow(2);
  ['N\u00ba','Nome','Fun\u00e7\u00e3o','H. Normais','H. Extra','Total Horas','F\u00e9rias','F.Injust.','F.Just.','Distribui\u00e7\u00e3o por Obra'].forEach((v,i) => {
    const cell = hdr.getCell(i+1);
    cell.value = v;
    cell.font = {bold:true, color:{argb:'FFFFFFFF'}};
    cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FF002060'}};
    cell.alignment = {horizontal:'center', vertical:'middle'};
  });
  hdr.height = 18;

  // Linhas de dados
  rows.forEach((row, i) => {
    const obraEntries = Object.entries(row.obraHoras).sort((a,b) => b[1]-a[1]);
    const obraStr = obraEntries.map(([oId, h]) => {
      const pct = row.totT > 0 ? Math.round((h/row.totT)*100) : 0;
      const obra = S.OBRAS.find(o => o.id === oId);
      const oNome = obra ? (obra.nome||obra.numero||oId) : (oId === '_sem_obra' ? 'Sem obra' : oId);
      return oNome + ': ' + pct + '%';
    }).join(' | ');

    const dataRow = ws.getRow(i+3);
    dataRow.values = [row.n, row.nome, row.func||'', fmtH(row.totN), fmtH(row.totE), fmtH(row.totT), row.dFer||0, row.dFaltInj||0, row.dFaltJust||0, obraStr];
    dataRow.eachCell(cell => {
      cell.alignment = {vertical:'middle', wrapText:true};
      if(i%2===1) cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FFF2F6FF'}};
    });
    dataRow.height = 16;
  });

  // Linha de totais
  const totRow = ws.getRow(rows.length+3);
  const globalN = rows.reduce((s,r) => s+r.totN, 0);
  const globalE = rows.reduce((s,r) => s+r.totE, 0);
  const globalT = rows.reduce((s,r) => s+r.totT, 0);
  const globalFer = rows.reduce((s,r) => s+(r.dFer||0), 0);
  const globalFaltInj = rows.reduce((s,r) => s+(r.dFaltInj||0), 0);
  const globalFaltJust = rows.reduce((s,r) => s+(r.dFaltJust||0), 0);
  totRow.values = ['', 'TOTAL (' + rows.length + ' trabalhadores)', '', fmtH(globalN), fmtH(globalE), fmtH(globalT), globalFer||'', globalFaltInj||'', globalFaltJust||'', ''];
  totRow.eachCell(cell => {
    cell.font = {bold:true, color:{argb:'FF002060'}};
    cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FFD9E1F2'}};
    cell.alignment = {vertical:'middle', horizontal:'center'};
  });
  totRow.height = 18;

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Folha_Fecho_' + mesNome + '_2026.xlsx';
  a.click();
  URL.revokeObjectURL(url);
  showToast('\u2713 Ficheiro exportado!');
}

export {
  renderPainel,
  renderFechoMes, exportFechoMes
};
