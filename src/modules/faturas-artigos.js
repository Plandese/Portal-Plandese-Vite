// ═══════════════════════════════════════════════════════════════════
//  FATURAS → LISTA DE MATERIAIS
//  Associa cada linha de uma fatura a um artigo do catálogo (window.ARTIGOS_CATALOGO).
//   1) memória por fornecedor (tabela fatura_artigo_alias) → associa sozinho
//   2) pontuação por palavras/medidas contra o catálogo → associa se for claro
//   3) o resto fica 'pendente' e o portal pergunta (diálogo "Associar artigos")
//  linha: { desc, ref_forn, qtd, un, pu, total, art_ref, art_nome, estado }
// ═══════════════════════════════════════════════════════════════════
import { sb } from '../supabase.js';
import { showToast } from './navigation.js';

const AUTO_MIN = 0.78;     // pontuação mínima para associar sem perguntar
const AUTO_MARGEM = 0.08;  // diferença mínima para o 2.º classificado

const STOP = new Set(['de','da','do','das','dos','para','p','c','com','e','a','o','as','os','em','no','na','por','ao','un','und','unid','ref','art','tipo']);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

export const normArt = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9,.\s]/g, ' ').replace(/(\d),(\d)/g, '$1.$2').replace(/[.,]+(\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = s => normArt(s).split(' ').filter(t => t && !STOP.has(t));
const isNum = t => /^\d+(\.\d+)?$/.test(t);

// ── Índice do catálogo (construído uma vez) ─────────────────────
let IDX = null;
function indice(){
  if(IDX) return IDX;
  const cat = window.ARTIGOS_CATALOGO || {};
  const items = [], inv = new Map();
  for(const k of Object.keys(cat)){
    for(const [ref, nome, un] of cat[k].items){
      const t = [...new Set(tokens(nome))];
      const i = items.length;
      items.push({ ref, nome, un: un || '', cat: cat[k].label || k, t });
      for(const x of t){ let a = inv.get(x); if(!a) inv.set(x, a = []); a.push(i); }
    }
  }
  const N = items.length || 1;
  const idf = t => Math.log(1 + N / (1 + (inv.get(t)?.length || 0)));
  IDX = { items, inv, idf };
  return IDX;
}

// Candidatos para um texto: [{ item, score }] por ordem decrescente
export function procurarArtigos(texto, un = '', max = 6){
  const { items, inv, idf } = indice();
  const q = [...new Set(tokens(texto))];
  if(!q.length || !items.length) return [];
  const peso = t => idf(t) * (isNum(t) ? 1.6 : 1);
  const totalQ = q.reduce((s, t) => s + peso(t), 0);
  const visto = new Map();
  for(const t of q){
    const lst = inv.get(t); if(!lst) continue;
    if(lst.length > 4000 && !isNum(t)) continue;   // palavras genéricas não geram candidatos
    for(const i of lst) visto.set(i, (visto.get(i) || 0) + peso(t));
  }
  const nq = new Set(q), unN = normArt(un);
  const res = [];
  for(const [i, hit] of visto){
    const it = items[i];
    const totalI = it.t.reduce((s, t) => s + peso(t), 0) || 1;
    let score = 0.7 * (hit / totalQ) + 0.3 * (hit / totalI);       // cobertura da linha + do artigo
    // medidas (Ø16, 20x20, 25 kg…) da linha que o artigo não tem → penaliza forte
    const numsFalta = q.filter(t => isNum(t) && !it.t.includes(t)).length;
    score -= 0.18 * numsFalta;
    if(unN && it.un && normArt(it.un) === unN) score += 0.03;
    if(score > 0.1) res.push({ item: it, id: i, score: Math.min(1, score), cobItem: hit / totalI });
  }
  return res.sort((a, b) => b.score - a.score).slice(0, max);
}

// ── Memória por fornecedor ──────────────────────────────────────
const chaveLinha = l => normArt(l.ref_forn ? `ref ${l.ref_forn}` : l.desc);
const chaveDesc = l => normArt(l.desc);
const _alias = {};   // nif → Map(chave → {art_ref, art_nome, un})

async function carregarAlias(nif){
  if(!nif) return new Map();
  if(_alias[nif]) return _alias[nif];
  const m = new Map();
  try{
    const { data, error } = await sb.from('fatura_artigo_alias').select('chave,art_ref,art_nome,un').eq('nif', nif);
    if(error) throw error;
    (data || []).forEach(r => m.set(r.chave, r));
  } catch(e){ console.warn('Associações de artigos:', e); }
  return (_alias[nif] = m);
}

async function guardarAlias(nif, l){
  if(!nif || !l.art_nome) return;
  const chaves = new Set([chaveDesc(l)]);
  if(l.ref_forn) chaves.add(chaveLinha(l));
  const rows = [...chaves].filter(Boolean).map(chave => ({
    nif, chave, art_ref: l.art_ref, art_nome: l.art_nome || '', un: l.un || '', atualizado: new Date().toISOString(),
  }));
  if(!rows.length) return;
  try{
    const { error } = await sb.from('fatura_artigo_alias').upsert(rows, { onConflict: 'nif,chave' });
    if(error) throw error;
    rows.forEach(r => (_alias[nif] ||= new Map()).set(r.chave, r));
  } catch(e){ console.warn('Guardar associação:', e); showToast('Não foi possível memorizar a associação'); }
}

// ── Normaliza as linhas devolvidas pelo Claude ──────────────────
export function normalizarLinhas(brutas){
  const num = v => (v == null || v === '' || isNaN(Number(v))) ? null : Math.round(Number(v) * 10000) / 10000;
  return (Array.isArray(brutas) ? brutas : []).map(r => ({
    desc: String(r.descricao || r.desc || '').trim(),
    ref_forn: String(r.ref_fornecedor || r.ref_forn || '').trim(),
    qtd: num(r.qtd), un: String(r.un || '').trim(),
    pu: num(r.preco_unit ?? r.pu), total: num(r.total_linha ?? r.total),
    art_ref: '', art_nome: '', estado: 'pendente',
  })).filter(l => l.desc);
}

// Associa automaticamente o que for claro; devolve nº de linhas por resolver.
export async function associarAuto(fat){
  const linhas = fat.linhas || [];
  const alias = await carregarAlias(fat.nif);
  for(const l of linhas){
    if(l.estado === 'manual' || l.estado === 'ignorado') continue;
    const a = alias.get(chaveLinha(l)) || alias.get(chaveDesc(l));
    if(a){ Object.assign(l, { art_ref: a.art_ref, art_nome: a.art_nome, estado: 'auto', _via: 'memoria' }); continue; }
    const c = procurarArtigos(l.desc, l.un, 5);
    l._cands = c.map(x => ({ id: x.id, ref: x.item.ref, nome: x.item.nome, un: x.item.un, score: x.score }));
    if(c[0] && c[0].score >= AUTO_MIN && c[0].cobItem >= 0.6 && (!c[1] || c[0].score - c[1].score >= AUTO_MARGEM)){
      Object.assign(l, { art_ref: c[0].item.ref, art_nome: c[0].item.nome, estado: 'auto', _via: 'pontuacao' });
    } else Object.assign(l, { art_ref: '', art_nome: '', estado: 'pendente' });
  }
  return linhas.filter(l => l.estado === 'pendente').length;
}

// ── Diálogo "Associar artigos" ──────────────────────────────────
let _dlg = null;   // { fat, linhas (cópia), onSave, resolve }
let _fila = Promise.resolve();

// Abre o diálogo para as linhas (só as pendentes, ou todas com todas=true). Resolve true se guardou.
export function perguntarArtigos(fat, { todas = false, onSave } = {}){
  const run = () => new Promise(resolve => {
    _dlg = { fat, onSave, resolve, todas, linhas: (fat.linhas || []).map(l => ({ ...l })), q: {} };
    desenhar();
  });
  const p = _fila.then(run, run);
  _fila = p.catch(() => {});
  return p;
}

function fechar(guardou){
  document.getElementById('fat-art-dlg')?.remove();
  const d = _dlg; _dlg = null;
  d?.resolve(!!guardou);
}

function desenhar(){
  const d = _dlg; if(!d) return;
  let el = document.getElementById('fat-art-dlg');
  if(!el){
    el = document.createElement('div'); el.id = 'fat-art-dlg';
    el.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(10,18,38,.55);display:flex;align-items:center;justify-content:center;padding:12px';
    document.body.appendChild(el);
  }
  const idxs = d.linhas.map((l, i) => i).filter(i => d.todas || d.linhas[i].estado === 'pendente' || d.linhas[i]._aberta);
  const pend = d.linhas.filter(l => l.estado === 'pendente').length;
  const cartao = i => {
    const l = d.linhas[i];
    const cands = l.estado === 'pendente' || l._aberta ? (l._cands || []) : [];
    const sel = l.estado === 'manual' || l.estado === 'auto';
    const pesq = d.q[i] || '';
    const res = pesq.length >= 2 ? procurarArtigos(pesq, l.un, 8).map(x => ({ id: x.id, ref: x.item.ref, nome: x.item.nome, un: x.item.un, score: x.score })) : [];
    const op = (c, extra = '') => `<button type="button" class="btn btn-secondary btn-sm" style="display:flex;justify-content:space-between;gap:10px;text-align:left;width:100%;margin-top:4px;${extra}" onclick="faArtEscolher(${i},${c.id})"><span>${esc(c.nome)}<span style="color:var(--gray-400);font-size:11px"> · ${c.ref ? esc(c.ref) : 'sem ref.'}${c.un ? ' · ' + esc(c.un) : ''}</span></span>${c.score != null ? `<span style="color:var(--gray-500);font-size:11px;white-space:nowrap">${Math.round(c.score * 100)}%</span>` : ''}</button>`;
    return `<div style="border:1.5px solid ${l.estado === 'pendente' ? '#fcd34d' : 'var(--gray-200)'};border-radius:10px;padding:10px 12px;margin-bottom:10px">
      <div style="font-weight:600;font-size:13px">${esc(l.desc)}</div>
      <div style="font-size:11px;color:var(--gray-500);margin-bottom:4px">${l.ref_forn ? 'Ref. ' + esc(l.ref_forn) + ' · ' : ''}${l.qtd ?? '—'} ${esc(l.un)}${l.pu != null ? ' · ' + l.pu.toLocaleString('pt-PT') + ' €/un' : ''}${l.total != null ? ' · total ' + l.total.toLocaleString('pt-PT') + ' €' : ''}</div>
      ${sel ? `<div style="font-size:12px;color:#15803d;margin:4px 0">✓ ${esc(l.art_nome)} <span style="color:var(--gray-400)">(${esc(l.art_ref)})</span> <button type="button" class="perm-reset" onclick="faArtReabrir(${i})">alterar</button></div>` : ''}
      ${l.estado === 'ignorado' ? `<div style="font-size:12px;color:var(--gray-500);margin:4px 0">Ignorada (não é material) <button type="button" class="perm-reset" onclick="faArtReabrir(${i})">alterar</button></div>` : ''}
      ${(l.estado === 'pendente' || l._aberta) ? `
        ${cands.length ? '<div style="font-size:11px;color:var(--gray-500)">Sugestões:</div>' + cands.map(c => op(c)).join('') : '<div style="font-size:12px;color:var(--gray-500)">Sem sugestões parecidas — pesquise no catálogo.</div>'}
        <input type="search" placeholder="Pesquisar no catálogo…" value="${esc(pesq)}" oninput="faArtPesq(${i},this.value)" style="width:100%;margin-top:8px;padding:7px 10px;border:1.5px solid var(--gray-200);border-radius:8px;font-size:13px">
        ${res.map(c => op(c)).join('')}
        <button type="button" class="perm-reset" style="margin-top:6px" onclick="faArtIgnorar(${i})">Não é material / ignorar</button>` : ''}
    </div>`;
  };
  el.innerHTML = `<div style="background:#fff;border-radius:16px;max-width:680px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3)">
    <div style="padding:16px 18px;border-bottom:1px solid var(--gray-200)">
      <div style="font-weight:700;font-size:16px">Associar artigos à lista de materiais</div>
      <div style="font-size:12px;color:var(--gray-500)">${esc(d.fat.fornecedor || '')} · ${esc(d.fat.numero || '')} — ${pend ? pend + ' linha' + (pend !== 1 ? 's' : '') + ' por associar' : 'tudo associado'}</div>
    </div>
    <div style="padding:14px 18px;overflow-y:auto;flex:1">${idxs.map(cartao).join('') || '<div style="color:var(--gray-500);font-size:13px">Sem linhas para mostrar.</div>'}
      ${d.todas ? '' : `<button type="button" class="perm-reset" onclick="faArtTodas()">Ver também as linhas já associadas</button>`}</div>
    <div style="padding:12px 18px;border-top:1px solid var(--gray-200);display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap">
      <label style="font-size:12px;color:var(--gray-600);display:flex;gap:6px;align-items:center"><input type="checkbox" id="fat-art-lembrar" checked> Lembrar para este fornecedor</label>
      <span><button class="btn btn-secondary" type="button" onclick="faArtFechar()">${pend ? 'Decidir depois' : 'Cancelar'}</button>
      <button class="btn btn-primary" type="button" onclick="faArtGuardar()">Guardar</button></span>
    </div></div>`;
}

const _foco = () => { const a = document.activeElement; return a && a.tagName === 'INPUT' && a.type === 'search' ? [a.selectionStart, [...document.querySelectorAll('#fat-art-dlg input[type=search]')].indexOf(a)] : null; };
function redesenhar(){
  const f = _foco(); desenhar();
  if(f && f[1] >= 0){ const i = document.querySelectorAll('#fat-art-dlg input[type=search]')[f[1]]; if(i){ i.focus(); i.setSelectionRange(f[0], f[0]); } }
}

function escolher(i, id){
  const l = _dlg?.linhas[i]; if(!l) return;
  const { items } = indice();
  const it = items[id]; if(!it) return;
  Object.assign(l, { art_ref: it.ref, art_nome: it.nome, estado: 'manual', _aberta: false });
  d_q(i, '');
  redesenhar();
}
const d_q = (i, v) => { if(_dlg) _dlg.q[i] = v; };

async function guardar(){
  const d = _dlg; if(!d) return;
  const lembrar = document.getElementById('fat-art-lembrar')?.checked;
  d.linhas.forEach(l => { delete l._aberta; });
  // grava no objeto da fatura (preserva as sugestões das ainda pendentes)
  d.fat.linhas = d.linhas;
  if(lembrar) for(const l of d.linhas) if(l.estado === 'manual') await guardarAlias(d.fat.nif, l);
  try{ await d.onSave?.(d.fat); } catch(e){ console.warn(e); }
  const pend = d.linhas.filter(l => l.estado === 'pendente').length;
  showToast(pend ? `Guardado — ${pend} linha${pend !== 1 ? 's' : ''} ainda por associar` : 'Artigos associados');
  fechar(true);
}

export const handlersArtigos = {
  faArtEscolher: escolher,
  faArtPesq: (i, v) => { d_q(i, v); redesenhar(); },
  faArtIgnorar: i => { const l = _dlg?.linhas[i]; if(l){ Object.assign(l, { estado: 'ignorado', art_ref: '', art_nome: '', _aberta: false }); redesenhar(); } },
  faArtReabrir: i => { const l = _dlg?.linhas[i]; if(l){ l._aberta = true; if(l.estado === 'ignorado') l.estado = 'pendente'; redesenhar(); } },
  faArtTodas: () => { if(_dlg){ _dlg.todas = true; redesenhar(); } },
  faArtFechar: () => { const d = _dlg; if(d) d.fat.linhas = d.fat.linhas || []; fechar(false); },
  faArtGuardar: guardar,
};

// Resumo para mostrar na ficha da fatura
export function resumoArtigos(fat){
  const l = fat.linhas || [];
  if(!l.length) return { n: 0, pend: 0 };
  return { n: l.length, pend: l.filter(x => x.estado === 'pendente').length };
}
