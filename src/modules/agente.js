// ═══════════════════════════════════════
//  ASSISTENTE IA — painel de conversa com o agente da Plandese
//  · Fala com a Edge Function "agente" (JWT do utilizador; a RLS decide o que ele vê)
//  · Resposta em stream (NDJSON): texto, ferramentas usadas, atalhos e ações a confirmar
//  · Alertas proativos (regras no servidor) com selo no botão e resumo do dia
//  Não está disponível para encarregados.
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S } from '../state.js';
import { canAccessSection } from './permissions.js';

const URL_FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agente`;
const ANON = import.meta.env.VITE_SUPABASE_KEY;
const MAX_GUARDADAS = 40;
const BRIEFING_TTL = 5 * 60 * 1000;

const $ = id => document.getElementById(id);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const me = () => S.currentUser?.key;
const storeKey = () => 'plandese_agente_' + me();

const ICO = {
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4M17 5h4M5 17v4M3 19h4"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v11H3V10zM7 10l4-8a3 3 0 0 1 3 3v4h6a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.6 21H7"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V3h4v11zM17 14l-4 8a3 3 0 0 1-3-3v-4H4a2 2 0 0 1-2-2.3l1.4-8A2 2 0 0 1 5.4 3H17"/></svg>',
};

let msgs = [];          // {role, content, ferr?, nav?, acoes?, logId?, fb?, erro?}
let alertas = [];
let briefingTs = 0;
let busy = false;
let ctrl = null;
let started = false;
let aberto = false;
let corrente = null;    // mensagem do assistente em curso
let ultimoPedido = '';

// ── Markdown mínimo e seguro (escapa primeiro) ─────────────────────
function inline(t){
  return t
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}
function md(src){
  const L = esc(src).split('\n');
  const out = [];
  for(let i = 0; i < L.length;){
    const l = L[i];
    if(/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(L[i + 1] || '')){
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(l);
      i += 2;
      const rows = [];
      while(i < L.length && /^\s*\|.*\|\s*$/.test(L[i])) rows.push(cells(L[i++]));
      out.push('<div class="ag-tb"><table><thead><tr>' + head.map(h => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    if(/^\s*[-*•]\s+/.test(l)){
      const it = [];
      while(i < L.length && /^\s*[-*•]\s+/.test(L[i])) it.push(L[i++].replace(/^\s*[-*•]\s+/, ''));
      out.push('<ul>' + it.map(x => `<li>${inline(x)}</li>`).join('') + '</ul>');
      continue;
    }
    if(/^\s*\d+[.)]\s+/.test(l)){
      const it = [];
      while(i < L.length && /^\s*\d+[.)]\s+/.test(L[i])) it.push(L[i++].replace(/^\s*\d+[.)]\s+/, ''));
      out.push('<ol>' + it.map(x => `<li>${inline(x)}</li>`).join('') + '</ol>');
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if(h){ out.push(`<h4>${inline(h[2])}</h4>`); i++; continue; }
    if(!l.trim()){ i++; continue; }
    // Consome sempre a 1.ª linha (uma tabela ainda incompleta durante o stream começa por "|" e não
    // casa com nenhum bloco acima; sem isto o ciclo nunca avançava e o separador congelava).
    const p = [L[i++]];
    while(i < L.length && L[i].trim() && !/^\s*([-*•]|\d+[.)])\s+/.test(L[i]) && !/^\s*\|/.test(L[i]) && !/^#{1,4}\s/.test(L[i])) p.push(L[i++]);
    out.push('<p>' + inline(p.join('<br>')) + '</p>');
  }
  return out.join('');
}

// ── Persistência local (por utilizador) ────────────────────────────
function guardar(){
  try{
    const lim = msgs.filter(m => m.content || m.acoes?.length).slice(-MAX_GUARDADAS)
      .map(({ role, content, nav, acoes, logId, fb, erro }) => ({ role, content, nav, acoes, logId, fb, erro }));
    localStorage.setItem(storeKey(), JSON.stringify(lim));
  }catch(e){}
}
function carregar(){
  try{ msgs = JSON.parse(localStorage.getItem(storeKey()) || '[]') || []; }catch(e){ msgs = []; }
  // ações que ficaram por decidir noutra sessão: o servidor valida o estado quando se clica
}

// ── Rede ───────────────────────────────────────────────────────────
async function chamar(body, signal){
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  if(!token) throw new Error('Sessão expirada. Volte a iniciar sessão.');
  return fetch(URL_FN, {
    method: 'POST', signal,
    headers: { Authorization: 'Bearer ' + token, apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
async function chamarJson(body){
  const r = await chamar(body);
  const j = await r.json().catch(() => ({}));
  if(!r.ok) throw new Error(j.error || ('Erro ' + r.status));
  return j;
}

// ── Contexto do ecrã ───────────────────────────────────────────────
function contexto(){
  const sec = document.querySelector('#admin-app .section.active');
  const id = sec?.id?.startsWith('sec-') ? sec.id.slice(4) : '';
  return id ? { seccao: id } : {};
}

// ── Arranque / paragem ─────────────────────────────────────────────
export function initAgente(){
  if(!me() || S.currentUser.role === 'encarregado') return;
  agenteStop();
  started = true;
  carregar();
  const fab = document.createElement('button');
  fab.id = 'ag-fab'; fab.type = 'button'; fab.title = 'Assistente IA'; fab.setAttribute('aria-label', 'Abrir o assistente IA');
  fab.innerHTML = ICO.spark + '<span class="ag-fab-badge" id="ag-fab-badge" hidden></span>';
  fab.addEventListener('click', () => agenteToggle());
  const pn = document.createElement('aside');
  pn.id = 'ag-panel'; pn.setAttribute('role', 'dialog'); pn.setAttribute('aria-label', 'Assistente Plandese');
  pn.innerHTML = `
    <header class="ag-hdr">
      <div class="ag-hdr-ic">${ICO.spark}</div>
      <div class="ag-hdr-tx"><b>Assistente Plandese</b><small id="ag-sub">Pergunte sobre os dados do portal</small></div>
      <div class="ag-hdr-acts">
        <button type="button" data-ag="limpar" title="Nova conversa">${ICO.trash}</button>
        <button type="button" data-ag="fechar" title="Fechar">${ICO.close}</button>
      </div>
    </header>
    <div class="ag-body" id="ag-body"></div>
    <div class="ag-compose">
      <textarea id="ag-in" rows="1" placeholder="Pergunte alguma coisa… (Enter envia)" aria-label="Pergunta"></textarea>
      <button type="button" id="ag-send" data-ag="enviar" title="Enviar">${ICO.send}</button>
    </div>
    <div class="ag-foot">As respostas usam apenas os dados que o seu perfil pode ver. Confirme valores importantes.</div>`;
  document.body.append(fab, pn);

  pn.addEventListener('click', onClick);
  const inp = $('ag-in');
  inp.addEventListener('keydown', e => {
    if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); enviarDoInput(); }
  });
  inp.addEventListener('input', () => { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 130) + 'px'; });
  document.addEventListener('keydown', onEsc);
  render();
  setTimeout(() => carregarBriefing(), 3000);
}

export function agenteStop(){
  if(ctrl){ try{ ctrl.abort(); }catch(e){} }
  ctrl = null; busy = false; corrente = null;
  $('ag-fab')?.remove(); $('ag-panel')?.remove();
  document.removeEventListener('keydown', onEsc);
  document.body.classList.remove('ag-open');
  msgs = []; alertas = []; briefingTs = 0; started = false; aberto = false;
}

const onEsc = e => { if(e.key === 'Escape' && aberto) agenteToggle(false); };

export function agenteToggle(abrir){
  if(!started) return;
  aberto = typeof abrir === 'boolean' ? abrir : !aberto;
  $('ag-panel')?.classList.toggle('open', aberto);
  document.body.classList.toggle('ag-open', aberto);
  if(aberto){
    render();
    if(Date.now() - briefingTs > BRIEFING_TTL) carregarBriefing();
    setTimeout(() => $('ag-in')?.focus(), 80);
  }
}

// ── Alertas ────────────────────────────────────────────────────────
async function carregarBriefing(){
  try{
    const j = await chamarJson({ acao: 'briefing' });
    alertas = Array.isArray(j.alertas) ? j.alertas : [];
    briefingTs = Date.now();
    const altas = alertas.filter(a => a.nivel === 'alta').length;
    const b = $('ag-fab-badge');
    if(b){ b.textContent = altas > 9 ? '9+' : String(altas); b.hidden = !altas; }
    const sub = $('ag-sub');
    if(sub && j.limite != null) sub.textContent = `${j.usadas ?? 0}/${j.limite} perguntas hoje`;
    if(aberto && !msgs.length) render();
  }catch(e){ /* sem alertas: silêncio */ }
}

// ── Ações do painel (delegação) ────────────────────────────────────
function onClick(e){
  const t = e.target.closest('[data-ag]');
  if(!t) return;
  const a = t.dataset.ag;
  if(a === 'fechar') return agenteToggle(false);
  if(a === 'limpar') return limpar();
  if(a === 'enviar') return busy ? parar() : enviarDoInput();
  if(a === 'chip') return enviar(t.dataset.q);
  if(a === 'resumo') return resumoDia();
  if(a === 'alerta') return irPara(t.dataset.sec);
  if(a === 'nav') return irPara(t.dataset.sec);
  if(a === 'acao') return decidirAcao(t.dataset.id, t.dataset.d, t);
  if(a === 'fb') return feedback(Number(t.dataset.log), Number(t.dataset.v), t);
  if(a === 'retry') return ultimoPedido && enviar(ultimoPedido);
}

function irPara(sec){
  if(!sec) return;
  if(window.innerWidth <= 900) agenteToggle(false);
  try{ window.goTo?.(sec, document.querySelector(`.sidebar .nav-btn[onclick*="'${sec}'"]`)); }catch(e){}
}

function limpar(){
  if(busy) parar();
  msgs = []; guardar(); render();
}
function parar(){ if(ctrl) ctrl.abort(); }

function enviarDoInput(){
  const inp = $('ag-in'); if(!inp) return;
  const v = inp.value.trim();
  if(!v) return;
  inp.value = ''; inp.style.height = 'auto';
  enviar(v);
}

// ── Envio e leitura do stream ──────────────────────────────────────
async function enviar(texto){
  if(busy || !texto) return;
  ultimoPedido = texto;
  msgs.push({ role: 'user', content: texto });
  corrente = { role: 'assistant', content: '', ferr: [], nav: [], acoes: [] };
  msgs.push(corrente);
  setBusy(true);
  render(true);

  const historico = msgs.slice(0, -1).filter(m => m.content).map(m => ({ role: m.role, content: m.content }));
  ctrl = new AbortController();
  let fim = false;
  try{
    const r = await chamar({ acao: 'chat', mensagens: historico, contexto: contexto() }, ctrl.signal);
    if(!r.ok){
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || ('Erro ' + r.status));
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while(true){
      const { done, value } = await reader.read();
      if(done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while((i = buf.indexOf('\n')) >= 0){
        const linha = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if(!linha) continue;
        let ev; try{ ev = JSON.parse(linha); }catch(_){ continue; }
        if(ev.type === 'fim') fim = true;
        tratarEvento(ev);
      }
    }
  }catch(e){
    if(e.name === 'AbortError'){ corrente.content += corrente.content ? '\n\n_(interrompido)_' : '_(interrompido)_'; }
    else corrente.erro = String(e.message || e);
  }finally{
    if(!fim && !corrente.content && !corrente.erro) corrente.erro = 'Sem resposta do assistente.';
    corrente.ferr = [];
    const c = corrente; corrente = null;
    setBusy(false); ctrl = null;
    guardar(); render(true);
    carregarBriefing();
    return c;
  }
}

function tratarEvento(ev){
  if(!corrente) return;
  switch(ev.type){
    case 'texto':
      corrente.content += ev.texto; corrente.ferr = []; break;
    case 'ferramenta':
      if(corrente.content && !/\n\n$/.test(corrente.content)) corrente.content += '\n\n';
      corrente.ferr = [ev.rotulo || ev.nome]; break;
    case 'nav':
      if(!corrente.nav.some(n => n.seccao === ev.seccao) && canAccessSection(ev.seccao)) corrente.nav.push({ seccao: ev.seccao, rotulo: ev.rotulo });
      break;
    case 'acao':
      corrente.acoes.push({ id: ev.id, tipo: ev.tipo, resumo: ev.resumo, params: ev.params, estado: 'pendente' }); break;
    case 'erro':
      corrente.erro = ev.mensagem; break;
    case 'fim':
      corrente.logId = ev.log_id; break;
  }
  atualizarCorrente();
}

function setBusy(v){
  busy = v;
  const b = $('ag-send');
  if(b){ b.innerHTML = v ? ICO.stop : ICO.send; b.title = v ? 'Parar' : 'Enviar'; b.classList.toggle('stop', v); }
}

// ── Ações com confirmação ──────────────────────────────────────────
async function decidirAcao(id, decisao, btn){
  const alvo = msgs.flatMap(m => m.acoes || []).find(a => a.id === id);
  if(!alvo || alvo.estado !== 'pendente') return;
  alvo.estado = 'a_processar'; render();
  try{
    const j = await chamarJson({ acao: decisao === 'confirmar' ? 'confirmar' : 'cancelar', acao_id: id });
    if(decisao === 'confirmar'){
      alvo.estado = j.ok ? 'feita' : 'erro';
      alvo.msg = j.ok ? j.mensagem : j.erro;
      alvo.seccao = j.seccao;
    } else alvo.estado = 'cancelada';
  }catch(e){
    alvo.estado = 'erro'; alvo.msg = String(e.message || e);
  }
  guardar(); render();
}

async function feedback(logId, v, btn){
  const m = msgs.find(x => x.logId === logId);
  if(!m || m.fb) return;
  m.fb = v; guardar(); render();
  try{ await sb.from('agente_logs').update({ feedback: v }).eq('id', logId); }catch(e){}
}

async function resumoDia(){
  if(busy) return;
  msgs.push({ role: 'user', content: 'Resumo do dia' });
  corrente = { role: 'assistant', content: '', ferr: ['A preparar o resumo'], nav: [], acoes: [] };
  msgs.push(corrente);
  setBusy(true); render(true);
  try{
    const j = await chamarJson({ acao: 'resumo' });
    corrente.content = j.texto || 'Sem alertas de momento.';
    if(Array.isArray(j.alertas)) alertas = j.alertas;
  }catch(e){ corrente.erro = String(e.message || e); }
  corrente.ferr = [];
  corrente = null; setBusy(false); guardar(); render(true);
}

// ── Desenho ────────────────────────────────────────────────────────
function sugestoes(){
  const s = [];
  if(canAccessSection('producao')){
    s.push('Qual a margem de cada obra ativa?');
    s.push('Que obras estão com margem negativa e porquê?');
  }
  if(canAccessSection('historico')) s.push('Quantas horas foram registadas esta semana, por obra?');
  if(canAccessSection('faturas') || canAccessSection('faturas-aprovar')) s.push('Que faturas estão por aprovar?');
  if(canAccessSection('equipamentos')) s.push('Que equipamentos têm seguro ou IPO a expirar?');
  s.push('Calcula 23% de IVA sobre 18 450 €');
  s.push('Como funciona a aprovação do ponto?');
  return s.slice(0, 6);
}

function htmlVazio(){
  const al = alertas.length ? `
    <div class="ag-al">
      <div class="ag-al-h">${ICO.bell}<b>Alertas</b><span>${alertas.length}</span>
        <button type="button" class="ag-link" data-ag="resumo">Resumo do dia</button></div>
      ${alertas.slice(0, 6).map((a, i) => `
        <button type="button" class="ag-al-i ${esc(a.nivel)}" data-ag="alerta" data-sec="${esc(a.seccao)}">
          <i></i><span><b>${esc(a.titulo)}</b><small>${esc(a.detalhe)}</small></span>
        </button>`).join('')}
      ${alertas.length > 6 ? `<div class="ag-al-m">+ ${alertas.length - 6} alertas. Pergunte "mostra todos os alertas".</div>` : ''}
    </div>` : '';
  return `
    <div class="ag-hello">
      <div class="ag-hello-ic">${ICO.spark}</div>
      <h3>Olá, ${esc((S.currentUser?.nome || '').split(' ')[0] || '')}.</h3>
      <p>Posso consultar os dados do portal, fazer contas e criar lembretes ou eventos por si.</p>
    </div>
    ${al}
    <div class="ag-chips">${sugestoes().map(q => `<button type="button" data-ag="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>`;
}

function htmlMsg(m){
  if(m.role === 'user') return `<div class="ag-m user"><div class="ag-b">${esc(m.content)}</div></div>`;
  const corpo = m.content ? md(m.content) : '';
  const est = m.ferr?.length ? `<div class="ag-st"><span class="ag-dots"><i></i><i></i><i></i></span>${esc(m.ferr[0])}…</div>` : '';
  const pensar = (!m.content && !m.ferr?.length && !m.erro && !m.acoes?.length && busy && m === corrente)
    ? '<div class="ag-st"><span class="ag-dots"><i></i><i></i><i></i></span>A pensar…</div>' : '';
  const err = m.erro ? `<div class="ag-err">${esc(m.erro)} <button type="button" class="ag-link" data-ag="retry">Tentar de novo</button></div>` : '';
  const nav = (m.nav || []).map(n => `<button type="button" class="ag-nav" data-ag="nav" data-sec="${esc(n.seccao)}">Abrir ${esc(n.rotulo)} →</button>`).join('');
  const acoes = (m.acoes || []).map(a => {
    const det = Object.entries(a.params || {}).filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `<li><span>${esc(k)}</span> ${esc(v)}</li>`).join('');
    let ctr;
    if(a.estado === 'pendente') ctr = `<div class="ag-ac-b"><button type="button" class="ok" data-ag="acao" data-d="confirmar" data-id="${esc(a.id)}">Confirmar</button><button type="button" data-ag="acao" data-d="cancelar" data-id="${esc(a.id)}">Cancelar</button></div>`;
    else if(a.estado === 'a_processar') ctr = '<div class="ag-ac-s">A executar…</div>';
    else if(a.estado === 'feita') ctr = `<div class="ag-ac-s good">✓ ${esc(a.msg || 'Feito')} ${a.seccao ? `<button type="button" class="ag-link" data-ag="nav" data-sec="${esc(a.seccao)}">Abrir</button>` : ''}</div>`;
    else if(a.estado === 'cancelada') ctr = '<div class="ag-ac-s">Cancelado</div>';
    else ctr = `<div class="ag-ac-s bad">✕ ${esc(a.msg || 'Não foi possível executar')}</div>`;
    return `<div class="ag-ac"><div class="ag-ac-t">Ação proposta</div><div class="ag-ac-r">${esc(a.resumo)}</div><ul>${det}</ul>${ctr}</div>`;
  }).join('');
  const fb = (m.logId && !busy) ? `<div class="ag-fb">
      <button type="button" data-ag="fb" data-log="${m.logId}" data-v="1" class="${m.fb === 1 ? 'on' : ''}" ${m.fb ? 'disabled' : ''} title="Útil">${ICO.up}</button>
      <button type="button" data-ag="fb" data-log="${m.logId}" data-v="-1" class="${m.fb === -1 ? 'on' : ''}" ${m.fb ? 'disabled' : ''} title="Não útil">${ICO.down}</button></div>` : '';
  return `<div class="ag-m bot"><div class="ag-b">${corpo}${est}${pensar}${err}${acoes}${nav ? `<div class="ag-navs">${nav}</div>` : ''}${fb}</div></div>`;
}

function render(descer){
  const body = $('ag-body'); if(!body) return;
  if(!msgs.length){
    body.innerHTML = htmlVazio();
    return;
  }
  const perto = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  body.innerHTML = msgs.map(htmlMsg).join('');
  if(descer || perto) body.scrollTop = body.scrollHeight;
}

// Durante o stream só se redesenha o último balão (evita piscar)
function atualizarCorrente(){
  const body = $('ag-body'); if(!body || !corrente) return;
  const ult = body.lastElementChild;
  if(!ult || !ult.classList.contains('bot')){ render(true); return; }
  const perto = body.scrollHeight - body.scrollTop - body.clientHeight < 120;
  ult.outerHTML = htmlMsg(corrente);
  if(perto) body.scrollTop = body.scrollHeight;
}
