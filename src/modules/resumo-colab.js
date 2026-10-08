// ═══════════════════════════════════════
//  RESUMO MENSAL POR COLABORADOR (MO Plandese e MO Aluguer)
//  Aberto ao clicar no nome nas folhas de ponto semanais.
//  O "mês" segue o ciclo de fecho da empresa: dia 22 → dia 21.
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S } from '../state.js';
import { fmtPT, isWeekend, isNonWorkday, calcH, fmtH } from '../utils/helpers.js';
import { MESES_PT } from '../config.js';

let _res = null; // {kind, ref, colabN | trab, nome, sub}

const _iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const _DIA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Ciclo 22→21 que contém a data. Nomeado pelo mês em que termina (igual ao exportMensal).
function _ciclo(ref) {
  const d = new Date(ref);
  const fimMes = d.getDate() >= 22 ? d.getMonth() + 1 : d.getMonth();
  const ini = new Date(d.getFullYear(), fimMes - 1, 22, 12);
  const fim = new Date(d.getFullYear(), fimMes, 21, 12);
  return { ini, fim, label: `${MESES_PT[fim.getMonth()]} ${fim.getFullYear()}` };
}

function _overlay() {
  let ov = document.getElementById('resumo-colab-ov');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'resumo-colab-ov';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;padding:16px';
    ov.onclick = (e) => { if (e.target === ov) fecharResumo(); };
    document.body.appendChild(ov);
  }
  return ov;
}

export function fecharResumo() {
  document.getElementById('resumo-colab-ov')?.remove();
  _res = null;
}

export function resumoNav(delta) {
  if (!_res) return;
  const r = new Date(_res.ref);
  r.setMonth(r.getMonth() + delta);
  _res.ref = r;
  _desenhar();
}

// MO Plandese: colaborador pelo nº
export function abrirResumoPonto(colabN, refDateStr) {
  const c = S.COLABORADORES.find(x => x.n === colabN);
  _res = { kind: 'ponto', ref: new Date(refDateStr + 'T12:00:00'), colabN, nome: c?.nome || ('Nº ' + colabN), sub: [c ? 'Nº ' + c.n : '', c?.func].filter(Boolean).join(' · ') };
  _desenhar();
}

// MO Aluguer: trabalhador {colabId, empresaId, nome, funcao, empresa}
export function abrirResumoMOA(trab, refDateStr) {
  _res = { kind: 'moa', ref: new Date(refDateStr + 'T12:00:00'), trab, nome: trab.nome, sub: [trab.funcao, trab.empresa].filter(Boolean).join(' · ') };
  _desenhar();
}

async function _carregar(ini, fim) {
  if (_res.kind === 'ponto') {
    const { data, error } = await sb.from('registos_ponto').select('*')
      .eq('colab_numero', _res.colabN).gte('data', ini).lte('data', fim).order('data');
    if (error) throw error;
    return data || [];
  }
  const t = _res.trab;
  let q = sb.from('registos_ponto_moa').select('*').gte('data', ini).lte('data', fim).order('data');
  if (t.colabId) q = q.eq('colab_moa_id', t.colabId);
  else {
    q = q.is('colab_moa_id', null).eq('trabalhador_nome', t.nome);
    if (t.empresaId) q = q.eq('empresa_moa_id', t.empresaId);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function _desenhar() {
  if (!_res) return;
  const cur = _res;
  const { ini, fim, label } = _ciclo(cur.ref);
  const ov = _overlay();
  const head = `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px">
      <div style="min-width:0"><div style="font-size:16px;font-weight:700;color:var(--gray-900)">${cur.nome}</div>
      <div style="font-size:12px;color:var(--gray-500);margin-top:2px">${cur.sub || ''}</div></div>
      <button onclick="fecharResumo()" style="border:none;background:none;font-size:22px;line-height:1;cursor:pointer;color:var(--gray-400)" title="Fechar">×</button></div>
    <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:14px">
      <button class="btn btn-secondary btn-sm" onclick="resumoNav(-1)">‹</button>
      <div style="text-align:center"><div style="font-size:14px;font-weight:700;color:var(--gray-800)">${label}</div>
      <div style="font-size:11px;color:var(--gray-500)">${fmtPT(_iso(ini))} a ${fmtPT(_iso(fim))}</div></div>
      <button class="btn btn-secondary btn-sm" onclick="resumoNav(1)">›</button></div>`;
  const shell = (body) => {
    ov.innerHTML = `<div class="card" style="width:100%;max-width:560px;max-height:90vh;overflow-y:auto;padding:18px">${head}${body}</div>`;
  };
  shell('<div class="pl-load"><span class="pl-logo"></span>A carregar…</div>');

  let rows;
  try { rows = await _carregar(_iso(ini), _iso(fim)); }
  catch (e) {
    if (_res !== cur) return;
    shell(`<div style="text-align:center;color:var(--red);padding:24px;font-size:13px">⚠️ Erro ao carregar: ${e.message || e}</div>`);
    return;
  }
  if (_res !== cur || _iso(_ciclo(cur.ref).ini) !== _iso(ini)) return; // navegou entretanto

  // Agregar por dia (vários registos no mesmo dia somam horas)
  const dias = {};
  rows.forEach(r => {
    const d = dias[r.data] || (dias[r.data] = { data: r.data, n: 0, e: 0, t: 0, tipos: new Set(), obras: new Set(), horas: [] });
    const h = calcH(r.entrada?.slice(0, 5), r.saida?.slice(0, 5), new Date(r.data + 'T12:00:00'));
    d.n += h.n; d.e += h.e; d.t += h.t;
    if (r.tipo) d.tipos.add(r.tipo);
    d.obras.add(r.obra_id || '_sem');
    if (r.entrada && r.saida) d.horas.push(`${r.entrada.slice(0, 5)}–${r.saida.slice(0, 5)}`);
  });
  const lista = Object.values(dias).sort((a, b) => a.data.localeCompare(b.data));
  const tipoDia = (d) => {
    if (d.t > 0) return 'trab';
    if (d.tipos.has('Falta Injust.')) return 'fi';
    if (d.tipos.has('Falta Just.')) return 'fj';
    if (d.tipos.has('Férias')) return 'fer';
    if (d.tipos.has('Folga')) return 'fol';
    if (d.tipos.size && [...d.tipos].every(t => t === 'Anulado')) return 'anul';
    return 'outro';
  };
  const cnt = { trab: 0, fi: 0, fj: 0, fer: 0, fol: 0 };
  let tn = 0, te = 0, tt = 0, fds = 0;
  const porObra = {};
  lista.forEach(d => {
    const k = tipoDia(d); if (cnt[k] != null) cnt[k]++;
    tn += d.n; te += d.e; tt += d.t;
    if (d.t > 0 && isNonWorkday(new Date(d.data + 'T12:00:00'))) fds++;
    const oid = [...d.obras][0];
    if (d.t > 0) { const o = porObra[oid] || (porObra[oid] = { dias: 0, t: 0 }); o.dias++; o.t += d.t; }
  });

  if (!lista.length) { shell('<div style="text-align:center;color:var(--gray-400);padding:28px;font-size:13px">Sem registos neste período.</div>'); return; }

  const kpi = (v, l, c) => `<div style="flex:1 1 90px;background:var(--gray-50);border-radius:10px;padding:10px 8px;text-align:center">
      <div style="font-family:'DM Mono',monospace;font-size:17px;font-weight:700;color:${c || 'var(--gray-900)'}">${v}</div>
      <div style="font-size:10px;color:var(--gray-500);margin-top:2px">${l}</div></div>`;
  let body = `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px">
      ${kpi(fmtH(tt) === '—' ? '0h' : fmtH(tt), 'Horas totais', 'var(--blue-600)')}
      ${kpi(fmtH(tn) === '—' ? '0h' : fmtH(tn), 'H. normais', 'var(--green)')}
      ${kpi(fmtH(te) === '—' ? '0h' : fmtH(te), 'H. extra', 'var(--orange)')}
      ${kpi(cnt.trab, 'Dias trabalhados')}</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">
      ${kpi(cnt.fi, 'Faltas injust.', cnt.fi ? 'var(--red)' : '')}
      ${kpi(cnt.fj, 'Faltas just.')}
      ${kpi(cnt.fer, 'Férias')}
      ${_res.kind === 'ponto' ? kpi(cnt.fol, 'Folgas') : ''}
      ${kpi(fds, 'Fins de semana')}</div>`;

  const obraIds = Object.keys(porObra);
  if (obraIds.length) {
    body += `<div style="font-size:12px;font-weight:700;color:var(--gray-700);margin-bottom:6px">Por obra</div>
      <div style="margin-bottom:14px">${obraIds.sort().map(id => {
        const nome = S.OBRAS.find(o => o.id === id)?.nome || '(sem obra)';
        return `<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--gray-100);font-size:12px"><span>${nome}</span><span style="font-family:'DM Mono',monospace;font-weight:600">${porObra[id].dias} d · ${fmtH(porObra[id].t)}</span></div>`;
      }).join('')}</div>`;
  }

  body += `<div style="font-size:12px;font-weight:700;color:var(--gray-700);margin-bottom:6px">Dia a dia</div>
    <div style="border:1px solid var(--gray-100);border-radius:8px;overflow:hidden">${lista.map((d, i) => {
      const dt = new Date(d.data + 'T12:00:00');
      const k = tipoDia(d);
      const badge = { fi: '<span class="badge b-red" style="font-size:10px">Falta Injust.</span>', fj: '<span class="badge b-red" style="font-size:10px">Falta Just.</span>',
        fer: '<span class="badge b-blue" style="font-size:10px">Férias</span>', fol: '<span class="badge b-yellow" style="font-size:10px">Folga</span>',
        anul: '<span class="badge b-gray" style="font-size:10px;text-decoration:line-through">Anulado</span>', outro: '<span style="color:var(--gray-300)">—</span>' }[k];
      const obra = [...d.obras].map(id => S.OBRAS.find(o => o.id === id)?.nome || '').filter(Boolean).join(', ');
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 10px;font-size:12px;${i ? 'border-top:1px solid var(--gray-100);' : ''}${isNonWorkday(dt) ? 'background:#fff7ed' : ''}">
        <div style="min-width:0"><span style="font-weight:600">${_DIA[dt.getDay()]} ${fmtPT(d.data).slice(0, 5)}</span>
          <span style="color:var(--gray-500);margin-left:6px">${d.horas.join(' · ')}</span>
          ${obra ? `<div style="font-size:10.5px;color:var(--gray-400);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${obra}</div>` : ''}</div>
        <div style="flex-shrink:0;text-align:right">${k === 'trab' ? `<span style="font-family:'DM Mono',monospace;font-weight:700;color:var(--blue-600)">${fmtH(d.t)}</span>${d.e > 0 ? `<span style="font-size:10px;color:var(--orange);margin-left:5px">+${fmtH(d.e)}</span>` : ''}` : badge}</div></div>`;
    }).join('')}</div>`;
  shell(body);
}
