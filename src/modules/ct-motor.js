// ═══════════════════════════════════════════════════════════════════
//  COMPRAS (TESTE) — motor de sincronização: guia/fatura ↔ nota de encomenda, e conferência
//  Funções puras (sem acesso a base de dados nem ao ecrã) para se poderem testar à parte.
// ═══════════════════════════════════════════════════════════════════
export const TOLERANCIA = 0.02;          // 2 % nas quantidades e nos preços
export const LIMIAR_AUTO = 75;           // a partir daqui liga sozinho (se houver margem sobre a 2.ª candidata)
export const LIMIAR_SUGESTAO = 40;       // entre isto e o automático fica «sugerida» para confirmar

export const semAc = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STOP = new Set(['de', 'do', 'da', 'dos', 'das', 'para', 'com', 'em', 'e', 'a', 'o', 'un', 'und', 'unidade', 'tipo', 'ref']);
export const tokens = t => semAc(t).replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(x => x.length > 1 && !STOP.has(x));
export const normNum = v => semAc(v).replace(/[^a-z0-9]/g, '');
const digitos = v => String(v ?? '').replace(/\D/g, '').slice(-9);
const dias = (a, b) => Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 864e5);

// Semelhança entre duas descrições de artigo (0 a 1). Medidas diferentes (Ø125 vs Ø90) penalizam.
export function similar(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let i = 0; A.forEach(x => { if (B.has(x)) i++; });
  let s = (i / (A.size + B.size - i) + i / Math.min(A.size, B.size)) / 2;
  const nA = [...A].filter(x => /\d/.test(x)), nB = [...B].filter(x => /\d/.test(x));
  if (nA.length && nB.length && !nA.some(x => nB.includes(x))) s *= 0.5;
  return s;
}

// A que linha da encomenda corresponde cada linha do documento (-1 = nenhuma)
export function atribuir(docLinhas, neLinhas, limiar = 0.5) {
  return (docLinhas || []).map(l => {
    let melhor = -1, ms = 0;
    (neLinhas || []).forEach((n, i) => {
      let s = similar(l.desc, n.desc);
      if (l.ref_forn && n.ref_forn && normNum(l.ref_forn) === normNum(n.ref_forn)) s = Math.max(s, 0.95);
      if (s > ms) { ms = s; melhor = i; }
    });
    return ms >= limiar ? melhor : -1;
  });
}

// 1 = o mesmo fornecedor; 0 = claramente outro; 0.3 = não se sabe
export function mesmoForn(a, b) {
  const na = digitos(a.nif), nb = digitos(b.nif);
  const fa = tokens(a.fornecedor), fb = tokens(b.fornecedor);
  const mesmaPalavra = fa.length && fb.length && fa[0] === fb[0];
  if (na.length === 9 && nb.length === 9) return na === nb ? 1 : (mesmaPalavra ? 0.5 : 0);
  if (!fa.length || !fb.length) return 0.3;
  if (mesmaPalavra) return 0.9;
  const A = new Set(fa), B = new Set(fb); let i = 0; A.forEach(x => { if (B.has(x)) i++; });
  return i / (A.size + B.size - i) >= 0.5 ? 0.7 : 0;
}

// Quantidade já recebida/faturada por linha da encomenda, a partir dos documentos ligados
function somaPorLinha(ne, docs, campo) {
  const q = (ne.linhas || []).map(() => 0);
  (docs || []).forEach(d => atribuir(d.linhas, ne.linhas).forEach((i, j) => { if (i >= 0) q[i] += Number(d.linhas[j].qtd) || 0; }));
  return campo ? q : q;
}

const ligados = (docs, neId, ignorar) => (docs || []).filter(d => d.encomenda_id === neId && d.id !== ignorar && (d.estado === 'casada' || d.estado === 'divergente'));

// ── Pontuação guia → encomenda ──
export function scoreGuia(g, ne, guiasDaNE) {
  const f = mesmoForn(g, ne);
  if (f === 0) return { score: 0, motivo: 'Fornecedor diferente' };
  const m = [];
  let s = 30 * f; if (f >= 0.9) m.push('fornecedor');
  if (g.obra_id && ne.obra_id) {
    if (g.obra_id !== ne.obra_id) return { score: 0, motivo: 'Obra diferente' };
    s += 20; m.push('obra');
  } else s += 8;
  const nd = String(ne.emitida_em || '').slice(0, 10);
  if (g.data && nd) {
    const d = dias(g.data, nd);
    if (d >= -1) { s += d <= 120 ? 10 : 3; m.push('data'); } else { s -= 10; m.push('guia anterior à encomenda'); }
  } else s += 4;
  const ass = atribuir(g.linhas, ne.linhas);
  const n = (g.linhas || []).length, ok = ass.filter(i => i >= 0).length, frac = n ? ok / n : 0;
  s += 30 * frac;
  if (ok) m.push(`${ok}/${n} artigos`);
  if (n && !ok) s = Math.min(s, 40);
  if (ok) {
    const rec = somaPorLinha(ne, guiasDaNE);
    const novo = (ne.linhas || []).map(() => 0);
    ass.forEach((i, j) => { if (i >= 0) novo[i] += Number(g.linhas[j].qtd) || 0; });
    const cabe = novo.every((q, i) => !q || q + rec[i] <= (Number(ne.linhas[i].qtd) || 0) * (1 + TOLERANCIA));
    if (cabe) { s += 10; m.push('cabe no saldo'); } else m.push('excede o saldo');
  }
  return { score: Math.max(0, Math.round(Math.min(100, s))), motivo: m.join(' · '), frac };
}

// ── Pontuação fatura → encomenda ──
export function scoreFatura(fa, ne, guiasDaNE) {
  const f = mesmoForn(fa, ne);
  if (f === 0) return { score: 0, motivo: 'Fornecedor diferente' };
  const m = [];
  let s = 25 * f; if (f >= 0.9) m.push('fornecedor');
  const cc = semAc(fa.centro_custo), on = semAc(ne.obra_nome), cod = (on.match(/o\d{2,3}/) || [])[0];
  if (cc && on) {
    if (cc === on || (cod && cc.includes(cod))) { s += 10; m.push('obra'); } else return { score: 0, motivo: 'Obra diferente' };
  } else s += 4;
  const refs = (fa.guias_ref || []).map(normNum).filter(Boolean);
  const citadas = (guiasDaNE || []).filter(g => g.numero_norm && refs.some(r => r === g.numero_norm || (r.length >= 5 && g.numero_norm.length >= 5 && (r.endsWith(g.numero_norm) || g.numero_norm.endsWith(r)))));
  if (citadas.length) { s += 30; m.push(`cita ${citadas.length} guia${citadas.length > 1 ? 's' : ''} da encomenda`); }
  const ass = atribuir(fa.linhas, ne.linhas);
  const n = (fa.linhas || []).length, ok = ass.filter(i => i >= 0).length, frac = n ? ok / n : 0;
  s += 30 * frac; if (ok) m.push(`${ok}/${n} artigos`);
  if (n && !ok && !citadas.length) s = Math.min(s, 40);
  if (ok) {
    const rec = somaPorLinha(ne, guiasDaNE);
    const fat = (ne.linhas || []).map(() => 0);
    ass.forEach((i, j) => { if (i >= 0) fat[i] += Number(fa.linhas[j].qtd) || 0; });
    if (fat.every((q, i) => !q || q <= Math.max(rec[i], 0) * (1 + TOLERANCIA) || !(guiasDaNE || []).length)) { s += 5; m.push('quantidades coerentes'); }
  }
  return { score: Math.max(0, Math.round(Math.min(100, s))), motivo: m.join(' · '), frac };
}

// Escolhe a melhor encomenda: liga sozinho, sugere ou deixa por ligar
export function decidir(cands) {
  const o = [...cands].filter(c => c.score > 0).sort((a, b) => b.score - a.score);
  const [a, b] = o;
  if (!a || a.score < LIMIAR_SUGESTAO) return { estado: 'por_casar', neId: null, score: a?.score ?? null, motivo: a ? `Melhor candidata com ${a.score} %: ${a.motivo}` : 'Nenhuma encomenda compatível' };
  const margem = a.score - (b ? b.score : 0);
  if (a.score >= LIMIAR_AUTO && margem >= 10) return { estado: 'casada', neId: a.neId, score: a.score, motivo: a.motivo };
  return { estado: 'sugerida', neId: a.neId, score: a.score, motivo: (b && margem < 10 ? `Há outra encomenda parecida (${b.score} %). ` : '') + a.motivo };
}

// ── Conferência de uma encomenda: encomendado × recebido × faturado ──
export function conferir(ne, guias, faturas) {
  const gs = ligados(guias, ne.id), fs = ligados(faturas, ne.id);
  const nl = ne.linhas || [];
  const linhas = nl.map(l => ({ desc: l.desc, un: l.un, qtd: Number(l.qtd) || 0, pu: Number(l.pu) || 0, rec: 0, fat: 0, fatValor: 0, flags: [] }));
  const docFlags = {};
  const marca = (tipo, id, txt) => { (docFlags[tipo + id] ||= []).push(txt); };
  const foraG = [], foraF = [];
  gs.forEach(g => atribuir(g.linhas, nl).forEach((i, j) => {
    const q = Number(g.linhas[j].qtd) || 0;
    if (i >= 0) linhas[i].rec += q; else { foraG.push({ guia: g, linha: g.linhas[j] }); marca('g', g.id, 'artigo fora da encomenda'); }
  }));
  fs.forEach(fa => atribuir(fa.linhas, nl).forEach((i, j) => {
    const l = fa.linhas[j], q = Number(l.qtd) || 0;
    if (i >= 0) {
      linhas[i].fat += q; linhas[i].fatValor += Number(l.total) || (Number(l.pu) || 0) * q;
      if (linhas[i].pu && l.pu != null && Math.abs(Number(l.pu) - linhas[i].pu) / linhas[i].pu > TOLERANCIA) marca('f', fa.id, 'preço diferente do adjudicado');
    } else { foraF.push({ fatura: fa, linha: l }); marca('f', fa.id, 'artigo fora da encomenda'); }
  }));
  linhas.forEach(l => {
    l.puFat = l.fat ? l.fatValor / l.fat : null;
    if (l.rec > l.qtd * (1 + TOLERANCIA)) l.flags.push('Recebido a mais do que o encomendado');
    if (l.fat > l.qtd * (1 + TOLERANCIA)) l.flags.push('Faturado a mais do que o encomendado');
    else if (gs.length && l.fat > l.rec * (1 + TOLERANCIA)) l.flags.push('Faturado a mais do que o recebido');
    if (l.puFat != null && l.pu && Math.abs(l.puFat - l.pu) / l.pu > TOLERANCIA) l.flags.push(`Preço faturado ${l.puFat > l.pu ? 'acima' : 'abaixo'} do adjudicado`);
  });
  const pond = campo => {
    const tot = linhas.reduce((s, l) => s + l.qtd * (l.pu || 1), 0);
    return tot ? linhas.reduce((s, l) => s + Math.min(l[campo], l.qtd) * (l.pu || 1), 0) / tot : 0;
  };
  const recPct = pond('rec'), fatPct = pond('fat');
  const estado = fs.length && fatPct >= 1 - TOLERANCIA ? 'faturada' : recPct >= 1 - TOLERANCIA ? 'completa' : (gs.length && recPct > 0) ? 'parcial' : 'emitida';
  const divergencias = linhas.reduce((s, l) => s + l.flags.length, 0) + foraG.length + foraF.length;
  return { linhas, guias: gs, faturas: fs, foraG, foraF, recPct, fatPct, estado, divergencias, docFlags };
}
