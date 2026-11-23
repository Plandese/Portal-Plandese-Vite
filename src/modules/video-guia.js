// ═══════════════════════════════════════════════════════════════════
//  VÍDEO GUIADO — «Como funciona» de um módulo, narrado em português de Portugal
//  Em vez de um ficheiro de vídeo (que ficava desatualizado a cada mudança), o vídeo corre sobre o próprio
//  portal: cada cena põe o ecrã no estado certo, destaca uma zona, move um cursor e é narrada pela voz
//  pt-PT do sistema (Web Speech API), com legendas. Sem voz portuguesa no computador, fica só com legendas.
//
//  iniciarVideoGuia({ titulo, cenas, aoFechar })
//    cena = { capitulo, prep?: async () => {}, falas: [ string | { t, alvo?, acao?, cursor? } ], cartao?: { titulo, sub } }
//      prep   — põe o ecrã no estado da cena (corre também quando se salta para ela)
//      alvo   — seletor (ou função que devolve o elemento) a destacar a partir dessa fala
//      acao   — async (ctl) => {} antes da fala (ctl.cursor(el|seletor), ctl.clicar(), ctl.esperar(ms))
//      cursor — 'clique' (move o cursor para o alvo e clica) | 'mover' (só move)
//      cartao — cena sem alvo: cartão ao centro (abertura e fecho)
// ═══════════════════════════════════════════════════════════════════
const LS_VG = 'vg_preferencias';
const $q = s => (typeof s === 'function' ? s() : s ? document.querySelector(s) : null);
const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const espera = ms => new Promise(r => setTimeout(r, ms));
const ICO = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pausa: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.2"/></svg>',
  ant: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 20L9 12l10-8z" fill="currentColor"/><path d="M5 19V5"/></svg>',
  seg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4l10 8-10 8z" fill="currentColor"/><path d="M19 5v14"/></svg>',
  som: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  mudo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4z" fill="currentColor"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  cursor: '<svg viewBox="0 0 28 28"><path d="M5 3l17 10.5-7.4 1.6 4.3 8.2-3.4 1.8-4.3-8.3L5 22z" fill="#fff" stroke="#1b2130" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};

let _vg = null;

function prefs() { try { return JSON.parse(localStorage.getItem(LS_VG) || '{}'); } catch (e) { return {}; } }
function gravarPrefs(o) { try { localStorage.setItem(LS_VG, JSON.stringify({ ...prefs(), ...o })); } catch (e) { /* sem armazenamento */ } }

// vozes em português de Portugal (as «naturais» do Edge primeiro, depois a Helia do Windows…)
async function vozesPT() {
  if (!('speechSynthesis' in window)) return [];
  let v = speechSynthesis.getVoices();
  if (!v.length) {
    await new Promise(r => { const t = setTimeout(r, 1500); speechSynthesis.addEventListener('voiceschanged', () => { clearTimeout(t); r(); }, { once: true }); });
    v = speechSynthesis.getVoices();
  }
  const pt = v.filter(x => /^pt[-_]PT$/i.test(x.lang) || /Portugal/i.test(x.name));
  const peso = x => (/natural|online|neural/i.test(x.name) ? 0 : /raquel|duarte|helia|fernanda/i.test(x.name) ? 1 : 2);
  return pt.sort((a, b) => peso(a) - peso(b));
}

export async function iniciarVideoGuia({ titulo, cenas, aoFechar }) {
  if (_vg) return;
  const pf = prefs();
  const vozes = await vozesPT();
  const st = {
    cenas, i: 0, a_tocar: true, mudo: !vozes.length || !!pf.mudo, vozes,
    voz: vozes.find(v => v.name === pf.voz) || vozes[0] || null, vel: pf.vel || 1,
    run: 0, alvo: null, raf: 0, aoFechar,
  };
  _vg = st;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="vg" id="vg" role="dialog" aria-label="${esc(titulo)}">
      <div class="vg-bloq"></div>
      <div class="vg-foco" hidden></div>
      <div class="vg-cartao" hidden><small>${esc(titulo)}</small><b></b><p></p></div>
      <div class="vg-cursor">${ICO.cursor}<i class="vg-onda"></i></div>
      <div class="vg-player">
        <div class="vg-topo"><span class="vg-tit">${esc(titulo)}</span><span class="vg-cap"></span>
          <button type="button" class="vg-b vg-fechar" data-vg="fechar" aria-label="Fechar o vídeo" title="Fechar (Esc)">${ICO.x}</button></div>
        <div class="vg-leg" aria-live="polite"></div>
        <div class="vg-barra">${cenas.map((c, k) => `<button type="button" class="vg-seg" data-vg-c="${k}" title="${esc(c.capitulo)}" aria-label="Ir para: ${esc(c.capitulo)}"><i></i></button>`).join('')}</div>
        <div class="vg-ctl">
          <button type="button" class="vg-b" data-vg="ant" aria-label="Cena anterior" title="Cena anterior (←)">${ICO.ant}</button>
          <button type="button" class="vg-b vg-pp" data-vg="pp" aria-label="Pausa" title="Pausa / continuar (espaço)">${ICO.pausa}</button>
          <button type="button" class="vg-b" data-vg="seg" aria-label="Cena seguinte" title="Cena seguinte (→)">${ICO.seg}</button>
          <span class="vg-num"></span>
          <span class="vg-esp"></span>
          <button type="button" class="vg-b vg-vel" data-vg="vel" title="Velocidade da voz">${st.vel}×</button>
          ${vozes.length > 1 ? `<select class="vg-voz" aria-label="Voz">${vozes.map(v => `<option value="${esc(v.name)}" ${v === st.voz ? 'selected' : ''}>${esc(v.name.replace(/^Microsoft\s+/, '').replace(/\s*-\s*Portuguese \(Portugal\)/i, '').replace(/\s*\(Natural\)/i, ' (natural)'))}</option>`).join('')}</select>` : ''}
          <button type="button" class="vg-b vg-som" data-vg="som" aria-label="Som" title="${vozes.length ? 'Ligar / desligar a voz' : 'Este computador não tem voz em português de Portugal'}" ${vozes.length ? '' : 'disabled'}>${st.mudo ? ICO.mudo : ICO.som}</button>
        </div>
        ${vozes.length ? '' : '<p class="vg-aviso">Este computador não tem voz em português de Portugal: o vídeo segue com legendas. No Microsoft Edge há vozes portuguesas naturais.</p>'}
      </div>
    </div>`);
  const el = document.getElementById('vg');
  st.el = el;
  el.querySelector('.vg-player').addEventListener('click', e => {
    const b = e.target.closest('[data-vg],[data-vg-c]'); if (!b) return;
    if (b.dataset.vgC != null) return irPara(+b.dataset.vgC);
    const a = b.dataset.vg;
    if (a === 'fechar') return fecharVideoGuia();
    if (a === 'pp') return alternar();
    if (a === 'ant') return irPara(Math.max(0, st.i - 1));
    if (a === 'seg') return st.i + 1 < st.cenas.length ? irPara(st.i + 1) : fecharVideoGuia();
    if (a === 'som') { st.mudo = !st.mudo; gravarPrefs({ mudo: st.mudo }); speechSynthesis?.cancel(); b.innerHTML = st.mudo ? ICO.mudo : ICO.som; return; }
    if (a === 'vel') { st.vel = st.vel >= 1.3 ? 1 : Math.round((st.vel + 0.15) * 100) / 100; b.textContent = st.vel + '×'; gravarPrefs({ vel: st.vel }); }
  });
  el.querySelector('.vg-voz')?.addEventListener('change', e => { st.voz = st.vozes.find(v => v.name === e.target.value) || st.voz; gravarPrefs({ voz: st.voz?.name }); speechSynthesis.cancel(); });
  st.tecla = e => {
    if (!_vg) return;
    if (e.target.closest?.('.vg-player select')) return;
    const k = e.key;
    e.stopPropagation();          // durante o vídeo, as teclas não chegam ao módulo por baixo
    if (k === 'Escape') { e.preventDefault(); fecharVideoGuia(); }
    else if (k === ' ') { e.preventDefault(); alternar(); }
    else if (k === 'ArrowLeft') { e.preventDefault(); irPara(Math.max(0, st.i - 1)); }
    else if (k === 'ArrowRight') { e.preventDefault(); if (st.i + 1 < st.cenas.length) irPara(st.i + 1); }
  };
  window.addEventListener('keydown', st.tecla, true);
  // o foco segue o alvo (o ecrã pode redesenhar-se a meio da cena)
  const seguir = () => { if (!_vg) return; posicionarFoco(); st.raf = requestAnimationFrame(seguir); };
  st.raf = requestAnimationFrame(seguir);
  irPara(0);
}

export function fecharVideoGuia() {
  const st = _vg; if (!st) return;
  st.run++; _vg = null;
  cancelAnimationFrame(st.raf);
  try { speechSynthesis.cancel(); } catch (e) { /* sem síntese de voz */ }
  window.removeEventListener('keydown', st.tecla, true);
  st.el?.remove();
  try { st.aoFechar?.(); } catch (e) { console.error(e); }
}

function alternar() {
  const st = _vg; if (!st) return;
  if (st.el.classList.contains('fim')) { st.el.classList.remove('fim'); return irPara(0); }
  st.a_tocar = !st.a_tocar;
  if (!st.a_tocar) st.cancelarFala?.();
  st.el.querySelector('.vg-pp').innerHTML = st.a_tocar ? ICO.pausa : ICO.play;
  st.el.classList.toggle('pausa', !st.a_tocar);
  if (!st.a_tocar) try { speechSynthesis.cancel(); } catch (e) { /* idem */ }
  st.acordar?.();
}

function irPara(i) {
  const st = _vg; if (!st) return;
  st.cancelarFala?.();
  st.el.classList.remove('fim');
  try { speechSynthesis.cancel(); } catch (e) { /* idem */ }
  st.i = i; st.a_tocar = true;
  st.el.classList.remove('pausa');
  st.el.querySelector('.vg-pp').innerHTML = ICO.pausa;
  correrCena(++st.run);
}

// ── foco (zona destacada) e cursor ──
function posicionarFoco() {
  const st = _vg, f = st.el.querySelector('.vg-foco');
  const alvo = st.alvo ? $q(st.alvo) : null;
  const r = alvo && alvo.isConnected ? alvo.getBoundingClientRect() : null;
  if (!r || !r.width || !r.height) { f.hidden = true; st.el.classList.toggle('escuro', !st.cartao); return; }
  st.el.classList.remove('escuro');
  f.hidden = false;
  const m = 6, x = Math.max(4, r.left - m), y = Math.max(4, r.top - m);
  f.style.left = x + 'px'; f.style.top = y + 'px';
  f.style.width = Math.min(innerWidth - 8 - x, r.right + m - x) + 'px';
  f.style.height = Math.min(innerHeight - 8 - y, r.bottom + m - y) + 'px';
}
function centroDe(alvo) {
  const e = $q(alvo); if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: r.left + Math.min(r.width / 2, 60), y: r.top + Math.min(r.height / 2, 24) };
}
async function moverCursor(alvo, run) {
  const st = _vg; if (!st || st.run !== run) return;
  const p = alvo && typeof alvo === 'object' && 'x' in alvo ? alvo : centroDe(alvo); if (!p) return;
  const c = st.el.querySelector('.vg-cursor');
  c.classList.add('ver');
  c.style.left = p.x + 'px'; c.style.top = p.y + 'px';
  await espera(750);
}
async function clicar() {
  const st = _vg; if (!st) return;
  const c = st.el.querySelector('.vg-cursor');
  c.classList.remove('clica'); void c.offsetWidth; c.classList.add('clica');
  await espera(380);
}

// ── narração ──
function falar(texto, run) {
  const st = _vg;
  return new Promise(res => {
    if (!st || st.run !== run) return res('fim');
    const est = Math.max(1600, texto.length * 64 / st.vel) + 300;   // sem voz: tempo de leitura
    if (st.mudo || !st.voz) { const t = setTimeout(() => res('ok'), est); st.cancelarFala = () => { clearTimeout(t); res('cancel'); }; return; }
    const u = new SpeechSynthesisUtterance(texto);
    u.voice = st.voz; u.lang = st.voz.lang || 'pt-PT'; u.rate = st.vel; u.pitch = 1;
    let feito = false;
    const acabar = r => { if (feito) return; feito = true; clearTimeout(seg); res(r); };
    const seg = setTimeout(() => acabar('ok'), est * 2 + 3000);   // se o fim da fala não chegar
    u.onend = () => acabar('ok'); u.onerror = () => acabar('cancel');
    st.cancelarFala = () => acabar('cancel');
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}
async function esperarPlay(run) {
  const st = _vg;
  while (st && st.run === run && !st.a_tocar) await new Promise(r => { st.acordar = r; });
}

async function correrCena(run) {
  const st = _vg; if (!st) return;
  const c = st.cenas[st.i];
  // barra e capítulo
  st.el.querySelectorAll('.vg-seg').forEach((s, k) => { s.classList.toggle('feito', k < st.i); s.classList.toggle('ag', k === st.i); });
  st.el.querySelector('.vg-cap').textContent = c.capitulo;
  st.el.querySelector('.vg-num').textContent = `${st.i + 1} / ${st.cenas.length}`;
  st.el.querySelector('.vg-leg').textContent = '';
  st.alvo = null;
  // cartão ao centro (abertura / fecho)
  const ct = st.el.querySelector('.vg-cartao');
  st.cartao = !!c.cartao; ct.hidden = !c.cartao;
  st.el.classList.toggle('com-cartao', !!c.cartao);
  if (c.cartao) { ct.querySelector('b').textContent = c.cartao.titulo; ct.querySelector('p').textContent = c.cartao.sub || ''; st.el.querySelector('.vg-cursor').classList.remove('ver'); }
  try { await c.prep?.(); } catch (e) { console.error('vídeo guiado (prep):', e); }
  if (!_vg || st.run !== run) return;
  const ctl = { cursor: a => moverCursor(a, run), clicar, esperar: espera, alvo: a => { st.alvo = a; } };
  for (const f0 of c.falas) {
    const f = typeof f0 === 'string' ? { t: f0 } : f0;
    await esperarPlay(run); if (!_vg || st.run !== run) return;
    if (f.alvo !== undefined) {
      st.alvo = f.alvo;
      const e = $q(f.alvo);
      if (e) { const r = e.getBoundingClientRect(); if (r.top < 60 || r.bottom > innerHeight - 200) e.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      await espera(250);
      if (f.cursor) { await moverCursor(f.alvo, run); if (f.cursor === 'clique') await clicar(); }
    }
    if (f.acao) { try { await f.acao(ctl); } catch (e) { console.error('vídeo guiado (ação):', e); } }
    if (!_vg || st.run !== run) return;
    st.el.querySelector('.vg-leg').textContent = f.t;
    // repete a fala se carregarem em pausa a meio dela
    for (;;) {
      const r = await falar(f.t, run);
      if (!_vg || st.run !== run) return;
      if (r === 'cancel' && !st.a_tocar) { await esperarPlay(run); if (!_vg || st.run !== run) return; continue; }
      break;
    }
    await espera(280);
  }
  await espera(450);
  await esperarPlay(run);
  if (!_vg || st.run !== run) return;
  if (st.i + 1 < st.cenas.length) { st.i++; correrCena(run); }
  else { st.a_tocar = false; st.el.querySelector('.vg-pp').innerHTML = ICO.play; st.el.classList.add('fim'); }
}
