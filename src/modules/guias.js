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
let _paginas = [];       // páginas fotografadas: { blob, base64, url }
let _lida = null;        // dados lidos, editáveis
let _passo = 'inicio';   // inicio | camara | paginas | a_ler | rever | resultado
let _tudoOk = false;     // "confirmo que fotografei todas as páginas"
let _semFalta = false;   // o utilizador confirmou que a guia tem mesmo só as páginas fotografadas
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
  if (_passo !== 'camara') pararCamara();
  $('gr-ov')?.classList.toggle('gr-cam-on', _passo === 'camara');
  if (_passo === 'camara') { sub.textContent = `Página ${_paginas.length + 1}`; b.innerHTML = htmlCamara(); iniciarCamara(); return; }
  if (_passo === 'paginas') { sub.textContent = `${_paginas.length} página${_paginas.length === 1 ? '' : 's'} fotografada${_paginas.length === 1 ? '' : 's'}`; b.innerHTML = htmlPaginas(); return; }
  if (_passo === 'inicio') {
    sub.textContent = 'Receber material em obra';
    b.innerHTML = `${_cfg?.ativo ? '' : '<div class="gr-teste">Modo de teste — nada é aplicado às faturas.</div>'}
      <button type="button" class="gr-foto" data-gr="foto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg><b>Fotografar guia</b><small>A câmara tira a foto sozinha quando a folha encaixa. Guias com várias páginas: uma foto por página.</small></button>
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
    const faltam = d.paginas_total > _paginas.length && !_semFalta;
    b.innerHTML = `${faltam ? `<div class="gr-falta"><b>Faltam páginas</b><small>A guia indica ${d.paginas_total} páginas e só fotografou ${_paginas.length}.</small><button type="button" class="gr-pri" data-gr="maispag">Fotografar as páginas em falta</button><button type="button" class="gr-sec-btn" data-gr="semfalta">A guia só tem ${_paginas.length} página${_paginas.length === 1 ? '' : 's'}</button></div>` : ''}
      ${d.confianca != null && d.confianca < 0.8 ? '<div class="gr-aviso">Leitura com pouca confiança — confira com a guia.</div>' : ''}
      ${(d.avisos || []).map(a => `<div class="gr-aviso">${esc(a)}</div>`).join('')}
      <label class="gr-l">Fornecedor<input id="gr-f" value="${esc(d.fornecedor)}"></label>
      <div class="gr-2"><label class="gr-l">Nº da guia<input id="gr-n" value="${esc(d.numero)}"></label><label class="gr-l">NIF<input id="gr-nif" inputmode="numeric" value="${esc(d.nif)}"></label></div>
      <div class="gr-2"><label class="gr-l">Data<input id="gr-d" type="date" value="${esc(d.data)}"></label>
      <label class="gr-l">Obra<select id="gr-o"><option value="">— Escolha —</option>${obras.map(o => `<option value="${esc(o.id)}"${o.id === obraSel ? ' selected' : ''}>${esc(o.nome)}</option>`).join('')}</select></label></div>
      <div class="gr-sec">Materiais recebidos</div>
      <div id="gr-linhas">${d.linhas.map((l, i) => `<div class="gr-ln" data-i="${i}"><input class="gr-ld" data-k="descricao" value="${esc(l.descricao)}" aria-label="Material"><input class="gr-lq" data-k="qtd" inputmode="decimal" value="${esc(l.qtd)}" aria-label="Quantidade"><input class="gr-lu" data-k="un" value="${esc(l.un)}" aria-label="Unidade"><button type="button" class="gr-lx" data-gr="rem" data-i="${i}" aria-label="Remover">×</button></div>`).join('') || '<div class="gr-vazio">Nenhum material lido.</div>'}</div>
      <button type="button" class="gr-sec-btn" data-gr="add">+ Adicionar linha</button>
      <button type="button" class="gr-pri" data-gr="guardar"${_busy || faltam ? ' disabled' : ''}>Guardar guia</button>
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

async function lerPaginas() {
  _passo = 'a_ler'; desenhar();
  try {
    const { data, error } = await sb.functions.invoke('ler-guia', { body: { paginas: _paginas.map(p => ({ base64: p.base64, mediaType: 'image/jpeg' })) } });
    if (error || !data?.guia) {
      let msg = data?.error || error?.message || 'sem resposta';
      try { const j = await error?.context?.json?.(); if (j?.error) msg = j.error; } catch (_) {}
      throw new Error(msg);
    }
    const g = data.guia;
    _lida = {
      fornecedor: g.fornecedor || '', nif: String(g.nif || '').replace(/\D/g, '').slice(-9), numero: g.numero || '', data: g.data || '',
      obra_id: '', confianca: Number(g.confianca) || 0, avisos: Array.isArray(g.avisos) ? g.avisos.filter(Boolean) : [],
      paginas_total: Number(g.paginas_total) || 0,
      linhas: (g.linhas || []).map(l => ({ descricao: l.descricao || '', ref_fornecedor: l.ref_fornecedor || '', qtd: Number(l.qtd) || 0, un: l.un || '' })),
    };
    // obra pelo local da guia: o nome da obra (sem o código "O065 - ") aparece no local ou vice-versa
    const loc = semAcentos(g.local_obra || '');
    const o = loc && (S.OBRAS || []).find(x => { const n = semAcentos(String(x.nome).replace(/^O\d+\s*-\s*/i, '')); return n.length > 3 && (loc.includes(n) || n.includes(loc)); });
    if (o) _lida.obra_id = o.id;
    _semFalta = false;
    _passo = 'rever';
  } catch (e) {
    _passo = 'paginas'; desenhar();
    erro('Não foi possível ler a guia: ' + (e.message || e));
    return;
  }
  desenhar();
}

// ── Câmara guiada: tira a foto sozinha quando a folha encaixa no retângulo ──
// Limiares afinados para texto impresso em papel branco; se na obra o disparo for lento ou falhar muito, é aqui que se ajusta.
const CAM = { PAPEL_MIN: 105, PAPEL_FRAC: 0.70, BORDA_FRAC: 0.62, FORA_MAX: 0.88, MOV_MAX: 5, NITIDEZ_MIN: 40, ESTAVEL: 5, INTERVALO: 160 };
let _stream = null, _timer = null, _prev = null, _estavel = 0, _espera = 0, _capturando = false;
const _tmp = document.createElement('canvas');

function htmlCamara() {
  return `<div class="gr-cam"><video id="gr-video" playsinline muted autoplay></video>
    <div class="gr-guia" id="gr-guia"><i></i><i></i><i></i><i></i></div>
    <div class="gr-dica" id="gr-dica">A abrir a câmara…</div>
    <div class="gr-cam-bar"><button type="button" class="gr-cam-b" data-gr="camvoltar" aria-label="Voltar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      <button type="button" class="gr-disp" data-gr="disparar" aria-label="Tirar fotografia"></button>
      <button type="button" class="gr-cam-b" data-gr="escolher" aria-label="Usar a câmara do telemóvel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg></button></div></div>`;
}

function pararCamara() {
  clearInterval(_timer); _timer = null; _prev = null; _estavel = 0;
  if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
}

// Retângulo A4 centrado, na orientação do ecrã (em píxeis do vídeo apresentado)
function geomGuia(W, H) {
  let gw, gh;
  if (H >= W) { gw = Math.min(W * 0.86, H * 0.74 / 1.414); gh = gw * 1.414; }
  else { gh = Math.min(H * 0.78, W * 0.8 / 1.414); gw = gh * 1.414; }
  return { x: (W - gw) / 2, y: (H - gh) / 2 - H * 0.03, w: gw, h: gh };
}
// Converte um retângulo do ecrã para coordenadas do vídeo (object-fit: cover)
function paraVideo(v, r) {
  const W = v.clientWidth, H = v.clientHeight, vw = v.videoWidth, vh = v.videoHeight;
  const k = Math.max(W / vw, H / vh), ox = (W - vw * k) / 2, oy = (H - vh * k) / 2;
  return { x: (r.x - ox) / k, y: (r.y - oy) / k, w: r.w / k, h: r.h / k };
}

async function iniciarCamara() {
  const dica = t => { const d = $('gr-dica'); if (d) d.textContent = t; };
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('sem câmara');
    _stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false });
  } catch (e) {
    _passo = _paginas.length ? 'paginas' : 'inicio'; desenhar();
    erro('Não foi possível abrir a câmara (autorize o acesso). Use "Escolher fotografia" ou a câmara do telemóvel.');
    return;
  }
  const v = $('gr-video'); if (!v) return pararCamara();
  v.srcObject = _stream;
  try { await v.play(); } catch (_) {}
  const pos = () => {
    const g = $('gr-guia'); if (!g || !v.clientWidth) return;
    const r = geomGuia(v.clientWidth, v.clientHeight);
    g.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
  };
  pos(); window.addEventListener('resize', pos, { once: true });
  dica('Encaixe a folha no retângulo');
  _capturando = false; _estavel = 0; _espera = 0; _prev = null;
  _timer = setInterval(() => analisar(v), CAM.INTERVALO);
}

// Analisa uma imagem pequena do vídeo e decide se a folha está encaixada, firme e nítida
function analisar(v) {
  if (_capturando || !v.videoWidth) return;
  const SW = 240, SH = Math.round(SW * v.videoHeight / v.videoWidth);
  _tmp.width = SW; _tmp.height = SH;
  const cx = _tmp.getContext('2d', { willReadFrequently: true });
  cx.drawImage(v, 0, 0, SW, SH);
  const px = cx.getImageData(0, 0, SW, SH).data, L = new Uint8Array(SW * SH);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) L[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
  const g = paraVideo(v, geomGuia(v.clientWidth, v.clientHeight)), k = SW / v.videoWidth;
  const R = { x: Math.max(0, Math.round(g.x * k)), y: Math.max(0, Math.round(g.y * k)), w: Math.round(g.w * k), h: Math.round(g.h * k) };
  R.w = Math.min(R.w, SW - R.x); R.h = Math.min(R.h, SH - R.y);
  const m = medirFolha(L, SW, SH, R);
  // movimento entre imagens consecutivas
  let mov = 0;
  if (_prev && _prev.length === L.length) { let s = 0; for (let i = 0; i < L.length; i += 7) s += Math.abs(L[i] - _prev[i]); mov = s / (L.length / 7); } else mov = 99;
  _prev = L;
  const dica = t => { const d = $('gr-dica'); if (d) d.textContent = t; };
  const guia = $('gr-guia');
  let ok = false;
  if (!m.papel) dica('Encaixe a folha no retângulo');
  else if (m.fora) dica('Afaste um pouco: a folha deve caber no retângulo');
  else if (mov > CAM.MOV_MAX) dica('Mantenha o telemóvel firme');
  else if (m.nitidez < CAM.NITIDEZ_MIN) dica('A focar…');
  else { ok = true; dica('Não mexa…'); }
  guia?.classList.toggle('ok', ok); guia?.classList.toggle('warn', !ok && m.papel);
  _estavel = ok ? _estavel + 1 : 0;
  // folha encaixada mas sem disparar há uns segundos: lembra o botão manual
  _espera = m.papel ? _espera + 1 : 0;
  if (_espera > 30 && !ok) dica('Se a folha está encaixada, toque no botão branco');
  if (_estavel >= CAM.ESTAVEL) capturar(v);
}

// Mede se a folha (zona clara) enche o retângulo, não passa dele e está nítida
export function medirFolha(L, SW, SH, R) {
  const hist = new Uint32Array(256); let n = 0;
  for (let y = R.y; y < R.y + R.h; y++) for (let x = R.x; x < R.x + R.w; x++) { hist[L[y * SW + x]]++; n++; }
  if (!n) return { papel: false };
  let acc = 0, p90 = 255; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.9) { p90 = i; break; } }
  const lim = p90 * 0.75;
  const frac = (x0, y0, w, h) => { let c = 0, t = 0; for (let y = Math.max(0, y0); y < Math.min(SH, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(SW, x0 + w); x++) { t++; if (L[y * SW + x] >= lim) c++; } return t ? c / t : 0; };
  const papel = p90 >= CAM.PAPEL_MIN && frac(R.x, R.y, R.w, R.h) >= CAM.PAPEL_FRAC;
  if (!papel) return { papel: false };
  const e = Math.max(3, Math.round(Math.min(R.w, R.h) * 0.08));
  const bordas = [frac(R.x, R.y, R.w, e), frac(R.x, R.y + R.h - e, R.w, e), frac(R.x, R.y, e, R.h), frac(R.x + R.w - e, R.y, e, R.h)];
  const encaixa = bordas.every(f => f >= CAM.BORDA_FRAC);
  if (!encaixa) return { papel: false };
  const o = Math.max(3, Math.round(Math.min(R.w, R.h) * 0.05));
  // a folha passa do retângulo se a faixa de fora também for papel em (pelo menos) 3 dos 4 lados
  const fora = [frac(R.x, R.y - o, R.w, o), frac(R.x, R.y + R.h, R.w, o), frac(R.x - o, R.y, o, R.h), frac(R.x + R.w, R.y, o, R.h)].filter(f => f >= CAM.FORA_MAX).length >= 3;
  // nitidez: variância do laplaciano dentro do retângulo
  let s = 0, s2 = 0, c = 0;
  for (let y = R.y + 1; y < R.y + R.h - 1; y += 1) for (let x = R.x + 1; x < R.x + R.w - 1; x += 1) {
    const l = 4 * L[y * SW + x] - L[y * SW + x - 1] - L[y * SW + x + 1] - L[(y - 1) * SW + x] - L[(y + 1) * SW + x]; s += l; s2 += l * l; c++;
  }
  const nitidez = c ? s2 / c - (s / c) ** 2 : 0;
  return { papel: true, fora, nitidez };
}

// Guarda a imagem do retângulo (com uma pequena margem) em alta resolução
async function capturar(v) {
  if (_capturando) return; _capturando = true;
  const g = paraVideo(v, geomGuia(v.clientWidth, v.clientHeight)), m = Math.min(g.w, g.h) * 0.03;
  const sx = Math.max(0, g.x - m), sy = Math.max(0, g.y - m), sw = Math.min(v.videoWidth - sx, g.w + 2 * m), sh = Math.min(v.videoHeight - sy, g.h + 2 * m);
  const k = Math.min(1, 1800 / Math.max(sw, sh)), c = document.createElement('canvas');
  c.width = Math.round(sw * k); c.height = Math.round(sh * k);
  c.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
  navigator.vibrate?.(70);
  $('gr-guia')?.classList.add('flash');
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) { _capturando = false; return; }
  const base64 = await new Promise(r => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1]); f.readAsDataURL(blob); });
  _paginas.push({ blob, base64, url: URL.createObjectURL(blob) });
  _tudoOk = false; _passo = 'paginas'; desenhar();
}

function htmlPaginas() {
  const n = _paginas.length;
  return `<div class="gr-pgs">${_paginas.map((p, i) => `<div class="gr-pg"><img src="${p.url}" alt="Página ${i + 1}"><span>${i + 1}</span><button type="button" class="gr-pgx" data-gr="rempag" data-i="${i}" aria-label="Apagar página ${i + 1}">×</button></div>`).join('')}
    <button type="button" class="gr-pg gr-pg-add" data-gr="maispag"><b>+</b><small>Outra página</small></button></div>
    <label class="gr-conf"><input type="checkbox" id="gr-tudo" ${_tudoOk ? 'checked' : ''}><span>Confirmo que fotografei <b>todas as páginas</b> desta guia (${n}).</span></label>
    <button type="button" class="gr-pri" data-gr="ler" ${_tudoOk && n ? '' : 'disabled'}>Terminei — ler a guia</button>
    <button type="button" class="gr-sec-btn" data-gr="cancelar">Cancelar</button>`;
}

async function fotoDeFicheiro(file) {
  try {
    const f = await lerFoto(file);
    _paginas.push({ blob: f.blob, base64: f.base64, url: URL.createObjectURL(f.blob) });
    _tudoOk = false; _passo = 'paginas'; desenhar();
  } catch (e) { erro('Fotografia inválida: ' + (e.message || e)); }
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
    const base = `${S.currentUser?.key || 'anon'}/${Date.now()}`, caminhos = [];
    for (let i = 0; i < _paginas.length; i++) {
      const path = `${base}-p${i + 1}.jpg`;
      const up = await sb.storage.from(BUCKET).upload(path, _paginas[i].blob, { contentType: 'image/jpeg' });
      if (up.error) { sb.storage.from(BUCKET).remove(caminhos).catch(() => {}); throw up.error; }
      caminhos.push(path);
    }
    const obra = (S.OBRAS || []).find(o => o.id === d.obra_id);
    const linhas = d.linhas.map(l => ({ desc: l.descricao, ref_forn: l.ref_fornecedor || '', qtd: l.qtd, un: l.un || '' }));
    const { data, error } = await sb.from('guias_remessa').insert({
      numero: d.numero, fornecedor: d.fornecedor, nif: d.nif || null, data: d.data || null, obra_id: d.obra_id || null, obra_nome: obra?.nome || null,
      linhas, confianca: d.confianca, avisos: d.avisos, foto_path: caminhos[0], fotos: caminhos, paginas: caminhos.length, teste: !_cfg?.ativo,
    }).select().single();
    if (error) { sb.storage.from(BUCKET).remove(caminhos).catch(() => {}); throw error; }
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
  _passo = 'inicio'; limparPaginas(); _lida = null; _res = null; _busy = false;
  desenhar();
}
function limparPaginas() { _paginas.forEach(p => URL.revokeObjectURL(p.url)); _paginas = []; _tudoOk = false; _semFalta = false; }
function fechar() { pararCamara(); const ov = $('gr-ov'); if (ov) { ov.hidden = true; ov.classList.remove('gr-cam-on'); } document.body.classList.remove('gr-aberto'); }

document.addEventListener('click', e => {
  const b = e.target.closest('[data-gr]'); if (!b || !$('gr-ov')?.contains(b)) return;
  const a = b.dataset.gr;
  if (a === 'fechar') fechar();
  else if (a === 'foto') { limparPaginas(); _passo = 'camara'; desenhar(); }
  else if (a === 'maispag') { _passo = 'camara'; desenhar(); }
  else if (a === 'camvoltar') { _passo = _paginas.length ? 'paginas' : 'inicio'; desenhar(); }
  else if (a === 'disparar') { const v = $('gr-video'); if (v?.videoWidth) capturar(v); }
  else if (a === 'escolher') $('gr-file').click();
  else if (a === 'rempag') { const p = _paginas.splice(+b.dataset.i, 1)[0]; if (p) URL.revokeObjectURL(p.url); _tudoOk = false; _passo = _paginas.length ? 'paginas' : 'inicio'; desenhar(); }
  else if (a === 'ler') { if (_tudoOk && _paginas.length) lerPaginas(); }
  else if (a === 'semfalta') { _semFalta = true; desenhar(); }
  else if (a === 'cancelar') { limparPaginas(); _passo = 'inicio'; desenhar(); }
  else if (a === 'outra') { limparPaginas(); _passo = 'inicio'; desenhar(); }
  else if (a === 'guardar') guardar();
  else if (a === 'add') { lerCampos(); _lida.linhas.push({ descricao: '', ref_fornecedor: '', qtd: 1, un: '' }); desenhar(); }
  else if (a === 'rem') { lerCampos(); _lida.linhas.splice(+b.dataset.i, 1); desenhar(); }
  else if (a === 'ligar') ligar(b.dataset.f);
});
document.addEventListener('change', e => {
  if (e.target.id === 'gr-tudo') { _tudoOk = e.target.checked; const bt = document.querySelector('#gr-body [data-gr=ler]'); if (bt) bt.disabled = !(_tudoOk && _paginas.length); return; }
  if (e.target.id !== 'gr-file') return;
  const f = e.target.files?.[0]; e.target.value = '';
  if (f) fotoDeFicheiro(f);
});

// ── Entradas no menu: só para quem pode usar o ecrã ───────────────
export async function guiasInit() {
  await carregarCfg();
  const ok = posso();
  const row = $('enc-row-guias'); if (row) row.hidden = !ok;
  const nav = $('nav-guias'); if (nav) nav.hidden = !ok;
}

Object.assign(window, { guiasAbrir: abrir, guiasInit });
