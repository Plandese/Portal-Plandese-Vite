// ═══════════════════════════════════════
//  AGENTE PLANDESE PARA ENCARREGADOS — conversa por texto e voz
//  · Um motor de conversa, vários agentes (cada um é uma Edge Function com JWT do utilizador):
//      compras → "agente-compras" (pedidos de compra)
//      ponto   → "agente-ponto"   (folha de ponto MO Plandese)
//  · O agente propõe um cartão; só grava quando o encarregado confirma (botão ou voz).
//  · Voz: ditado (o texto aparece logo na conversa) e leitura das respostas em voz feminina.
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S, R } from '../state.js';
import { md } from './agente.js';

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/`;
const ANON = import.meta.env.VITE_SUPABASE_KEY;
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dataPT = d => String(d || '').split('-').reverse().join('/');

const SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>';
const STOP = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
const SPARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>';
const MAX_HIST = 14;

// ── Voz (partilhada pelos agentes) ───────────────────────────────
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const TTS = 'speechSynthesis' in window;
let lerVoz = (() => { try { return localStorage.getItem('plandese_enc_voz') !== '0'; } catch (e) { return true; } })();

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
function pararFalar() { if (TTS) speechSynthesis.cancel(); }
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

// ── Motor de conversa ────────────────────────────────────────────
// cfg: { fn, tela, p (prefixo dos ids), sugestoes, intro, catalogo, cartao(params,ctr), falar(params), enviar, aoFeita(params) }
function criarChat(cfg) {
  const $ = id => document.getElementById(cfg.p + id);
  let msgs = [];          // {role, content, acoes?, erro?}
  let corrente = null, busy = false, ctrl = null, ligado = false, ultimo = '';
  let rec = null, ouvindo = false, modoVoz = false, erroVoz = '', textoOuvido = '';

  async function chamar(body, signal) {
    const { data } = await sb.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error('Sessão expirada. Volte a iniciar sessão.');
    return fetch(BASE + cfg.fn, {
      method: 'POST', signal,
      headers: { Authorization: 'Bearer ' + token, apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function marcarVoz() {
    $('mic')?.classList.toggle('on', ouvindo);
    const v = $('voz'); if (v) v.classList.toggle('off', !lerVoz);
  }

  // Balão provisório com o que vai sendo ouvido; vira a mensagem normal quando a frase acaba
  function desenharOuvido() {
    const body = $('body'); if (!body) return;
    let el = $('live');
    if (!textoOuvido) { el?.remove(); return; }
    if (!msgs.length) body.innerHTML = '';
    if (!el) { el = document.createElement('div'); el.id = cfg.p + 'live'; el.className = 'ci-m user live'; body.appendChild(el); }
    el.innerHTML = '<div class="ci-b">' + esc(textoOuvido) + '</div>';
    body.scrollTop = body.scrollHeight;
  }

  // Texto a ler: resposta sem markdown + resumo falado do cartão pendente
  function textoParaFalar(m) {
    let t = String(m.content || '').replace(/[*_`#|>]/g, ' ').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim();
    for (const a of (m.acoes || []).filter(x => x.estado === 'pendente')) t += ' ' + cfg.falar(a.params || {});
    return t.trim();
  }

  // Mensagem por tipo de erro do reconhecimento de fala (código no fim, para diagnóstico)
  const MSG_VOZ = {
    'not-allowed': 'O microfone está bloqueado. Ative a permissão do microfone para esta página/app nas definições do tablet.',
    'service-not-allowed': 'Este navegador não deixa usar o reconhecimento de voz. Abra o portal no Chrome.',
    'audio-capture': 'Não encontrei o microfone neste dispositivo.',
    'network': 'Sem ligação ao serviço de voz do Google. Verifique a internet.',
    'language-not-supported': 'O português não está disponível para ditado neste dispositivo.',
  };
  let aguardaInicio = 0;

  function iniciarOuvir() {
    if (!SR || busy || ouvindo) return;
    pararFalar();
    const inp = $('in');
    erroVoz = ''; textoOuvido = '';
    try { rec = new SR(); } catch (e) { return avisoVoz('Este dispositivo não permite o reconhecimento de voz. Abra o portal no Chrome.'); }
    rec.lang = 'pt-PT'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    // Se em 3 s o microfone não arrancou (alguns tablets/WebViews aceitam o pedido e ficam calados), avisa
    clearTimeout(aguardaInicio);
    aguardaInicio = setTimeout(() => {
      if (!ouvindo) { try { rec.abort(); } catch (e) { /* nada */ } modoVoz = false; avisoVoz('O microfone não arrancou neste dispositivo. Abra o portal no Chrome e permita o microfone, ou escreva.'); }
    }, 3000);
    rec.onstart = () => { clearTimeout(aguardaInicio); ouvindo = true; marcarVoz(); if (inp) inp.placeholder = 'A ouvir… fale agora'; };
    rec.onresult = e => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      textoOuvido = t;
      desenharOuvido();
    };
    rec.onerror = e => { clearTimeout(aguardaInicio); erroVoz = e.error || 'erro'; };
    rec.onend = () => {
      clearTimeout(aguardaInicio);
      const estavaAOuvir = ouvindo;
      ouvindo = false; marcarVoz();
      if (inp) inp.placeholder = cfg.placeholder;
      const txt = textoOuvido.trim();
      textoOuvido = ''; $('live')?.remove();
      if (erroVoz && erroVoz !== 'no-speech' && erroVoz !== 'aborted') {
        modoVoz = false;
        avisoVoz((MSG_VOZ[erroVoz] || 'Não consegui ouvir bem. Tente outra vez ou escreva.') + ' (' + erroVoz + ')');
      } else if (txt && !erroVoz) {
        tratarFala(txt);
      } else {
        modoVoz = false;
        if (estavaAOuvir && erroVoz === 'no-speech') avisoVoz('Não ouvi nada. Carregue no microfone e fale logo a seguir.');
      }
    };
    try { rec.start(); } catch (e) { clearTimeout(aguardaInicio); ouvindo = false; marcarVoz(); avisoVoz('Não foi possível ligar o microfone (' + (e?.name || 'erro') + ').'); }
  }
  function pararOuvir() { if (rec && ouvindo) { try { rec.stop(); } catch (e) { /* já parado */ } } }
  function avisoVoz(t) { msgs.push({ role: 'assistant', content: '', erro: t, acoes: [] }); render(true); }

  // Responder "confirmar"/"cancelar" por voz ao cartão pendente; o resto segue como mensagem normal
  function tratarFala(txt) {
    const pend = msgs.flatMap(m => m.acoes || []).filter(a => a.estado === 'pendente').pop();
    const n = norm(txt).replace(/[^a-z ]/g, '').trim();
    if (pend && /^(sim|confirm\w*|pode ser|pode enviar|pode guardar|envia\w*|guarda\w*|esta bem|ok|certo)\b/.test(n)) { modoVoz = true; return decidirAcao(pend.id, 'confirmar'); }
    if (pend && /^(nao|cancel\w*|deixa|esquece)\b/.test(n)) { modoVoz = true; return decidirAcao(pend.id, 'cancelar'); }
    enviar(txt, true);
  }

  function falarResposta(m) {
    if (!modoVoz || !lerVoz) { if (modoVoz && !lerVoz) modoVoz = false; return; }
    const pendente = (m.acoes || []).some(a => a.estado === 'pendente');
    const pergunta = /\?\s*$/.test(String(m.content || '').trim());
    falar(textoParaFalar(m), () => { if (modoVoz && (pendente || pergunta)) iniciarOuvir(); else modoVoz = false; });
  }

  function abrir() {
    const ecra = document.getElementById(cfg.tela);
    if (!ecra) return;
    if ($('mic')) $('mic').hidden = !SR;
    if ($('voz')) $('voz').hidden = !(SR && TTS);
    marcarVoz();
    if (!ligado) {
      ligado = true;
      ecra.addEventListener('click', onClick);
      const inp = $('in');
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
      try { localStorage.setItem('plandese_enc_voz', lerVoz ? '1' : '0'); } catch (err) { /* sem armazenamento */ }
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
    const inp = $('in'); if (!inp) return;
    const v = inp.value.trim();
    if (!v) return;
    inp.value = ''; inp.style.height = 'auto';
    enviar(v);
  }

  async function enviar(texto, porVoz = false) {
    if (busy || !texto) return;
    modoVoz = porVoz;
    ultimo = texto;
    msgs.push({ role: 'user', content: texto });
    corrente = { role: 'assistant', content: '', acoes: [], estado: '' };
    msgs.push(corrente);
    setBusy(true); render(true);

    const historico = msgs.slice(0, -1).filter(m => m.content).slice(-MAX_HIST).map(m => ({ role: m.role, content: m.content }));
    const corpo = { acao: 'chat', mensagens: historico };
    if (cfg.catalogo) {
      const penultimo = [...msgs].reverse().filter(m => m.role === 'user' && m.content)[1]?.content || '';
      corpo.catalogo = pesquisarCatalogo(texto + ' ' + penultimo);
    }
    ctrl = new AbortController();
    let fim = false;
    try {
      const r = await chamar(corpo, ctrl.signal);
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
    const b = $('send');
    if (b) { b.innerHTML = v ? STOP : SEND; b.title = v ? 'Parar' : 'Enviar'; }
  }

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
    if (alvo.estado === 'feita') { try { cfg.aoFeita?.(alvo.params || {}); } catch (e) { console.warn('aoFeita:', e); } }
    render();
    if (modoVoz && lerVoz) {
      const frase = alvo.estado === 'feita' ? alvo.msg : alvo.estado === 'cancelada' ? 'Cancelado.' : 'Não foi possível concluir. ' + (alvo.msg || '');
      falar(frase, () => { modoVoz = false; });
    } else modoVoz = false;
  }

  // ── Desenho ──
  function htmlVazio() {
    const nome = esc(String(S.currentUser?.nome || '').trim().split(/\s+/)[0] || '');
    return `<div class="ci-hello">
        <div class="ci-hello-ic">${SPARK}</div>
        <h3>Olá${nome ? ', ' + nome : ''}.</h3>
        <p>${esc(cfg.intro)}</p>
      </div>
      <div class="ci-chips">${cfg.sugestoes.map(q => `<button type="button" data-ci="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>`;
  }

  function htmlAcao(a) {
    let ctr;
    if (a.estado === 'pendente') ctr = `<div class="ci-ac-b"><button type="button" class="ok" data-ci="acao" data-d="confirmar" data-id="${esc(a.id)}">${esc(cfg.enviar)}</button><button type="button" data-ci="acao" data-d="cancelar" data-id="${esc(a.id)}">Cancelar</button></div>`;
    else if (a.estado === 'a_processar') ctr = '<div class="ci-ac-s">A guardar…</div>';
    else if (a.estado === 'feita') ctr = `<div class="ci-ac-s good">✓ ${esc(a.msg || 'Feito')}</div>`;
    else if (a.estado === 'cancelada') ctr = '<div class="ci-ac-s">Cancelado</div>';
    else ctr = `<div class="ci-ac-s bad">✕ ${esc(a.msg || 'Não foi possível concluir')}</div>`;
    return cfg.cartao(a.params || {}, ctr);
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
    const body = $('body'); if (!body) return;
    const novo = $('novo'); if (novo) novo.hidden = !msgs.length;
    if (!msgs.length) { body.innerHTML = textoOuvido ? '' : htmlVazio(); desenharOuvido(); return; }
    const perto = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    body.innerHTML = msgs.map(htmlMsg).join('');
    desenharOuvido();
    if (descer || perto) body.scrollTop = body.scrollHeight;
  }

  function atualizarCorrente() {
    const body = $('body'); if (!body || !corrente) return;
    const ult = body.lastElementChild;
    if (!ult || !ult.classList.contains('bot')) { render(true); return; }
    const perto = body.scrollHeight - body.scrollTop - body.clientHeight < 120;
    ult.outerHTML = htmlMsg(corrente);
    if (perto) body.scrollTop = body.scrollHeight;
  }

  return { abrir };
}

// ── Agente de compras ────────────────────────────────────────────
const compras = criarChat({
  fn: 'agente-compras', tela: 'enc-screen-compras-chat', p: 'ci-',
  placeholder: 'Escreva o que precisa…', enviar: 'Enviar pedido', catalogo: true,
  intro: 'Diga-me o que precisa para a obra e eu preparo o pedido de compras. Também posso ver o estado dos seus pedidos.',
  sugestoes: ['Pedido de tout-venant', 'Pedido de areia', 'Pedido de cimento', 'Pedido de capacetes', 'Pedido de botas'],
  falar: p => {
    const lista = (p.artigos || []).map(x => `${x.quantidade} ${x.unidade && x.unidade !== 'un' ? x.unidade + ' de ' : ''}${x.descricao}`).join('; ');
    return `Pedido para ${p.obra_nome || 'a obra'}: ${lista}${p.data_limite ? ', para ' + dataPT(p.data_limite) : ''}. Diga confirmar para enviar, ou cancelar.`;
  },
  cartao: (p, ctr) => `<div class="ci-ac">
      <div class="ci-ac-t">Pedido de compras</div>
      <div class="ci-ac-o">${esc(p.obra_nome || '')}</div>
      <ul>${(p.artigos || []).map(x => `<li><b>${esc(x.quantidade)}</b> ${esc(x.descricao)}</li>`).join('')}</ul>
      <div class="ci-ac-m">${p.urgencia ? `<span class="ci-pill ${p.urgencia === 'Normal' ? '' : 'warn'}">${esc(p.urgencia)}</span>` : ''}${p.data_limite ? `<span class="ci-pill">Para ${esc(dataPT(p.data_limite))}</span>` : ''}</div>
      ${p.notas ? `<div class="ci-ac-n">${esc(p.notas)}</div>` : ''}
      ${ctr}
    </div>`,
});

// ── Agente da folha de ponto (MO Plandese) ───────────────────────
const fmtH = h => { const m = Math.round((h || 0) * 60); return Math.floor(m / 60) + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : ''); };
const ponto = criarChat({
  fn: 'agente-ponto', tela: 'enc-screen-ponto-ia', p: 'cp-',
  placeholder: 'Diga quem trabalhou e a que horas…', enviar: 'Guardar folha', catalogo: false,
  intro: 'Diga-me quem trabalhou, em que obra e a que horas, e eu preencho a folha de ponto. Também posso repetir a equipa de ontem.',
  sugestoes: ['Mesma equipa de ontem', 'Hoje trabalharam todos das 8 às 17', 'Quem registei ontem?'],
  falar: p => {
    const faltas = (p.registos || []).filter(r => r.tipo !== 'Presença');
    const pres = (p.registos || []).filter(r => r.tipo === 'Presença');
    let t = `Folha de ${dataPT(p.data)} na obra ${p.obra_nome || ''}: ${pres.length} presença${pres.length === 1 ? '' : 's'}`;
    if (pres.length) t += `, das ${pres[0].entrada} às ${pres[0].saida}`;
    if (faltas.length) t += `, e ${faltas.length} ausência${faltas.length === 1 ? '' : 's'}: ` + faltas.map(r => `${r.nome} ${r.tipo}`).join(', ');
    t += `. Total ${fmtH(p.totais?.t)}.`;
    if ((p.atualiza || []).length) t += ' Atenção: já havia registos deste dia, serão atualizados.';
    return t + ' Diga confirmar para guardar, ou cancelar.';
  },
  cartao: (p, ctr) => `<div class="ci-ac">
      <div class="ci-ac-t">Folha de ponto · MO Plandese</div>
      <div class="ci-ac-o">${esc(p.obra_nome || '')}</div>
      <div class="ci-ac-n" style="margin:0 0 6px">${esc(dataPT(p.data))}</div>
      <ul class="ci-pt">${(p.registos || []).map(r => `<li><span>${esc(r.nome)}${(p.atualiza || []).includes(r.colab_numero) ? ' <em>(atualiza)</em>' : ''}</span><span>${r.tipo === 'Presença' ? esc(r.entrada) + '–' + esc(r.saida) + ' · ' + fmtH(r.horas_t) : `<b class="ci-aus">${esc(r.tipo)}</b>`}</span></li>`).join('')}</ul>
      <div class="ci-ac-m"><span class="ci-pill">${(p.registos || []).filter(r => r.tipo === 'Presença').length} presenças</span><span class="ci-pill">Normais ${fmtH(p.totais?.n)}</span>${p.totais?.e > 0 ? `<span class="ci-pill warn">Extra ${fmtH(p.totais.e)}</span>` : ''}</div>
      ${ctr}
    </div>`,
  // Mesmo que a folha tradicional: marca "registado hoje" e avisa o diretor de obra
  aoFeita: p => {
    try { const d = new Date(); localStorage.setItem(`enc_done_plandese_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, '1'); } catch (e) { /* sem armazenamento */ }
    R.emitEvent?.({ acao: 'Folha de ponto submetida · ' + (S.currentUser?.nome || 'Encarregado') + ' (' + (p.registos || []).length + ' colab.)', seccao: 'historico', obra: [p.obra_id] });
  },
});

export const comprasIAAbrir = () => compras.abrir();
export const pontoIAAbrir = () => ponto.abrir();
