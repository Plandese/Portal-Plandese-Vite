// ═══════════════════════════════════════════════════════════════════
//  GUIAS DE REMESSA — o encarregado limita-se a fotografar a guia que recebe em obra.
//  As fotografias seguem para o servidor (função guias-pdf), que as junta num PDF e o guarda na pasta «Guias»
//  da Dropbox. O casamento das guias com as faturas faz-se depois, no portal da empresa (ecrã «Guias de remessa»).
//
//  O ecrã só aparece a quem está em app_config 'guias'.teste (ou a todos os encarregados quando 'guias'.ativo = true).
// ═══════════════════════════════════════════════════════════════════
import { S, R } from '../state.js';
import { sb } from '../supabase.js';

const BUCKET = 'guias-remessa';
const $ = id => document.getElementById(id);
const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
let _passo = 'inicio';   // inicio | camara | paginas | enviando | enviada
let _tudoOk = false;     // "confirmo que fotografei todas as páginas"
let _busy = false, _pdfOk = true;

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
const fmtData = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }); };

async function listaMinhas() {
  const { data } = await sb.from('guias_remessa').select('id,obra_nome,paginas,pdf_path,criado_em').eq('criado_por', S.currentUser?.key || '').order('criado_em', { ascending: false }).limit(8);
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
    b.innerHTML = `<button type="button" class="gr-foto" data-gr="foto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg><b>Fotografar guia</b><small>A câmara tira a foto sozinha quando a folha encaixa. Guias com várias páginas: uma foto por página.</small></button>
      <div class="gr-sec">As minhas guias</div><div id="gr-lista" class="gr-lista">A carregar…</div>`;
    try {
      const l = await listaMinhas();
      $('gr-lista').innerHTML = l.length ? l.map(g => `<div class="gr-li"><div><b>${esc(fmtData(g.criado_em))}</b><small>${esc(g.obra_nome || 'Sem obra')} · ${g.paginas || 1} pág.</small></div>${g.pdf_path ? pill('Enviada ✓', 'ok') : pill('A processar', 'mute')}</div>`).join('') : '<div class="gr-vazio">Ainda não enviou nenhuma guia.</div>';
    } catch (e) { $('gr-lista').innerHTML = '<div class="gr-vazio">Não foi possível carregar a lista.</div>'; }
  } else if (_passo === 'enviando') {
    sub.textContent = 'A enviar a guia…';
    b.innerHTML = '<div class="gr-load"><div class="gr-spin"></div><b>A enviar a guia</b><small>Não feche o ecrã</small></div>';
  } else if (_passo === 'enviada') {
    sub.textContent = 'Guia enviada';
    b.innerHTML = `<div class="gr-res ok"><b>Guia enviada ✓</b><small>${_pdfOk ? 'As fotografias foram guardadas em PDF.' : 'As fotografias foram guardadas. O PDF fica disponível em breve.'}</small></div>
      <button type="button" class="gr-pri" data-gr="outra">Fotografar outra guia</button><button type="button" class="gr-sec-btn" data-gr="fechar">Fechar</button>`;
  }
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
    <button type="button" class="gr-pri" data-gr="enviar" ${_tudoOk && n ? '' : 'disabled'}>Enviar guia</button>
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

// Envia as fotografias, regista a guia e pede ao servidor o PDF (pasta «Guias» da Dropbox)
async function enviar() {
  if (_busy || !_paginas.length) return;
  _busy = true; _passo = 'enviando'; desenhar();
  const caminhos = [];
  try {
    const base = `${S.currentUser?.key || 'anon'}/${Date.now()}`;
    for (let i = 0; i < _paginas.length; i++) {
      const path = `${base}-p${i + 1}.jpg`;
      const up = await sb.storage.from(BUCKET).upload(path, _paginas[i].blob, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      caminhos.push(path);
    }
    // a obra só é indicada quando o encarregado tem uma única obra ativa
    const minhas = (S.OBRAS || []).filter(o => o.ativa !== false && (o.encarregado_id === S.currentUser?.key || (o.encarregados_extra || []).includes(S.currentUser?.key)));
    const obra = minhas.length === 1 ? minhas[0] : null;
    const { data, error } = await sb.from('guias_remessa').insert({
      obra_id: obra?.id || null, obra_nome: obra?.nome || null, linhas: [], confianca: null, avisos: [],
      foto_path: caminhos[0], fotos: caminhos, paginas: caminhos.length, teste: !_cfg?.ativo,
    }).select('id').single();
    if (error) throw error;
    _pdfOk = true;
    try {
      const r = await sb.functions.invoke('guias-pdf', { body: { guia_id: data.id } });
      if (r.error || !r.data?.ok) throw new Error(r.data?.error || r.error?.message || 'sem resposta');
    } catch (e) { console.warn('guias-pdf:', e); _pdfOk = false; }   // a guia já está guardada; o escritório pode gerar o PDF depois
    R.emitEvent?.({ acao: `Guia de remessa enviada${obra ? ' · ' + obra.nome : ''}`, seccao: 'faturas', obra: obra?.id || undefined });
    limparPaginas(); _passo = 'enviada';
  } catch (e) {
    if (caminhos.length) sb.storage.from(BUCKET).remove(caminhos).catch(() => {});
    _passo = 'paginas'; _busy = false; desenhar();
    return erro('Não foi possível enviar a guia: ' + (e.message || e));
  }
  _busy = false; desenhar();
}

function abrir() {
  garantirOverlay().hidden = false;
  document.body.classList.add('gr-aberto');
  _passo = 'inicio'; limparPaginas(); _busy = false;
  desenhar();
}
function limparPaginas() { _paginas.forEach(p => URL.revokeObjectURL(p.url)); _paginas = []; _tudoOk = false; }
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
  else if (a === 'enviar') { if (_tudoOk && _paginas.length) enviar(); }
  else if (a === 'cancelar' || a === 'outra') { limparPaginas(); _passo = 'inicio'; desenhar(); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'gr-tudo') { _tudoOk = e.target.checked; const bt = document.querySelector('#gr-body [data-gr=enviar]'); if (bt) bt.disabled = !(_tudoOk && _paginas.length); return; }
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
