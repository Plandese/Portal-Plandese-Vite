// ═══════════════════════════════════════════════════════════════════
//  AVISOS POR EMAIL — validades dos colaboradores (Identificação, FA, EPI)
//  Painel lateral aberto pelo botão «Avisos por email» da página Colaboradores:
//  quem recebe o email e com que antecedência para cada documento.
//  O envio é feito pela Edge Function «avisos-validades», todos os dias às 08:00
//  (pg_cron); ver migração 20261118_avisos_validades.sql.
// ═══════════════════════════════════════════════════════════════════
import { sb } from '../supabase.js';
import { S } from '../state.js';
import { validadesColaboradores } from './colaboradores-ficha.js';

const TIPOS = { id: 'Identificação', fa: 'Ficha de aptidão (FA)', epi: 'EPI' };
const SUB = { id: 'Cartão de Cidadão, título de residência ou passaporte', fa: 'Exame de medicina do trabalho', epi: 'Entrega de equipamento de proteção individual' };
const REGRA_BASE = { ativo: true, primeiro: 30, n: 3, intervalo: 7, no_dia: true };

let _cfg = null, _enviados = [], _valid = null, _erro = '', _aGuardar = false, _alterado = false, _carregando = false;

const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = m => (typeof window.showToast === 'function' ? window.showToast(m) : alert(m));
const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hoje = () => isoLocal(new Date());
const fmt = s => s ? s.split('-').reverse().join('/') : '—';
const somaDias = (s, n) => { const [y, m, d] = s.split('-').map(Number); return isoLocal(new Date(y, m - 1, d + n)); };
const diasEntre = (a, b) => { const t = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((t(b) - t(a)) / 86400000); };

// mesmos dias que a Edge Function: do maior para o menor (0 = no dia em que caduca)
function diasAviso(r){
  const out = new Set();
  const n = Math.max(0, Math.min(10, Math.floor(+r.n || 0)));
  for(let k = 0; k < n; k++){ const d = Math.floor(+r.primeiro - k * (+r.intervalo || 0)); if(d > 0) out.add(d); }
  if(r.no_dia) out.add(0);
  return [...out].sort((a, b) => b - a);
}
function resumoRegra(r){
  if(!r.ativo) return 'Sem avisos para este documento.';
  const ds = diasAviso(r), pos = ds.filter(d => d > 0);
  if(!ds.length) return 'Nenhum aviso configurado.';
  const lista = pos.length > 1 ? pos.slice(0, -1).join(', ') + ' e ' + pos[pos.length - 1] : String(pos[0] ?? '');
  return (pos.length ? `Avisa a ${lista} ${pos.length === 1 && pos[0] === 1 ? 'dia' : 'dias'} do fim da validade` : 'Avisa só')
    + (r.no_dia ? (pos.length ? ' e no dia em que caduca.' : ' no dia em que caduca.') : '.');
}

// ───────── painel lateral ─────────
function _drawer(){
  let dr = document.getElementById('av-drawer');
  if(!dr){
    document.body.insertAdjacentHTML('beforeend', '<div class="d-scrim" id="av-scrim"></div><aside class="d-drawer av-drawer" id="av-drawer" aria-hidden="true"></aside>');
    dr = document.getElementById('av-drawer');
    document.getElementById('av-scrim').addEventListener('click', fecharAvisosValidades);
    document.addEventListener('keydown', e => { if(e.key === 'Escape' && dr.classList.contains('open')) fecharAvisosValidades(); });
  }
  return dr;
}
export function fecharAvisosValidades(){
  if(_alterado && !confirm('Há alterações por guardar. Fechar mesmo assim?')) return;
  _alterado = false;
  document.getElementById('av-drawer')?.classList.remove('open');
  document.getElementById('av-scrim')?.classList.remove('open');
}
export async function abrirAvisosValidades(){
  const dr = _drawer();
  _carregando = true; _erro = ''; _desenhar();
  requestAnimationFrame(() => { dr.classList.add('open'); document.getElementById('av-scrim')?.classList.add('open'); dr.setAttribute('aria-hidden', 'false'); });
  await _carregar();
  _carregando = false; _desenhar();
}

async function _carregar(){
  const [c, e, v] = await Promise.all([
    sb.from('avisos_validades_config').select('*').eq('id', 1).maybeSingle(),
    sb.from('avisos_validades_enviados').select('numero,tipo,ate,dias,enviado_em').order('enviado_em', { ascending: false }).limit(1000),
    validadesColaboradores().catch(() => null),
  ]);
  if(c.error || !c.data){
    _cfg = null;
    _erro = c.error && /schema cache|does not exist/i.test(c.error.message) ? 'Os avisos por email ainda não estão instalados na base de dados.'
      : c.error ? 'Não foi possível ler a configuração: ' + c.error.message
      : 'Não tem permissão para gerir os avisos (capítulo Recursos Humanos).';
    return;
  }
  _cfg = JSON.parse(JSON.stringify(c.data));
  _cfg.regras = Object.fromEntries(Object.keys(TIPOS).map(k => [k, { ...REGRA_BASE, ...(_cfg.regras?.[k] || {}) }]));
  _cfg.destinatarios = Array.isArray(_cfg.destinatarios) ? _cfg.destinatarios : [];
  _enviados = e.data || [];
  _valid = v;
  _alterado = false;
}

// O que sai no próximo envio (08:00) e as datas dos avisos nos próximos 60 dias
function _proximos(){
  if(!_valid || !_cfg) return [];
  const h = hoje(), ja = new Set(_enviados.map(r => `${r.numero}|${r.tipo}|${r.ate}|${r.dias}`));
  const out = [];
  _valid.forEach(v => {
    const r = _cfg.regras[v.tipo]; if(!r?.ativo) return;
    const ds = diasAviso(r), faltam = diasEntre(h, v.ate);
    const devidos = ds.filter(d => faltam <= d);
    if(devidos.length){ const d = Math.min(...devidos); if(!ja.has(`${v.numero}|${v.tipo}|${v.ate}|${d}`)) out.push({ ...v, agora: true, faltam, quando: h }); }
    ds.filter(d => faltam > d).forEach(d => { const q = somaDias(v.ate, -d); if(diasEntre(h, q) <= 60) out.push({ ...v, agora: false, faltam: d, quando: q }); });
  });
  return out.sort((a, b) => (b.agora - a.agora) || a.quando.localeCompare(b.quando) || (a.faltam - b.faltam) || a.nome.localeCompare(b.nome, 'pt'));
}

const _num = (k, rot, v, suf) => `<div class="av-f"><label>${rot}</label><div class="av-num"><input type="number" data-k="${k}" min="0" max="${k === 'n' ? 10 : 365}" inputmode="numeric" value="${esc(v)}" oninput="avCampo(this)"/><span>${suf}</span></div></div>`;

function _desenhar(){
  const dr = document.getElementById('av-drawer'); if(!dr) return;
  const y = dr.querySelector('.dd-b')?.scrollTop || 0;
  let corpo, rodape = '';
  if(_carregando) corpo = '<div class="dd-vazio">A carregar…</div>';
  else if(_erro) corpo = `<div class="dd-vazio av-erro">${esc(_erro)}</div>`;
  else {
    const cfg = _cfg;
    const dest = cfg.destinatarios.length
      ? cfg.destinatarios.map((d, i) => `<span class="av-dest"><b>${esc(d.nome || d.email)}</b>${d.nome ? `<small>${esc(d.email)}</small>` : ''}<button type="button" onclick="avRemoverDest(${i})" aria-label="Remover ${esc(d.nome || d.email)}">×</button></span>`).join('')
      : '<span class="av-mute">Ainda ninguém recebe estes avisos.</span>';
    const cartoes = Object.entries(TIPOS).map(([k, nome]) => {
      const r = cfg.regras[k];
      return `<div class="av-card${r.ativo ? '' : ' off'}" data-tipo="${k}">
        <div class="av-card-h"><div><b>${nome}</b><small>${SUB[k]}</small></div>
          <label class="av-sw" title="Avisar sobre este documento"><input type="checkbox" data-k="ativo" ${r.ativo ? 'checked' : ''} onchange="avCampo(this)"/><span></span></label></div>
        <div class="av-grid">
          ${_num('primeiro', '1.º aviso', r.primeiro, 'dias antes')}
          ${_num('n', 'N.º de avisos', r.n, r.n == 1 ? 'aviso' : 'avisos')}
          ${_num('intervalo', 'Intervalo', r.intervalo, 'dias')}
        </div>
        <label class="av-chk"><input type="checkbox" data-k="no_dia" ${r.no_dia ? 'checked' : ''} onchange="avCampo(this)"/>Avisar também no dia em que caduca</label>
        <div class="av-res">${esc(resumoRegra(r))}</div>
      </div>`;
    }).join('');
    const prox = _proximos();
    const sit = x => x.agora
      ? (x.faltam < 0 ? `<span class="dd-pill bad">Caducado há ${-x.faltam} d</span>` : x.faltam === 0 ? '<span class="dd-pill bad">Caduca hoje</span>' : `<span class="dd-pill warn">Faltam ${x.faltam} d</span>`)
      : `<span class="dd-pill warn">${x.faltam ? `${x.faltam} d antes` : 'No dia'}</span>`;
    const lista = prox.length
      ? prox.map(x => `<div class="dd-row av-prox"><div class="av-q${x.agora ? ' now' : ''}">${x.agora ? 'Próximo<br>envio' : fmt(x.quando).slice(0, 5)}</div>
          <div class="dd-tx"><b>${esc(x.nome)}</b><small>${TIPOS[x.tipo]} · válido até ${fmt(x.ate)}</small></div><div class="dd-pills">${sit(x)}</div></div>`).join('')
      : `<div class="dd-vazio">${_valid === null ? 'Sem acesso às validades dos colaboradores.' : 'Não há avisos previstos nos próximos 60 dias.'}</div>`;
    const nAgora = prox.filter(x => x.agora).length;
    corpo = `
      <div class="av-on"><div><b>Enviar avisos por email</b><small>Todos os dias às 8h sai um único email com os avisos do dia.</small></div>
        <label class="av-sw"><input type="checkbox" id="av-ativo" ${cfg.ativo ? 'checked' : ''} onchange="avCampoGeral()"/><span></span></label></div>
      <h4>Quem recebe</h4>
      <div class="av-dests">${dest}</div>
      <div class="av-add">
        <div class="av-f"><label for="av-nd">Nome</label><input id="av-nd" type="text" placeholder="Ex.: Rui Gonçalves"/></div>
        <div class="av-f"><label for="av-ed">E-mail</label><input id="av-ed" type="email" placeholder="nome@plandese.com" onkeydown="if(event.key==='Enter')avAdicionarDest()"/></div>
        <button type="button" class="av-btn-add" onclick="avAdicionarDest()">Adicionar destinatário</button>
      </div>
      <h4>Antecedência por documento</h4>
      <p class="av-ajuda">O 1.º aviso sai com a antecedência escolhida; os seguintes, de tantos em tantos dias (o intervalo).</p>
      ${cartoes}
      <h4>Próximos avisos${nAgora ? ` · ${nAgora} no próximo envio` : ''}</h4>
      ${lista}`;
    rodape = `<button class="btn btn-secondary" onclick="avTeste()">Enviar email de teste</button>
      <button class="btn btn-primary" id="av-guardar" onclick="avGuardar()" ${_aGuardar || !_alterado ? 'disabled' : ''}>${_aGuardar ? 'A guardar…' : (_alterado ? 'Guardar' : 'Guardado')}</button>`;
  }
  dr.innerHTML = `
    <div class="dd-h">
      <button class="dd-x" onclick="fecharAvisosValidades()" aria-label="Fechar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <small>Colaboradores</small>
      <h2>Avisos por email</h2>
      <p>Identificação, FA e EPI a caducar</p>
    </div>
    <div class="dd-b">${corpo}</div>
    ${rodape ? `<div class="dd-f">${rodape}</div>` : ''}`;
  const b = dr.querySelector('.dd-b'); if(b) b.scrollTop = y;
}

function _marcar(){
  _alterado = true;
  const b = document.getElementById('av-guardar'); if(b && !_aGuardar){ b.textContent = 'Guardar'; b.disabled = false; }
}
export function avCampo(el){
  const card = el.closest('[data-tipo]'); if(!card || !_cfg) return;
  const r = _cfg.regras[card.dataset.tipo], k = el.dataset.k;
  if(el.type === 'checkbox') r[k] = el.checked;
  else r[k] = Math.max(0, Math.min(k === 'n' ? 10 : 365, parseInt(el.value, 10) || 0));
  _marcar();
  if(el.type === 'checkbox') _desenhar();
  else {
    card.querySelector('.av-res').textContent = resumoRegra(r);
    if(k === 'n'){ const s = el.parentElement.querySelector('span'); if(s) s.textContent = r.n == 1 ? 'aviso' : 'avisos'; }
  }
}
export function avCampoGeral(){ if(!_cfg) return; _cfg.ativo = document.getElementById('av-ativo').checked; _marcar(); }
export function avAdicionarDest(){
  const n = document.getElementById('av-nd'), e = document.getElementById('av-ed');
  const email = (e?.value || '').trim().toLowerCase(), nome = (n?.value || '').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ toast('Escreva um e-mail válido'); e?.focus(); return; }
  if(_cfg.destinatarios.some(d => d.email === email)){ toast('Esse e-mail já está na lista'); return; }
  _cfg.destinatarios.push({ nome, email });
  _alterado = true; _desenhar();
}
export function avRemoverDest(i){ _cfg.destinatarios.splice(i, 1); _alterado = true; _desenhar(); }

export async function avGuardar(){
  if(!_cfg || _aGuardar) return;
  _aGuardar = true; _desenhar();
  const { error } = await sb.from('avisos_validades_config').update({
    ativo: _cfg.ativo, destinatarios: _cfg.destinatarios, regras: _cfg.regras,
    atualizado_em: new Date().toISOString(), atualizado_por: S.currentUser?.key || null,
  }).eq('id', 1);
  _aGuardar = false;
  if(error){ toast('Não foi possível guardar: ' + error.message); _desenhar(); return; }
  _alterado = false; toast('Avisos guardados'); _desenhar();
}
export async function avTeste(){
  if(_alterado){ toast('Guarde primeiro as alterações'); return; }
  if(!_cfg?.destinatarios.length){ toast('Acrescente pelo menos um destinatário'); return; }
  toast('A enviar o email de teste…');
  const { data, error } = await sb.functions.invoke('avisos-validades', { body: { acao: 'teste' } });
  let msg = data?.error;
  if(error){ try{ msg = (await error.context?.json())?.error || error.message; }catch{ msg = error.message; } }
  if(msg){ toast('Não foi possível enviar: ' + msg); return; }
  toast(`Email de teste enviado para ${data.enviados} ${data.enviados === 1 ? 'pessoa' : 'pessoas'}`);
}
