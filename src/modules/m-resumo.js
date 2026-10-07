// ═══════════════════════════════════════
//  M-RESUMO — resumos informativos de obra e de pessoa (pesquisa da app de telemóvel)
//  Só constrói o HTML; a folha inferior é aberta pelo m-shell.
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S } from '../state.js';
import { fmtPT, calcH, fmtH } from '../utils/helpers.js';
import { MESES_PT } from '../config.js';
import { resumoObraSemana } from './admin.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const corPct = p => (p == null ? '#8a92a2' : p >= 85 ? 'var(--green)' : p >= 65 ? 'var(--orange)' : 'var(--red)');
const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];

// código da célula → [texto, classe, descrição]
const CEL = {
  P: ['✓', 'eo-c-ok', 'Presença'], F: ['F', 'eo-c-fer', 'Férias'], J: ['FJ', 'eo-c-fj', 'Falta justificada'],
  I: ['FI', 'eo-c-fi', 'Falta injustificada'], V: ['P', 'eo-c-prev', 'Férias previstas'], '-': ['·', 'eo-c-nd', 'Sem registo'],
};
const celula = k => `<i class="eo-c ${CEL[k][1]}" title="${CEL[k][2]}">${CEL[k][0]}</i>`;
const nomeColab = n => (S.COLABORADORES || []).find(c => c.n === n)?.nome || ('Nº ' + n);
const EQ_TXT = { operacional: 'Operacional', manutencao: 'Manutenção', oficina: 'Em oficina', parada: 'Parada' };

const kpi = (v, l, cor, js) => `<div class="m-kpi${js ? ' m-kpi-go' : ''}"${js ? ` onclick="${js}"` : ''}><b${cor ? ` style="color:${cor}"` : ''}>${v}</b><small>${l}</small></div>`;
const acao = (txt, js) => `<div class="m-row" onclick="${js}"><span class="m-row-tx"><b>${txt}</b></span><span class="m-row-chev">›</span></div>`;

// ── Obra ──────────────────────────────────────────────────────────────────────
export async function resumoObraHtml(obra, cod, nome) {
  let r;
  try { r = await resumoObraSemana(obra.id); } catch (e) { console.warn('resumo obra:', e); r = null; }
  const acoes = `<div class="m-sum-acts">${r && !r.vazio ? acao('Ver detalhe da semana', `mSheetClose();abrirEstadoObra('${esc(obra.id)}')`) : ''}${acao('Abrir em Controlo de Obras', `mSheetClose();mAbrirObraModulo('${esc(obra.id)}')`)}</div>`;
  const info = `<div class="m-sum-meta">${[cod, obra.local, obra.cliente].filter(Boolean).map(esc).join(' · ')}</div>`;
  if (!r) return { titulo: nome, corpo: info + '<div class="m-res-empty">Não foi possível carregar o resumo desta obra.</div>' + acoes };
  if (r.vazio) return { titulo: nome, corpo: info + `<div class="m-res-empty">Sem equipa nem equipamentos registados esta semana (${r.semanaTxt}).</div>` + acoes };

  let h = info + `<div class="m-grp">Semana de ${esc(r.semanaTxt)}</div><div class="m-kpis">`;
  if (r.podeMO) h += kpi(r.equipa.size, 'Pessoas', '', "mResumoLista('pessoas')") + kpi(r.mo == null ? '—' : r.mo + '%', 'Disponibilidade MO', corPct(r.mo), "mResumoLista('pessoas')");
  if (r.podeEQ) h += kpi(r.equips.length, 'Equipamentos', '', "mResumoLista('equip')") + kpi(r.eq == null ? '—' : r.eq + '%', 'Operacionais', corPct(r.eq), "mResumoLista('equip')");
  h += '</div>';

  if (r.podeMO && r.equipa.size) {
    const aus = [...r.equipa.entries()].filter(([, c]) => c.some(x => 'FJIV'.includes(x)));
    h += `<div class="m-grp">Férias e faltas</div>`;
    h += aus.length
      ? aus.map(([n, c]) => `<div class="m-sum-li"><span>${esc(nomeColab(n))}</span><span class="m-sum-cels">${c.map(celula).join('')}</span></div>`).join('')
        + `<div class="m-sum-dias">${DIAS.map(d => `<span>${d}</span>`).join('')}</div>`
      : '<div class="m-sum-ok">Toda a equipa disponível esta semana.</div>';
  }
  if (r.podeEQ && r.equips.length) {
    const nao = r.equips.filter(e => e.estado && e.estado !== 'operacional');
    h += `<div class="m-grp">Equipamentos</div>`;
    h += nao.length
      ? nao.map(e => `<div class="m-sum-li"><span>${esc(e.nome)}${e.codigo ? ` <small>${esc(e.codigo)}</small>` : ''}</span><span class="m-sum-tag">${esc(EQ_TXT[e.estado] || e.estado)}</span></div>`).join('')
      : '<div class="m-sum-ok">Todos os equipamentos operacionais.</div>';
    const pend = r.equips.reduce((s, e) => s + (e.pend || []).length, 0);
    if (pend) h += `<div class="m-sum-li"><span>Pedidos de manutenção pendentes</span><b>${pend}</b></div>`;
  }
  return { titulo: nome, corpo: h + acoes, r };
}

// Listas completas (ao tocar nos números do resumo)
export function listaObraHtml(r, tipo) {
  if (tipo === 'pessoas') {
    const l = [...r.equipa.entries()].map(([n, cel]) => ({ n, cel, c: (S.COLABORADORES || []).find(x => x.n === n) }))
      .sort((a, b) => nomeColab(a.n).localeCompare(nomeColab(b.n), 'pt'));
    if (!l.length) return '<div class="m-res-empty">Sem equipa registada nesta obra.</div>';
    return `<div class="m-sum-sub">${l.length} pessoas · semana de ${esc(r.semanaTxt)}</div>`
      + l.map(p => `<div class="m-sum-li m-sum-p" onclick="mSheetClose();mAbrirPessoa(${p.n})"><span><b>${esc(nomeColab(p.n))}</b><small>${esc(p.c?.func || '')}</small></span><span class="m-sum-cels">${p.cel.map(celula).join('')}</span></div>`).join('')
      + `<div class="m-sum-dias">${DIAS.map(d => `<span>${d}</span>`).join('')}</div>`;
  }
  const l = [...r.equips].sort((a, b) => ((b.estado !== 'operacional') - (a.estado !== 'operacional')) || a.nome.localeCompare(b.nome, 'pt'));
  if (!l.length) return '<div class="m-res-empty">Sem equipamentos nesta obra.</div>';
  return `<div class="m-sum-sub">${l.length} equipamentos · ${r.equips.length - r.eqNaoOp} operacionais</div>`
    + l.map(e => {
      const ok = !e.estado || e.estado === 'operacional';
      return `<div class="m-sum-li"><span><b>${esc(e.nome)}</b><small>${esc([e.codigo, e.matricula].filter(Boolean).join(' · '))}</small></span><span class="m-sum-tag${ok ? ' ok' : ''}">${esc(EQ_TXT[e.estado] || 'Operacional')}</span></div>`;
    }).join('');
}

// ── Pessoa ────────────────────────────────────────────────────────────────────
function ciclo(ref) {
  const fimMes = ref.getDate() >= 22 ? ref.getMonth() + 1 : ref.getMonth();
  const ini = new Date(ref.getFullYear(), fimMes - 1, 22, 12), fim = new Date(ref.getFullYear(), fimMes, 21, 12);
  return { ini, fim, label: `${MESES_PT[fim.getMonth()]} ${fim.getFullYear()}` };
}
const tipoDia = d => {
  if (d.t > 0) return 'P';
  if (d.tipos.has('Falta Injust.')) return 'I';
  if (d.tipos.has('Falta Just.')) return 'J';
  if (d.tipos.has('Férias')) return 'F';
  return d.tipos.size ? 'P' : '-';
};

export async function resumoPessoaHtml(n) {
  const c = (S.COLABORADORES || []).find(x => x.n === n);
  const titulo = c?.nome || ('Nº ' + n);
  const sub = [c ? 'Nº ' + c.n : '', c?.func, c && c.ativo === false ? 'Inativo' : ''].filter(Boolean).map(esc).join(' · ');
  const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
  const seg = new Date(hoje); seg.setDate(hoje.getDate() - ((hoje.getDay() + 6) % 7));
  const sex = new Date(seg); sex.setDate(seg.getDate() + 4);
  const { ini, fim, label } = ciclo(hoje);
  const de = iso(new Date(Math.min(ini, seg))), ate = iso(new Date(Math.max(fim, sex)));
  let rows;
  try {
    const { data, error } = await sb.from('registos_ponto').select('data,entrada,saida,tipo,obra_id').eq('colab_numero', n).gte('data', de).lte('data', ate).order('data');
    if (error) throw error;
    rows = data || [];
  } catch (e) {
    console.warn('resumo pessoa:', e);
    return { titulo, corpo: `<div class="m-sum-meta">${sub}</div><div class="m-res-empty">Não foi possível carregar os registos.</div>` };
  }
  const dias = {};
  rows.forEach(r => {
    const d = dias[r.data] || (dias[r.data] = { n: 0, e: 0, t: 0, tipos: new Set() });
    const h = calcH(r.entrada?.slice(0, 5), r.saida?.slice(0, 5), new Date(r.data + 'T12:00:00'));
    d.n += h.n; d.e += h.e; d.t += h.t;
    if (r.tipo) d.tipos.add(r.tipo);
  });
  const semana = DIAS.map((_, i) => { const d = new Date(seg); d.setDate(seg.getDate() + i); const x = dias[iso(d)]; return x ? tipoDia(x) : '-'; });
  const cnt = { P: 0, F: 0, J: 0, I: 0 };
  let tt = 0, te = 0;
  Object.entries(dias).forEach(([data, d]) => {
    if (data < iso(ini) || data > iso(fim)) return;
    const k = tipoDia(d); if (cnt[k] != null) cnt[k]++;
    tt += d.t; te += d.e;
  });
  const ult = [...rows].reverse().find(r => r.obra_id);
  const obra = ult ? (S.OBRAS || []).find(o => o.id === ult.obra_id) : null;

  let h = `<div class="m-sum-meta">${sub}</div>`;
  if (obra) h += `<div class="m-sum-li"><span>Última obra</span><b>${esc(obra.nome)}</b></div>`;
  h += `<div class="m-grp">Esta semana</div><div class="m-sum-week">${semana.map((k, i) => `<div><small>${DIAS[i]}</small>${celula(k)}</div>`).join('')}</div>`;
  h += `<div class="m-grp">${esc(label)} <span class="m-sum-per">${fmtPT(iso(ini))} a ${fmtPT(iso(fim))}</span></div><div class="m-kpis">`
    + kpi(cnt.P, 'Dias trabalhados') + kpi(fmtH(tt), 'Horas') + kpi(fmtH(te), 'Horas extra')
    + kpi(cnt.F, 'Dias de férias') + kpi(cnt.J + cnt.I, 'Faltas') + '</div>';
  h += `<div class="m-sum-acts">${acao('Ver resumo mensal completo', `mSheetClose();mResumoCompleto(${n})`)}</div>`;
  return { titulo, corpo: h };
}
