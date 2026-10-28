// ═══════════════════════════════════════════════════════════════════
//  GUIAS DE REMESSA — o encarregado fotografa a guia que recebe em obra, a app lê-a (Claude) e
//  casa-a com a fatura do fornecedor: mesmo nº de guia e mesmos materiais/quantidades.
//
//  FASE DE TESTE: o ecrã só aparece a quem está em app_config 'guias'.teste (ou a todos os encarregados
//  quando 'guias'.ativo = true). Enquanto ativo = false nada é aplicado às faturas: o resultado só é
//  mostrado a quem fotografou a guia e as guias ficam marcadas como teste.
//  Com ativo = true uma divergência suspende a fatura (guia_estado = 'suspensa') e avisa o diretor de obra.
// ═══════════════════════════════════════════════════════════════════
import { S, R } from '../state.js';
import { sb } from '../supabase.js';
import { showToast } from './navigation.js';

const BUCKET = 'guias-remessa';
const $ = id => document.getElementById(id);
const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtQtd = n => Number(n).toLocaleString('pt-PT', { maximumFractionDigits: 3 });

// ── Interruptor ──────────────────────────────────────────────────
let _cfg = null;
async function carregarCfg() {
  if (_cfg) return _cfg;
  try {
    const { data } = await sb.from('app_config').select('value').eq('key', 'guias').maybeSingle();
    _cfg = data?.value || { ativo: false, teste: [] };
  } catch (e) { _cfg = { ativo: false, teste: [] }; }
  return _cfg;
}
const euTeste = () => (_cfg?.teste || []).includes(S.currentUser?.key);
const ativo = () => !!_cfg?.ativo;
// Quem pode usar o ecrã: utilizadores de teste; com o interruptor ativo, também os encarregados
const posso = () => euTeste() || (ativo() && S.currentUser?.role === 'encarregado');

// ── Casamento guia ↔ fatura (funções puras, fáceis de testar) ────────
const semAcentos = t => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const normNumero = t => String(t == null ? '' : t).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const normDesc = t => semAcentos(t).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const normRef = t => String(t == null ? '' : t).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const tokens = t => new Set(normDesc(t).split(' ').filter(w => w.length > 1));
function similar(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let i = 0; A.forEach(w => { if (B.has(w)) i++; });
  return i / (A.size + B.size - i);
}

// Junta linhas repetidas do mesmo material (mesma referência ou descrição) somando as quantidades
function agrupar(linhas) {
  const out = [];
  (linhas || []).forEach(l => {
    const qtd = Number(l.qtd);
    if (!isFinite(qtd)) return;
    const ref = normRef(l.ref_forn ?? l.ref_fornecedor), desc = l.desc ?? l.descricao ?? '';
    const g = out.find(x => (ref && x.ref && x.ref === ref) || (!ref && !x.ref && normDesc(x.desc) === normDesc(desc)));
    if (g) g.qtd += qtd; else out.push({ ref, desc, qtd, un: l.un || '' });
  });
  return out;
}

// Compara o que a fatura cobra com o que as guias entregaram. Devolve a lista de divergências.
export function compararLinhas(linhasFatura, linhasGuias) {
  const F = agrupar(linhasFatura), G = agrupar(linhasGuias), usadasG = new Set(), div = [];
  F.forEach(f => {
    let j = G.findIndex((g, k) => !usadasG.has(k) && f.ref && g.ref && f.ref === g.ref);
    if (j < 0) {
      let melhor = 0;
      G.forEach((g, k) => { if (usadasG.has(k)) return; const s = similar(f.desc, g.desc); if (s > melhor) { melhor = s; j = k; } });
      if (melhor < 0.6) j = -1;
    }
    if (j < 0) { div.push({ tipo: 'so_fatura', desc: f.desc, fatura: f.qtd, un: f.un }); return; }
    usadasG.add(j);
    if (Math.abs(f.qtd - G[j].qtd) > 0.0009) div.push({ tipo: 'qtd', desc: f.desc, fatura: f.qtd, guia: G[j].qtd, un: f.un || G[j].un });
  });
  G.forEach((g, k) => { if (!usadasG.has(k)) div.push({ tipo: 'so_guia', desc: g.desc, guia: g.qtd, un: g.un }); });
  return div;
}

// Procura a fatura da guia, junta todas as guias dessa fatura e compara.
// ligada: id de fatura escolhido à mão (testes) quando a fatura ainda não refere a guia.
async function casar(guia, ligada) {
  let { data: cands, error } = await sb.rpc('fn_guia_candidatas', { p_norm: normNumero(guia.numero), p_nif: guia.nif || '' });
  if (error) throw error;
  if (!cands?.length && ligada) {
    const r = await sb.rpc('fn_guia_fatura', { p_fatura_id: ligada });
    if (r.error) throw r.error;
    cands = r.data;
  }
  if (!cands?.length) return { estado: 'por_casar', motivo: 'sem_fatura' };
  const fat = cands[0];
  const { data: todas, error: e2 } = await sb.rpc('fn_guias_da_fatura', { p_fatura_id: fat.id, p_guia_id: guia.id });
  if (e2) throw e2;
  const guias = todas || [];
  const refs = (fat.guias_ref || []).map(normNumero);
  const faltam = (fat.guias_ref || []).filter(n => !guias.some(g => g.numero_norm === normNumero(n)));
  if (faltam.length && refs.length) return { estado: 'por_casar', motivo: 'faltam_guias', fatura: fat, faltam };
  const div = compararLinhas(fat.linhas, guias.flatMap(g => g.linhas || []));
  return { estado: div.length ? 'divergente' : 'casada', fatura: fat, divergencias: div, nGuias: guias.length };
}

// Guarda o resultado na guia e, se o interruptor estiver ativo, aplica-o à fatura
async function aplicar(guia, res) {
  await sb.from('guias_remessa').update({
    estado: res.estado, fatura_id: res.fatura?.id ?? null,
    divergencias: res.divergencias || [], casada_em: res.estado === 'por_casar' ? null : new Date().toISOString(),
  }).eq('id', guia.id);
  if (!res.fatura || res.estado === 'por_casar') return false;
  const resumo = { divergencias: res.divergencias || [], guias: res.nGuias, em: new Date().toISOString() };
  const { data } = await sb.rpc('fn_guia_aplicar', { p_fatura_id: res.fatura.id, p_estado: res.estado === 'casada' ? 'ok' : 'suspensa', p_resumo: resumo });
  if (data && res.estado === 'divergente') {
    R.emitEvent?.({ acao: `Fatura suspensa: a guia ${guia.numero} não coincide com a fatura ${res.fatura.numero || ''} (${guia.fornecedor || ''})`, seccao: 'faturas-aprovar', obra: res.fatura.centro_custo || undefined });
  }
  return !!data;
}

// ── Fotografia: reduz e converte para JPEG ───────────────────────
function lerFoto(file) {
  return new Promise((ok, ko) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const max = 1800, k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(blob => {
        URL.revokeObjectURL(url);
        if (!blob) return ko(new Error('Não foi possível preparar a fotografia'));
        const r = new FileReader();
        r.onload = () => ok({ blob, base64: String(r.result).split(',')[1] });
        r.onerror = () => ko(r.error);
        r.readAsDataURL(blob);
      }, 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); ko(new Error('Fotografia inválida')); };
    img.src = url;
  });
}

// ── Ecrã (sobreposição a ecrã inteiro, igual no telemóvel e no computador) ───
let _foto = null;        // { blob, base64 }
let _lida = null;        // dados lidos, editáveis
let _passo = 'inicio';   // inicio | a_ler | rever | resultado
let _res = null, _guiaGuardada = null, _busy = false, _sug = [];

function garantirOverlay() {
  let ov = $('gr-ov'); if (ov) return ov;
  ov = document.createElement('div'); ov.id = 'gr-ov'; ov.hidden = true;
  ov.innerHTML = `<div class="gr-hdr"><button type="button" class="gr-x" data-gr="fechar" aria-label="Fechar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    <div class="gr-t">Guias de remessa</div><div class="gr-s" id="gr-s">Receber material em obra</div></div>
    <div class="gr-sheet"><div id="gr-body"></div></div>
    <input type="file" id="gr-file" accept="image/*" capture="environment" hidden>`;
  document.body.appendChild(ov);
  return ov;
}

const pill = (t, c) => `<span class="gr-pill ${c}">${esc(t)}</span>`;
const ESTADO = { por_casar: ['Por casar', 'mute'], casada: ['Casada ✓', 'ok'], divergente: ['Divergente', 'bad'] };

async function listaMinhas() {
  const { data } = await sb.from('guias_remessa').select('id,numero,fornecedor,data,estado,teste,criado_em').eq('criado_por', S.currentUser?.key || '').order('criado_em', { ascending: false }).limit(8);
  return data || [];
}

async function desenhar() {
  const b = $('gr-body'); if (!b) return;
  const sub = $('gr-s');
  if (_passo === 'inicio') {
    sub.textContent = 'Receber material em obra';
    b.innerHTML = `${_cfg?.ativo ? '' : '<div class="gr-teste">Modo de teste — nada é aplicado às faturas.</div>'}
      <button type="button" class="gr-foto" data-gr="foto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg><b>Fotografar guia</b><small>Uma fotografia por guia, com o papel inteiro à vista</small></button>
      <div class="gr-sec">As minhas guias</div><div id="gr-lista" class="gr-lista">A carregar…</div>`;
    try {
      const l = await listaMinhas();
      $('gr-lista').innerHTML = l.length ? l.map(g => `<div class="gr-li"><div><b>${esc(g.numero)}</b><small>${esc(g.fornecedor || '—')}${g.teste ? ' · teste' : ''}</small></div>${pill(...(ESTADO[g.estado] || ESTADO.por_casar))}</div>`).join('') : '<div class="gr-vazio">Ainda não registou nenhuma guia.</div>';
    } catch (e) { $('gr-lista').innerHTML = '<div class="gr-vazio">Não foi possível carregar a lista.</div>'; }
  } else if (_passo === 'a_ler') {
    sub.textContent = 'A ler a guia…';
    b.innerHTML = '<div class="gr-load"><div class="gr-spin"></div><b>A ler a guia</b><small>Demora alguns segundos</small></div>';
  } else if (_passo === 'rever') {
    sub.textContent = 'Confirme os dados lidos';
    const d = _lida, obras = (S.OBRAS || []).filter(o => o.ativa !== false);
    const minhas = obras.filter(o => o.encarregado_id === S.currentUser?.key || (o.encarregados_extra || []).includes(S.currentUser?.key));
    const obraSel = d.obra_id || (minhas.length === 1 ? minhas[0].id : '');
    b.innerHTML = `${d.confianca != null && d.confianca < 0.8 ? '<div class="gr-aviso">Leitura com pouca confiança — confira com a guia.</div>' : ''}
      ${(d.avisos || []).map(a => `<div class="gr-aviso">${esc(a)}</div>`).join('')}
      <label class="gr-l">Fornecedor<input id="gr-f" value="${esc(d.fornecedor)}"></label>
      <div class="gr-2"><label class="gr-l">Nº da guia<input id="gr-n" value="${esc(d.numero)}"></label><label class="gr-l">NIF<input id="gr-nif" inputmode="numeric" value="${esc(d.nif)}"></label></div>
      <div class="gr-2"><label class="gr-l">Data<input id="gr-d" type="date" value="${esc(d.data)}"></label>
      <label class="gr-l">Obra<select id="gr-o"><option value="">— Escolha —</option>${obras.map(o => `<option value="${esc(o.id)}"${o.id === obraSel ? ' selected' : ''}>${esc(o.nome)}</option>`).join('')}</select></label></div>
      <div class="gr-sec">Materiais recebidos</div>
      <div id="gr-linhas">${d.linhas.map((l, i) => `<div class="gr-ln" data-i="${i}"><input class="gr-ld" data-k="descricao" value="${esc(l.descricao)}" aria-label="Material"><input class="gr-lq" data-k="qtd" inputmode="decimal" value="${esc(l.qtd)}" aria-label="Quantidade"><input class="gr-lu" data-k="un" value="${esc(l.un)}" aria-label="Unidade"><button type="button" class="gr-lx" data-gr="rem" data-i="${i}" aria-label="Remover">×</button></div>`).join('') || '<div class="gr-vazio">Nenhum material lido.</div>'}</div>
      <button type="button" class="gr-sec-btn" data-gr="add">+ Adicionar linha</button>
      <button type="button" class="gr-pri" data-gr="guardar"${_busy ? ' disabled' : ''}>Guardar guia</button>
      <button type="button" class="gr-sec-btn" data-gr="cancelar">Cancelar</button>`;
  } else if (_passo === 'resultado') {
    sub.textContent = 'Resultado';
    b.innerHTML = htmlResultado();
  }
}

function htmlResultado() {
  const r = _res, g = _guiaGuardada;
  const teste = !_cfg?.ativo ? '<div class="gr-teste">Modo de teste — nada foi aplicado à fatura.</div>' : '';
  let h = `${teste}<div class="gr-card"><b>Guia ${esc(g.numero)}</b><small>${esc(g.fornecedor || '—')} · ${g.linhas.length} linha(s)</small></div>`;
  if (r.estado === 'casada') {
    h += `<div class="gr-res ok"><b>Casa com a fatura ${esc(r.fatura.numero || '')} ✓</b><small>Materiais e quantidades coincidem.</small></div>`;
  } else if (r.estado === 'divergente') {
    h += `<div class="gr-res bad"><b>Não coincide com a fatura ${esc(r.fatura.numero || '')}</b><small>${_cfg?.ativo ? 'A fatura fica suspensa e o diretor de obra foi avisado.' : 'Com o modo ativo, a fatura ficaria suspensa e o diretor avisado.'}</small></div>
      <div class="gr-div">${r.divergencias.map(d => d.tipo === 'qtd'
        ? `<div><b>${esc(d.desc)}</b><small>Fatura: ${fmtQtd(d.fatura)} ${esc(d.un)} · Guia: ${fmtQtd(d.guia)} ${esc(d.un)}</small></div>`
        : d.tipo === 'so_fatura'
          ? `<div><b>${esc(d.desc)}</b><small>Faturado (${fmtQtd(d.fatura)} ${esc(d.un)}) mas não vem na guia</small></div>`
          : `<div><b>${esc(d.desc)}</b><small>Na guia (${fmtQtd(d.guia)} ${esc(d.un)}) mas não está na fatura</small></div>`).join('')}</div>`;
  } else if (r.motivo === 'faltam_guias') {
    h += `<div class="gr-res mute"><b>Guia registada</b><small>A fatura ${esc(r.fatura.numero || '')} refere também: ${esc(r.faltam.join(', '))}. A comparação faz-se quando todas chegarem.</small></div>`;
  } else {
    h += `<div class="gr-res mute"><b>Guia registada — ainda sem fatura</b><small>Quando o Emanuel lançar a fatura com este nº de guia, o casamento faz-se sozinho.</small></div>`;
    if (_sug.length) h += `<div class="gr-sec">Só para testes: ligar a uma fatura deste fornecedor</div><div class="gr-lista">${_sug.map(s => `<button type="button" class="gr-li gr-li-b" data-gr="ligar" data-f="${s.id}"><div><b>${esc(s.numero || '—')}</b><small>${esc(s.data || '')}</small></div><span class="gr-go">Ligar</span></button>`).join('')}</div>`;
  }
  return h + '<button type="button" class="gr-pri" data-gr="outra">Fotografar outra guia</button><button type="button" class="gr-sec-btn" data-gr="fechar">Fechar</button>';
}

function lerCampos() {
  const d = _lida;
  d.fornecedor = $('gr-f').value.trim(); d.numero = $('gr-n').value.trim(); d.nif = $('gr-nif').value.replace(/\D/g, '').slice(-9);
  d.data = $('gr-d').value; d.obra_id = $('gr-o').value;
  document.querySelectorAll('#gr-linhas .gr-ln').forEach(row => {
    const l = d.linhas[+row.dataset.i]; if (!l) return;
    l.descricao = row.querySelector('[data-k=descricao]').value.trim();
    l.qtd = parseFloat(String(row.querySelector('[data-k=qtd]').value).replace(',', '.'));
    l.un = row.querySelector('[data-k=un]').value.trim();
  });
}

async function processarFoto(file) {
  _passo = 'a_ler'; desenhar();
  try {
    _foto = await lerFoto(file);
    const { data, error } = await sb.functions.invoke('ler-guia', { body: { base64: _foto.base64, mediaType: 'image/jpeg' } });
    if (error || !data?.guia) {
      let msg = data?.error || error?.message || 'sem resposta';
      try { const j = await error?.context?.json?.(); if (j?.error) msg = j.error; } catch (_) {}
      throw new Error(msg);
    }
    const g = data.guia;
    _lida = {
      fornecedor: g.fornecedor || '', nif: String(g.nif || '').replace(/\D/g, '').slice(-9), numero: g.numero || '', data: g.data || '',
      obra_id: '', confianca: Number(g.confianca) || 0, avisos: Array.isArray(g.avisos) ? g.avisos.filter(Boolean) : [],
      linhas: (g.linhas || []).map(l => ({ descricao: l.descricao || '', ref_fornecedor: l.ref_fornecedor || '', qtd: Number(l.qtd) || 0, un: l.un || '' })),
    };
    // obra pelo local da guia: o nome da obra (sem o código "O065 - ") aparece no local ou vice-versa
    const loc = semAcentos(g.local_obra || '');
    const o = loc && (S.OBRAS || []).find(x => { const n = semAcentos(String(x.nome).replace(/^O\d+\s*-\s*/i, '')); return n.length > 3 && (loc.includes(n) || n.includes(loc)); });
    if (o) _lida.obra_id = o.id;
    _passo = 'rever';
  } catch (e) {
    _passo = 'inicio'; desenhar();
    erro('Não foi possível ler a guia: ' + (e.message || e));
    return;
  }
  desenhar();
}

function erro(msg) {
  const b = $('gr-body'); if (!b) return;
  let el = $('gr-erro');
  if (!el) { el = document.createElement('div'); el.id = 'gr-erro'; el.setAttribute('role', 'alert'); el.onclick = () => el.remove(); b.prepend(el); }
  el.textContent = msg + ' (toque para fechar)';
}

async function guardar() {
  if (_busy) return;
  lerCampos();
  const d = _lida;
  if (!d.numero) return erro('Indique o número da guia.');
  if (!d.fornecedor) return erro('Indique o fornecedor.');
  if (!d.linhas.length || d.linhas.some(l => !l.descricao || !isFinite(l.qtd))) return erro('Confirme os materiais: cada linha precisa de descrição e quantidade.');
  _busy = true; desenhar();
  try {
    const path = `${S.currentUser?.key || 'anon'}/${Date.now()}.jpg`;
    const up = await sb.storage.from(BUCKET).upload(path, _foto.blob, { contentType: 'image/jpeg' });
    if (up.error) throw up.error;
    const obra = (S.OBRAS || []).find(o => o.id === d.obra_id);
    const linhas = d.linhas.map(l => ({ desc: l.descricao, ref_forn: l.ref_fornecedor || '', qtd: l.qtd, un: l.un || '' }));
    const { data, error } = await sb.from('guias_remessa').insert({
      numero: d.numero, fornecedor: d.fornecedor, nif: d.nif || null, data: d.data || null, obra_id: d.obra_id || null, obra_nome: obra?.nome || null,
      linhas, confianca: d.confianca, avisos: d.avisos, foto_path: path, teste: !_cfg?.ativo,
    }).select().single();
    if (error) { sb.storage.from(BUCKET).remove([path]).catch(() => {}); throw error; }
    _guiaGuardada = { ...data, linhas };
    _res = await casar(_guiaGuardada, null);
    await aplicar(_guiaGuardada, _res);
    _sug = _res.motivo === 'sem_fatura' && d.nif ? ((await sb.rpc('fn_guia_sugestoes', { p_nif: d.nif })).data || []) : [];
    _passo = 'resultado';
    R.emitEvent?.({ acao: `Guia de remessa ${d.numero} registada${d.fornecedor ? ' · ' + d.fornecedor : ''}`, seccao: 'faturas', obra: d.obra_id || undefined });
  } catch (e) {
    _busy = false; desenhar(); return erro('Não foi possível guardar: ' + (e.message || e));
  }
  _busy = false; desenhar();
}

async function ligar(faturaId) {
  try {
    _res = await casar(_guiaGuardada, Number(faturaId));
    await aplicar(_guiaGuardada, _res);
    _sug = [];
    desenhar();
  } catch (e) { erro('Não foi possível ligar: ' + (e.message || e)); }
}

function abrir() {
  garantirOverlay().hidden = false;
  document.body.classList.add('gr-aberto');
  _passo = 'inicio'; _foto = null; _lida = null; _res = null; _busy = false;
  desenhar();
}
function fechar() { const ov = $('gr-ov'); if (ov) ov.hidden = true; document.body.classList.remove('gr-aberto'); }

document.addEventListener('click', e => {
  const b = e.target.closest('[data-gr]'); if (!b || !$('gr-ov')?.contains(b)) return;
  const a = b.dataset.gr;
  if (a === 'fechar') fechar();
  else if (a === 'foto') $('gr-file').click();
  else if (a === 'cancelar') { _passo = 'inicio'; desenhar(); }
  else if (a === 'outra') { _passo = 'inicio'; desenhar(); }
  else if (a === 'guardar') guardar();
  else if (a === 'add') { lerCampos(); _lida.linhas.push({ descricao: '', ref_fornecedor: '', qtd: 1, un: '' }); desenhar(); }
  else if (a === 'rem') { lerCampos(); _lida.linhas.splice(+b.dataset.i, 1); desenhar(); }
  else if (a === 'ligar') ligar(b.dataset.f);
});
document.addEventListener('change', e => {
  if (e.target.id !== 'gr-file') return;
  const f = e.target.files?.[0]; e.target.value = '';
  if (f) processarFoto(f);
});

// ── Entradas no menu: só para quem pode usar o ecrã ───────────────
export async function guiasInit() {
  await carregarCfg();
  const ok = posso();
  const row = $('enc-row-guias'); if (row) row.hidden = !ok;
  const nav = $('nav-guias'); if (nav) nav.hidden = !ok;
}

Object.assign(window, { guiasAbrir: abrir, guiasInit });
