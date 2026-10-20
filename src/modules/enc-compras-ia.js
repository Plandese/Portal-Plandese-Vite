// ═══════════════════════════════════════
//  COMPRAS COM O AGENTE PLANDESE — ecrã do encarregado
//  · Conversa com a Edge Function "agente-compras" (só encarregados; só pedidos de compra)
//  · O catálogo de artigos vive no cliente: a cada mensagem enviam-se as melhores correspondências
//  · O pedido só é criado quando o encarregado confirma o cartão (ação "criar_pedido_compra")
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S } from '../state.js';
import { md } from './agente.js';

const URL_FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agente-compras`;
const ANON = import.meta.env.VITE_SUPABASE_KEY;
const $ = id => document.getElementById(id);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>';
const STOP = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
const SPARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>';

const SUGESTOES = ['Pedido de tout-venant', 'Pedido de areia', 'Pedido de cimento', 'Pedido de capacetes', 'Pedido de botas'];
const MAX_HIST = 14;

let msgs = [];          // {role, content, acoes?, erro?}
let corrente = null;
let busy = false;
let ctrl = null;
let ligado = false;
let ultimo = '';

// ── Catálogo de artigos (global ARTIGOS_CATALOGO, carregado por index.html) ──
const PARASITAS = new Set(['para', 'preciso', 'precisamos', 'quero', 'queria', 'pedir', 'pedido', 'material', 'obra', 'uns', 'umas', 'com', 'que', 'dos', 'das', 'mais', 'por', 'uma', 'ola', 'bom', 'dia', 'boa', 'tarde']);
function pesquisarCatalogo(texto) {
  const cat = typeof ARTIGOS_CATALOGO !== 'undefined' ? ARTIGOS_CATALOGO : null;
  if (!cat) return [];
  const toks = [...new Set(norm(texto).split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !PARASITAS.has(t)))].slice(0, 8);
  if (!toks.length) return [];
  const out = [];
  for (const g of Object.values(cat)) {
    for (const it of (g.items || [])) {
      const n = norm(it[1]);
      let score = 0;
      for (const t of toks) if (n.includes(t)) score++;
      if (score) out.push({ s: score - n.length / 1000, ref: it[0], nome: it[1], unidade: it[2] || 'un' });
    }
  }
  return out.sort((a, b) => b.s - a.s).slice(0, 25).map(({ ref, nome, unidade }) => ({ ref, nome, unidade }));
}

// ── Rede ─────────────────────────────────────────────────────────
async function chamar(body, signal) {
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Volte a iniciar sessão.');
  return fetch(URL_FN, {
    method: 'POST', signal,
    headers: { Authorization: 'Bearer ' + token, apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Voz: ditar (reconhecimento de fala) e ler as respostas (síntese de voz) ──
// Usa a API do próprio telemóvel/navegador; sem suporte, os botões de voz ficam escondidos.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const TTS = 'speechSynthesis' in window;
let rec = null, ouvindo = false, modoVoz = false, erroVoz = '';
let lerVoz = (() => { try { return localStorage.getItem('plandese_enc_voz') !== '0'; } catch (e) { return true; } })();

function marcarVoz() {
  $('ci-mic')?.classList.toggle('on', ouvindo);
  const v = $('ci-voz'); if (v) v.classList.toggle('off', !lerVoz);
}

function pararFalar() { if (TTS) speechSynthesis.cancel(); }

// Os telemóveis não dizem o género da voz: escolhe-se pelo nome (vozes femininas conhecidas de pt-PT
// no Windows, iOS/macOS e Android) e afastam-se as masculinas. Sem correspondência, usa a 1.ª voz pt-PT.
const VOZ_F = /helia|hélia|raquel|joana|catarina|fernanda|female|feminin|maria|google portugu/i;
const VOZ_M = /duarte|cosimo|diogo|male\b|masculin|-jmn-|-pmj-/i;
function vozFeminina() {
  const todas = speechSynthesis.getVoices();
  const pt = todas.filter(x => /^pt[-_]PT/i.test(x.lang));
  const lista = pt.length ? pt : todas.filter(x => /^pt/i.test(x.lang));
  return lista.find(x => VOZ_F.test(x.name) && !VOZ_M.test(x.name)) || lista.find(x => !VOZ_M.test(x.name)) || lista[0] || null;
}

function falar(texto, aoFim) {
  if (!TTS || !texto) return aoFim?.();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = 'pt-PT';
  const v = vozFeminina();
  if (v) { u.voice = v; u.lang = v.lang; }
  u.pitch = 1.05;
  let feito = false;
  const fim = () => { if (!feito) { feito = true; aoFim?.(); } };
  u.onend = fim; u.onerror = fim;
  speechSynthesis.speak(u);
}

// Texto a ler: resposta sem markdown + resumo falado do pedido pendente
function textoParaFalar(m) {
  let t = String(m.content || '').replace(/[*_`#|>]/g, ' ').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim();
  for (const a of (m.acoes || []).filter(x => x.estado === 'pendente')) {
    const p = a.params || {};
    const lista = (p.artigos || []).map(x => `${x.quantidade} ${x.unidade && x.unidade !== 'un' ? x.unidade + ' de ' : ''}${x.descricao}`).join('; ');
    t += ` Pedido para ${p.obra_nome || 'a obra'}: ${lista}${p.data_limite ? ', para ' + String(p.data_limite).split('-').reverse().join('/') : ''}. Diga confirmar para enviar, ou cancelar.`;
  }
  return t.trim();
}

function iniciarOuvir() {
  if (!SR || busy || ouvindo) return;
  pararFalar();
  const inp = $('ci-in');
  erroVoz = '';
  rec = new SR();
  rec.lang = 'pt-PT'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
  rec.onstart = () => { ouvindo = true; marcarVoz(); if (inp) inp.placeholder = 'A ouvir… fale agora'; };
  rec.onresult = e => {
    let t = '';
    for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
    if (inp) inp.value = t;
  };
  rec.onerror = e => { erroVoz = e.error || 'erro'; };
  rec.onend = () => {
    ouvindo = false; marcarVoz();
    if (inp) inp.placeholder = 'Escreva o que precisa…';
    const txt = (inp?.value || '').trim();
    if (erroVoz === 'not-allowed' || erroVoz === 'service-not-allowed') {
      avisoVoz('Não tenho permissão para usar o microfone. Ative-a nas definições do telemóvel.');
    } else if (txt && !erroVoz) {
      inp.value = ''; inp.style.height = 'auto';
      tratarFala(txt);
    } else { modoVoz = false; if (erroVoz && erroVoz !== 'no-speech' && erroVoz !== 'aborted') avisoVoz('Não consegui ouvir bem. Tente outra vez ou escreva.'); }
  };
  try { rec.start(); } catch (e) { ouvindo = false; marcarVoz(); }
}

function pararOuvir() { if (rec && ouvindo) { try { rec.stop(); } catch (e) { /* já parado */ } } }

function avisoVoz(t) {
  msgs.push({ role: 'assistant', content: '', erro: t, acoes: [] });
  render(true);
}

// Responder "confirmar"/"cancelar" por voz ao cartão pendente; o resto segue como mensagem normal
function tratarFala(txt) {
  const pend = msgs.flatMap(m => m.acoes || []).filter(a => a.estado === 'pendente').pop();
  const n = norm(txt).replace(/[^a-z ]/g, '').trim();
  if (pend && /^(sim|confirm\w*|pode ser|pode enviar|envia\w*|esta bem|ok|certo)\b/.test(n)) { modoVoz = true; return decidirAcao(pend.id, 'confirmar'); }
  if (pend && /^(nao|cancel\w*|deixa|esquece)\b/.test(n)) { modoVoz = true; return decidirAcao(pend.id, 'cancelar'); }
  enviar(txt, true);
}

function falarResposta(m) {
  if (!modoVoz || !lerVoz) { if (modoVoz && !lerVoz) modoVoz = false; return; }
  const pendente = (m.acoes || []).some(a => a.estado === 'pendente');
  const pergunta = /\?\s*$/.test(String(m.content || '').trim());
  falar(textoParaFalar(m), () => { if (modoVoz && (pendente || pergunta)) iniciarOuvir(); else modoVoz = false; });
}

// ── Abrir o ecrã ─────────────────────────────────────────────────
export function comprasIAAbrir() {
  const ecra = $('ci-body')?.closest('#enc-screen-compras-chat');
  if (!ecra) return;
  if ($('ci-mic')) $('ci-mic').hidden = !SR;
  if ($('ci-voz')) $('ci-voz').hidden = !(SR && TTS);
  marcarVoz();
  if (!ligado) {
    ligado = true;
    ecra.addEventListener('click', onClick);
    const inp = $('ci-in');
    inp?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarDoInput(); } });
    inp?.addEventListener('input', () => { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 120) + 'px'; });
  }
  render(true);
}

function onClick(e) {
  const t = e.target.closest('[data-ci]');
  if (!t) return;
  const a = t.dataset.ci;
  if (a === 'mic') { if (ouvindo) return pararOuvir(); if (busy) return; return iniciarOuvir(); }
  if (a === 'voz') {
    lerVoz = !lerVoz; if (!lerVoz) pararFalar();
    try { localStorage.setItem('plandese_enc_voz', lerVoz ? '1' : '0'); } catch (e) { /* sem armazenamento */ }
    return marcarVoz();
  }
  if (a === 'enviar') { pararFalar(); modoVoz = false; return busy ? ctrl?.abort() : enviarDoInput(); }
  if (a === 'chip') { modoVoz = false; return enviar(t.dataset.q); }
  if (a === 'acao') { modoVoz = false; pararFalar(); return decidirAcao(t.dataset.id, t.dataset.d); }
  if (a === 'novo') return novaConversa();
  if (a === 'retry') return ultimo && enviar(ultimo);
}

function novaConversa() {
  pararFalar(); pararOuvir(); modoVoz = false;
  if (busy) ctrl?.abort();
  msgs = []; corrente = null; render();
}

function enviarDoInput() {
  const inp = $('ci-in'); if (!inp) return;
  const v = inp.value.trim();
  if (!v) return;
  inp.value = ''; inp.style.height = 'auto';
  enviar(v);
}

// ── Envio e leitura do stream ────────────────────────────────────
async function enviar(texto, porVoz = false) {
  if (busy || !texto) return;
  modoVoz = porVoz;
  ultimo = texto;
  msgs.push({ role: 'user', content: texto });
  corrente = { role: 'assistant', content: '', acoes: [], estado: '' };
  msgs.push(corrente);
  setBusy(true); render(true);

  const historico = msgs.slice(0, -1).filter(m => m.content).slice(-MAX_HIST).map(m => ({ role: m.role, content: m.content }));
  const penultimo = [...msgs].reverse().filter(m => m.role === 'user' && m.content)[1]?.content || '';
  const catalogo = pesquisarCatalogo(texto + ' ' + penultimo);
  ctrl = new AbortController();
  let fim = false;
  try {
    const r = await chamar({ acao: 'chat', mensagens: historico, catalogo }, ctrl.signal);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || ('Erro ' + r.status));
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const linha = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!linha) continue;
        let ev; try { ev = JSON.parse(linha); } catch (_) { continue; }
        if (ev.type === 'fim') fim = true;
        tratarEvento(ev);
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') corrente.content += corrente.content ? '\n\n_(interrompido)_' : '_(interrompido)_';
    else corrente.erro = String(e.message || e);
  } finally {
    if (!fim && !corrente.content && !corrente.erro && !corrente.acoes.length) corrente.erro = 'Sem resposta do assistente.';
    corrente.estado = '';
    const feita = corrente;
    corrente = null; setBusy(false); ctrl = null;
    render(true);
    if (modoVoz && !feita.erro) falarResposta(feita); else modoVoz = false;
  }
}

function tratarEvento(ev) {
  if (!corrente) return;
  if (ev.type === 'texto') { corrente.content += ev.texto; corrente.estado = ''; }
  else if (ev.type === 'ferramenta') {
    if (corrente.content && !/\n\n$/.test(corrente.content)) corrente.content += '\n\n';
    corrente.estado = ev.rotulo || '';
  } else if (ev.type === 'acao') corrente.acoes.push({ id: ev.id, resumo: ev.resumo, params: ev.params, estado: 'pendente' });
  else if (ev.type === 'erro') corrente.erro = ev.mensagem;
  atualizarCorrente();
}

function setBusy(v) {
  busy = v;
  const b = $('ci-send');
  if (b) { b.innerHTML = v ? STOP : SEND; b.title = v ? 'Parar' : 'Enviar'; }
}

// ── Confirmar / cancelar o pedido proposto ───────────────────────
async function decidirAcao(id, decisao) {
  const alvo = msgs.flatMap(m => m.acoes || []).find(a => a.id === id);
  if (!alvo || alvo.estado !== 'pendente') return;
  alvo.estado = 'a_processar'; render();
  try {
    const r = await chamar({ acao: decisao === 'confirmar' ? 'confirmar' : 'cancelar', acao_id: id });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('Erro ' + r.status));
    if (decisao === 'confirmar') { alvo.estado = j.ok ? 'feita' : 'erro'; alvo.msg = j.ok ? j.mensagem : j.erro; }
    else alvo.estado = 'cancelada';
  } catch (e) { alvo.estado = 'erro'; alvo.msg = String(e.message || e); }
  render();
  if (modoVoz && lerVoz) {
    const frase = alvo.estado === 'feita' ? alvo.msg : alvo.estado === 'cancelada' ? 'Pedido cancelado.' : 'Não foi possível enviar o pedido. ' + (alvo.msg || '');
    falar(frase, () => { modoVoz = false; });
  } else modoVoz = false;
}

// ── Desenho ──────────────────────────────────────────────────────
function htmlVazio() {
  const nome = esc(String(S.currentUser?.nome || '').trim().split(/\s+/)[0] || '');
  return `<div class="ci-hello">
      <div class="ci-hello-ic">${SPARK}</div>
      <h3>Olá${nome ? ', ' + nome : ''}.</h3>
      <p>Diga-me o que precisa para a obra e eu preparo o pedido de compras. Também posso ver o estado dos seus pedidos.</p>
    </div>
    <div class="ci-chips">${SUGESTOES.map(q => `<button type="button" data-ci="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>`;
}

function htmlAcao(a) {
  const p = a.params || {};
  const lista = (p.artigos || []).map(x => `<li><b>${esc(x.quantidade)}</b> ${esc(x.descricao)}</li>`).join('');
  let ctr;
  if (a.estado === 'pendente') ctr = `<div class="ci-ac-b"><button type="button" class="ok" data-ci="acao" data-d="confirmar" data-id="${esc(a.id)}">Enviar pedido</button><button type="button" data-ci="acao" data-d="cancelar" data-id="${esc(a.id)}">Cancelar</button></div>`;
  else if (a.estado === 'a_processar') ctr = '<div class="ci-ac-s">A enviar…</div>';
  else if (a.estado === 'feita') ctr = `<div class="ci-ac-s good">✓ ${esc(a.msg || 'Pedido enviado')}</div>`;
  else if (a.estado === 'cancelada') ctr = '<div class="ci-ac-s">Cancelado</div>';
  else ctr = `<div class="ci-ac-s bad">✕ ${esc(a.msg || 'Não foi possível enviar o pedido')}</div>`;
  return `<div class="ci-ac">
      <div class="ci-ac-t">Pedido de compras</div>
      <div class="ci-ac-o">${esc(p.obra_nome || '')}</div>
      <ul>${lista}</ul>
      <div class="ci-ac-m">${p.urgencia ? `<span class="ci-pill ${p.urgencia === 'Normal' ? '' : 'warn'}">${esc(p.urgencia)}</span>` : ''}${p.data_limite ? `<span class="ci-pill">Para ${esc(String(p.data_limite).split('-').reverse().join('/'))}</span>` : ''}</div>
      ${p.notas ? `<div class="ci-ac-n">${esc(p.notas)}</div>` : ''}
      ${ctr}
    </div>`;
}

function htmlMsg(m) {
  if (m.role === 'user') return `<div class="ci-m user"><div class="ci-b">${esc(m.content)}</div></div>`;
  const corpo = m.content ? md(m.content) : '';
  const est = m.estado ? `<div class="ci-st"><span class="ci-dots"><i></i><i></i><i></i></span>${esc(m.estado)}…</div>` : '';
  const pensar = (!m.content && !m.estado && !m.erro && !m.acoes?.length && busy && m === corrente)
    ? '<div class="ci-st"><span class="ci-dots"><i></i><i></i><i></i></span>A pensar…</div>' : '';
  const err = m.erro ? `<div class="ci-err">${esc(m.erro)} <button type="button" data-ci="retry">Tentar de novo</button></div>` : '';
  return `<div class="ci-m bot"><div class="ci-b">${corpo}${est}${pensar}${err}${(m.acoes || []).map(htmlAcao).join('')}</div></div>`;
}

function render(descer) {
  const body = $('ci-body'); if (!body) return;
  const novo = $('ci-novo'); if (novo) novo.hidden = !msgs.length;
  if (!msgs.length) { body.innerHTML = htmlVazio(); return; }
  const perto = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  body.innerHTML = msgs.map(htmlMsg).join('');
  if (descer || perto) body.scrollTop = body.scrollHeight;
}

function atualizarCorrente() {
  const body = $('ci-body'); if (!body || !corrente) return;
  const ult = body.lastElementChild;
  if (!ult || !ult.classList.contains('bot')) { render(true); return; }
  const perto = body.scrollHeight - body.scrollTop - body.clientHeight < 120;
  ult.outerHTML = htmlMsg(corrente);
  if (perto) body.scrollTop = body.scrollHeight;
}
